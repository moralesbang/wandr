# Wandr — Identity

**Status:** Draft — in review
**Date:** November 22, 2026
**Related:** [`01-product-brief.md`](./01-product-brief.md)

What Wandr believes, how it speaks and how it looks. The brief says *what* we build; this document says *how it should feel*, and it should stay true even when the features change.

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

Final values and the dark-mode counterpart are defined in the design system.

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

Part of the identity, not an extra: sufficient contrast in light and dark modes, visible focus, keyboard navigation, alt text for images, and touch targets sized for walking hands.

## 7. Open questions

- Final palette, type families and component library. _(Settled in the design system phase.)_
- How far ASCII art goes beyond empty states.
