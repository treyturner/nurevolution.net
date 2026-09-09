import { z } from 'zod'
import { hashSchema, instantSchema } from '../../shared/content/schema.ts'
import {
  commitSchema,
  validateManifest,
  verifyHash,
  type MediaManifest,
} from './manifest.ts'

export const registry = 'ghcr.io/treyturner/nurevolution.net'
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/)
export const releaseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sourceCommit: commitSchema,
  verifyRunUrl: z
    .string()
    .regex(
      /^https:\/\/github\.com\/treyturner\/nurevolution\.net\/actions\/runs\/[1-9][0-9]*$/,
    ),
  imageDigest: digest,
  imageId: digest,
  caddyImageDigest: digest,
  caddyImageId: digest,
  configurationSha256: hashSchema,
  mediaManifestSha256: hashSchema,
  publishedAt: instantSchema,
})
export type Release = z.infer<typeof releaseSchema>
export const configurationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sourceCommit: commitSchema,
  compose: z.string().min(1),
  rendererSha256: hashSchema,
  caddyDockerfileSha256: hashSchema,
})

export function readRelease(
  release: unknown,
  manifestBytes: string,
  configurationBytes: string,
) {
  const record = releaseSchema.parse(release)
  verifyHash(manifestBytes, record.mediaManifestSha256)
  verifyHash(configurationBytes, record.configurationSha256)
  const manifest = validateManifest(JSON.parse(manifestBytes))
  const configuration = configurationSchema.parse(
    JSON.parse(configurationBytes),
  )
  if (
    manifest.sourceCommit !== record.sourceCommit ||
    configuration.sourceCommit !== record.sourceCommit
  )
    throw new Error('Release commit mismatch')
  return { record, manifest, configuration }
}

export function assertTrustedRun(
  run: {
    event: string
    conclusion: string | null
    head_branch: string
    head_sha: string
    path: string
    repository: { full_name: string }
  },
  commit: string,
) {
  if (
    run.event !== 'push' ||
    run.conclusion !== 'success' ||
    run.head_branch !== 'main' ||
    run.head_sha !== commit ||
    run.path !== '.github/workflows/verify.yml' ||
    run.repository.full_name !== 'treyturner/nurevolution.net'
  )
    throw new Error(
      'Release did not come from successful trusted main verification',
    )
}

export function expectedImages(release: Release) {
  releaseSchema.parse(release)
  return {
    app: `${registry}@${release.imageDigest}`,
    caddy: `${registry}-caddy@${release.caddyImageDigest}`,
  }
}

export interface DeploymentRecord {
  release: Release
  manifest: MediaManifest
  configuration: z.infer<typeof configurationSchema>
  profileSha256: string
  edgeSha256: string
  deployedAt: string
}
