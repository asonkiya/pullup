# Website (heypullup.com)

Static site in `site/`, hosted on Vercel. The Vercel project is linked to this
repo with Root Directory `site`, so every push to `main` deploys production and
every PR gets a preview URL. No build step; `site/vercel.json` holds the routing.

| Path | What |
|---|---|
| `/` | Landing page |
| `/privacy-policy` | Privacy policy |
| `/support` | Support + FAQ (App Store Connect support URL) |
| `/join/<token>` | Guest join page (`api/join.js` renders `join.html` + `join.js`); see below |
| `/.well-known/apple-app-site-association` | Universal links: `/join/*` opens the app |

With the app installed, iOS opens `https://heypullup.com/join/<token>` straight
in the app; the page is only seen without it.

## DNS (Squarespace → Domains → heypullup.com → DNS)

| Host | Type | Data |
|---|---|---|
| @ | A | 76.76.21.21 |
| www | CNAME | cname.vercel-dns.com |

`www` redirects to the apex (set on the Vercel domain). The Squarespace
"Email Security" preset stays: it stops anyone sending mail as @heypullup.com.

## Old GitHub Pages URLs

`asonkiya.github.io/pullup` (legacy Pages build of `docs/`) stays up: build 7
links to `/privacy-policy` there and its App Store Support URL is the root.
Once every live build and App Store Connect point at heypullup.com, turn off
Pages and delete `docs/index.md`, `docs/support.md`, `docs/privacy-policy.md`
and `docs/_config.yml`.

## Guest join page

People without the app join from the browser with just a name:

1. `api/join.js` calls `invite_preview(token)` with the anon key and renders
   `join.html` with the plan's title, host and place in the Open Graph tags, so
   the link preview in iMessage/WhatsApp shows the actual plan.
2. "Join as a guest" → name → Supabase **anonymous sign-in**
   (`display_name` in user metadata; `handle_new_user` creates the profile) →
   `join_plan(token)`.
3. The plan view: RSVP, vote on the spot with `cast_vote` (which also
   auto-locks it), the locked spot with Open in Maps, who's coming, and a nudge
   to get the app for ETA sharing on the day.

The session is kept in localStorage, so reopening the link returns to the plan.
Anonymous accounts can't create plans (`plans_insert_creator`). Web guests get
no push notifications.

Vercel env vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (both public).

## Later
- Guest → full account: when a web guest installs the app, link the anonymous
  user (`updateUser` with email / `linkIdentity`) so they keep their plans.
- Turn on CAPTCHA for anonymous sign-ins if spam shows up (Supabase rate-limits
  them per IP by default).
- ETA sharing from the web page (browser geolocation while the tab is open).
- An email at the domain (e.g. hello@heypullup.com) instead of the personal
  Gmail on the support and privacy pages.
