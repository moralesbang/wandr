import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import type { DataContext } from '@/api/query-client'

export const Route = createRootRouteWithContext<DataContext>()({
  component: Outlet,
})
