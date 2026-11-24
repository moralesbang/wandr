import type { ReactNode } from 'react'

export const HealthLayout = ({ children }: { children: ReactNode }) => (
  <main className="mx-auto flex max-w-measure flex-col gap-8 px-4 py-12">
    <header className="flex flex-col gap-2">
      <h1 className="type-title">Wandr</h1>
      <p className="text-muted-foreground">
        A quiet place to keep the walks worth remembering. The journal opens here soon.
      </p>
    </header>
    {children}
  </main>
)
