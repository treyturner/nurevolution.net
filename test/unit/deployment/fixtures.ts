import {
  createManifest,
  serialize,
  sha256,
} from '../../../tools/deploy/manifest.ts'
import { runnableCatalog } from '../content/fixtures.ts'

export function releaseFixture() {
  const manifest = createManifest(
    runnableCatalog(),
    'a'.repeat(40),
    '2026-09-09T00:00:00.000Z',
  )
  const configuration = {
    schemaVersion: 1 as const,
    sourceCommit: manifest.sourceCommit,
    compose: 'services: {}',
    rendererSha256: 'b'.repeat(64),
    caddyDockerfileSha256: 'c'.repeat(64),
  }
  const release = {
    schemaVersion: 1 as const,
    sourceCommit: manifest.sourceCommit,
    verifyRunUrl:
      'https://github.com/treyturner/nurevolution.net/actions/runs/123',
    imageDigest: 'sha256:' + 'd'.repeat(64),
    imageId: 'sha256:' + 'e'.repeat(64),
    caddyImageDigest: 'sha256:' + 'f'.repeat(64),
    caddyImageId: 'sha256:' + '0'.repeat(64),
    configurationSha256: sha256(serialize(configuration)),
    mediaManifestSha256: sha256(serialize(manifest)),
    publishedAt: '2026-09-09T00:00:00.000Z',
  }
  return {
    release,
    manifest,
    configuration,
    profileSha256: '1'.repeat(64),
    edgeSha256: '2'.repeat(64),
    deployedAt: release.publishedAt,
  }
}
