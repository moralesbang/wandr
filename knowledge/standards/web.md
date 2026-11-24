# Web

## Purpose

Keep `apps/web` organised the same way everywhere: routes compose, features hold the screens, the data layer holds the server, and the map editor's rule stays testable without a browser. The data layer has its own standard, [`data-layer.md`](data-layer.md).

## Scope

Applies to every file under `apps/web/src/`.

**MUST**, **MUST NOT**, **SHOULD** and **MAY** follow RFC 2119.

## Layout

### WEB-001 — One place for each kind of code

```
src/
  routes/          TanStack Router's file routes
  api/             the data layer (data-layer.md)
  features/        one folder per screen or flow: auth/, journal/, walk/, share/, shared-page/
  components/ui/   shadcn/ui components, themed by the Design System
  components/map/  Wandr's map overlays: FindMarker, RoutePoint, StretchEnd, RouteLine, StretchControls
  lib/             stateless helpers
```

Code MUST live in the folder its kind names.

### WEB-002 — Routes compose, features build

A route file MUST hold only its route definition: `loader`, `validateSearch`, `beforeLoad`, `pendingComponent`, `errorComponent`, `notFoundComponent`, and a `component` imported from `features/`. Screen logic and markup live in `features/`.

### WEB-003 — Features stay apart

A feature MUST NOT import from another feature. A piece two features need moves to `components/` or `lib/`.

Enforced by `wandr/no-cross-feature-imports`

## UI

### WEB-004 — shadcn/ui first

Where shadcn/ui has a component, the UI MUST use it, added with the shadcn CLI into `components/ui/`. The Design System's component table says which one each screen uses.

### WEB-005 — Colours and sizes come from tokens

Components MUST style through Tailwind classes backed by the Design System's tokens. They MUST NOT hold raw colours or one-off sizes; a value the tokens don't have is added to the Design System first.

#### Rationale

Light and dark mode, and their contrast (M7, keyboard and dark mode), hold only when every colour switches with the theme.

## State

### WEB-006 — Each kind of state has one home

- Server state MUST come from the data layer's hooks.
- State that belongs in the address, such as the Share step, MUST live in search params validated by the route's `validateSearch`.
- Everything else MUST be local component state. There is no global store.

## Forms

### WEB-007 — TanStack Form with the contract's schemas

A form MUST use TanStack Form and validate with the schema from `packages/contract` that the API validates the same request with. Validation messages come from that schema.

## The map

### WEB-008 — Overlays in `components/map/`

Finds, route points, midpoint handles and stretch ends MUST be DOM markers built in `components/map/`, each with a 44 × 44 px hit area. The route MUST be map layers.

### WEB-009 — The editor's rule is a pure function

What a tap or a drag does MUST be decided by `resolveGesture(tool, target, gesture)`, a pure function that follows the tools table in [`docs/04-flows.md` §2](../../docs/04-flows.md#2-the-map-editor) row by row. Map components MUST only report gestures and apply its result.

### WEB-010 — The stretch comes from `packages/sharing`

Which points are on a link, and where its ends go after an edit, MUST be computed with `packages/sharing`, never in the SPA's own code.

#### Rationale

The API computes the same thing for the shared page. One implementation means the editor's marks and what the recipient sees can't disagree (U4).

### WEB-011 — Motion respects the user

Every camera move and transition MUST take a duration of 0 under `prefers-reduced-motion`.
