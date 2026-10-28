# TODO

## After App Store approval (immediate)
- [ ] OTA update (`eas update --branch production`) shipping the committed client fixes:
      Book-a-table removal, Google Maps navigate flow, "Not sharing" ETA label,
      instant snapshot marking on stop-share. Hold until approval so nothing
      changes under the reviewer.
- [ ] Clean demo account test data before/after any manual testing (demo world
      must stay: 4 documented plans).

## Build 7 (needs a new native build)
- [ ] **Universal links for invites.** Replace `pullup://join/<token>` shares with
      an https link that opens the app directly and shows a download landing page
      for non-users (every invite becomes an acquisition funnel).
      1. Decide domain: ~$10/yr custom domain (`pullupapp.com/join/…`) vs free
         GitHub Pages (`asonkiya.github.io/pullup/join/…`).
      2. Serve `/.well-known/apple-app-site-association` for bundle
         `com.ahrimane.pullup`, route `/join/*`.
      3. `associatedDomains: ["applinks:<domain>"]` in app.json (native change —
         this is why it needs build 7).
      4. Landing page: "X invited you to Pull Up" + App Store link.
      5. Share the https URL; keep `pullup://` as fallback.
- [ ] Send `X-Ios-Bundle-Identifier` header on client Google Places calls, then
      add the iOS-app restriction to the Maps API key in Google Cloud (key is
      already API-restricted to Places New + Routes with daily quota caps).
- [ ] Owners can't delete plans from the client — RLS silently no-ops (204, row
      stays). Add delete policy or an edge function; surface errors in UI.
- [ ] Notification tap should deep-link to the relevant plan/chat (verify during
      testing where it currently lands).


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
