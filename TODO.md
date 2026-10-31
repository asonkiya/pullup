# TODO

## In review: 1.0 (build 7)
- Resubmitted 2026-10-30. Builds 5 and 6 were rejected for a crash on launch
  (2.1(a)); the cause was missing EAS env vars, fixed from build 6 on.
- Do not publish OTAs to the `production` channel until it's approved: the
  reviewer's build picks them up.

## Build 8 (1.1.0, branch `feat/build-8`)
Done on the branch:
- [x] Version 1.1.0, so build 8 gets its own runtime and OTAs for it can't
      reach build 7.
- [x] ETA sharing keeps running in the background (switch to Maps, lock the
      phone). Uses a location task started by the user's tap, so "While
      Using" permission is enough; iOS shows the blue location pill.
- [x] Push permission asked after creating or joining a plan, with an
      explanation first, instead of at first sign-in.
- [x] Sign in with Apple.
- [x] Profile reads email/phone from the auth user.

Before building 8:
- [ ] Enable the Apple provider in Supabase Auth with client ID
      `com.ahrimane.pullup` (native sign-in needs no secret).
- [ ] Buy the domain, then universal links (below).
- [ ] Update `docs/review-notes.md`: location section (background while
      sharing, no "Always"), Sign in with Apple.

After build 8 is live:
- [ ] Move `supabase/deferred/hide_user_contact_columns.sql` into
      `supabase/migrations/` and push it (hides co-members' email, phone and
      push token; breaks build 7's original bundle, so not before).

### Universal links for invites (needs the domain)
Replace `pullup://join/<token>` shares with an https link that opens the app
directly and shows a landing page for non-users.
1. Buy a domain (GitHub Pages project sites can't serve the AASA file at the
   domain root).
2. Serve `/.well-known/apple-app-site-association` for
   `Z428Z377RQ.com.ahrimane.pullup`, route `/join/*`.
3. `associatedDomains: ["applinks:<domain>"]` in app.json.
4. Landing page / guest web page: "X invited you to Pull Up" + App Store link.
5. Share the https URL; keep `pullup://` as a fallback.

### Other native-build items
- [ ] Send `X-Ios-Bundle-Identifier` on client Google Places calls, then add
      the iOS-app restriction to the Maps API key.
- [ ] Owners can't delete plans from the client — RLS silently no-ops (204, row
      stays). Add delete policy or an edge function; surface errors in UI.

### UX from the 2-phone field test (2026-09-03)
- [ ] **Anchor/area picking.** Today the search area is either an exact venue or
      silent GPS-"near me" (venues screen writes anchor from current position).
      Add an optional "Area" field on plan create + a "change area" control on
      the venues screen — reuse PlacePicker autocomplete but write only
      anchor_lat/lng, don't lock a venue.
- [ ] **Chat peek tap.** The plan screen's latest-message row is coded as a
      TouchableOpacity → chat (shipped in build 6) but reportedly doesn't
      respond on device. Reproduce, check for a parent view swallowing touches
      or a plan-state layout variant missing the touchable; add hitSlop.
- [ ] **ETA widget on plan screen.** Replace the "Who's close" button with an
      embedded compact ETA list (name + minutes) on the plan card; tapping it
      opens the existing full map screen.

## Backend / ops
- [ ] Supabase Pro before user acquisition (free project auto-paused twice;
      keepalive workflow on main is a stopgap).
- [ ] Rotate the old dev@pullup.app password (creds were scrubbed from docs in PR #1).
- [ ] Security advisors (deferred until after review to protect signup trigger):
      SECURITY DEFINER functions (`handle_new_user`, `my_plan_ids`) publicly
      executable; duplicate permissive policies on users/plans/plan_invites;
      leaked-password protection disabled.
- [ ] Consider caching Google place photos (Photos SKU $7/1k) if photo traffic
      grows; autocomplete → Mapbox searchbox is the next cost lever if needed.
