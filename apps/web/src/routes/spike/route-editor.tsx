import { createFileRoute } from '@tanstack/react-router'
import { RouteEditorSpike } from '@/features/walk/spike/route-editor-spike'

export const Route = createFileRoute('/spike/route-editor')({
  staticData: { title: 'Route editor' },
  component: RouteEditorSpike,
})
