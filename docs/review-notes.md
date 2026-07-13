# App Review Notes — paste into App Store Connect → App Review Information

## Demo account
The app requires sign-in. Please use:

- **Email:** `demo@pullup.app`
- **Password:** `PullUp2026!`

(Seeded directly in the backend with a full demo world — live plan, locked
plan, open plan with a venue deck — so the reviewer lands in a working app
that matches the screenshots.)

## What the app does
Pull Up is a group-planning app. A user creates a plan, invites friends, and the
group votes on a venue by swiping through nearby spots. Once a venue is locked,
members can optionally share their live ETA to that location.

## How to test the core flow
1. Sign in with the demo account.
2. Tap **+** to create a plan (give it a title, optionally pick a vibe).
3. On the plan screen, tap **Swipe venues** to vote on nearby places.
4. Lock a venue (host action), then tap **Share ETA** / **Who's close** to see the live map.

## Location usage (important)
Location is used **only in the foreground** and **only per-plan**:
- The app never requests "Always" location and never tracks in the background.
- Sharing is started explicitly by the user (a "Share ETA for this plan" button),
  is scoped to a single plan, and ends automatically after a few hours.
- The usage string is shown at the relevant moment, not at launch.

We request `NSLocationWhenInUseUsageDescription` only. There is no background
location entitlement.

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
| Precise location | Yes | Yes | No | App Functionality (live ETA, foreground only) |
| User content (chat messages) | Yes | Yes | No | App Functionality |
| Other user content (plans, venue votes) | Yes | Yes | No | App Functionality |
| Device ID (push token) | Yes | Yes | No | App Functionality (notifications) |

Not collected: contacts, photos, health, financial info, browsing history,
search history, advertising data, audio, or any sensor data other than GPS.

**Tracking:** No. The app does not track users across apps or websites and
contains no third-party advertising or analytics SDKs.

**Export compliance:** `ITSAppUsesNonExemptEncryption` is set to `false` in
app.json (standard HTTPS only), so no export-compliance documentation is needed.
