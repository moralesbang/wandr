import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import type { DataContext } from '@/api/query-client'
import { PageTitleHost } from '@/features/app-shell/page-title'

const RootLayout = () => (
  <PageTitleHost>
    <Outlet />
  </PageTitleHost>
)

export const Route = createRootRouteWithContext<DataContext>()({
  staticData: { title: 'Wandr' },
  component: RootLayout,
})
