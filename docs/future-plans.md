# Future Plans

A running backlog of work that hasn't been picked up yet, grouped by category and ordered by rough priority within each group. An agent (or human) should be able to read any entry and have enough context to start, including the files involved, the data model touchpoints, and the gotchas to watch for.

Last refreshed: 2026-07-11.

---

## Correctness / bug-squashing

### 1. End-to-end shakedown with a second account
Most lurking bugs only show up under multi-user usage. Run the full loop with two real accounts:
1. Account A creates a plan, shares invite
2. Account B joins via the link (works in a dev build, not Expo Go — see [features.md §2](features.md#2-invite--join-flow))
3. Both swipe; trigger an auto-lock
4. Both suggest a custom venue; verify it appears live on the other side with the "Suggested by" pill
5. Host activates; both share location; verify avatars appear on each other's `LiveMap`
6. Host ends plan; verify recap state on both

Things that might break here that solo testing missed: realtime subs for `venue_candidates` INSERT, `location_points` co-member SELECT (RLS policy `lp_select_co_member`), push notifications not arriving, the host-only update policy on `plans` (the `plans_update_creator` policy ties to `creator_user_id`, not `role='host'` — flag if a non-creator host ever gets demoted by this).

### 2. Verify the departure status fix
Earlier session: user reported "I'm leaving" / "I've arrived" buttons not updating the UI. Fix landed in `db17d1d` (manual `fetchAll()` after the mutation) but wasn't confirmed working after a full Expo Go reload. Worth re-testing once the shakedown happens.

### 3. Re-check the "Start plan" button
Same pattern as above — `activatePlan()` in `app/plan/[id]/index.tsx:118-126` was failing silently; fixed in `a29bf9f` to surface RLS errors via Alert. Confirm it actually fires the state transition cleanly under multi-user conditions.

---

## Feature gaps (real holes in the product)

### 4. Move location sharing into the root layout ✅ DONE
`lib/locationSharing.ts` hook mounted in the root layout watches once for all active sessions and uploads points per session. Screens create/stop sessions and call `refreshLocationSharing()`. iOS still suspends the watch when backgrounded without background entitlements — true background tracking remains item #6.

### 5. Face-off tiebreaker
**Problem.** When multiple venues all hit the 60% auto-select threshold, `checkAutoSelect` in `app/plan/[id]/venues.tsx:133-154` locks the first one it sees. No tie-breaking.

**Fix.** When two or more candidates are tied (or within 1 vote of each other) on a swipe that would trigger auto-lock, instead push the host to `app/plan/[id]/faceoff.tsx` (new) with the tied candidate IDs. UI: bracket-style side-by-side cards, host taps a winner, the winner gets the host-type `venue_selection_events` insert.

**Files.** `app/plan/[id]/venues.tsx` (detection), `app/plan/[id]/faceoff.tsx` (new), `app/plan/[id]/_layout.tsx` (registration).

**Gotcha.** Make sure only the host can resolve a tie — RLS policy `vse_insert` already enforces this for `selection_type='host'`.

### 6. Background location
**Problem.** Today, sharing only works while the app is in the foreground. Useful upgrade for real-world hangout coordination.

**Approach.** Requires:
- A dev build (Expo Go doesn't support background location native modules)
- `expo-task-manager` + `expo-location`'s `startLocationUpdatesAsync` with a background task
- Updated `share_mode` enum to add `'background'`
- Updated consent screen copy + Apple "always" permission rationale
- App Store review will scrutinize this — be ready to justify the use case

**Files.** `app/plan/[id]/eta.tsx` (mode toggle), `app/_layout.tsx` (register task), new `lib/backgroundLocationTask.ts`, migration to extend `share_mode` enum.

### 7. Recent crew / past members suggestions ✅ DONE
Invite screen shows past co-members as tappable tiles. Tapping sends a `crew_invited` push that deep-links to the plan's join token — the invitee joins themselves (consent-respecting, and consistent with the `pm_insert_self` RLS policy). `notify` gained `recipient_user_ids` for targeting non-members.

---

## UX polish (cosmetic, low risk)

### 8. Skeleton loaders ✅ DONE
`components/ui/Skeleton.tsx` (RN Animated shimmer, Expo Go safe) with `SkeletonRow`/`SkeletonList`. Replaced spinners on home, plan detail, and the venue deck.

### 9. Empty states + first-time onboarding ✅ DONE
The home empty state is now a 3-step how-it-works walkthrough with a "Start your first plan" CTA. It lives in the empty state, so it self-expires once the user has plans — no onboarding flag or extra route.

### 10. Profile screen functionality — MOSTLY DONE
Display-name editing, delete account (2-step confirm → `delete-account` edge function), and privacy policy link all exist. Still open if wanted: push notification toggle, location sharing history view.

---

## Production readiness (pre-launch checklist)

### 11. EAS dev build ✅ DONE
`eas.json` and `app.json` are configured (bundle ID `com.ahrimane.pullup`, team `Z428Z377RQ`). Dev client builds are working. See `docs/submission-runbook.md` for the production build step.

### 12. Privacy policy ✅ DONE
`docs/privacy-policy.md` is written. Needs to be published via GitHub Pages — see `docs/submission-runbook.md` step 1.

### 13. Delete account flow ✅ DONE
In-app "Delete account" is accessible from the profile screen (required by App Store guideline 5.1.1.v).

### 14. Analytics wiring ✅ DONE
`lib/analytics.ts` ships fire-and-forget event logging. Instrumented events: `plan_created`, `plan_joined`, `venue_suggested`, `venue_locked`, `eta_share_started`, `departure_leaving`, `departure_arrived`, `affiliate_click`. Retention + funnel SQL in `docs/analytics-queries.md`.

### 15. App Store submission — IN PROGRESS
Store listing (`store.config.json`) passes `eas metadata:lint`. Submission runbook at `docs/submission-runbook.md`. Remaining steps require interactive Apple account access — see the runbook.

---

## Future swings (the bigger stuff)

### 16. In-app friend graph
**Problem.** No concept of "friends" outside per-plan invites. Every plan requires a fresh share-link, even if you hang out with the same crew weekly.

**Fix.** New `friends` table (`user_id`, `friend_user_id`, `created_at`, `status: pending|accepted`). Friend request UI in profile. Then `app/plan/[id]/invite.tsx` can show friends as one-tap-to-add tiles.

**Tradeoff.** Adds significant social-network surface area (privacy, blocking, request management). Worth it only if the per-plan invite friction is actually slowing people down — validate before building.

### 17. Photo uploads in chat
**Problem.** `plan_messages` only supports text (`message_type='text'` is the default).

**Fix.** Supabase Storage bucket `plan_media`, RLS gated on plan membership. `expo-image-picker` in chat input. New `message_type='image'` with the URL in `body` (or a new `media_url` column).

**Files.** Migration, `app/plan/[id]/chat.tsx`, possibly a `MessageMedia` component.

### 18. Plan templates / "redo this plan" ✅ DONE
"Plan another with this crew" on the DONE state clones the plan (title + vibe), creates a join token, and sends a `crew_reinvite` push to the old crew that deep-links to `/join/{token}`. Members re-join themselves (RLS-consistent).

### 19. iMessage extension / WhatsApp share card
**Why.** The network-effect cliff — getting friend group #2 to install the app — is the single biggest adoption blocker (see the product spec's "Honest concerns"). An iMessage extension that lets friends RSVP without installing the standalone app would meaningfully lower the friction.

**Approach.** iOS iMessage extension is its own Xcode target. Would require ejecting from managed Expo or significant config. Big lift. Lower priority until product-market fit is more validated.

---

## Notes for the agent picking this up

- Always check `docs/database.md` for current schema before assuming column names. The repo iterates fast and migrations land often.
- `docs/features.md` has end-to-end flow walkthroughs that are usually the fastest way to understand how a feature actually works.
- Push to `main` is the workflow — small commits, no PR ceremony for solo work.
- Run `npx tsc --noEmit` before committing. The codebase is currently TS-clean — no known suppressions.
- Realtime subs in Supabase don't always fire for the user's own writes — every mutating handler in the codebase explicitly calls `fetchAll()` (or the equivalent refetch) after the await. Don't rely on realtime alone.
- Expo Go limitations to remember: Reanimated v4 + gesture-handler need a dev build, custom URL schemes (`pullup://`) don't work, background location doesn't work.
