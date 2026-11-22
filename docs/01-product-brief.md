# Wandr — Product Brief

> **A slow social network for wanderers.**

**Status:** Draft — in review
**Date:** November 21, 2026
**Related:** [`vision.md`](./vision.md)

---

## 1. Summary

People who walk for pleasure have no good place to keep their walks. Fitness apps measure pace and distance; photos and thoughts end up scattered; and the path itself is rarely saved, so a great walk can't be repeated or shared.

**Wandr** is a mobile walking journal: record a walk (even with the phone in your pocket), attach the photos, thoughts and finds that made it meaningful, and come back to it later to relive or repeat it. When a walker chooses to, they can share a route or a find through a public web link, or let it appear in a calm, popularity-free Explore feed.

The MVP is a bet that **a walking journal is valuable on its own**, before any community exists. It is built by one engineer in an 8-day window, prioritizing polish over breadth.

## 2. Problem

People who walk for pleasure (to clear their head, unwind after work, get some sun, or simply explore their neighborhood) have no good place to keep a record of those walks.

The tools that exist today are built for something else:

- **Fitness trackers (e.g. Strava) measure performance, not experience.** They capture pace, distance and records, but leave no room for what made a walk meaningful: a thought, a beautiful old house, a park or café discovered along the way.
- **Generic tools fragment the memory.** Photos end up in the camera roll, thoughts in a notes app, and the path itself is rarely saved at all. Nothing ties a walk together as one experience.
- **Sharing means exposure.** Existing platforms center the author: a real name, a public profile, follower counts. Sharing a lovely route turns into a popularity contest, or exposes a personal routine.

### What this looks like in practice

> I used to live in a neighborhood full of beautiful old houses, and walking through it was one of my favorite things to do. But those routes stayed with me: I had no way to keep them, and no way to share them with someone who'd enjoy them too. More than once I've wanted to repeat a walk exactly as I did it, only to realize I never saved the path.

### Problems, in priority order

| # | Problem | Addressed in MVP? |
| --- | --- | --- |
| P1 | There is no **personal journal** for walks that values memories (photos, notes, finds) as much as distance. | Yes — core |
| P2 | Walkers **can't repeat a walk** they enjoyed, because the exact path was never kept. | Yes — saved path shown on a map |
| P3 | Walkers can't **share routes and finds safely**, without exposing their identity or routine, or chasing popularity. | Yes — public links and a basic Explore feed |

**Evidence:** first-hand experience of the author, plus informal conversations with other recreational walkers. This is an **assumption to validate**, not proven demand (see [Risks](#8-risks--open-questions)).

## 3. Target user

### Primary: the everyday wanderer

Someone who walks regularly for well-being (mental health, decompressing after work, time in the sun) rather than for training. They notice details: architecture, cafés, parks, small things on the street. They want to **remember** their walks and **build a habit**, not compete.

**What they need from Wandr:**

- Record a walk with minimal effort, without having to set a goal or pace.
- Attach the moments that mattered: photos, a short thought, a find.
- Come back later to a personal, visual journal and see their habit grow.
- Get value from the app **even if they never share anything**.

### Secondary: the curious explorer

Someone looking for inspiration for their next walk: routes, places and finds shared by others. This user depends on primary users sharing content first; an empty feed has no value (the **cold-start problem**).

**Product decision:** the journal is the entry point and must be useful on its own. The MVP serves the explorer in two lightweight ways: **share links** (the walker brings their own audience, so no network is needed) and a **basic Explore feed**, seeded with the author's own walks so it is never empty at launch.

## 4. Proposed solution

A **mobile app** for walkers and a **web app** for anyone who opens a shared link.

| Experience | What the user can do | Problem |
| --- | --- | --- |
| **Record** | Start a walk in a couple of taps and keep the phone in a pocket; the path is recorded in the background. | P1, P2 |
| **Capture** | During or after a walk, add photos, a short thought, or a *find* (a place or detail worth remembering). | P1 |
| **Journal** | Browse past walks as a visual diary; open one to see its path on a map and follow it again. See a simple walk count and weekly streak. | P1, P2 |
| **Share** | Make a walk or a find public and get a web link anyone can open without an account. | P3 |
| **Explore** | Browse a calm feed of public routes and finds: no like counts, no follower counts, no ranking by popularity. | P3 |
| **Profile** | A pseudonymous public profile, with an optional link to Instagram. | P3 |

**Principles that shape every screen** (from the [vision](./vision.md)): walks are **private by default**; sharing never reveals sensitive locations automatically; content comes before its author; stats celebrate the habit and never compare people.

## 5. Goals & success metrics

The MVP has no real user base yet, so success is measured by the author using the product for real, and by the core flows working end to end.

| Goal | Success criterion |
| --- | --- |
| **The journal is worth using** | The author records **at least 5 real walks** with Wandr during or right after the build. |
| **Recording is effortless** | Starting a walk takes **2 taps or fewer**; saving a find takes **under 10 seconds**. |
| **Recording is reliable** | A **30-minute walk with the screen locked** produces a continuous path, with no visible gaps. |
| **A walk can be repeated** | Any past walk can be opened and its path followed on a map. |
| **The sharing loop works** | Someone **without an account** opens a shared link on the web and sees the route and its finds. |

## 6. Scope

### In the MVP

- Walk recording with **background GPS**
- Photos, notes and finds attached to a walk
- Personal journal with walk detail and map
- Simple stats: walk count and weekly streak
- Public share links, viewable on the web without an account
- Basic Explore feed of public routes and finds
- Pseudonymous profile with an optional Instagram link
- Local saving with upload when back online

### Out of the MVP (non-goals)

- **Performance metrics:** pace, records, leaderboards or segments
- **Turn-by-turn navigation** to follow a saved route
- **Collections**
- **Notes and comments** from other people
- **Robust offline sync** (conflict resolution, multi-device editing)
- **Likes, followers or any popularity signal**
- **Algorithmic ranking** of the Explore feed

### Cut order if the schedule slips

Polish is non-negotiable, so if the build runs behind, scope is cut in this order:

1. Explore feed (share links still cover P3)
2. Streaks and stats
3. Instagram link on the profile

**Never cut:** recording with background GPS, finds, the journal, and share links. Together they are the MVP.

## 7. Constraints & assumptions

### Constraints

- **Team:** one engineer (design, product and engineering).
- **Time:** an 8-day build window, roughly 8 hours per day (~64 hours total).
- **Quality bar:** this is also a portfolio project. A **smaller, polished** product is preferred over a broader, rough one. Scope gives way before quality does.

### Assumptions

- Recreational walkers want a journal, not a performance tracker. _(Validated only by the author's experience so far.)_
- A walk is worth recording even without photos or notes, so the bare habit has value on its own.
- Users are more willing to share **places and finds** than **themselves**.

## 8. Risks & open questions

### Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| **Background GPS is hard to get right.** It needs a native build (not a quick prototype), "always" location permission, and survival when the OS suspends the app. | High: without it, P2 fails. | Prototype background recording **on day 1, on a real device**, before building anything else on top of it. |
| **Scope vs. 64 hours.** Mobile, web, background GPS and a feed are a lot for one person. | High | Follow the cut order in [Scope](#6-scope). |
| **Shared routes reveal where people live.** A route usually starts and ends at home. | High: breaks the core privacy promise. | Walks are private by default; shared routes hide their start and end points. |
| **Empty Explore feed.** | Medium | Seed the feed with the author's own walks; the journal works without it. |
| **Demand is unvalidated.** | Medium | Dogfood during the build; show the MVP to a few recreational walkers afterwards. |

### Open questions

To be settled in the PRD. Proposed defaults are in parentheses.

- **Streak rule:** what counts as keeping a streak? _(At least one walk per calendar week.)_
- **Route privacy:** how much of the start and end of a shared route is hidden? _(The first and last ~200 m.)_
- **Profile visibility:** is a profile public as soon as it exists, or only once something has been shared? _(Only once something is shared.)_
- **Explore ordering:** what does "not only recency" mean for the feed in the MVP? _(Chronological for the MVP; revisit once there is content.)_
