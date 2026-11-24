import { bucket, defineRailway, github, postgres, project, ref, service } from 'railway/iac'

// Wandr in production (docs/05-architecture.md §12): one service built from the
// Dockerfile, Postgres and a private bucket, in one Railway project and region.
export const partial = 'wandr'

export default defineRailway(() => {
  const db = postgres('Postgres')
  const photos = bucket('contained-chest-PiH6', { region: 'sjc' })

  const wandr = service('wandr', {
    // Deploys main only once GitHub's checks pass.
    source: github('moralesbang/wandr', { branch: 'main', checkSuites: true }),
    build: { buildEnvironment: 'V3', builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile' },
    // A release starts only on a migrated database, and /api/health gates the switch.
    preDeploy: 'bun src/db/migrate.ts',
    healthcheck: '/api/health',
    healthcheckTimeout: 60,
    replicas: { 'us-west2': 1 },
    env: {
      DATABASE_URL: ref(db, 'DATABASE_URL'),
      S3_ENDPOINT: ref(photos, 'ENDPOINT'),
      S3_REGION: ref(photos, 'REGION'),
      S3_BUCKET: ref(photos, 'BUCKET'),
      S3_ACCESS_KEY_ID: ref(photos, 'ACCESS_KEY_ID'),
      S3_SECRET_ACCESS_KEY: ref(photos, 'SECRET_ACCESS_KEY'),
    },
  })

  return project('wandr', {
    variables: { managed: true },
    resources: [db, photos, wandr],
  })
})
