# Edge Functions

All edge functions run on Supabase Edge Functions (Deno runtime). They authenticate the caller via Bearer token and use `SUPABASE_SERVICE_ROLE_KEY` for admin database operations.

## Common patterns

**Authentication:**
```typescript
const authHeader = req.headers.get('Authorization');
const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { headers: { Authorization: authHeader } },
});
const { data: { user } } = await userClient.auth.getUser();
```

**Environment variables** (available in all functions):
| Variable | Description |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_ANON_KEY` | Public/anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin key (bypasses RLS) |
| `GOOGLE_MAPS_API_KEY` | Google Maps API key (search-venues, compute-eta only) |

**Invoking from the app:**
```typescript
await supabase.functions.invoke('function-name', {
  body: { ... },
  headers: { Authorization: `Bearer ${session?.access_token}` }, // some functions require this explicitly
});
```

---

## `search-venues`

**Path:** `supabase/functions/search-venues/index.ts`

Searches for nearby venues based on the plan's vibe and location, then computes travel time to each.

### Request

```json
POST /functions/v1/search-venues
Authorization: Bearer <access_token>

{
  "plan_id": "uuid",
  "provider": "google"   // optional — "google" (default) or "mapbox"
}
```

### What it does

1. Fetches the plan's `anchor_lat`, `anchor_lng`, `vibe`, and `travel_mode_default`
2. Maps the vibe to Google Place types:
   | Vibe | Place types |
   |---|---|
   | Food | restaurant |
   | Drinks | bar |
   | Coffee | cafe |
   | Movie | movie_theater |
   | Gaming | amusement_center, bowling_alley |
   | Active | gym, sports_club |
   | Party | night_club, bar |
   | _(none)_ | restaurant, bar, cafe |
3. Calls **Google Places Nearby Search** (2km radius, max 20 results) with field mask: `places.id,displayName,location,rating,userRatingCount,priceLevel,primaryTypeDisplayName,photos,shortFormattedAddress,websiteUri,googleMapsUri,currentOpeningHours`
4. Calls **Google Routes `computeRouteMatrix`** to get ETA from anchor to each venue
5. Sorts results by ETA (shortest first)
6. Upserts into `venue_candidates` with `source = 'nearby_search'` and rich data (photo_urls, address, website_url, maps_url, user_rating_count, is_open)

### Response

```json
{ "inserted": 15 }
```

### Errors

| Status | Cause |
|---|---|
| 401 | Missing or invalid auth token |
| 400 | Missing `plan_id` in body |
| 404 | Plan not found |
| 502 | Google Places API error |

---

## `compute-eta`

**Path:** `supabase/functions/compute-eta/index.ts`

Computes ETAs from all members' current locations to the plan's selected destination.

### Request

```json
POST /functions/v1/compute-eta
Authorization: Bearer <access_token>

{
  "plan_id": "uuid",
  "provider": "google"   // optional — "google" (default) or "mapbox"
}
```

### What it does

1. Resolves the plan destination via a 3-layer fallback (in order):
   - `plans.selected_place_lat / selected_place_lng` — most reliable (set at lock time)
   - `venue_candidates` row matching `plans.selected_place_id`
   - Latest `venue_selection_events` row → join to `venue_candidates` (stable row ID, immune to place ID drift)
2. Finds all active `location_share_sessions` for this plan
3. Gets the latest `location_points` entry per session
4. Calls **Google Routes `computeRouteMatrix`** (or Mapbox Directions API if `provider='mapbox'`) with all member locations as origins and the resolved destination
5. Upserts results into `eta_snapshots` (conflict on `plan_id, user_id`)
6. Broadcasts `eta_updated` event on the `eta-{plan_id}` Supabase Realtime channel

### Response

```json
{ "computed": 3 }
```

### Errors

| Status | Cause |
|---|---|
| 401 | Missing or invalid auth token |
| 400 | Missing `plan_id` |
| 404 | Plan not found |
| 502 | Google Routes API error |

---

## `notify`

**Path:** `supabase/functions/notify/index.ts`

Sends push notifications to plan members via the Expo Push API. Self-heals stale push tokens.

### Request

```json
POST /functions/v1/notify
Authorization: Bearer <access_token>

{
  "event": "plan_activated",
  "plan_id": "uuid",
  "actor_user_id": "uuid",
  "extra": {
    "actor_name": "Alice",
    "plan_title": "Friday dinner",
    "place_name": "Olive Garden",
    "message_body": "omw!"
  }
}
```

### Events and messages

| Event | Recipients | Notification body |
|---|---|---|
| `member_joined` | Host only | `"{actor_name} joined"` |
| `venue_suggested` | All members except actor | `"{actor_name} suggested {place_name}"` |
| `venue_locked` | All members except actor | `"Venue set: {place_name}"` |
| `voting_reopened` | All members except actor | `"{actor_name} re-opened voting — pick again"` |
| `plan_activated` | All members except actor | `"{plan_title} is happening now!"` |
| `plan_ended` | All members except actor | `"{plan_title} has ended"` |
| `plan_cancelled` | All members except actor | `"{plan_title} was cancelled"` |
| `leaving` | All members except actor | `"{actor_name} is on the way!"` |
| `arrived` | All members except actor | `"{actor_name} arrived!"` |
| `chat_message` | All members except actor | `"{actor_name}: {message_body}"` (truncated to 100 chars) |
| `crew_reinvite` | All members of the referenced (old) plan except actor | `"{actor_name} is planning another one — tap to join"` |
| `crew_invited` | Explicit `recipient_user_ids` only | `"{actor_name} invited you — tap to join"` |
| `venue_tie` | Host only | `"It's a tie! Two spots are equally loved — you pick the winner"` |

The actor is always excluded from the recipient list. `member_joined` additionally filters to host only.

**Targeting non-members:** pass `recipient_user_ids: string[]` at the top level of the payload to send to exactly those users instead of the plan's members (used to invite people who aren't in the plan yet).

**Join deep links:** if `extra.join_token` is set, it's included in the push `data` payload; the app routes the tap to `/join/{join_token}` instead of the plan screen.

### What it does

1. Fetches all `plan_members` joined with `users(push_token)` using the service role key
2. Filters out the actor and members without push tokens
3. For `member_joined`, further filters to host only
4. Builds notification payload with title (plan name) and body (event-specific message)
5. Posts batch to `https://exp.host/--/api/v2/push/send`
6. Inspects per-recipient tickets in the response. For any ticket with `status='error'` and `details.error='DeviceNotRegistered'`, clears that user's `push_token` (self-healing for uninstalls).
7. Returns `{ sent, ok, errors }` and logs `notify event=X sent=N ok=N errors=N`

### Response

```json
{ "sent": 4, "ok": 4, "errors": 0 }
```

### Adding a new event

1. Add the event name to the `NotifyEvent` union type at the top of `notify/index.ts`
2. Add a case to the `buildMessage()` switch with the notification body
3. Optionally filter the recipients (e.g., host-only)
4. Call from the app:
   ```ts
   notifyMembers('your_event_name', { extra_key: 'value' });
   ```
   (The helper in `plan/[id]/index.tsx` handles auth + the standard payload shape.)
5. Redeploy: `npx supabase functions deploy notify`
6. Update the event matrix above in this doc

---

## `send-plan-pushes`

Delivers the reminder pushes that the database queues for plans that run
themselves. No request body and no caller identity: it only sends what
`run_plan_automation()` already queued in `plan_pushes`, and
`claim_plan_pushes()` hands each push out once. Deploy with `--no-verify-jwt`
(pg_cron calls it without a key).

### How plans run themselves

pg_cron runs `run_plan_automation()` every 5 minutes (migration
`20261117000000_plans_run_themselves.sql`), then calls this function if the
queue isn't empty. "Plan time" is `coalesce(arrival_time, scheduled_for)`;
plans without a time, and plans with `automation = false` (the App Review demo
plans), are left alone.

| Kind | To | When | Effect |
|---|---|---|---|
| `tomorrow` | Members | 24h before (plans made more than 30h ahead) | "Tomorrow at <place>" |
| `vote` | Members who haven't swiped | max(24h before, 2h after creation) | "<host> is waiting on your vote", opens the deck |
| `locked` | Members | The decide time (below) | Open plan → `venue_locked`, "It's settled: <place>" |
| `host_pick` | Host | max(3h before, 1h after creation), still no spot | "2 people haven't voted yet", opens the deck |
| `starting` | Members | 1h before | `venue_locked` → `active`, "Starts in about an hour" |
| `leave` | Members who haven't left | Travel time + 10 min before (15 to 50 min) | "Time to head out" |
| `ended` | Members | 4h after | `venue_locked`/`active` → `completed`, "Tap for the recap" |

Members who RSVP'd "can't make it" get none of these. Copy never states a
clock time, because the server doesn't know anyone's timezone. One push per
person, kind and plan time; moving the plan re-arms its reminders. A push that
sits unsent for 30 minutes is dropped.

### How a plan decides

Migration `20261118000000_host_pick_default.sql`. The crew is everyone who
hasn't said "can't make it".

- **Host's pick.** The first spot the host likes becomes
  `plans.host_pick_candidate_id`, the default.
- **Early lock** (`cast_vote`): once at least half the crew has voted, a spot
  with 2+ likes from 60% of the people who voted locks. Two spots level on that
  count is a tie for the host's face-off.
- **Decide time** (`decide_due_plans`, run by the same cron job): 3 hours
  before the plan, or an hour after it was made if that's later, but no later
  than 30 minutes before. Most likes wins; ties go to the host's pick, then the
  better rated. With no votes the host's pick wins. A plan with no likes and no
  pick stays open and the host gets the `host_pick` nudge.
- Never auto-decided: host mode, plans with no time, `automation = false`, and
  plans that were already locked once (a host who re-opens voting is in charge).

`vote_status(plan_id)` gives the app and web page the tie, the host's pick and
the decide time.

To add a reminder: add an `insert into plan_pushes` block to
`run_plan_automation()` with a new `kind`, a time window, and
`on conflict do nothing`. Tapping opens `route` (default: the plan screen).

---

## Deploying

```bash
npx supabase functions deploy <function-name>
```

Deploy all functions:
```bash
for fn in search-venues compute-eta notify; do
  npx supabase functions deploy $fn
done
npx supabase functions deploy send-plan-pushes --no-verify-jwt
```

## Setting secrets

Google Maps API key (needed for search-venues and compute-eta):
```bash
npx supabase secrets set GOOGLE_MAPS_API_KEY=<your-key>
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are automatically available in all edge functions.

## Viewing logs

In the Supabase dashboard → Functions → pick a function → Logs tab. Or via the CLI:
```bash
npx supabase functions logs <function-name>
```

The `notify` function logs delivery health (`sent=N ok=N errors=N`) which is the first place to look if push notifications aren't arriving.
