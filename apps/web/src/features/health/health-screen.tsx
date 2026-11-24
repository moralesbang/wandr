import { useHealth } from '@/api/health/use-health'
import { HealthLayout } from './health-layout'
import { HealthStatus } from './health-status'

export const HealthScreen = () => {
  const health = useHealth()
  return (
    <HealthLayout>
      <HealthStatus checks={health.checks} />
    </HealthLayout>
  )
}
