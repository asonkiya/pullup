# Website (heypullup.com)

Static site in `site/`, deployed to GitHub Pages by `.github/workflows/pages.yml`
on every push to `main` that touches `site/`.

| Path | What |
|---|---|
| `/` | Landing page |
| `/privacy-policy` | Privacy policy (the source of truth; `docs/privacy-policy.md` is retired at cutover) |
| `/support` | Support + FAQ (App Store Connect support URL) |
| `/join/<token>` | Invite page for people without the app (served by `404.html`) |
| `/.well-known/apple-app-site-association` | Universal links: `/join/*` opens the app |

With the app installed, iOS opens `https://heypullup.com/join/<token>` straight
in the app; the page is only seen without it.

## Cutover

1. **DNS at Squarespace** (Domains → heypullup.com → DNS). Delete the default
   Squarespace records, then add:

   | Host | Type | Data |
   |---|---|---|
   | @ | A | 185.199.108.153 |
   | @ | A | 185.199.109.153 |
   | @ | A | 185.199.110.153 |
   | @ | A | 185.199.111.153 |
   | @ | AAAA | 2606:50c0:8000::153 |
   | @ | AAAA | 2606:50c0:8001::153 |
   | @ | AAAA | 2606:50c0:8002::153 |
   | @ | AAAA | 2606:50c0:8003::153 |
   | www | CNAME | asonkiya.github.io |

2. **Verify the domain on GitHub** (github.com/settings/pages → Add a domain).
   It gives a `_github-pages-challenge-asonkiya` TXT record to add at
   Squarespace. This stops anyone else's repo from claiming the domain.
3. **Switch Pages to Actions and set the domain**, then run the workflow:
   ```sh
   gh api -X PUT repos/asonkiya/pullup/pages -f build_type=workflow -f cname=heypullup.com
   gh workflow run pages.yml
   ```
4. Once the certificate is issued (minutes to an hour), enforce HTTPS:
   `gh api -X PUT repos/asonkiya/pullup/pages -F https_enforced=true`.
5. Check:
   ```sh
   curl -sI https://heypullup.com/privacy-policy | head -1
   curl -s https://heypullup.com/.well-known/apple-app-site-association
   curl -sI https://asonkiya.github.io/pullup/privacy-policy | grep -i location   # redirects to heypullup.com
   ```
6. **App Store Connect:** Privacy Policy URL → `https://heypullup.com/privacy-policy`,
   Support URL → `https://heypullup.com/support`, Marketing URL →
   `https://heypullup.com`.
7. Delete `docs/privacy-policy.md` and `docs/_config.yml` (Pages no longer
   builds `docs/`).

The old `asonkiya.github.io/pullup/...` URLs redirect to the custom domain with
the same path, so build 7's in-app privacy link keeps working.

## Later
- Guest web page on `/join/<token>`: show the plan (host, time, place) and let
  guests vote without installing (needs an `invite-preview` edge function and
  Supabase anonymous sign-in; see friction-audit.md workstream 4).
- An email at the domain (e.g. hello@heypullup.com) instead of the personal
  Gmail on the support and privacy pages.
