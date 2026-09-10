# Media audit and transfer

The manifest derives from the validated catalog and frozen historical artwork allowlist. It preserves all 55 MP3s and 101 artwork assets, 6,808,089,382 bytes in total. Every mapping includes original relative path, URL, type, length, SHA-256, public eligibility, and attachment metadata. New unreferenced or draft-only assets have no public routes. Original files are never rewritten.

Use the manifest from the exact verified release bundle. From the source workspace:

```sh
node tools/deploy/cli.ts scan --manifest .local/delivery/artifacts/manifest.json \
  --audio /home/coder/dev/net.nurevolution.podcast \
  --uploads /home/coder/dev/net.nurevolution/wp/wp-content/uploads --decode
node tools/deploy/cli.ts stage --manifest .local/delivery/artifacts/manifest.json \
  --audio /home/coder/dev/net.nurevolution.podcast \
  --uploads /home/coder/dev/net.nurevolution/wp/wp-content/uploads \
  --destination .local/media-stage
```

`scan --decode` requires FFmpeg on the source workstation. It hashes every file and decodes all audio with explicit failure reporting; do not run the decode pass on the 1 GB droplet. A checksum-only scan omits `--decode`. The stage command checks all sources before copying, streams hashing, rejects symlinks and overlapping roots, verifies staged bytes, and creates destination files exclusively. It resumes identical files and refuses conflicting destination bytes. Staging explicitly sets the destination root and asset directories to mode 0755 and verified files to mode 0444, including on a resumed copy under umask 0077. Host directories above the destination and temporary staging directories keep their private permissions; Caddy only needs to traverse the tree mounted at `/media`. No sync deletes old assets.

Transfer the staged `audio/` and `uploads/` directories to a **non-served** host staging directory using the operator's pinned SSH connection, then run:

```sh
node /srv/nurevolution/tooling/deploy.mjs check-assets \
  --manifest RELEASE_BUNDLE/manifest.json --destination HOST_STAGING
node /srv/nurevolution/tooling/deploy.mjs stage \
  --manifest RELEASE_BUNDLE/manifest.json \
  --audio HOST_STAGING/audio --uploads HOST_STAGING/uploads \
  --destination /srv/nurevolution/media
```

Keep enough disk for both copies, images, logs, backups, and recovery. Serialize upload/backup/deployment work on the small host. Only remove this operation's temporary staging directory after destination checks pass. Append-only media remains available across app rollback.

The website `/downloads/<slug>` returns a no-store 307 to the DNS-only media host. Its attachment route uses `application/octet-stream` plus the exact ASCII/UTF-8 filename disposition: WebKit otherwise opens redirected `audio/mpeg` as media. Original enclosure paths remain `audio/mpeg`, support HEAD/ranges/resume, and have no attachment disposition. Artwork retains its original MIME type. Unknown download/asset routes cannot fall through to Node or reveal arbitrary files.

Run the explicit HTTP audit against the candidate preview names:

```sh
node /srv/nurevolution/tooling/deploy.mjs audit-http \
  --manifest RELEASE_BUNDLE/manifest.json \
  --web https://preview.nurevolution.net \
  --media https://podcast-preview.nurevolution.net
```

This checks every public asset's HEAD/range metadata and all attachment mappings. `--full` additionally downloads and verifies every public asset, about 6.34 GiB; use it deliberately and record the transfer cost. For representative full/resume checks, use the largest MP3, apostrophe filename, and both Mega parts with `curl --resolve` to the candidate and compare SHA-256 against the manifest. A saved subset may be audited only if recorded as a subset, never represented as the complete archive. Keep private source paths out of public evidence.
