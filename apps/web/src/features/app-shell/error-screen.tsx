import { Link, useRouter } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { usePageTitle } from './page-title'

// Never shows the error itself: what failed is no use to a reader.
export const ErrorScreen = () => {
  const router = useRouter()
  usePageTitle("Page didn't load")
  return (
    <main className="mx-auto flex min-h-screen max-w-measure flex-col items-start justify-center gap-6 px-4 py-12">
      <h1 className="type-title">This page didn't load.</h1>
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => router.invalidate()}>Try again</Button>
        <Button variant="outline" asChild>
          <Link to="/">Back to the start</Link>
        </Button>
      </div>
    </main>
  )
}
