# App Review Notes — paste into App Store Connect → App Review Information

## Demo account
The app requires sign-in. Please use:

- **Email:** `demo@pullup.app`
- **Password:** `PullUp2026!`

(Seeded directly in the backend with a full demo world — live plan, locked
plan, open plan with a venue deck — so the reviewer lands in a working app
that matches the screenshots. Plan dates roll forward automatically, so the
plans are always current.)

Sign in with Apple is also available on the login screen and creates a fresh,
empty account.

## What the app does
Pull Up is a group-planning app. A user creates a plan, invites friends, and the
group votes on a venue by swiping through nearby spots. Once a venue is locked,
members can optionally share their live ETA to that location.

## How to test the core flow
1. Sign in with the demo account.
2. Tap **+** to create a plan: pick a vibe and a time (the name fills itself
   in). After creating it, the app explains and then asks for notification
   permission.
3. On the plan screen, tap **Swipe venues** to vote on nearby places.
4. Open **Taco Tuesday** (live now) and tap **Share ETA** to see the live map.
   You can then switch to Apple Maps; sharing continues in the background
   (blue location indicator) until you tap Stop or the plan ends.

## Location usage (important)
Location is used for two things:
- **Finding nearby venues**, while the app is open.
- **Sharing your ETA for one plan**, only after you tap **Share ETA**.

Background use is limited to ETA sharing:
- Sharing is always started by the user, for one plan, and the app asks only
  for **"While Using"** permission. The app never requests "Always".
- While sharing, updates continue if the user switches to a navigation app or
  locks the phone, so friends see an ETA that keeps moving. iOS shows the blue
  location indicator the whole time.
- Sharing stops when the user taps Stop, when the plan ends, or automatically
  after a few hours. When no share is active, the app does not use location in
  the background.
- The user can choose **ETA only**, which shows friends the minutes away
  without a map pin.

`UIBackgroundModes` includes `location` for this purpose only.

## Sign in with Apple
Offered alongside email sign-up. Only the name (first sign-in) and the email
or private relay address Apple provides are used, for the account itself.

## Account deletion
Account + all associated data (plans, messages, location history) can be deleted
in-app from the Profile tab → "Delete account" (double-confirmed).

## Privacy policy
https://asonkiya.github.io/pullup/privacy-policy

---

# App Privacy "nutrition label" — answers for App Store Connect → App Privacy

Declare these data types as **collected**. None are used for tracking or
third-party advertising. All are "linked to the user" and used for **App
Functionality** only.

| Data type | Collected | Linked to user | Used for tracking | Purpose |
|---|---|---|---|---|
| Email address | Yes | Yes | No | App Functionality (account/auth) |
| Name (display name) | Yes | Yes | No | App Functionality |
| Precise location | Yes | Yes | No | App Functionality (venue search; live ETA while the user is sharing) |
| User content (chat messages) | Yes | Yes | No | App Functionality |
| Other user content (plans, venue votes) | Yes | Yes | No | App Functionality |
| Device ID (push token) | Yes | Yes | No | App Functionality (notifications) |

Not collected: contacts, photos, health, financial info, browsing history,
search history, advertising data, audio, or any sensor data other than GPS.

**Tracking:** No. The app does not track users across apps or websites and
contains no third-party advertising or analytics SDKs.

**Export compliance:** `ITSAppUsesNonExemptEncryption` is set to `false` in
app.json (standard HTTPS only), so no export-compliance documentation is needed.
