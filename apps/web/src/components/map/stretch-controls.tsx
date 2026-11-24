import { Button } from '@/components/ui/button'

export type StretchEnd = 'start' | 'end'

export type StretchControlsProps = {
  /** How many points the route has. */
  total: number
  /** Each end's index on the route, or null while it isn't set. */
  start: number | null
  end: number | null
  onMove: (end: StretchEnd, index: number) => void
}

const place = (index: number | null, total: number) =>
  index === null ? 'Not set' : `Point ${index + 1} of ${total}`

/**
 * Steps each end of the stretch along the route, one point at a time: precise on a phone, where a
 * finger covers several points, and the way the keyboard chooses a stretch (U3).
 */
export const StretchControls = ({ total, start, end, onMove }: StretchControlsProps) => {
  const ends: { end: StretchEnd; name: string; index: number | null }[] = [
    { end: 'start', name: 'Start', index: start },
    { end: 'end', name: 'End', index: end },
  ]
  return (
    <div className="flex flex-col gap-3">
      {ends.map(({ end: which, name, index }) => (
        <section key={which} aria-label={name} className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="type-label">{name}</span>
            <span className="type-meta-lg text-muted-foreground">{place(index, total)}</span>
          </div>
          <Button
            variant="outline"
            disabled={total === 0 || index === 0}
            onClick={() => onMove(which, index === null ? total - 1 : index - 1)}
          >
            Previous point
          </Button>
          <Button
            variant="outline"
            disabled={total === 0 || index === total - 1}
            onClick={() => onMove(which, index === null ? 0 : index + 1)}
          >
            Next point
          </Button>
        </section>
      ))}
    </div>
  )
}
