# Pull Up — Design Brief for Claude Design

Handoff for generating: (1) hi-fi HTML screens of the app, (2) the app icon, (3) App Store marketing screenshots. Everything below mirrors the shipped React Native app exactly — tokens are copied from `constants/index.ts`, so any screen you generate should be indistinguishable from a real screenshot.

---

## 1. What Pull Up is

Pull Up turns "we should hang out" into actual plans. One person starts a plan and invites the crew with a link. Everyone swipes Tinder-style through nearby venues — the most-loved spot wins and locks in automatically. When it's go time, members share live ETAs on a map, per-plan only, and watch each other converge on the destination.

**Personality:** warm, casual, slightly playful, zero corporate. It's the friend who actually organizes things. Copy is short, lowercase-leaning, uses contractions. The wordmark is `pull up` — always lowercase, Outfit ExtraBold, primary purple.

**Anti-goals:** never sterile/enterprise, never neon-cyberpunk, never Facebook-blue social clutter. No gradients except very subtle ones on marketing surfaces. The app itself is flat, soft, and light — color does the talking.

---

## 2. Design tokens (exact values)

### Colors
| Token | Hex | Use |
|---|---|---|
| primary | `#5B4FE9` | Buttons, links, wordmark, active states |
| primaryPressed | `#4A3ED1` | Pressed button state |
| primaryLight | `#EAE8FD` | Selected chips, locked-state pill |
| primaryFaint | `#F4F2FE` | Tinted card backgrounds, icon circles |
| surface | `#FFFFFF` | Cards, headers |
| background | `#F6F5F8` | Screen background |
| text | `#17171C` | Primary text |
| textSecondary | `#6E6E7A` | Body/meta text |
| textFaint | `#A9A8B3` | Labels, placeholders |
| border | `#E8E7EE` | Hairlines, input borders |
| success / Tint / Deep | `#10B981` / `#E6F7F0` / `#0B8A60` | Live states, arrived |
| warning / Tint / Deep | `#F59E0B` / `#FDF1DC` / `#B26E05` | Planning pill, tie banner |
| error / errorTint | `#EF4444` / `#FDE8E8` | Destructive, NOPE stamp |

### Vibe chip colors (bg / fg / border)
- Food `#FBEFE3` / `#8A5A1E` / `#EDD9BD`
- Drinks `#F0EDFC` / `#5347B8` / `#D8D2F3`
- Party `#FBECF3` / `#94346B` / `#F0D3E2`
- Movie `#ECF0FC` / `#3D55B0` / `#D3DCF4`
- Coffee `#F7F0DF` / `#75601B` / `#E6DBB8`
- Gaming `#E7F4E9` / `#2A7042` / `#C8E5CE`
- Active `#E6F2F7` / `#1F6680` / `#C5E0EB`

### Avatar palette (letter circles, cycle by member index)
`#6A5CE8` `#1E9E7E` `#C98A2A` `#D84F8F` `#4E7FB8` `#8E5BC4` — white letter, weight 700.

### Typography — Outfit (Google Fonts), weights 400/500/600/700/800
Sizes: xs 11 · sm 13 · md 15 · lg 17 · xl 20 · xxl 28 · display 32.
Section labels: 12px, weight 700, UPPERCASE, letter-spacing 1.1, color textFaint.

### Geometry
Spacing scale: 4 / 8 / 16 / 24 / 32 / 48. Radii: card 20 · button 16 · input 14 · photo 24 · chips/pills fully rounded.
Shadows: card = y2 blur12 7% of `#17171C`; floating = y8 blur20 16%; primary button = y6 blur16 30% of `#5B4FE9`.

### Canvas
Design at **430 × 932 pt** (iPhone 15 Plus), export screenshots at **1284 × 2778 px**. Status bar: 9:41, full signal, full battery. Home indicator visible.

---

## 3. Component library

- **NavHead** — 38pt white circle with chevron-left (or ×) Feather icon, hairline border; title 20/700 beside it; optional right slot.
- **HButton** — heights: sm 38 / md 50 / lg 56. Variants: `primary` (primary bg, white 700 text, button shadow), `ghost` (white bg, border, text color label), `tint` (primaryLight bg, primary label), `text` (label only, primary). Radius 16. Pressed = primaryPressed + scale 0.98.
- **VibeChip** — pill, 13/600, vibe colors above; unselected = white bg, border, textSecondary.
- **StatePill** — Planning (warningTint bg / warningDeep text) · Locked (primaryLight / primary) · LIVE (successTint / successDeep with 6pt pulsing dot) · Done (border bg / textSecondary).
- **Avatar / AvatarRow** — letter circle, overlap −8pt with 2pt white ring, "+N" overflow chip.
- **Card** — white, radius 20, card shadow, padding 16–24.
- **ProgressBar** — 6pt track (border color), pill radius, primary fill.
- **CustomTabBar** — white bar, hairline top, two items: Plans (calendar icon) and You (user icon), 11/600 labels, active = primary. Center: 58pt primary circle with white plus, raised −20pt above the bar, 4pt white ring, floating shadow.
- **Skeleton** — border-color blocks, radius 8–20, shimmer.

---

## 4. Demo content (use EXACTLY this — it matches the review demo account)

People: **Alex** (you), **Sarah**, **Jake**, **Maya**. City: Chapel Hill, NC.

Plans:
1. **Taco Tuesday** — LIVE now at **Bartaco Chapel Hill** (tacos, ★4.6, $$, 140 W Franklin St). Sarah arrived (1 min), Jake on the way (6 min), Maya not left (13 min). Chat: Sarah "got us a table on the patio 🌮", Jake "omw! 5 min", Maya "leaving now, order me a marg".
2. **Friday night dinner** — LOCKED at **Lantern** (Asian fusion, ★4.7, $$$, 423 W Franklin St), tomorrow 7:30 PM, 4 going.
3. **Sunday coffee & catchup** — PLANNING, vibe Coffee, Sunday 10:00 AM, 3 members. Deck candidates: Carraway Coffee Roasters (★4.8, $$, 4 min), Open Eye Cafe (★4.7, $, 7 min), Perennial (★4.6, $$, 5 min), Gray Squirrel Coffee (★4.5, $), Purple Bowl (★4.4, $$).
4. **Ramen run** — DONE last week at Tonbo Ramen.

Venue photos: warm, editorial restaurant/cafe photography (Unsplash-style). No stocky people-pointing-at-salad shots.

---

## 5. Screens to generate (in priority order)

1. **Home (Plans)** — header: `pull up` wordmark left (26/800 primary), 34pt avatar right. Live ticker: successTint card, pulsing dot, "Taco Tuesday · Bartaco Chapel Hill" + "Happening now" + avatar row. "NEXT UP" label + hero card: Lantern photo 148pt with countdown pill overlay ("in 1d"), title "Friday night dinner", Food vibe chip, avatar row + "4 going". "UPCOMING": compact row for Sunday coffee (title, "Sun, Jul 19 10:00 AM · Time TBD", avatars, Planning pill). Collapsed "Past plans (1)" row. Custom tab bar with raised +.
2. **Venue swipe deck** — NavHead "Pick the spot" + "+ Suggest" chip. Progress: "2 of 5" + ProgressBar. Card stack (2 back cards peeking, offset/rotated): front card = Carraway photo full-bleed radius 24, story-segment indicators top, scrim bottom with "Carraway Coffee Roasters" 24/800 white + "★ 4.8 · Coffee shop · $$ · 4 min away". Info chips row below. Two action circles at bottom: 64pt white circle with error ×, 64pt success circle with white ✓. Optionally show the LIKE stamp rotated on the card.
3. **Live plan (Taco Tuesday)** — header: title + "Bartaco Chapel Hill · arrive by 7:00", LIVE pill. Map card 196pt: light map of Franklin St, red venue pin, 3 avatar markers with status-dot rings and ETA bubbles ("1m" green, "6m" purple, "13m" gray). Status rows: ARRIVED (Sarah) / ON THE WAY (Jake) / NOT LEFT (Maya) with avatars + fixed pills. Chat peek row (last message). Bottom: "I'm leaving" primary lg + "Get a ride" tint button.
4. **Who's close (ETA screen)** — NavHead "Who's close · Taco Tuesday" + Re-center. Map 38% height, same markers. Green sharing banner "Sharing your location for this plan only · Stop". Ranked ETA list: 1 Sarah 1 min walk 120m · 2 Jake 6 min drive 1.4km · 3 Maya 13 min drive 2.9km, each with avatar + big primary time.
5. **Locked plan (Friday night dinner)** — venue photo card 165pt (Lantern), name + "7 min away" chip, address, Directions/Website ghost buttons, countdown strip "Tomorrow!", arrival time "7:30 PM", WHO'S IN avatar row ×4, Chat + Share ETA ghost row, "Book a table" tint button, "Start plan — happening now" primary lg.
6. **Create plan** — × close, "1 of 2", "What's the move?" 32/800, title input as bare 30/700 text with 2.5pt primary underline ("Taco Tuesday|"), vibe chip row (Food selected), "When-ish?" chips (Tonight selected / Tomorrow / This weekend / Pick exact), optional "Pre-pick a spot" search field, "Create plan" primary lg pinned bottom.
7. **Match moment (overlay)** — full-screen primary bg, confetti shapes (white/primaryLight/success at 20–40% opacity), "It's a match!" 40/800 white rotated −4°, white venue card (Carraway photo + "4/4 liked" pill), "Lock it in" white button w/ primary label + "Keep swiping" text button in white.
8. **Invite screen** — plan title NavHead, "Anyone with the link can join & vote on venues.", dashed primaryFaint link card `pullup://join/x7k2m9q4` + Copy, "Share link" primary, divider "or add from recent plans", 3 crew tiles (avatar + name + "+ Invite"), "Going so far" avatar row, "Done — go to plan" ghost.
9. **Face-off** — NavHead "Break the tie", "The crew loves both. Tap the winner.", two venue photo cards side by side (radius 20) with names/ratings, 44pt primary VS circle with white ring overlapping the seam.
10. **First-run home** — "Make plans that\nactually happen." 32/800, three step cards (zap/heart/map-pin icon in 44pt primaryFaint circles): "Start a plan", "Swipe to pick the spot", "Watch everyone pull up", each with one-line sub; "Start your first plan" primary CTA with plus icon; "Have an invite link? Join with a code" text link.

---

## 6. App icon brief

**Canvas:** 1024×1024, no transparency, no rounded corners (iOS masks it), must read at 29pt.

**Concept direction (pick the strongest, explore 3–4):**
1. **Converging dots** — 3 avatar-colored dots (from the avatar palette) with motion trails converging toward a white location pin, on primary `#5B4FE9`. This is literally the product: friends pulling up to a spot.
2. **Pin + chevron-up** — a map pin whose inner circle is an upward chevron ("pull UP"), white glyph on primary, subtle vertical gradient `#6A5CE8→#5B4FE9`.
3. **Wordmark monogram** — lowercase `pu` set in Outfit ExtraBold, tight, white on primary, the `p` descender doubling as a pin drop.

**Rules:** one bold glyph, generous margins (~12% padding), no thin strokes, no photo, no text smaller than the monogram. Background always primary purple family — the icon should own "purple pin" on a home screen. Also export a 1024 monochrome/dark-mode variant (white bg, primary glyph) for good measure.

---

## 7. App Store screenshots (the actual deliverable to export)

Five frames, **1284 × 2778 px** each, portrait. Style: app screen inside a subtle device frame, floating on a soft brand background (primaryFaint→white vertical wash, faint oversized `pull up` wordmark as texture), big caption above in Outfit ExtraBold 64–72px `#17171C`, one accent word in primary.

1. Home screen — **"Plans that actually happen."**
2. Swipe deck — **"Swipe. Match. Lock it in."**
3. Live map — **"See who's actually on the way."**
4. Who's close list — **"No more 'omw' lies."**
5. Match moment — **"When the crew agrees, it's a match."**

Captions ≤ 6 words, sentence case, period at the end. Screens must use the demo content from §4 so screenshots match what App Review sees when they log into the demo account.
