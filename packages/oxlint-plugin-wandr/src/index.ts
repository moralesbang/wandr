import { definePlugin } from '@oxlint/plugins'
import { noCrossFeatureImports } from './rules/no-cross-feature-imports.ts'

// Wandr's own lint rules: each one turns a convention in knowledge/ into an
// error (knowledge/standards/lint-rules.md). Referenced as `wandr/<rule-name>`.
export default definePlugin({
  meta: { name: 'wandr' },
  rules: {
    'no-cross-feature-imports': noCrossFeatureImports,
  },
})
