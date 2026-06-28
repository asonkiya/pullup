# App Store submission runbook

Everything that can be automated is done and committed. This is the ordered list
of the remaining steps that need your Apple account or a device. Run them top to
bottom — most are one command each.

## Already done (in the repo)
- App config complete: bundle id `com.ahrimane.pullup`, v1.0.0, splash, icon
  (1024²), location permission strings, account deletion in-app.
- `eas.json`: production build profile + iOS submit profile (team `Z428Z377RQ`).
- `store.config.json`: full App Store listing — **validated** with
  `eas metadata:lint` ✅.
- `docs/review-notes.md`: App Review notes + App Privacy nutrition-label answers.
- Privacy policy written at `docs/privacy-policy.md`.

---

## 1. Publish the privacy policy (Apple requires the URL the app links to)
Enable GitHub Pages (Settings → Pages → Source: `main`, folder `/docs`), or:
```
gh api -X POST repos/asonkiya/pullup/pages -f "source[branch]=main" -f "source[path]=/docs"
```
Confirm `https://asonkiya.github.io/pullup/privacy-policy` loads.
> Note: Pages serves from `main`, so the privacy policy must be on `main`.

## 2. Build the production binary (~30 min, needs Apple login once)
```
npx eas-cli build --profile production -p ios
```
Say **yes** to let EAS create the Distribution Certificate + App Store
provisioning profile.

## 3. Create the app + demo account
- In App Store Connect, create a new app: bundle id `com.ahrimane.pullup`,
  name "Pull Up". (Or let `eas submit` auto-create it in the next step.)
- The app is login-gated, so create a demo account by signing up once in the
  app, then put those credentials into `docs/review-notes.md` and the App Review
  Information section.

## 4. Capture screenshots (no physical phone needed — use the Simulator)
Your broken phone doesn't matter; capture from the iOS Simulator:
```
npx expo run:ios     # builds + launches in the Simulator
```
Use an iPhone 16 Pro Max (6.7") simulator. Cmd+S saves a screenshot. Grab 3–4:
plans home, swipe deck, live ETA map, plan detail. Upload in App Store Connect.

## 5. Push the listing + submit
```
npx eas-cli metadata:push      # pushes store.config.json (name, desc, keywords)
npx eas-cli submit --profile production -p ios
```
`submit` will find or create the App Store Connect app by bundle id and upload
the build from step 2.

## 6. In App Store Connect, before hitting "Submit for Review"
- Paste the App Review notes + demo credentials from `docs/review-notes.md`.
- Fill the App Privacy section using the nutrition-label table in the same file.
- Attach screenshots.
- Set pricing to Free.
- Submit.

---

## Decision still open
`feat/mapbox` holds all the recent work (Mapbox + monetization + submission prep)
and has **not** been merged to `main`. Step 1 (Pages) serves from `main`, and the
build should come from the code you intend to ship — so merge `feat/mapbox` →
`main` once you're comfortable, then run this runbook from `main`.
