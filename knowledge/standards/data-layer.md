# Data layer

## Purpose

Keep server state in `apps/web` behind one data layer. Components get their data from **resource hooks** and know only that the data arrives; TanStack Query, query keys and the API client stay inside `src/api/`. Every cache entry has one key from its resource's factory, so an invalidation reaches exactly what it means to reach.

## Scope

Applies to every file in `apps/web/src/` that calls the API, defines a query key, uses `@tanstack/react-query`, or declares a route `loader`.

**MUST**, **MUST NOT**, **SHOULD** and **MAY** follow RFC 2119. A **SHOULD** may be broken only for the reason its rule states.

## Definitions

| Term | Meaning |
| --- | --- |
| **resource** | One thing the API reads or writes, named by its plural noun: `walks`, `finds`, `shared-walks`. |
| **query factory** | The `<resource>Queries` object that builds every `queryOptions` of a resource, keys included. |
| **query hook** | A hook that reads one query of a factory. |
| **mutation hook** | A hook that performs one write. |
| **route data** | Data a route's component needs before it can render at all. Its route preloads it. |
| **input data** | Data a component asks for only after the user does something, such as the Share preview. |

## The pattern

Every rule below is a part of this example.

```ts
// src/api/walks/queries.ts
import { queryOptions } from '@tanstack/react-query'
import { api, unwrap } from '../client'

export const walkQueries = {
  all: () => ['walks'] as const,
  list: () =>
    queryOptions({
      queryKey: [...walkQueries.all(), 'list'] as const,
      queryFn: () => unwrap(api.GET('/api/walks')),
    }),
  detail: (walkId: string) =>
    queryOptions({
      queryKey: [...walkQueries.all(), 'detail', walkId] as const,
      queryFn: () => unwrap(api.GET('/api/walks/{walkId}', { params: { path: { walkId } } })),
    }),
}
```

```ts
// src/api/walks/use-walks.ts
export const useWalks = () => useSuspenseQuery(walkQueries.list()).data
```

```ts
// src/api/walks/use-delete-walk.ts
export const useDeleteWalk = () => {
  const queryClient = useQueryClient()
  const { mutate, isPending, error } = useMutation({
    mutationFn: (walkId: string) =>
      unwrap(api.DELETE('/api/walks/{walkId}', { params: { path: { walkId } } })),
    onSuccess: (_data, walkId) => {
      queryClient.removeQueries({ queryKey: walkQueries.detail(walkId).queryKey })
      return queryClient.invalidateQueries({ queryKey: walkQueries.list().queryKey })
    },
  })
  return { deleteWalk: mutate, isDeleting: isPending, error }
}
```

```tsx
// src/routes/_journal/index.tsx
export const Route = createFileRoute('/_journal/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(walkQueries.list()),
  pendingComponent: JournalSkeleton,
  errorComponent: JournalError,
  component: Journal,
})

function Journal() {
  const walks = useWalks()
  return walks.length === 0 ? <EmptyJournal /> : <WalkList walks={walks} />
}
```

## Layout

### DL-001 — One folder per resource, one hook per file

The data layer MUST live in `apps/web/src/api/`:

```
src/api/
  client.ts            api (openapi-fetch) and unwrap
  query-client.ts      the app's QueryClient
  walks/
    queries.ts         walkQueries
    use-walks.ts
    use-walk.ts
    use-create-walk.ts
    use-delete-walk.ts
```

Each hook MUST sit in its own file, named after the hook in kebab-case.

### DL-002 — TanStack Query stays inside `src/api/`

`@tanstack/react-query` and `src/api/client.ts` MUST be imported only from files under `src/api/`. Components import hooks; route loaders import factories and reach the `QueryClient` through the router context.

#### Rationale

A component that never sees TanStack Query can only render the data it gets. Swapping a fetch, a key or a cache rule is then an edit in `src/api/` alone.

## Naming

### DL-003 — Names follow the resource

| Thing | Pattern | Examples |
| --- | --- | --- |
| Query factory | `<resource, singular>Queries` | `walkQueries`, `findQueries`, `sharedWalkQueries` |
| List query hook | `use<Resources>` | `useWalks()` |
| Single query hook | `use<Resource>(<key>)` | `useWalk(walkId)`, `useSharedWalk(token)` |
| Input query hook | `use<Noun>(…, { enabled })` | `useSharePreview(walkId, selection, { enabled })` |
| Mutation hook | `use<Verb><Resource>` | `useCreateWalk`, `useUpdateFind`, `useUploadFindPhoto`, `useRevokeLink`, `useSignIn` |
| Mutation result | `{ <verb><Resource>, is<Verb-ing>, error }` | `{ deleteWalk, isDeleting, error }` |

A mutation's verb MUST be `create`, `update` or `delete` for plain writes, and the product's own word where it has one: `upload`, `remove` (a photo), `revoke` (a link), `signIn`, `signUp`, `signOut`.

An ID parameter MUST be named after its resource: `walkId`, `findId`, never `id`.

## Query keys

### DL-004 — Every key comes from its factory

A factory's root MUST be `all: () => ['<resources>'] as const`, with the resource's plural name in kebab-case. Every other key MUST start from `all()`; one entity's keys MUST start from its `detail` key, so invalidating `detail` refreshes everything scoped to it. Filter params travel as one object in the key's last slot.

#### Good
```ts
queryKey: [...walkQueries.detail(walkId).queryKey, 'link'] as const
```

#### Bad
```ts
queryKey: ['walk-link', walkId]
```

## Query hooks

### DL-005 — Route data arrives defined

A query hook for route data MUST call `useSuspenseQuery` with a factory call and MUST return the `data` alone. Its route MUST preload the same factory call in its `loader` with `context.queryClient.ensureQueryData`. The route, not the component, owns the other states: `pendingComponent` for loading, `errorComponent` for errors, `notFoundComponent` for "not found".

#### Rationale

Under Suspense the component renders only once the data is there, so it has no empty or loading branch to get wrong, and the loader fetches before the screen mounts instead of in a waterfall.

### DL-006 — Input data waits on `enabled`

A query hook for input data MUST call `useQuery`, MUST accept `{ enabled }`, and MUST return `{ <noun>, isLoading, error }`, as in `const { preview, isLoading } = useSharePreview(walkId, selection, { enabled: hasSelection })`.

### DL-007 — Hooks take only the options their callers use

A hook MUST declare its options as its own type, listing only what its callers pass. It MUST NOT accept or spread `UseQueryOptions` or `UseMutationOptions`.

#### Rationale

A hook that forwards TanStack's options lets a component override the key or the fetch, and the data layer stops being the single place that decides them.

### DL-008 — Shape the data in the hook

Data derived from a response MUST be computed in `select` or in the hook. A component MUST NOT reshape what a hook returns.

## Mutation hooks

### DL-009 — The hook owns the cache

A mutation hook MUST update every query its write affects (`invalidateQueries`, `setQueryData`, `removeQueries`, optimistic updates) in the `useMutation` callbacks.

### DL-010 — The caller owns the UI

Navigation, closing a dialog, moving focus and messages MUST be passed by the caller in the action call: `deleteWalk(walkId, { onSuccess: () => navigate({ to: '/' }) })`. A mutation hook MUST NOT navigate or touch the UI.

#### Rationale

`useMutation`'s callbacks always run, even after the component unmounts; the action call's callbacks run only while it is still mounted. Cache work must always happen, and UI work has nowhere to go once its screen is gone.

## Requests

### DL-011 — `unwrap` is the only error path

Every `queryFn` and `mutationFn` MUST call the API through `api.<METHOD>` from `src/api/client.ts`, wrapped in `unwrap`. `unwrap` returns the response's data or throws: a 404 as the Router's `notFound()`, anything else as an `ApiError` with its status.

#### Rationale

One place turns a response into data or an error, so every screen's "not found" comes from its route's `notFoundComponent` without per-screen checks.

## The shared page

### DL-012 — A shared walk is never kept

`sharedWalkQueries` MUST set `staleTime: 0` and `gcTime: 0`, and the query cache MUST NOT be persisted to any storage.

#### Rationale

The MVP's sharing rules say a revoke is immediate and a selected find's edit shows on the next reload ([`docs/02-mvp-scope.md` §5](../../docs/02-mvp-scope.md#5-surfaces-and-sharing-rules)). A kept copy in the browser is a second place a revoked link could still show.
