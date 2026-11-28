import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { usePageTitle } from './page-title'

export const NotFoundScreen = () => {
  usePageTitle('Page not found')
  return (
    <main className="mx-auto flex min-h-screen max-w-measure flex-col items-start justify-center gap-6 px-4 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="type-title">This path isn't on the map.</h1>
        <p className="text-muted-foreground">
          The address may be mistyped, or the page may have moved.
        </p>
      </div>
      <Button asChild>
        <Link to="/">Back to the start</Link>
      </Button>
    </main>
  )
}
