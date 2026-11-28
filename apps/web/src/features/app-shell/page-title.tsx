import { useMatches } from '@tanstack/react-router'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

const SITE = 'Wandr'

const OverrideContext = createContext<(title: string | null) => void>(() => {})

// The fallback screens name themselves: they replace a route's title while they are on screen.
export const usePageTitle = (title: string) => {
  const setOverride = useContext(OverrideContext)
  useEffect(() => {
    setOverride(title)
    return () => setOverride(null)
  }, [setOverride, title])
}

// Keeps the tab's title on the page in view: a fallback's own, else the deepest route's.
export const PageTitleHost = ({ children }: { children: ReactNode }) => {
  const [override, setOverride] = useState<string | null>(null)
  const routeTitle = useMatches({
    select: (matches) => {
      const last = matches.at(-1)
      if (!last || last.routeId === '__root__' || last.routeId === '/') return null
      return last.staticData.title
    },
  })
  const title = override ?? routeTitle

  useEffect(() => {
    document.title = title ? `${title} · ${SITE}` : SITE
  }, [title])

  return <OverrideContext value={setOverride}>{children}</OverrideContext>
}
