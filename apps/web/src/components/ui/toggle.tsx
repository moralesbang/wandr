import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { Toggle as TogglePrimitive } from 'radix-ui'

const toggleVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md type-label whitespace-nowrap transition-colors duration-(--duration-fast) ease-standard hover:bg-muted focus-visible:focus-ring disabled:pointer-events-none disabled:text-muted-foreground data-[state=on]:bg-accent data-[state=on]:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        default: 'bg-transparent text-foreground',
        outline: 'border border-input bg-card text-foreground',
      },
      size: {
        default: 'min-h-touch min-w-touch px-4',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Toggle({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
