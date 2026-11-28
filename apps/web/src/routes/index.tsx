import { createFileRoute } from '@tanstack/react-router'
import { healthQueries } from '@/api/health/queries'
import { HealthError } from '@/features/health/health-error'
import { HealthPending } from '@/features/health/health-pending'
import { HealthScreen } from '@/features/health/health-screen'

export const Route = createFileRoute('/')({
  staticData: { title: 'Home' },
  loader: ({ context }) => context.queryClient.ensureQueryData(healthQueries.status()),
  pendingComponent: HealthPending,
  errorComponent: HealthError,
  component: HealthScreen,
})
