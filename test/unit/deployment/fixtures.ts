import {
  createManifest,
  serialize,
  sha256,
} from '../../../tools/deploy/manifest.ts'
import { runnableCatalog } from '../content/fixtures.ts'
import { profileSchema } from '../../../tools/deploy/render-config.ts'
import exampleProfile from '../../../deploy/profile.example.json'

export const fixtureTooling = 'synthetic verified deployment executable\n'

export const imageConfiguration = (kind: string) =>
  serialize({
    os: 'linux',
    architecture: 'amd64',
    config: { Labels: { 'test.kind': kind } },
    rootfs: { type: 'layers', diff_ids: ['sha256:' + sha256(kind)] },
  })

export function imageArchiveCommands(configuration: (image: string) => string) {
  const archives = new Map<string, string>()
  return (command: string, args: string[]) => {
    if (command === 'docker' && args[0] === 'image' && args[1] === 'save') {
      archives.set(
        args[args.indexOf('--output') + 1]!,
        configuration(args.at(-1)!),
      )
      return ''
    }
    if (command === 'tar') {
      const bytes = archives.get(args[1]!)!
      return args.at(-1) === 'manifest.json'
        ? JSON.stringify([{ Config: 'blobs/sha256/' + sha256(bytes) }])
        : bytes
    }
  }
}

export function releaseFixture() {
  const profile = profileSchema.parse(exampleProfile)
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
    toolingSha256: sha256(fixtureTooling),
    caddyDockerfileSha256: 'c'.repeat(64),
  }
  const release = {
    schemaVersion: 1 as const,
    sourceCommit: manifest.sourceCommit,
    verifyRunUrl:
      'https://github.com/treyturner/nurevolution.net/actions/runs/123',
    imageDigest: 'sha256:' + 'd'.repeat(64),
    imageId: 'sha256:' + sha256(imageConfiguration('app')),
    caddyImageDigest: 'sha256:' + 'f'.repeat(64),
    caddyImageId: 'sha256:' + sha256(imageConfiguration('caddy')),
    caddyBinarySha256: '3'.repeat(64),
    configurationSha256: sha256(serialize(configuration)),
    mediaManifestSha256: sha256(serialize(manifest)),
    publishedAt: '2026-09-09T00:00:00.000Z',
  }
  return {
    release,
    manifest,
    configuration,
    profile,
    profileSha256: sha256(serialize(profile)),
    edgeSha256: '2'.repeat(64),
    deployedAt: release.publishedAt,
  }
}
