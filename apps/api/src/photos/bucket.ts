import { S3Client } from 'bun'
import { env } from '../env.ts'

export const bucket = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  bucket: env.S3_BUCKET,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
})

export const pingBucket = () => bucket.list({ maxKeys: 1 })
