# Guest effort review (Nov 2026)

Question: guests are lazy. Given what the research says, does Pull Up work for
a crew where only the host cares, and if not, what do we change?

Follows `growth-research.md` (Oct) and `friction-audit.md`. Since then the
guest web page, link previews, server-side voting and reminders have shipped.
Method: a live run of the guest link on heypullup.com at iPhone size (throwaway
plan, deleted after), a read of the current app code, and a short research pass.
Items marked *judgment* are opinion.

**Verdict:** joining is now cheap enough. The plan still **stalls without guest
effort**, and that is the part to change. Make the host's choice the default
and a guest's tap a bonus, never a requirement.

## What a guest does today (measured)

| Step | Effort | Time |
|---|---|---|
| Open the link, see "Sam invited you to Friday dinner" | 0 taps | 2.8s |
| "Join as a guest", type a name, "Join plan" | 2 taps, 1 typed field | 2.4s |
| Like one spot | 1 tap | 1.1s |
| Come back later | 0 taps (session remembered) | 1.4s |

Three taps and a name. That matches the best link-based tools: Partiful guests
open a link and RSVP with a phone number, no app
([Partiful help](https://help.partiful.com/hc/en-us/articles/26526377667739-Why-use-Partiful)).
Joining also defaults to "Going", so a guest who does nothing else still counts.

## The bar has moved: the chat itself

- **iMessage polls** (iOS 26): the host adds a poll in the group chat and
  everyone votes with one tap, without leaving the chat. Only works when the
  whole group is on iMessage and iOS 26
  ([MacRumors](https://www.macrumors.com/how-to/create-polls-imessage-group-chats),
  [iGeeksBlog](https://www.igeeksblog.com/how-to-create-poll-in-imessage-on-iphone-ipad/)).
- **WhatsApp events and polls**: RSVP in the chat, reminders, and now an invite
  link for people without WhatsApp
  ([WhatsApp blog](https://blog.whatsapp.com/whatsapp-events-brings-people-together-beyond-the-group-chat)).

A lazy guest compares us to one tap inside a chat they already have open. We
can't beat that on voting. We can beat it on what a poll doesn't do: real
options with ratings and distance, a decision that happens on its own,
reminders, and who's on the way. *Judgment.*

## Where it breaks for a lazy crew

Ordered by how badly it hurts.

1. **The shipped app shares `pullup://` links.** Build 7 (in review) sends
   `pullup://join/<token>`, which most chat apps don't make tappable and which
   never reaches the web page. The https link is only on the build 8 branch.
   The change is JS-only, so it can go out over the air once build 7 is
   approved.
2. **The first guest can arrive to an empty page.** Spots to vote on are only
   fetched when someone opens the swipe deck in the app (`venues.tsx` calls
   `search-venues`). A host who creates a plan and shares the link straight
   away sends guests to "No spots to vote on yet", with nothing to bring them
   back.
3. **Silence blocks the decision.** A spot locks when it has 2+ likes from 60%
   of *all members* (`cast_vote`). Every guest who joins and doesn't vote
   raises the bar, including people who said they can't make it. Six members
   means four likes on the same spot. With a lazy crew that never happens, and
   the plan waits for the host nudge three hours before.
4. **Too many options.** The deck holds up to 20 spots and the web page lists
   all of them (8 spots was already 2.4 screens). Votes scatter, which makes
   (3) worse. Google's own group shortlist for Maps never caught on
   ([Google](https://blog.google/products/maps/all-together-now-group-planning-google-maps/)).
5. **Guests never hear the result.** Web guests get no notifications, and the
   app has no way to post "we're going to X at 8" back to the chat (both Share
   buttons only send the invite). The outcome lives where lazy guests aren't
   looking.
6. **With two people it locks instantly.** In the live run the guest's single
   like locked the spot, because the host had liked the same one (2 of 2).
   Fast, but later arrivals find it already decided. Worth deciding on purpose.
7. **The day of needs the app.** ETA sharing and "who's close" are app-only.
   Fine as the reason to install, but reminders don't reach web guests either.

Smaller: the vote rows squeeze on a phone (ratings cut off, "Can't make it"
wraps); a web guest has no way to delete their guest account.

## What the research supports

- **Defaults beat asking.** People mostly stay with a pre-set option; Johnson
  and Goldstein's organ-donation work is the standard reference
  ([summary](https://thedecisionlab.com/intervention/how-default-settings-doubled-organ-donation-rates-in-the-us)).
  The summaries I found disagree on the exact figures, so I'm citing the
  direction only. Applied here: the plan should go ahead unless someone objects.
- **Every extra step loses people**, with passwords and phone numbers the worst
  ([Venture Harbour](https://ventureharbour.com/how-form-length-impacts-conversion-rates/)
  collects the tests; the per-field numbers quoted around the web are unsourced).
  We ask for a name only, which is about as low as it goes.
- **The organizer carries it.** In a Klook survey of 2,725 travellers, most
  planners said group trips only happen because of them
  ([SAYS](https://says.com/my/lifestyle/travel-lifestyle/holiday-planners-appreciation-survey-klook);
  a travel company's marketing survey, so treat it as colour). Design for one
  person doing the work.
- **App Clips aren't the answer**: usage is widely described as low and the
  gains are anecdotal
  ([Cloud Four](https://cloudfour.com/thinks/android-instant-apps-are-dead-ios-app-clips-should-follow/)).
  The web page already covers this.

I found no good study of how friend groups pick a restaurant, so (3), (4) and
the ordering are judgment backed by the live run, not by data.

## Retrofit, in order

| # | Change | Fixes | Ships via |
|---|---|---|---|
| 1 | Share the https link from the app | 1 | OTA after build 7 is approved (already on build 8) |
| 2 | Fetch spots when the plan is created, and on the web page if there are none | 2 | Server + OTA |
| 3 | **Host's pick is the default.** The host stars a favourite (or we take the top-rated). Guests see "Tacos on Franklin, unless the crew wants something else" with one tap to agree and a short list to object. No votes by the deadline means the host's pick wins | 3, 4, 6 | Server + web + OTA |
| 4 | Count likes against people who voted, not everyone who joined, and auto-pick the leader at a deadline (the host nudge time) | 3 | Server |
| 5 | Show 3 to 5 spots on the web, with "show more" | 4 | Web |
| 6 | "Send to the chat" after a lock: one tap shares "📍 Tacos on Franklin, Fri 7:30" with the link, whose preview already shows the spot | 5 | OTA |
| 7 | "Add to calendar" on the web page, so guests get a reminder without the app | 5, 7 | Web |
| 8 | "I'm in" on the invite card that joins in one step, name on the same screen | Effort | Web |

1, 2, 5, 7 and 8 are small. 3 and 4 change how a plan decides and are the ones
that matter most: after them, a plan with a host and five people who do nothing
still ends with a spot, a time and a message in the chat.

**Measure it:** of people who open an invite link, how many join, how many
vote, and how many plans reach a locked spot without the host forcing it.
`plan_joined {source: web}` and `venue_locked {source}` are already logged;
link opens are not.
