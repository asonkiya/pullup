# Website (heypullup.com)

Static site in `site/`, hosted on Vercel. The Vercel project is linked to this
repo with Root Directory `site`, so every push to `main` deploys production and
every PR gets a preview URL. No build step; `site/vercel.json` holds the routing.

| Path | What |
|---|---|
| `/` | Landing page |
| `/privacy-policy` | Privacy policy |
| `/support` | Support + FAQ (App Store Connect support URL) |
| `/join/<token>` | Invite page for people without the app (rewritten to `join.html`) |
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

## Later
- Guest web page on `/join/<token>`: show the plan (host, time, place) and let
  guests vote without installing. On Vercel this can be a function in `site/api/`
  that reads the invite (via an `invite-preview` edge function or the anon key)
  and renders per-plan Open Graph tags, plus Supabase anonymous sign-in; see
  friction-audit.md workstream 4.
- An email at the domain (e.g. hello@heypullup.com) instead of the personal
  Gmail on the support and privacy pages.
