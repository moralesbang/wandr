# Wandr — MVP Scope

**Status:** Approved
**Date:** November 23, 2026
**Related:** [`01-product-brief.md`](./01-product-brief.md) · [`00-identity.md`](./00-identity.md)

The reference for what the MVP includes and what it leaves out. A feature is in the MVP only if it is listed here as a Must, Should or Could; anything else is out until this document changes. Shoulds and Coulds are built only after every Must is done.

---

## 1. Constraints

- **Team:** one person (product, design and engineering), implementing with an AI coding agent.
- **Schedule:**
  - Mon Nov 23: definition and UX.
  - Tue Nov 24: architecture and foundation (project scaffolding and a deployed walking skeleton).
  - Wed Nov 25 – Mon Nov 30: **6 build days** of ~8 hours. Estimates below are in build days (1 d = 8 h) and include tests.
- **Capacity rule:** Musts take at most 60% of build capacity (3.6 d). They currently take **3.75 d (62.5%)**, accepted knowingly; see [§12](#12-risks-to-this-scope).
- **Quality bar:** a portfolio project. A smaller, polished product beats a broader, rough one: scope gives way before quality does.

## 2. The demo this scope must deliver

> Back from a walk, a walker opens Wandr on their laptop and creates "Old houses of Laureles". They drop a find on the blue house with a note and a photo, then draw the route with a handful of points. Later, on their phone's browser, they open the journal and the walk. They choose the blue house and the middle stretch of the route, preview the public page, and create a link. In a second browser session, a friend with no account opens the link and sees exactly that: the blue house with its note and photo, the middle stretch, no start, no end, no other finds and no author. The walker fixes a typo in the blue house's note; the friend reloads and sees the fix. The walker adds a new find; the friend reloads and it isn't there. The walker revokes the link; the friend reloads the page and the photo's address and gets "not found". That night, in dark mode, the walker goes back through the journal using only the keyboard.

Every Must is a step in this story. A feature that isn't on this path isn't a Must.

## 3. MVP goals

There is no user base yet, so the MVP is judged by the author using it for real and by its promises being provably kept.

| Goal | Done when | Verified in |
| --- | --- | --- |
| **The journal is worth using** | The author saves **at least 3 real walks** during or right after the build. | Dogfooding |
| **Saving is quick** | A find with a note takes **< 30 s**; a typical neighborhood route takes **< 2 min**. | M2, M4 |
| **The map editor feels right** | Editing works with mouse and finger; panning is never mistaken for editing. | M4 |
| **A walk can be revisited** | Any walk opens on desktop and on a phone with its route, finds and photos. | M5 |
| **Sharing keeps its promise** | The automated privacy tests pass, and the two-session demo in §2 runs end to end. | M1, M3, M6 |
| **Anyone can use it** | Every Must works with the keyboard and in light and dark mode. | M7 |

## 4. Where the engineering effort goes

Depth goes where a reviewer can understand and verify the decisions:

- **The map editor.** Direct manipulation with mouse and touch, with an explicit rule for when a gesture pans the map and when it edits. Validated first, on a real phone.
- **The private/public boundary.** A link stores a **selection**, and the shared page reads only through the **public projection** ([§5](#5-surfaces-and-sharing-rules)).
- **Tests that defend the privacy promise.** Ownership and data-exposure tests are part of the definition of done for M1, M3 and M6.

## 5. Surfaces and sharing rules

### Terms

- **Selection:** what a link shows: a set of chosen finds and, optionally, one **stretch**.
- **Stretch:** one contiguous part of a walk's route, bounded by two of its points (its **ends**).
- **Public projection:** the single read path behind every shared page. It turns a link's selection into the public data, as the walk is now.

### Surfaces

One web app with two kinds of pages.

| Area | Its job | Who uses it | Account? |
| --- | --- | --- | --- |
| **Journal** (private) | Save, edit and revisit walks; create and revoke links. | The walker | Required |
| **Shared page** (public) | Show a link's selection, read-only. The recipient can pan and zoom the map and open each find. | Anyone with the link | None |
| **Backend** | Check ownership on every journal read and write; serve the public projection. | Both areas | — |

### Rules

These rules define the privacy promise. The tests in M6 defend them.

- **Private by default.** A walk, its finds, photos and route are visible only to their owner until the walker selects them for a link.
- **A link stores a selection, never a query over the walk.** A shared page reads only through the public projection; it never reads a walk, its finds or its route directly.
- **The projection returns an allowlist:** the walk's title and date, each selected find's position, note and photo, and the route points within the stretch. Everything else stays out: unselected finds, points outside the stretch, the author, internal IDs.
- **Selected items stay live; nothing joins on its own.** Editing a selected find's note, photo or position shows on the next reload. A find added after the link was created never appears on it.
- **The stretch follows route edits without growing on its own.** A point inserted between the two ends joins it; moving an end moves the edge; deleting an end moves the edge inward to the next point. With fewer than two points left, the link shows no route.
- **Deletions reach the link.** Deleting a selected find removes it from the link; clearing the route removes the stretch; deleting the walk revokes its link.
- **One link per walk, fixed at creation.** To show something different, the walker revokes the link and creates a new one, at a new address.
- **Revoking is immediate.** The link and every photo reached through it return "not found" on the next request. Shared pages and shared photos are never cached.
- **Photos carry no location.** Location metadata (EXIF GPS) is removed from every photo on upload, shared or not.
- **The shared page never names its author.** No name, no profile, no account details.
- **Link addresses are unguessable.**

## 6. Must have

Without these, Wandr does not solve the brief's three problems: keeping what mattered on a walk, going back to it, and sharing it safely. **Musts are never cut**; when time runs short, Shoulds go first and quality stays.

| # | User outcome | Est. |
| --- | --- | --- |
| M1 | I can create an account, sign in and sign out, and my walks are visible only to me. | 0.25 d |
| M2 | I can save a walk with a title and a date, and place finds on the map, each with a note. | 0.5 d |
| M3 | I can attach one photo to a find. | 0.5 d |
| M4 | I can draw the route of a walk by adding, moving and deleting points on the map, with mouse or finger. | 0.75 d |
| M5 | I can browse my walks and open one to see its route, finds and photos, on desktop and on my phone. | 0.5 d |
| M6 | I can share chosen finds and a stretch of the route through a link that opens without an account, and revoke it at any time. | 1.0 d |
| M7 | I can use Wandr with the keyboard, and in light or dark mode. | 0.25 d |

**Must total: 3.75 d** (62.5% of 6 build days). M4 carries the interaction risk; M3 and M6 carry the privacy risk.

### User stories and acceptance criteria

**M1 — Account**
- As a walker, I want my own private journal, so that nobody else sees my walks.
- ✅ Sign up and sign in with email and password take one screen each; I can sign out from any journal page.
- ✅ Every journal read and write is checked against the owner. **Test:** account B gets "not found" for a walk, find, photo or route owned by account A, by URL or by API.

**M2 — Walk and finds**
- As a walker, I want to mark the house that caught my eye, so that I can find it again.
- ✅ A walk has a title and a date (defaults to today). I can edit both and delete the walk.
- ✅ I can add a find by clicking or tapping the map, move it and delete it.
- ✅ A find needs a note or a photo. The first line of the note serves as its title.
- ✅ A walk with one find and no route is a complete entry.
- ✅ Adding a find with a note takes under 30 s.

**M3 — Photo**
- As a walker, I want to keep the photo I took of the blue house next to its note, so that the memory stays whole.
- ✅ A find has at most one photo. I can add it from my phone's camera roll or my computer, replace it and remove it.
- ✅ The photo shows in the find on desktop and on a phone, at a size that loads fast on a phone.
- ✅ **Test:** a stored photo has no location metadata.

**M4 — Route editor**
- As a walker, I want to keep the path I took, so that I can repeat it.
- ✅ I can add points to the end of the route, insert a point between two others, drag a point and delete one.
- ✅ It works with a mouse on desktop and with a finger on a phone. Panning or zooming the map never moves or adds a point.
- ✅ A typical neighborhood route takes under 2 minutes to draw.
- ✅ The route is optional and can be cleared.

**M5 — Journal**
- As a walker, I want to come back to a past walk, so that I can relive or repeat it.
- ✅ The journal lists my walks, newest first, with an empty state for the first visit.
- ✅ A walk's page shows its route and finds on the map, with their notes and photos.
- ✅ Every journal page is usable at phone width (≥ 360 px) and on desktop.

**M6 — Share**
- As a walker, I want to share one stretch and the finds I pick, so that I can show a walk without revealing where I live.
- ✅ I select finds and, optionally, a stretch of the route (a start point and an end point).
- ✅ I see a preview of the shared page before creating the link; the shared page matches the preview.
- ✅ While editing a walk, I can see which finds and which part of the route are visible on its link.
- ✅ From the walk, I can copy the link or revoke it.
- ✅ Someone without an account opens the link on a phone or a laptop and sees only the selected finds, with their notes and photos, and the stretch.
- ✅ **Test:** the public response contains no unselected find, no route point outside the stretch, no author, and no walk, user or internal ID.
- ✅ **Test:** editing a selected find's note, photo or position shows on the shared page; adding a find does not.
- ✅ **Test:** inserting a point inside the stretch shows on the shared page; adding a point outside it does not; deleting an end moves the edge inward.
- ✅ **Test:** after a revoke, the link and its photos return "not found" on the next request; the photo of an unselected find is never reachable through the link.

**M7 — Keyboard and dark mode**
- As a walker, I want Wandr to work the way I use my devices, so that it never gets in my way.
- ✅ Every action works with the keyboard, with a visible focus, except placing and moving points on the map, which needs a pointer.
- ✅ Wandr follows the system's light or dark setting, including the map. Both modes meet the contrast set in the identity doc.
- ✅ Motion respects `prefers-reduced-motion`.

## 7. Should have

Important, but each has a workaround. Listed in **cut order**: the first one goes first.

| # | User outcome | Est. | Workaround if cut |
| --- | --- | --- | --- |
| S1 | I can change what a link shows, keeping its address, with the same preview. | 0.25 d | Revoke the link and create a new one. |
| S2 | I can search my walks by title or note. | 0.25 d | Scroll the journal; there are few walks early on. |
| S3 | I can see all my walks together on one map. | 0.25 d | Open each walk from the list. |
| S4 | I can center the map on where I am, while the page is open and with my permission. | 0.1 d | Pan to the place. |
| S5 | I can search for a place by name to move the map there. | 0.25 d | The map opens on my latest walk; pan from there. |

**Should total: 1.1 d.** With Musts at 3.75 d, expect only the last ones in the list to be built, if any.

## 8. Could have

Only with time left after the checkpoint in [§10](#10-plan).

- **C1 — Undo** the last change in the route editor.
- **C2 — Preview card in chat apps:** the link shows the title and a static map of the stretch when pasted in a chat. Chat apps keep their own copy, so an edit or a revoke doesn't reach a card already posted; the card shows only what the link showed.
- **C3 — Snap the route to streets** while drawing.
- **C4 — Link expiry:** the walker picks a date after which the link stops working.

## 9. Won't have (this time)

The brief's [non-goals](./01-product-brief.md#6-non-goals) are permanent stances and stay out of every scope. On top of them, the MVP leaves out:

| Feature | Why not now |
| --- | --- |
| Native mobile apps | One responsive web app covers desktop and phone. |
| Password reset, email verification, social login | Each adds an email or identity provider. In the MVP a forgotten password means a lost account. |
| Deleting the account | Deleting walks one by one removes their data and revokes their links. |
| Several photos per find, photos on the walk itself, video | One photo per find keeps the memory anchored to a place and the upload work bounded. |
| Several links per walk, or sharing with specific accounts | One link per walk keeps every link revocable from the walk itself. |
| Explore feed, public profiles, comments | A share link is enough to learn whether anyone wants to receive a walk. A feed needs content and moderation. |
| Streaks | Against gentle motivation; the journal itself shows the habit. |
| Usage analytics or open counters | Recipients have no account and aren't tracked. The brief's success signals are observed by hand. |
| Offline use | A walk is saved after the fact, usually online. |
| GPX import or export | Adds file parsing and edge cases; drawing the route covers the MVP. |
| Opening a find in an external map app, turn-by-turn navigation | Seeing the stretch on the map is enough to repeat a walk. |
| Placing or moving map points with the keyboard | The map editor is pointer-only in the MVP; every other action works with the keyboard. |
| Languages other than English | No translation infrastructure in the MVP. |
| ASCII art beyond empty states | An accent, not a mechanism; empty states are enough to set the tone. |

## 10. Plan

| Day | Planned | Scope |
| --- | --- | --- |
| Tue Nov 24 | Architecture, scaffolding, deployed walking skeleton | Foundation, outside the 6 build days |
| Wed Nov 25 | **Route editor spike on a real phone**, then account | De-risks M4 before anything depends on it; M1 |
| Thu Nov 26 | Walks, finds and photos | M2, M3 |
| Fri Nov 27 | Route editor and journal | M4, M5 |
| Sat Nov 28 | Share | M6 |
| Sun Nov 29 | Keyboard and dark mode pass · **checkpoint at 12:00** | M7, then Shoulds from the bottom of the list up (S5 first) |
| Mon Nov 30 | Hardening and the two-session demo | No new scope |

Keyboard support and both color modes are built into each screen as it's made; Sunday closes the gaps. At the checkpoint, Shoulds start only if every Must meets its acceptance criteria.

## 11. Assumptions

- ASSUMPTION: A shared stretch is one contiguous part of the route, chosen by a start and an end point.
- ASSUMPTION: Map tiles come from a hosted provider with a free tier and both a light and a dark style; no custom tile server.
- ASSUMPTION: Photos arrive as JPEG, PNG or WebP of up to 10 MB; iOS Safari converts HEIC to JPEG on upload.
- ASSUMPTION: Supported browsers are current Chrome, Firefox and Safari, on desktop and on iOS and Android.

## 12. Risks to this scope

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Musts take 62.5% of capacity, above the 60% rule. | Little margin for polish; Shoulds likely don't get built. | Shoulds are cut in order without debate; Monday stays hardening only. |
| Touch gestures for editing clash with map panning. | M4 slips or feels wrong on phones. | Spike on Wednesday on a real phone. If gestures clash, switch to an explicit edit mode and record the decision. |
| Selecting a stretch is awkward on a phone. | M6 slips. | Fall back to sharing the whole route or none, and record the cut. |
| The preview and the shared page drift apart. | The walker approves something other than what gets shared. | Render both from the public projection: the preview is the projection of an unsaved selection. |
| A route edit exposes more than the walker meant (e.g. dragging the stretch's start toward home). | Breaks the privacy promise with no preview in between. | The editor marks what's visible on the link; the stretch never grows on its own; one test per edit type in M6. |
| A photo leaks location, or outlives its link. | Breaks the privacy promise outside the map. | Location metadata is removed on upload; shared photos are reachable only through the link; tests in M3 and M6. |
