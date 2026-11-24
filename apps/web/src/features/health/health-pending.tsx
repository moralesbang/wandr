import { Skeleton } from '@/components/ui/skeleton'
import { HealthLayout } from './health-layout'

export const HealthPending = () => (
  <HealthLayout>
    <div aria-busy="true" className="flex flex-col gap-3">
      <span className="sr-only">Loading</span>
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-36 w-full rounded-lg" />
    </div>
  </HealthLayout>
)
