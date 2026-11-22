# Wandr — MVP Scope

**Status:** Draft — in review
**Date:** November 22, 2026
**Related:** [`01-product-brief.md`](./01-product-brief.md)

**Capacity:** 5 build days (Days 3–7) · **Rule:** Must ≤ 60% (≤ 3 days)

---

## 1. Constraints

- **Team:** one person (product, design and engineering), implementing with an AI coding agent.
- **Time:** an 8-day window, roughly 8 hours per day (~64 hours). Days 1–2 are for definition and design; Days 3–7 are for building.
- **Quality bar:** this is a portfolio project. A **smaller, polished** product beats a broader, rough one. Scope gives way before quality does.

## 2. The demo this scope must deliver

> Back from a walk, a walker opens Wandr on their laptop and creates "Old houses of Laureles". They drop a find on the blue house with a note, then draw the route with a handful of points. Later, on their phone's browser, they open the journal and find the walk. They choose the blue house and the middle stretch of the route, preview the public page, and create a link. In a second browser session, a friend with no account opens the link and sees exactly that: no start, no end, no other finds. The walker fixes a typo in the blue house's note; the friend reloads and sees the fix. The walker adds a new find to the walk; the friend reloads and it isn't there. The walker revokes the link; the friend reloads and gets "not found".

Every **Must** below is a step in this story. If a feature isn't on this path, it isn't a Must.

## 3. MVP goals

There is no user base yet, so the MVP is judged by the author using it for real and by its promises being provably kept.

| Goal | Done when | Verified in |
| --- | --- | --- |
| **The journal is worth using** | The author saves **at least 5 real walks** during or right after the build. | Dogfooding |
| **Saving is quick** | A find with a note takes **< 30 s**; a typical neighborhood route takes **< 2 min**. | M2, M3 |
| **The map editor feels right** | Editing works with mouse and finger; panning is never mistaken for editing. | M3 |
| **A walk can be revisited** | Any walk opens on desktop and on a phone with its route and finds. | M4 |
| **Sharing keeps its promise** | Automated tests pass, and the two-session demo in §2 runs end to end. | M1, M5 |

## 4. Where the engineering effort goes

The technical depth is concentrated where a reviewer can understand and verify the decisions:

- **Map editing.** Direct manipulation that works with mouse and touch, with an explicit rule for when a gesture pans the map and when it edits the route. Validated early, on a real phone.
- **An explicit public/private boundary.** A link stores a **selection** (which finds, and the two ends of a stretch), never a query over the walk. The public page goes through a single **public projection** that reads only the selected finds and the route between the two ends, and returns an allowlisted shape. Edits to selected items flow through; nothing unselected can, so adding to a walk after sharing can't publish anything by accident.
- **Tests that defend the promise.** Authorization and data-exposure tests are part of the definition of done for M1 and M5, not an afterthought.

## 5. Surfaces and the privacy boundary

There is one web app with two kinds of pages.

| Area | Its job | Who uses it | Account? |
| --- | --- | --- | --- |
| **Journal** (private) | Save, edit and revisit walks; decide what to share. | The walker | Required |
| **Shared page** (public) | Show the walk's current selection through the public projection. Read-only. | Anyone with the link | None |
| **Backend** | Enforce ownership on every journal read and write; serve the public projection. | Both areas | — |

**Rules that follow:**

- A shared page reads **only** through the public projection. It never queries a walk, its finds or its route directly.
- The projection returns the walk's title and date, the selected finds (position and note), and the route points between the stretch's two ends. It returns no unselected find, no point outside the stretch, no author and no internal ID.
- The stretch follows route edits without ever growing on its own: points inserted between the two ends join it, and moving an end moves the edge. Deleting an end moves the edge inward to the next point; with fewer than two points left, the link shows no route.
- Deleting a selected find removes it from the link. Clearing the route removes the stretch.
- Shared pages are never cached, so edits and revokes take effect on the next reload.

## 6. Must have

Without these, Wandr does not solve P1–P3. Estimates are in build days (1 d = 8 h) and include tests. **Musts are never cut**; if time runs out, Shoulds go first and quality stays.

| # | User outcome | Est. |
| --- | --- | --- |
| M1 | I can create an account and sign in, and my walks are visible only to me. | 0.25 d |
| M2 | I can save a walk with a title and a date, and place finds on the map, each with a note. | 0.5 d |
| M3 | I can draw the route of a walk by adding, moving and deleting points on the map, with mouse or finger. | 0.75 d |
| M4 | I can browse my walks and open one to see its route and finds, on desktop and on my phone. | 0.5 d |
| M5 | I can share chosen finds and a stretch of the route through a link that opens without an account, change what it shows, and revoke it at any time. | 1.0 d |

**Must total: 3.0 d** — exactly at the limit. M3 carries the interaction risk and M5 the privacy risk (see [§12](#12-risks-to-this-scope)).

### User stories & acceptance criteria

**M1 — Account**
- As a walker, I want my own private journal, so that nobody else sees my walks.
- ✅ Sign up and sign in take one screen each.
- ✅ Every journal read and write is checked against the owner. **Test:** account B gets "not found" for a walk, find or route owned by account A, by URL or by API.

**M2 — Walk and finds**
- As a walker, I want to mark the house that caught my eye, so that I can find it again.
- ✅ A walk has a title and a date (defaults to today).
- ✅ I can add a find by clicking or tapping the map, write a note, move it and delete it.
- ✅ A walk with one find and no route is a complete entry.
- ✅ Adding a find with a note takes under 30 s.

**M3 — Route editor**
- As a walker, I want to keep the path I took, so that I can repeat it.
- ✅ I can add points to the end of the route, insert a point between two others, drag a point, and delete one.
- ✅ It works with mouse on desktop and with a finger on a phone. Panning or zooming the map never moves or adds a point by accident.
- ✅ A typical neighborhood route takes under 2 minutes to draw.
- ✅ The route is optional and can be cleared.

**M4 — Journal**
- As a walker, I want to come back to a past walk, so that I can relive or repeat it.
- ✅ The journal lists my walks, newest first, with an empty state for the first visit.
- ✅ A walk's detail shows its route and finds on the map, with the notes.
- ✅ Both pages are usable at phone width (≥ 360 px) and on desktop.

**M5 — Share**
- As a walker, I want to share one stretch and the finds I pick, so that I can show a walk without revealing where I live.
- ✅ I select finds and, optionally, a stretch of the route (a start point and an end point).
- ✅ I see a preview of the public page before creating the link; the shared page matches the preview.
- ✅ A walk has at most one link. From the walk, I can change what it shows (with the same preview) or revoke it.
- ✅ While editing a walk, I can see which finds and which stretch are visible on its link.
- ✅ Someone without an account opens the link and sees only the selected finds and stretch, and no author.
- ✅ **Test:** the public response contains no unselected find, no route point outside the stretch, and no walk, user or internal ID.
- ✅ **Test:** editing a selected find's note or moving it shows up on the shared page; adding a find does not.
- ✅ **Test:** inserting a point inside the stretch shows up; adding a point outside it does not; deleting an end moves the edge inward.
- ✅ **Test:** after I revoke it, the link returns "not found" on the next request.
- ✅ Link slugs are unguessable.

## 7. Should have

Important, but there's a workaround. Listed in **cut order** (first to go on top).

| # | User outcome | Est. | Cut if... |
| --- | --- | --- | --- |
| S1 | I can attach one private photo to a walk. | 0.5 d | Musts aren't done by Day 6 at 12:30. Notes carry the memory. |
| S2 | A shared link shows a preview card (title + static map of the shared stretch) in chat apps. Chat apps keep their own copy of the card, so an edit or a revoke doesn't reach a card already posted; the card only ever shows what the link showed. | 0.25 d | Out of time. The link still opens. |
| S3 | I can undo the last change in the route editor. | 0.25 d | Out of time. Delete a point to fix a mistake. |

**Should total: 1.0 d**

## 8. Could have

Only if there is time left after the Day 6 checkpoint.

- **C1 — Snap the route to streets** while drawing.
- **C2 — Use my current location** to center the map or place a find while walking (foreground only).
- **C3 — Share the photo** of a walk in its link.
- **C4 — Optional display name** on shared pages.

## 9. Won't have (this time)

| Feature | Why not now |
| --- | --- |
| Native mobile apps | One responsive web app covers desktop and phone; a native app triples the surfaces. (Continuous GPS recording is a product non-goal, see the [brief](./01-product-brief.md#6-non-goals).) |
| Explore feed, public profiles | A share link is enough to learn if anyone wants to receive a walk. A feed needs content and moderation. |
| Likes, followers, comments | Against the product, and require moderation. |
| Streaks and stats | Don't serve P1–P3; the journal itself shows the habit. |
| Offline sync | The walk is saved after the fact, usually online. |
| GPX import / export | Adds file parsing and edge cases; manual drawing covers the MVP. |
| Several links per walk | One link per walk keeps every link revocable from the walk itself. Links live in their own table, so allowing more later is a small change. |
| Turn-by-turn navigation | Seeing the route on a map is enough to repeat a walk. |

## 10. Total estimate

**Must: 3.0 d (≤ 3 d ✅) · Should: 1.0 d · Could: not estimated**

### How it fits the 5 build days

| Day | Planned | Scope |
| --- | --- | --- |
| 3 | Walking skeleton (deployed) + **route editor spike on a real phone** | De-risks M3 before anything depends on it |
| 4 | Auth + walks and finds | M1, M2 |
| 5 | Route editor + journal | M3, M4 |
| 6 | Share + Shoulds · checkpoint at 12:30 | M5, then S1 → S3 in order |
| 7 | Hardening + two-session demo | No new scope |

**Read this honestly:** feature days are 4–6, which is exactly the 3 days of Musts. Shoulds only get built with time the Musts don't use. Expect to cut at least S1.

## 11. Assumptions

- ASSUMPTION: A shared stretch is one contiguous segment of the route, chosen by a start and an end point.
- ASSUMPTION: Map tiles come from a hosted provider with a free tier; no custom tile server.

## 12. Risks to this scope

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Touch gestures for editing clash with map panning. | M3 slips or feels wrong on phones. | Spike on Day 3 on a real phone. If gestures clash, switch to an explicit edit mode and record the decision. |
| Selecting a stretch is awkward on a phone. | M5 slips. | Fall back to "share the whole route or none" and record the cut. |
| Preview and shared page logic are duplicated. | The preview and the shared page drift apart. | Render both from the public projection: the preview is the projection of an unsaved selection. |
| A route edit exposes more than the walker meant (e.g. dragging the stretch's start toward home). | Breaks the privacy promise with no preview in between. | The editor marks what's visible on the link; the stretch never grows on its own; one test per edit type in M5. |
| Map library and SSR setup drag on. | M4 and M5 slip. | Render the map client-side only; SSR just the page shell and text. |
