# Friction audit (Oct 2026)

A code-level walk through every flow, built on the premise from
[growth-research.md](growth-research.md): people do the least work possible.
Every tap, typed field, permission prompt, wait, dead end and silent failure is
counted. Refs are `file:line` as of `main` @ 58b03aa. Items marked
"(verify on device)" were inferred from reading the code.

Severity: **H** = loses users or breaks a core loop · **M** = real drag ·
**L** = polish.

## The cost today

| Journey | Installs | Taps | Typed | Permission prompts | Other |
|---|---|---|---|---|---|
| Host: cold install → venue locked + invited | 1 | ~14 | 3 | 2 | N swipes, then an open-ended wait on friends |
| Guest **with** app: link → voted | 0 | 3+ | 0 | 0–1 | Link may not be tappable at all |
| Guest **without** app: link → voted | 1 | 16–20 (+4 if email confirmation is on) | 3 | 2 | 2–4 app switches; must re-find and paste the link |
| Guest: voted → sharing ETA on the day | 0 | 6–8 | 0 | 0–1 | Two waits on the host tapping "Start" |
| Next plan with the same crew | — | Same as a first plan | — | — | Nothing ever prompts it |

## A. Invites and joining (the growth loop)

| # | Sev | Where | Friction |
|---|---|---|---|
| A1 | H | `join/[token].tsx:26,35` | **One link works for one person.** The token is marked `accepted` after the first join, so everyone after that in a group chat sees "invalid or already used". This breaks the share link, "Plan another with this crew" and guest re-shares. |
| A2 | H | `invite.tsx:114`, `index.tsx:202`, `app.json` | **The shared link is `pullup://` only.** It's often not tappable (Android, WhatsApp) and does nothing without the app. There's no https link, no store link and no landing page. |
| A3 | H | `_layout.tsx:122`, `join/[token].tsx:22` | **The join is lost after signup.** `pending_join_token` is saved but never read, so a new user lands on an empty home screen and has to find and paste the link again. |
| A4 | H | `_layout.tsx:116-120` | The join may run twice when the link is opened while signed in, which can show "already used" on top of a join that worked (verify on device). |
| A5 | M | `invite.tsx:114` | The invite text has no host name, time, place or "get the app" line. |
| A6 | M | `invite.tsx:89-100` | If saving the invite fails, the error is ignored and a local token that was never saved gets shared, so the link is dead. |
| A7 | M | `(tabs)/index.tsx:68` | "Join with a code" is a small link at the very bottom of home. There's no clipboard detection. |
| A8 | M | `invite.tsx:119-133` | Recent crew is one tap per person, with no "invite all". Push only, so people without a push token are silently dropped, but the screen still shows "Invited ✓". |
| A9 | L | `invite.tsx:96` | Tokens expire after 7 days, which kills links for plans further out. The expired screen only offers "Go home". |
| A10 | L | `join/[token].tsx:31` | Joining shows no preview or welcome ("Alex invited you · Fri 8pm"). |
| A11 | L | `invite.tsx:150`, `index.tsx:471/609` | The link card shows a placeholder link, and the "+" on the crew row behaves differently depending on plan state. |
| A12 | L | `invite.tsx:198` | "Going so far" doesn't update live. |

## B. Account and permissions

| # | Sev | Where | Friction |
|---|---|---|---|
| B1 | H | `_layout.tsx:84` | **The push prompt fires the moment a session exists**, with no explanation and no second ask. Guests depend on push for everything. |
| B2 | H | `login.tsx:34-41` | Email confirmation, if it's on in prod, sends the user out to Mail and loses the join (check the Supabase Auth setting). |
| B3 | M-H | `login.tsx` | Email and password only. There's no Apple or Google sign-in, no magic link and **no "forgot password"**. |
| B4 | M | `login.tsx:18` | The login screen defaults to "Sign in", even for a new user arriving from an invite. |
| B5 | M | `venues.tsx:126`, `Info.plist:63` | The location prompt appears in the middle of the venue flow with ETA-related wording. If the user denies it, the deck dead-ends with no settings or "pick an area" fallback. Guests shouldn't need location to vote. |
| B6 | M | `migrations/0001:310` | The display name defaults to the email prefix ("jsmith92") and the user is never asked for a name. |

## C. Creating a plan

| # | Sev | Where | Friction |
|---|---|---|---|
| C1 | M | `create.tsx:44,55` | The title is required, and nothing is inferred. "Drinks · Tonight" could be the default. |
| C2 | M | `create.tsx:44-50` | Every plan starts blank: last vibe, mode, area and crew aren't remembered. |
| C3 | M | `venues.tsx:131` | The search area is always the host's GPS, and there's no way to set an area (TODO item). |
| C4 | M | `create.tsx:212`, `edit.tsx` | The `datetime` picker mode probably doesn't work on Android (verify on device). |
| C5 | L-M | `create.tsx:31,35` | "Tonight" after 8pm gives a time in the past, and "Weekend" picked on a Saturday jumps to next week. |
| C6 | L | `create.tsx:259,144,227` | The Create button sits under the keyboard; the "1 of 2" counter suggests a step 2 the user must do; PlacePicker isn't centred on the user's location. |
| C7 | M | `create.tsx:88-93` | If adding the host as a plan member fails, the plan disappears from home without any error. |

## D. Picking the venue

| # | Sev | Where | Friction |
|---|---|---|---|
| D1 | H | `venues.tsx:164-170` | **The venue locks when only the host is in.** With 1 member, the host's first right swipe is 100%. The natural order (invite → Done → swipe) means friends join a plan that's already decided. |
| D2 | H | `venues.tsx:395` | In voting mode the host can't just pick a spot. When the crew stalls, the host gets "All done… check back". |
| D3 | H | `venues.tsx:126-133` | If a **guest** opens the deck first, saving the area is blocked by permissions without an error, and the guest gets "No venues… set an anchor", which they can't do. |
| D4 | M | `venues.tsx:44,113` | The deck restarts at card 0 every visit, showing venues already swiped. The cached order also isn't sorted. |
| D5 | M | `venues.tsx:166` | The 60% bar moves as people join, so early swipers can lock the venue before latecomers vote. |
| D6 | M | `index.tsx:445` | Nothing shows who has or hasn't swiped, and there's no "nudge" button. |
| D7 | M | `index.tsx:457`, `index.tsx:446` | In host mode, guests still see "Swipe venues", which leads to a "Voting disabled" dead end. The plan card copy still says "vote with your crew". |
| D8 | M | `venues.tsx:131` | GPS lookup has no error handling, so the skeleton loads forever if location is off. |
| D9 | M | `venues.tsx:117` | Changing the vibe after the deck exists never refreshes it. |
| D10 | L | `venues.tsx:372` | "All done swiping!" offers only "Start over". There's no back-to-plan button or "we'll ping you". |
| D11 | L-M | `suggest.tsx:76` | A suggestion never triggers the auto-lock check. In host mode the suggested venue lands at the end of the deck. |
| D12 | L | `venues.tsx:249`, `faceoff.tsx:101` | A confirmation alert after an explicit pick is an extra tap. |
| D13 | L | `search-venues:241` | Open/Closed reflects right now, not the plan's time. |
| D14 | L | `venues.tsx:236` | Swipe save errors are ignored. |

## E. Day-of

| # | Sev | Where | Friction |
|---|---|---|---|
| E1 | H | `index.tsx:213-253,613` | **Plans only start when the host taps "Start plan".** Until then guests have no "I'm leaving" button, and there's no day-of reminder. |
| E2 | H | `locationSharing.ts:76`, `app.json` | **Sharing works only while the app is open**, but the leaving flow sends the guest to Google Maps. The ETA freezes the moment they navigate or lock the phone. |
| E3 | M | `eta.tsx:219-256` | "I'm leaving" and "Share ETA" are two separate actions. |
| E4 | M | `index.tsx:552-581` | The host has to "+ Set arrival time" separately even when the plan already has a time. |
| E5 | M | `index.tsx:695`, `eta.tsx:379` | Users must remember to tap "I've arrived" and Stop. There's no geofence. |
| E6 | M | `locationSharing.ts:90`, `eta.tsx:228` | Sessions never expire in the database, so stale pins show, and the "one active session" rule blocks re-sharing ("Could not start sharing"). |
| E7 | L | `index.tsx:609` | Sharing can start days early and expire before the event. |
| E8 | M | `chat.tsx:68`, `notify:63` | One push per chat message, with no mute or grouping, so people turn off notifications for the whole app. |

## F. After the plan and coming back

| # | Sev | Where | Friction |
|---|---|---|---|
| F1 | H | (missing) | **Nothing runs on a schedule.** There's no "tomorrow", "in 1h" or "time to leave" reminder, no "you haven't swiped" nudge and no stalled-vote nudge. The only cron is a data cleanup job. |
| F2 | H | `index.tsx:395` | **Plans never end on their own.** A `venue_locked` plan can't be ended at all, only cancelled, so most plans never reach the recap screen or "Plan another". |
| F3 | H | `index.tsx:723-757` | **There's no real post-plan payoff.** "Add pics" does nothing, "N attended" is really the member count, and there's nothing to share. |
| F4 | H | (missing) | Nothing prompts the next plan: no "same crew again?" push and no "Your crews" on home. |
| F5 | H | `_layout.tsx:97-109` | **A push tap that opens the app from closed is lost**, and the user lands on home. |
| F6 | M | `notify` routing | The chat push opens the plan, not the chat; the tie push opens the plan, not the face-off; the "ended" push has no reason to tap. |
| F7 | M | `index.tsx:266-304` | "Plan another" copies only the title and vibe (not mode, area, time or last venue), reaches only crew with push tokens, and skips the invite screen. |
| F8 | M | `(tabs)/index.tsx:106-160` | Home is sorted by join date, not plan date, and past or overdue plans stay as "Next up" or "Happening now" forever. Past plans have no "again" button. |
| F9 | M | `plans_update_creator` RLS | A co-host who isn't the creator fails to start or end plans, and the error is ignored. |
| F10 | L | `edit.tsx` | Changing the time or vibe doesn't notify the crew. |
| F11 | L | `index.tsx:751` | A cancelled plan dead-ends; there's no "Reschedule with this crew". |
| F12 | L | `(tabs)/index.tsx:117` | Home runs extra queries per plan and refreshes on any membership change. |

## G. Measurement

| # | Sev | Gap |
|---|---|---|
| G1 | H | Invite → join can't be measured: there's no `invite_shared` event, and `plan_joined` has no source or inviter. |
| G2 | H | There are no `app_open`, plan state change or push-opened events, so "did it happen?" and "do pushes work?" can't be answered. |
| G3 | M | There's no crew identity, so weekly active crews can't be counted. Guest → host conversion is only roughly measurable. |

## Security (tracked separately)

Two database access-policy issues in the invites table turned up during this
audit. They have been reported to the maintainer and should be fixed before
the A1 rework, because the fix touches the same rules.
