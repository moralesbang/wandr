import path from 'node:path'
import { defineRule } from '@oxlint/plugins'

// web WEB-003: a feature never imports from another feature. A file under
// `src/features/<name>/` may import its own feature, and anything outside
// `features/`, through a relative path or the `@/` alias.

const FEATURE_FILE = /^(?<src>.*\/src)\/features\/(?<feature>[^/]+)\//
const ALIAS = '@/'

const featureOf = (file: string) => {
  const match = FEATURE_FILE.exec(file.split(path.sep).join('/'))
  return match?.groups ? { src: match.groups.src!, feature: match.groups.feature! } : null
}

const targetFeature = (specifier: string, file: string, src: string): string | null => {
  let target: string
  if (specifier.startsWith(ALIAS)) target = path.posix.join(src, specifier.slice(ALIAS.length))
  else if (specifier.startsWith('.'))
    target = path.posix.resolve(path.posix.dirname(file), specifier)
  else return null
  return featureOf(`${target}/`)?.feature ?? null
}

export const noCrossFeatureImports = defineRule({
  meta: {
    type: 'problem',
    docs: { description: 'A feature never imports from another feature (web WEB-003).' },
    messages: {
      crossFeature:
        'The {{from}} feature imports from the {{to}} feature (web WEB-003). Move what both need to components/ or lib/.',
    },
    schema: [],
  },
  create(context) {
    const file = context.filename.split(path.sep).join('/')
    const own = featureOf(file)
    if (!own) return {}

    const check = (node: { source?: unknown } & object) => {
      const source = node.source as { type?: string; value?: unknown } | null | undefined
      if (!source || source.type !== 'Literal' || typeof source.value !== 'string') return
      const to = targetFeature(source.value, file, own.src)
      if (to && to !== own.feature) {
        context.report({
          node: source as never,
          messageId: 'crossFeature',
          data: { from: own.feature, to },
        })
      }
    }

    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
      ImportExpression: check,
    }
  },
})
