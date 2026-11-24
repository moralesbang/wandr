import { useRouter } from '@tanstack/react-router'
import { CircleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { HealthLayout } from './health-layout'

export const HealthError = () => {
  const router = useRouter()
  return (
    <HealthLayout>
      <Alert variant="destructive">
        <CircleAlert />
        <AlertTitle>Wandr isn't answering right now.</AlertTitle>
        <AlertDescription>
          <Button variant="outline" onClick={() => router.invalidate()}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    </HealthLayout>
  )
}
