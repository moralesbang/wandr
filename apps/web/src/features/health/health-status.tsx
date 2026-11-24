import type { CheckStatus } from '@wandr/contract'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type HealthStatusProps = {
  checks: { database: CheckStatus; bucket: CheckStatus }
}

const ROWS = [
  { name: 'API', status: () => 'up' as const },
  { name: 'Database', status: (checks: HealthStatusProps['checks']) => checks.database },
  { name: 'Photo storage', status: (checks: HealthStatusProps['checks']) => checks.bucket },
]

export const HealthStatus = ({ checks }: HealthStatusProps) => (
  <Card>
    <CardHeader>
      <CardTitle>Behind the scenes</CardTitle>
    </CardHeader>
    <CardContent>
      <ul aria-label="Services" className="flex flex-col divide-y">
        {ROWS.map(({ name, status }) => (
          <li key={name} className="flex min-h-touch items-center justify-between gap-4 py-2">
            <span className="type-label">{name}</span>
            {status(checks) === 'up' ? (
              <Badge variant="secondary">Answering</Badge>
            ) : (
              <Badge variant="destructive">Not answering</Badge>
            )}
          </li>
        ))}
      </ul>
    </CardContent>
  </Card>
)
