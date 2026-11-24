import { describe, it } from 'node:test'
import { RuleTester } from 'oxlint/plugins-dev'
import { noCrossFeatureImports } from './no-cross-feature-imports.ts'

RuleTester.describe = describe
RuleTester.it = it

const SRC = '/repo/apps/web/src'
const JOURNAL = `${SRC}/features/journal/journal-list.tsx`
const NESTED = `${SRC}/features/journal/parts/walk-row.tsx`

const crossFeature = (to: string) => [{ messageId: 'crossFeature', data: { from: 'journal', to } }]

new RuleTester().run('no-cross-feature-imports', noCrossFeatureImports as never, {
  valid: [
    {
      name: 'its own feature, relative',
      filename: JOURNAL,
      code: `import { Row } from './walk-row'`,
    },
    {
      name: 'its own feature, from a nested folder',
      filename: NESTED,
      code: `import { List } from '../journal-list'`,
    },
    {
      name: 'its own feature, through the alias',
      filename: JOURNAL,
      code: `import { Row } from '@/features/journal/walk-row'`,
    },
    {
      name: 'shared components',
      filename: JOURNAL,
      code: `import { Button } from '@/components/ui/button'`,
    },
    {
      name: 'shared helpers, relative',
      filename: JOURNAL,
      code: `import { cn } from '../../lib/utils'`,
    },
    {
      name: 'the data layer',
      filename: JOURNAL,
      code: `import { useWalks } from '@/api/walks/use-walks'`,
    },
    { name: 'a package', filename: JOURNAL, code: `import { z } from 'zod'` },
    {
      name: 'a package whose name looks like a path',
      filename: JOURNAL,
      code: `import x from 'features/walk'`,
    },
    {
      name: 'a folder that only starts with features',
      filename: JOURNAL,
      code: `import x from '@/features-old/walk/x'`,
    },
    {
      name: 'a route composing two features',
      filename: `${SRC}/routes/index.tsx`,
      code: `import { A } from '@/features/journal/a'\nimport { B } from '@/features/walk/b'`,
    },
    {
      name: 'a file just outside features/',
      filename: `${SRC}/lib/compose.ts`,
      code: `import { W } from '../features/walk/w'`,
    },
    {
      name: 'a test beside its feature',
      filename: `${SRC}/features/journal/journal-list.test.tsx`,
      code: `import { List } from './journal-list'`,
    },
    {
      name: 'a dynamic import of its own feature',
      filename: JOURNAL,
      code: `const m = import('./walk-row')`,
    },
    {
      name: 'a dynamic import of a computed path',
      filename: JOURNAL,
      code: `const m = import(name)`,
    },
  ],
  invalid: [
    {
      name: 'another feature through the alias',
      filename: JOURNAL,
      code: `import { Map } from '@/features/walk/walk-map'`,
      errors: crossFeature('walk'),
    },
    {
      name: 'another feature, relative',
      filename: JOURNAL,
      code: `import { Map } from '../walk/walk-map'`,
      errors: crossFeature('walk'),
    },
    {
      name: 'another feature, from a nested folder',
      filename: NESTED,
      code: `import { Step } from '../../share/share-step'`,
      errors: crossFeature('share'),
    },
    {
      name: 'another feature through a path that leaves and comes back',
      filename: JOURNAL,
      code: `import { X } from '../../features/walk/x'`,
      errors: crossFeature('walk'),
    },
    {
      name: "another feature's folder index",
      filename: JOURNAL,
      code: `import { Walk } from '@/features/walk'`,
      errors: crossFeature('walk'),
    },
    {
      name: 'a type-only import',
      filename: JOURNAL,
      code: `import type { Walk } from '@/features/walk/types'`,
      errors: crossFeature('walk'),
    },
    {
      name: 'a re-export',
      filename: JOURNAL,
      code: `export { Map } from '@/features/walk/walk-map'`,
      errors: crossFeature('walk'),
    },
    {
      name: 'a re-export of everything',
      filename: JOURNAL,
      code: `export * from '../walk/walk-map'`,
      errors: crossFeature('walk'),
    },
    {
      name: 'an aliased import',
      filename: JOURNAL,
      code: `import { Map as WalkMap } from '@/features/walk/walk-map'`,
      errors: crossFeature('walk'),
    },
    {
      name: 'a dynamic import',
      filename: JOURNAL,
      code: `const m = import('@/features/shared-page/page')`,
      errors: crossFeature('shared-page'),
    },
  ],
})
