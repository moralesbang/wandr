# Wandr — Product Brief

> **A map journal for memorable walks.**

**Status:** Approved
**Date:** November 22, 2026
**Related:** [`00-identity.md`](./00-identity.md) · [`02-mvp-scope.md`](./02-mvp-scope.md) (what gets built first)

---

## 1. Summary

People who walk for pleasure have no good place to keep the walks they want to remember. Photos and thoughts end up scattered, the path is rarely saved, and sharing a lovely stretch with someone means sending a screenshot or a vague description.

**Wandr** is a web map journal for walks. After a walk, you place what caught your eye on a map (a find, with a note or a photo), optionally draw the route you want to repeat, and come back to it later from your laptop or your phone's browser. When you want to, you share **only the finds and the stretch you choose** through a link that opens without an account, stays up to date as you fix your notes, and that you can revoke at any time.

**The promise:** *Wandr helps me keep the walk I want to remember*, not *Wandr records where I walked*.

## 2. Objective

Make it effortless to keep a walk as a memory anchored to a map, and to show it to someone specific without revealing more than you meant to.

The bet: **a walking journal is valuable on its own**, and a single share link is enough to learn whether people want to receive a walk, before any feed or community exists.

## 3. Problem

People who walk for pleasure (to clear their head, unwind after work, or explore their neighborhood) notice things worth remembering: an old house, a quiet park, a café. Those moments get lost.

- **The memory fragments.** Photos end up in the camera roll, thoughts in a notes app, and the path is rarely saved. Nothing ties a walk together as one place on a map.
- **A good walk can't be repeated.** Weeks later, you remember *that* house but not the street, nor the way you got there.
- **Sharing means oversharing.** Sending a recorded track exposes where you started (usually home). Fitness apps add a public profile and counts on top.

### What this looks like in practice

> I used to live in a neighborhood full of beautiful old houses, and walking through it was one of my favorite things to do. But those routes stayed with me: I had no way to keep them, and no way to share them with someone who'd enjoy them too. More than once I've wanted to repeat a walk exactly as I did it, only to realize I never saved the path.

### Problems, in priority order

| # | Problem | How Wandr addresses it |
| --- | --- | --- |
| P1 | There is no **place to keep what mattered on a walk**, anchored where it happened. | Finds with notes or photos, placed on a map |
| P2 | Walkers **can't go back to a walk** they enjoyed, because the path was never kept. | A route drawn on the map (approximate) |
| P3 | Walkers can't **share a walk safely**, without exposing where they live or their routine. | A revocable link with only the chosen finds and stretch |

**Evidence:** first-hand experience of the author. This is an **assumption to validate**, not proven demand.

## 4. Target users

### Primary: the everyday wanderer

Someone who walks regularly for well-being rather than training, and notices details: architecture, cafés, parks, small things on the street. They want to **remember** and sometimes **show** a walk to someone specific, not to an audience.

**What they need from Wandr:**

- Save a find in seconds, even if that's all they save.
- Find it again later, on a map, from any device.
- Send a walk to a friend without thinking about what else it reveals.

### Secondary: the recipient

A friend who gets a link. They have no account and no intention to create one. They need the page to open fast on a phone and to show the walk clearly.

## 5. Solution

A single **responsive web app**: a private journal for the walker, plus public pages for shared links.

| Capability | What the user can do | Problem |
| --- | --- | --- |
| **Save** | Place finds on a map, each with a note or a photo, and optionally draw the route. A walk with a single find is a complete entry. | P1, P2 |
| **Return** | Open any past walk with its route and finds, on a laptop or a phone's browser. The journal is useful even if nothing is ever shared. | P1, P2 |
| **Share** | Send only the chosen finds and one stretch of the route through a link that opens without an account and can be revoked. | P3 |

What each capability includes in the MVP, and the rules every shared link follows, live in [`02-mvp-scope.md`](./02-mvp-scope.md). The principles, voice and visual direction behind every screen live in [`00-identity.md`](./00-identity.md).

## 6. Non-goals

These are product stances, not things postponed.

- **Performance metrics.** No pace, records, leaderboards or segments. Wandr is a journal, not a tracker.
- **Popularity signals.** No likes, follower counts or rankings. What's shared is the walk, not its author.
- **Continuous GPS recording.** Wandr keeps the walk you choose to remember, after the fact. Web geolocation only updates while the page is active and visible, and automatic tracks are exactly what makes sharing risky.

## 7. Success signals

There is no user base yet, so these are hypotheses to watch, not targets.

| Signal | What it would tell us |
| --- | --- |
| Walks are **opened again** days or weeks after being saved | The journal is worth coming back to (P1, P2). |
| Walks have **more than one find** | Walkers treat a walk as a set of moments, not a single pin (P1). |
| Shared links are **opened by recipients** | People want to receive a walk, not just send one (P3). |
| Links are **revoked** without walkers reporting surprises | Walkers trust the sharing controls (P3). |

## 8. Assumptions

- Walkers want to keep **places and moments**, not tracks. A walk with one find is still worth saving.
- An approximate, hand-drawn route is enough to remember and repeat a walk.
- People are more willing to share a **chosen stretch** than a full walk.

## 9. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| **Demand is unvalidated.** | Nobody beyond the author keeps using it. | Use it for real walks; send real links to a few people and watch whether they open them. |
| **Drawing a route feels like a chore.** | Walkers skip the route and P2 weakens. | The route is optional; a find alone is a complete entry. |
| **A shared page shows more than intended.** | Breaks the core promise and the walker's trust. | Sharing follows explicit rules defended by automated tests; see [`02-mvp-scope.md`](./02-mvp-scope.md#5-surfaces-and-sharing-rules). |
