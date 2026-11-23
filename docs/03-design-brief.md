# Wandr — Design brief

**Status:** Approved
**Date:** November 23, 2026
**Related:** [`01-product-brief.md`](./01-product-brief.md) · [`02-mvp-scope.md`](./02-mvp-scope.md) · [`04-flows.md`](./04-flows.md) · [Design System](https://claude.ai/artifact/EdqUYYoSM61zcvvNMnocUi) · [Design canvas](https://claude.ai/artifact/EsR7EX2xd6SZGrTCX4nvar)

The input for Wandr's visual design. The product brief says *what* we build and the MVP scope says *what comes first*; this document says *how it should feel* and *what the design must solve*.

- **Sections 1–6** are Wandr's identity: what it believes, how it speaks and how it looks. They stay true even when the features change.
- **Sections 7–8** are the MVP's UX problems and the constraints the design works within. They follow the scope, and change with it.

The screens, their steps and their states live in [`04-flows.md`](./04-flows.md), not here. The final values (color and type tokens, spacing, motion, components and the map's look) live in the [Design System](https://claude.ai/artifact/EdqUYYoSM61zcvvNMnocUi), and the screens are drawn from it on the [Design canvas](https://claude.ai/artifact/EsR7EX2xd6SZGrTCX4nvar).

---

## 1. In one sentence

**Wandr is a quiet place to keep the walks worth remembering: somewhere to observe, remember and come back to the world, without competing for attention or performance.**

## 2. Principles

1. **Walking is enough.** No goals of speed, distance or calories. A walk doesn't need to be an achievement to be worth keeping.
2. **Moments matter more than metrics.** A note, a find or a feeling is worth as much as the path.
3. **Private by default.** Nothing becomes public without a deliberate choice. Nobody should be able to infer someone's home, routine or current location.
4. **Places before people.** What's shared is the walk, not its author. Identity is discreet: pseudonymous, never mandatory, never a number to grow.
5. **What's valuable lasts.** An entry is a memory to come back to, not a post that expires in a feed.
6. **Gentle motivation.** The product invites; it never shames, punishes or nags.
7. **Visual calm.** Little noise, no aggressive engagement mechanics, nothing designed to maximize screen time.

## 3. What Wandr is not

- A performance tracker with rankings, records or leaderboards.
- A feed designed to keep you scrolling.
- A service that publishes your location or routine automatically.
- An Instagram clone with a GPS line on every photo.

## 4. Voice & tone

Warm, curious, unhurried. Wandr talks like a friend who also likes to walk, not like a coach.

| Wandr says | Wandr doesn't say |
| --- | --- |
| "What did you find?" | "How did you perform?" |
| "A place to come back to" | "New personal best!" |
| "Nothing here yet. Your first walk will live here." | "You haven't walked in 5 days." |
| "Only what you choose will be visible." | "Share to reach more people!" |

**Microcopy rules**

- Short, plain sentences. No exclamation marks to create urgency.
- Never guilt the user about absence or inactivity.
- Privacy is explained in human terms at the moment it matters, not hidden in settings.

## 5. Visual identity

### Direction

**Cozy, editorial, analog, contemplative and minimal.** It should feel like a travel notebook, not a dashboard.

**References:** travel notebooks, film photography, paper and texture, printed maps, nature, cafés, quiet streets, the personal web of the 2000s, a certain Tumblr sensibility.

**Anti-references:** fitness dashboards, neon gradients, gamified badges, dense social feeds.

### Color

A warm, muted palette. Suggested starting point:

| Role | Color |
| --- | --- |
| Background | Cream, bone |
| Primary accent | Moss green |
| Secondary accent | Soft terracotta |
| Warm neutral | Coffee brown |
| Text | Ink gray |

Final values and the dark-mode counterpart are defined in the [Design System](https://claude.ai/artifact/EdqUYYoSM61zcvvNMnocUi).

### Typography

- **Headings:** an expressive editorial serif.
- **Interface:** a legible sans-serif.
- **Details and metadata** (dates, coordinates, small labels): monospace.

### Imagery & maps

- The map and the finds are the protagonists. Photography, when present, has a film-like feel and room to breathe.
- Maps are quiet and low in saturation, so routes and finds stand out.
- Generous white space. One thing at a time.

### Motion

Discreet transitions that support orientation, never decoration. `prefers-reduced-motion` is always respected.

### ASCII art

An **accent, not a mechanism**: small generative illustrations of trees, hills or stylized maps for empty states, badges or experimental postcards. It never stands between the user and a task.

## 6. Accessibility

Part of the identity, not an extra: WCAG 2.2 AA contrast in light and dark modes, visible focus, keyboard navigation, alt text for images, and touch targets sized for walking hands.

## 7. UX problems to solve

The hard parts of the MVP's experience. Each one names the Must it serves in [`02-mvp-scope.md`](./02-mvp-scope.md#6-must-have) and says how to tell it's solved. How to solve it is the design's job.

### U1 — Editing the route without fighting the map (M4)

**Problem.** On a map, the same drag or tap can mean "move the map" or "change the route". On a phone the map fills the screen and a finger hides the point it touches, so the two are easy to confuse.

**Solved when** panning and zooming never move or add a point, with a mouse or a finger; adding, inserting, dragging and deleting a point each work on the first try; and a typical neighborhood route takes under 2 minutes to draw. It's validated on a real phone in the route editor spike.

### U2 — A find in under 30 seconds (M2)

**Problem.** Right after a walk, the walker wants to keep a find before the memory fades. Every extra field, step or confirmation competes with that.

**Solved when** placing a find on an open walk and writing its note takes under 30 seconds on a phone and on a laptop, and the find shows on the map as soon as it's saved.

### U3 — Choosing what to share on a phone (M6)

**Problem.** The walker picks finds and the two ends of a stretch on a small screen, where points sit close together and a finger is imprecise.

**Solved when** on a 360 px phone the walker selects the finds and both ends of the stretch of a typical walk without picking a wrong point, and sees the whole selection on the map before going on.

### U4 — Knowing what's on the link while editing (M6)

**Problem.** Once a link exists, edits keep reaching it: moving a selected find, inserting a point inside the stretch, dragging one of its ends. The walker has to see what an edit will show before making it, not after the friend has seen it.

**Solved when** on a walk that has a link, every find and every part of the route shows whether it's on the link, and dragging an end of the stretch shows the shared part changing as it moves.

### U5 — The preview is the shared page (M6)

**Problem.** The walker approves a preview before creating the link. If the preview reads differently from what the recipient gets, the walker approved something else.

**Solved when** the preview and the shared page show the same content, laid out the same way, and the preview is unmistakably a preview that nobody else can see yet.

### U6 — The recipient's first look (M6)

**Problem.** A friend opens the link from a chat on their phone, with no account and no idea what Wandr is. They need to understand what they're looking at, and that nothing is being asked of them.

**Solved when** on a 360 px phone the first screen shows the walk's title and date and the map with the stretch and the finds; each find opens with its note and photo; and nothing asks the recipient to sign up or names the author.

## 8. Constraints

| Area | Constraint |
| --- | --- |
| **Devices** | Phone (from 360 px wide) and desktop, in the browsers listed in the [scope's assumptions](./02-mvp-scope.md#11-assumptions). |
| **Input** | Mouse, touch and keyboard. Every action works with the keyboard and a visible focus, except placing and moving points on the map, which needs a pointer. Touch targets are at least 44 × 44 px. |
| **Color modes** | Light and dark, following the system setting, the map included. Contrast meets WCAG 2.2 AA in both. |
| **Motion** | `prefers-reduced-motion` is always respected. |
| **Language** | English only. |
| **Components** | ASSUMPTION: the UI is built with shadcn/ui and Tailwind CSS. The Design System names its color tokens after shadcn/ui's theme variables and themes shadcn/ui's components rather than inventing new ones where one exists. |
| **Map** | Tiles come from a hosted provider with a light and a dark style. The Design System's map section defines how the map looks in both styles and lists the requirements the provider and the map library are chosen against. |
