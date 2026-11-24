import { useEffect } from 'react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { Tool } from './resolve-gesture'

const tools: { tool: Tool; name: string }[] = [
  { tool: 'view', name: 'View' },
  { tool: 'add-find', name: 'Add find' },
  { tool: 'route', name: 'Route' },
]

const isTool = (value: string): value is Tool => tools.some(({ tool }) => tool === value)

export type EditorToolsProps = {
  tool: Tool
  onChange: (tool: Tool) => void
}

/** The map's tools: one active at a time, until another is picked; Escape returns to View. */
export const EditorTools = ({ tool, onChange }: EditorToolsProps) => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onChange('view')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onChange])

  return (
    <ToggleGroup
      type="single"
      aria-label="Map tool"
      value={tool}
      onValueChange={(value) => {
        if (isTool(value)) onChange(value)
      }}
    >
      {tools.map(({ tool: value, name }) => (
        <ToggleGroupItem key={value} value={value}>
          {name}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
