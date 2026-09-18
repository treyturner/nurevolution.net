# Accurate VBR seeking

The website can serve MP3 audio inside a virtual MP4 container. The front index maps time to exact compressed MP3 packets, avoiding Chromium's approximate VBR byte seeking. No audio is re-encoded. RSS enclosures, downloads, canonical asset identities, and sample-based track offsets retain their original identities/timeline. RSS chapter output remains future M8 work.

## Representation and audit

`playback/manifest.json` classifies all 55 MP3s by their actual audio frame bitrates. There are 37 VBR files and 18 CBR files; filenames alone are insufficient. Each VBR entry binds its source SHA-256, byte length and contiguous packet span to a representation SHA-256 and gzip-compressed MP4 header. The headers total 1,859,368 bytes. They are packaged as private Nitro server assets, not public static files. No second copy of the audio is stored on the host.

The offline generator verifies original identity, packet contiguity, byte-identical compressed payloads, leading delay, presentation duration, and a per-channel SHA-256 of decoded floating-point PCM. MP4 edit metadata preserves leading trim and all trailing padding, including files with multiple padding packets. VBRI duration estimates can include the metadata frame, so the original decoded sample count is authoritative. The manifest records these sample counts and PCM hashes. All 37 VBR files passed this audit; CBR files retain their original delivery.

The offline generator is pinned to PyAV 16.1.0 with its bundled libavformat 62.3.100. Regenerate deliberately when originals change. Do not run it on production. It needs temporary space for one full episode representation, removed after each file, and reads each original several times.

```bash
python3 -m venv .local/playback-venv
.local/playback-venv/bin/pip install --only-binary=:all: -r tools/playback/requirements.txt
.local/playback-venv/bin/python tools/playback/generate.py --audio /absolute/path/to/originals
.local/playback-venv/bin/python -m unittest discover -s tools/playback -p 'test_generate.py'
pnpm check:playback
```

Commit the complete manifest and headers together. `pnpm build` rejects incomplete coverage, stale source identities, missing/extra headers, decompression/hash mismatches, and invalid MP4 payload boundaries. CI additionally regenerates the synthetic fixture with the pinned muxer and checks compressed payload identity, decoded PCM and presentation trimming. Updating PyAV/FFmpeg requires regenerating and auditing every representation; an ordinary dependency bump is insufficient.

## Runtime and browser behavior

`/playback/<source-sha256>/<representation-sha256>.m4a` serves a checked header followed by the original MP3 packet span. Only current public audio mappings are available. The server rejects path escapes, symlinks, missing files and size mismatches. Deployment's existing full source hash check establishes identity before activation; requests use a read-only source mount and check size without rehashing hundreds of megabytes per request. Operators must replace media only through verified deployment.

Responses implement GET, HEAD, single byte ranges (including the header/audio boundary), strong ETags, conditional 304 responses and If-Range. Unsatisfiable ranges receive 416; malformed or multipart ranges are ignored and receive the complete representation. The one-year immutable cache key includes both source and representation identity. Response errors are not cached. CORS permits browser media playback, and Caddy proxies this path on the media hostname while continuing to serve original MP3s directly.

The decoded header LRU has a 16 MiB budget. File reads use 64 KiB chunks and response backpressure. Client disconnects cancel reads and close descriptors. There is no conversion, external media fetch or child process in the request handler.

Initial virtual playback selection requires desktop/Android Chromium (including Brave) and a positive `canPlayType` result for `audio/mp4; codecs="mp4a.6B"`. Firefox, WebKit and iOS browser variants retain MP3 pending separate audible compatibility qualification. An advertised codec alone is not enough to qualify an engine.

On a network, decode or unsupported-source media error, the player retries once with the original MP3, retaining the requested position, play/pause intent, volume and mute state. The failed virtual URL is remembered for that page session. Autoplay denial, buffering and stale requests do not switch formats. A fallback may restore the original VBR seeking limitations; it does not change track offsets.

## Preview, activation and rollback

For local preview with verified originals:

```bash
NUXT_VIRTUAL_PLAYBACK=true NUXT_AUDIO_ROOT=/absolute/path/to/originals pnpm dev --host 0.0.0.0 --port 3000
```

Development uses the same origin for virtual playback and preserves the original media origin for MP3 fallback. Production descriptors use the configured media origin. Disabling the switch removes descriptors and makes the virtual endpoint return 404.

For a separately authorized production release, add `"virtualPlayback": true` to the operator's deployment profile. The default is off; this change does not enable production automatically. Compose mounts `/srv/nurevolution/media/audio` read-only at `/media/audio` and passes the profile switch. The deployment checks the Praxis descriptor, media origin, representation identity and a bounded range before acceptance; failure triggers existing recovery. The uptime monitor probes the same virtual range when the descriptor is present.

To roll back the feature, set `"virtualPlayback": false` and run the normal authorized promotion workflow. New player selections then use MP3. A playing virtual representation can finish from its buffer or fall back on an error. Original feed and download URLs remain usable throughout. Prior releases also remain available through the normal release rollback procedure.

## Acceptance checks

`pnpm verify` covers the player state machine, browser source selection and fallback, real HTTP ranges, Caddy proxy delivery, and synthetic audible seek comparison. Chromium's test captures decoded output after repeated forward/backward seeks and correlates it with the original sound; the maximum permitted disagreement with the reported clock is 100 ms. Browser audio pipelines introduce tens of milliseconds of measurement uncertainty, so this does not claim sample-exact browser output.

The following opt-in checks require the actual archive and never contact production:

```bash
.local/playback-venv/bin/pip install --only-binary=:all: -r tools/playback/audit-requirements.txt
.local/playback-venv/bin/python -m unittest discover -s tools/playback -p 'test_*.py'
.local/playback-venv/bin/python tools/playback/references.py /absolute/path/to/originals
node tools/playback/audible.mjs http://localhost:3000
node tools/playback/capacity.ts /absolute/path/to/originals
```

The audible check uses sequentially decoded PCM references for Praxis, Radio Silenced, Cody Haynes' November 12, 2005 mix and EazyTom's Bizarre NYE. It tests 12 positions, including late-episode seeks. NumPy performs full-resolution waveform correlation to distinguish repeating bars that can confuse amplitude-only comparisons. Results go to `.local/playback/audible.json`. Set `PLAYBACK_PYTHON` if the audit environment uses a different interpreter path.

The capacity check builds the current runtime, warms every VBR header, runs 16 paced streams for 120 seconds in a read-only 256 MiB container, includes abandoned responses, and loads health, SSR and RSS concurrently. It records resident memory, completed checks and OOM state in `.local/playback/capacity.json`. For a separate Docker daemon, set `NUREVOLUTION_DOCKER_ADDRESS` to its reachable IPv4 address, as with the delivery suite. Confirm the daemon can bind the specified original-audio directory.

Windows Brave and physical Android listening remain user acceptance checks. Safari/iOS and Firefox do not receive the new format in this release.

The [recorded local acceptance evidence](virtual-playback-evidence.json) includes all 12 audible positions and the capacity run. Chromium 153 measured roughly 2 ms of audio/clock disagreement at these positions. The 16-listener run completed 333 health/page/feed checks with a peak resident size of 139.4 MiB and no OOM. These are local measurements, not a guarantee about every physical device or production load.
