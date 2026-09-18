# Development and contribution

Run commands from the repository root. This guide contains setup, verification, architecture, and dependency-maintenance details. See the [documentation index](README.md), [current status](STATUS.md), and [roadmap](../ROADMAP.md) for context. Historical milestone records retain the tool versions and outcomes of their original runs.

## Setup

Use Node.js **24.21.0** from `mise.toml` and `.node-version`, pnpm **12.3.4** from `package.json`, and Python **3.14.4** from `.python-version`. Python runs the existing M0 audit unit tests using only its standard library; no pip dependencies are needed. The repository's mise configuration selects Node without changing other projects' defaults:

```sh
mise install
mise exec -- corepack enable
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm exec playwright install --with-deps chromium firefox webkit
mise exec -- pnpm verify
```

With [mise shell activation](https://mise.jdx.dev/cli/activate.html) or its shims already configured, the ordinary `node` and `pnpm` commands below use the project pin. Otherwise prefix them with `mise exec --`. Python remains separately pinned; mise does not replace the system Python used by host services. CI reads `.node-version` with `setup-node`, and the application image uses its pinned Node base image. Neither depends on an interactive shell.

Browser installation is a one-time environment setup step; repeat it after changing Playwright versions. Linux system dependency installation may need elevated privileges. If Corepack shims are unavailable on your PATH, invoke pnpm as `corepack pnpm`, or install shims in a writable directory with `corepack enable --install-directory <directory>` and add that directory to PATH.

Ordinary application verification needs no private migration source, live production feed, or deployment credentials. Dependency/browser installation uses the network; Docker is required for delivery checks. Dependencies are pinned exactly and `pnpm-lock.yaml` is the installation source of truth. Do not replace it with a different package manager's lockfile.

The version marker in `.nuxtrc` records the completed Nuxt test-utils setup so verification does not create a setup file or launch its installer. Keep it aligned when intentionally upgrading test-utils.

## Development and commands

```sh
mise exec -- pnpm dev
```

Open the local URL printed by Nuxt. Vue and CSS edits update through HMR; changes to project configuration may restart the development server. Stop it with Ctrl-C. For a remote Coder workspace, use `mise exec -- pnpm dev --host 0.0.0.0 --port 3000` and its authenticated forwarded URL. The development server allows `.coder.treyturner.info`; keep authentication enabled. The archive restores its locally saved episode/position within 24 hours of the last document visit, always paused; otherwise it selects the latest episode. Direct episode URLs take precedence. Mobile uses Episodes/Tracklist tabs.

| Command                                               | Behavior                                                                                                                                                                                              |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm prepare`                                        | Generate Nuxt types and ESLint configuration; also runs during installation.                                                                                                                          |
| `pnpm dev`                                            | Start the local Nuxt development server.                                                                                                                                                              |
| `pnpm format`                                         | Rewrite maintained files with Prettier; review documentation changes.                                                                                                                                 |
| `pnpm format:check`                                   | Check formatting without edits.                                                                                                                                                                       |
| `pnpm lint`                                           | Check source, tests, and tooling with Nuxt ESLint.                                                                                                                                                    |
| `pnpm typecheck`                                      | Strict Nuxt checks plus explicit test, fixture, and tooling checks.                                                                                                                                   |
| `pnpm test`                                           | Run Node unit tests and Nuxt runtime tests once.                                                                                                                                                      |
| `pnpm test:migration`                                 | Run the deterministic M0 audit unit tests without private source access.                                                                                                                              |
| `pnpm check:migration`                                | Validate the public M0 inventory and legacy URL map; exit 2 means valid artifacts contain documented blockers.                                                                                        |
| `pnpm import:wordpress`                               | Dry-run the frozen WordPress import; `--write` creates missing files; `--check` compares without edits.                                                                                               |
| `pnpm check:content`                                  | Validate authoring, references, safe descriptions, publication rules, and protected historical fields.                                                                                                |
| `pnpm check:thumbnails`                               | Validate the complete committed thumbnail set without original media or network access.                                                                                                               |
| `pnpm generate:thumbnails --uploads <directory>`      | Regenerate small list thumbnails from verified original artwork; commit the results with content changes.                                                                                             |
| `pnpm check:episode-artwork`                          | Validate committed feed JPEGs and their provenance manifest offline, including complete coverage and retained public paths.                                                                           |
| `pnpm generate:episode-artwork --uploads <directory>` | Generate feed-compatible JPEGs from hash-verified originals; commit images and the manifest together.                                                                                                 |
| `pnpm check:playback`                                 | Validate committed playback indexes against the canonical assets.                                                                                                                                     |
| `pnpm check:feed`                                     | Generate and independently parse the complete RSS, checking canonical fields and all protected historical identities without network or media access.                                                 |
| `pnpm test:coverage`                                  | Run those tests and enforce coverage thresholds.                                                                                                                                                      |
| `pnpm build`                                          | Validate content, thumbnails, feed artwork, RSS, and playback indexes, then produce the portable SSR Node application in `.output/`.                                                                  |
| `pnpm build:fixture`                                  | Build the independent test-only media application.                                                                                                                                                    |
| `pnpm test:e2e`                                       | Build the media fixture and run all browser projects; requires a current normal production build.                                                                                                     |
| `pnpm verify`                                         | Run preparation, formatting, lint, types, migration/operations tests, coverage, content/feed/artwork/playback validation, production builds, browser tests, and Docker delivery, stopping on failure. |

The canonical local and CI gate is **`pnpm verify`**, including the Docker delivery checks. A working Docker daemon is required; see [local and separate-daemon setup](DEPLOYMENT.md#release-and-host-contracts). It prepares its generated prerequisites and builds both applications without a hand-started server. It does not install dependencies, rewrite maintained files, accept snapshots, or contact the legacy site.

`pnpm test:operations`, also included in that gate, checks the Python host credential helpers and Discord notifier without cloud credentials or network access. The Docker delivery checks validate the Cloudflare account-token format and certificate automation before application routes exist, using an offline local CA.

For focused work:

```sh
pnpm exec vitest run --project unit
pnpm exec vitest run --project nuxt
pnpm build
pnpm build:fixture
pnpm exec playwright test --project chromium
```

Run the normal production build locally with `node .output/server/index.mjs`. This validates the portable Node target; it is separate from live deployment and release acceptance.

## Application and test boundaries

- `app/` contains the SSR archive, request-scoped navigation model, persistent player session, mobile tabs, and audio adapter/controller.
- `content/` holds 55 episode records, 156 assets, show metadata, legacy URL mappings, and deterministic import provenance. See [editing and reconciliation](CONTENT.md).
- `shared/content/` defines strict schemas and pure public selection/projections. `server/content/` validates and loads the catalog; `server/api/` exposes show, episode summaries, and detail. Nitro packages the archive as server assets, independent of the production working directory.
- `tools/content/` imports only frozen public M0 inputs plus the Praxis evidence. The default import is a dry run; explicit writes create missing files without overwriting existing ones. Ordinary validation permits later editorial changes and protects historical subscriber identity.
- `tools/migration/` contains the standard-library audit command and tests. The shared gate runs both its unit tests and the public artifact check; feed capture, database export, and source reconciliation remain explicit private-workspace operations.
- `test/unit/` tests adapter behavior in Node with controlled media events and promises.
- `test/nuxt/` mounts the real application and shell through Nuxt test utilities and happy-dom.
- `test/e2e/` checks production SSR/hydration, unknown-route status, keyboard focus, narrow-screen text scaling, fixture isolation, and real browser media behavior.
- `test/fixtures/media-app/` is a separate Nuxt app importing the production adapter, player/list components, and download handler. Its routes and media fixtures must return 404 in the normal production app.

`createAudioAdapter(element)` accepts an existing `HTMLAudioElement` or the narrow `AudioPort` interface. `load(url)` sets and loads a source without invoking play. `play()` returns the native promise, including rejection; `pause()` pauses. `subscribe()` returns an unsubscribe function. Disposal pauses and removes only the adapter's listeners, and is idempotent. Operations after disposal throw synchronously; create a new adapter to start a new lifecycle. Imports and construction never create browser globals or playback state. The adapter also exposes the native media snapshot needed by the player controller. Custom seek/volume controls, local restoration, interactive tracks, and automatic advancement down the displayed episode list share that session. See the [player guide](PLAYER.md) for selection, retry, and download behavior.

The committed audio fixture is an original, deterministic two-second, mono, 22,050 Hz, 16-bit PCM WAV containing a quiet 440 Hz tone, generated with `node tools/generate-audio-fixture.mjs`. No recording or third-party licensed asset is used. The fixture is muted in browser tests. Its provenance is also recorded [alongside the fixture](../test/fixtures/media-app/README.md). M4 adds a small original MP3 fixture for the production player and attachment-download tests. These tests establish application/browser integration, not historical MP3 delivery or physical-device compatibility.

## M8 development and acceptance

Timestamp-link parsing and Media Session integration live in `app/services/`, with the existing player and route transaction remaining the state owners. Browser compatibility settings are shared by the archive and media fixture. Feature-removal tests exercise fallbacks; current headless WebKit does not emulate Safari 14.3. Test that device against a production build, not only the HMR server. Keep a separate immutable copy of `.output` for an owner preview while rebuilding or running the gate in the working tree.

Episode feed artwork is generated explicitly from verified originals. Builds and CI only check committed JPEGs and `tools/content/episode-artwork-manifest.json`, without fetching original images. Follow [content authoring](CONTENT.md#m8-episode-feed-artwork-and-chapters) for generation and retention. The shared chapter serializer feeds both the public chapter endpoint and the RSS version hint. Follow the [two-release rollout order](FEED-VALIDATION.md#m8-resource-support-and-rollout) before any authorized production promotion.

Timestamp links use the current browser origin, including its scheme, hostname, and port, so links copied in a workspace preview reopen that preview directly. Ordinary episode links and RSS resource URLs retain the canonical production origin. A preview's canonical RSS chapter/artwork references do not make undeployed production resources available. Actual podcast-client acceptance is separate from the automated resource checks and remains pending until those resources are reachable by the client. Do not change the canonical feed identity to make a preview subscription work.

The [M8 evidence record](milestones/evidence/M08-local-verification.json) records local gates, the first PR's review, observed iPad behavior, and outstanding physical/UI/client acceptance. The milestone remains open, and this work does not authorize deployment.

## Coverage and browser execution

Vitest includes every executable `app/**/*.{ts,vue}`, `shared/**/*.ts`, `server/**/*.ts`, and `tools/content/**/*.ts`, and `tools/deploy/**/*.ts` file, including unimported files. Only declaration files are excluded within those source patterns. Tests, generated output, dependencies, and declarative project configuration are outside the production-source patterns. No application subsystem is excluded. Python migration tooling is tested by `test:migration` separately from V8 application coverage. Generated migration reports/manifests retain the audit tool’s canonical formatting and are excluded from Prettier; maintained documentation remains checked.

Coverage thresholds are **95% statements, lines, and functions; 90% branches**, with automatic threshold updates disabled. Reports appear in `coverage/index.html` and `coverage/lcov.info` as well as the terminal. Add meaningful behavioral tests as code grows; do not lower thresholds to make a gate pass.

Playwright runs Chromium, Firefox, and WebKit against the built Node application on `127.0.0.1:3100`, isolated media app on `127.0.0.1:3101`, and a second application instance with development delivery origins on `127.0.0.1:3102`. Override these with `NUREVOLUTION_TEST_PORT`, `NUREVOLUTION_MEDIA_TEST_PORT`, and `NUREVOLUTION_DEV_TEST_PORT`. Playwright owns all three servers, stops them after testing, and fails if a port is already occupied. Local runs use two workers; CI uses one. Neither retries automatically. Media assertions wait for state/events rather than fixed sleeps.

The browser report is `playwright-report/index.html`; failed tests retain screenshots and traces under `test-results/`. Inspect with `pnpm exec playwright show-report` or `pnpm exec playwright show-trace <trace.zip>`.

## Dependency choices and CI

The pinned Nuxt 4.5.2, Vue 3.5.42, and Vue Router 5.3.1 set uses standard SSR and Nitro's Node server preset. TypeScript 6.0.3 is within the selected ESLint parser's supported range. Vitest 4.1.11 uses `@nuxt/test-utils` 4.3.2 and the matching V8 coverage provider. Direct versions and their rationale are recorded in the [M1 toolchain contract](milestones/M01-foundation-and-verification.md#toolchain-and-dependency-contract).

`pnpm-workspace.yaml` allows only the version-specific `esbuild@0.28.2` and `unrs-resolver@1.12.2` installation scripts to prepare their platform binaries. It supplies `cac@6.7.14` through `@nuxt/cli@3.37.0` to `@bomb.sh/tab@0.0.19`, whose optional peer requires `^6.7.14`; other tooling requires cac 7. This preserves the declared peer range without changing unrelated consumers or ignoring conflicts. Reassess this narrow extension when upgrading that package.

GitHub Actions checks pull requests and pushes to `main` on Ubuntu 24.04 using the declared Node/Python runtimes, a frozen installation, all three browsers, and exactly `pnpm verify`. Actions are pinned to verified commit SHAs, verification permissions are read-only, and available coverage/browser artifacts are retained for 14 days. PR verification needs no deployment secrets. After successful main verification, a separate job publishes the exact tested application/Caddy images; manual production promotion is enabled and uses environment-scoped credentials. A merge publishes verified artifacts; it does not automatically deploy production. Separate Verify jobs also audit playback indexing, container image identity, temporary Headscale clients, and Headscale backup/restore tooling. A local successful run is separate evidence from an actual remote Actions run.

[Dependabot](../.github/dependabot.yml) checks npm dependencies (including the pnpm lockfile) and SHA-pinned GitHub Actions every Monday at 09:00 UTC. It allows up to three open npm version-update PRs and one Actions version-update PR. Minor/patch npm updates share a group; Nuxt/Vue and Vitest major updates each have their own group to keep related packages together, while other majors remain individual PRs. All Actions version updates share one group. Security updates have a separate group per ecosystem and are not held to the weekly version-update schedule or its PR limits; The owner confirmed Dependabot security alerts enabled on 2026-09-18. Automatic security-update PRs additionally require their repository setting; enabling alerts alone does not confirm that setting. Nothing auto-merges.

Node type-definition major updates are ignored until the declared Node runtime is deliberately upgraded. Dependency PRs must preserve the pinned toolchain and frozen installation; check the version-specific build-script approvals and `cac` extension in `pnpm-workspace.yaml` when their packages change. Container/runtime upgrades remain coordinated manual changes because their versions also appear in deployment policy, image digests, and verification fixtures. Python operational tools use the standard library. The offline [virtual playback indexer](operations/virtual-playback.md) separately pins PyAV and requires a complete audio audit when its muxer version changes.

[CodeQL](../.github/workflows/codeql.yml) scans GitHub Actions, JavaScript/TypeScript (including Vue), and Python on PRs targeting `main`, pushes to `main`, Sundays at 12:20 UTC, and manual dispatch. Each language runs independently with the default query suite and no application build or dependency installation. Only the analysis job receives permission to upload security results; it needs no deployment secrets. This workflow uses **advanced setup**: keep CodeQL default setup disabled in repository settings so it does not conflict with workflow uploads. These workflows are on `main`; their schedules are active, subject to GitHub schedule availability and inactivity rules.
