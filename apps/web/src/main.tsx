import './index.css'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { queryClient } from './api/query-client'
import { QueryProvider } from './api/query-provider'
import { ErrorScreen } from './features/app-shell/error-screen'
import { LoadingMark } from './features/app-shell/loading-mark'
import { NotFoundScreen } from './features/app-shell/not-found-screen'
import { routeTree } from './route-tree.gen'

const router = createRouter({
  routeTree,
  context: { queryClient },
  // TanStack Query owns freshness; the router always asks it.
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
  // The fallbacks of every page, so one added later gets them for free.
  defaultNotFoundComponent: NotFoundScreen,
  defaultErrorComponent: ErrorScreen,
  defaultPendingComponent: LoadingMark,
  defaultPendingMs: 0,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
  // Every route names its page (web WEB-012); the tab reads "{title} · Wandr".
  interface StaticDataRouteOption {
    title: string
  }
}

const root = document.getElementById('root')
if (!root) throw new Error('index.html has no #root')

createRoot(root).render(
  <StrictMode>
    <QueryProvider>
      <RouterProvider router={router} />
    </QueryProvider>
  </StrictMode>,
)
