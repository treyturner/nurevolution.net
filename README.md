# Nurevolution

A podcast website being rebuilt from WordPress. M1 supplies a minimal dark Nuxt shell, a browser-audio boundary, and the verification tooling needed for subsequent milestones. The archive, feed, full player, branding, and deployment follow in later milestones.

See the [roadmap](ROADMAP.md), [M0 audit plan and evidence](docs/milestones/M00-migration-audit.md), [M1 completion record](docs/milestones/M01-foundation-and-verification.md), and [M2 canonical content implementation plan](docs/milestones/M02-canonical-content.md).

## Setup

Use Node.js **22.23.2** from `.node-version`, pnpm **12.3.4** from `package.json`, and Python **3.14.4** from `.python-version`. Python runs the existing M0 audit unit tests using only its standard library; no pip dependencies are needed. With Node selected through your runtime manager:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm exec playwright install --with-deps chromium firefox webkit
pnpm verify
```

Browser installation is a one-time environment setup step; repeat it after changing Playwright versions. Linux system dependency installation may need elevated privileges. If Corepack shims are unavailable on your PATH, invoke pnpm as `corepack pnpm`, or install shims in a writable directory with `corepack enable --install-directory <directory>` and add that directory to PATH.

No environment file, private migration source, external feed, or credentials are needed for M1. Dependencies are pinned exactly and `pnpm-lock.yaml` is the installation source of truth. Do not replace it with a different package manager's lockfile.

The version marker in `.nuxtrc` records the completed Nuxt test-utils setup so verification does not create a setup file or launch its installer. Keep it aligned when intentionally upgrading test-utils.

## Development and commands

```sh
pnpm dev
```

Open the local URL printed by Nuxt. Vue and CSS edits update through HMR; changes to project configuration may restart the development server. Stop it with Ctrl-C. This shell intentionally contains only the site heading and keyboard skip link until the content and design milestones.

| Command                | Behavior                                                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm prepare`         | Generate Nuxt types and ESLint configuration; also runs during installation.                                                                  |
| `pnpm dev`             | Start the local Nuxt development server.                                                                                                      |
| `pnpm format`          | Rewrite maintained files with Prettier; review documentation changes.                                                                         |
| `pnpm format:check`    | Check formatting without edits.                                                                                                               |
| `pnpm lint`            | Check source, tests, and tooling with Nuxt ESLint.                                                                                            |
| `pnpm typecheck`       | Strict Nuxt checks plus explicit test, fixture, and tooling checks.                                                                           |
| `pnpm test`            | Run Node unit tests and Nuxt runtime tests once.                                                                                              |
| `pnpm test:migration`  | Run the deterministic M0 audit unit tests without private source access.                                                                      |
| `pnpm check:migration` | Validate the public M0 inventory and legacy URL map; exit 2 means valid artifacts contain documented blockers.                                |
| `pnpm test:coverage`   | Run those tests and enforce coverage thresholds.                                                                                              |
| `pnpm build`           | Produce the portable SSR Node application in `.output/`.                                                                                      |
| `pnpm build:fixture`   | Build the independent test-only media application.                                                                                            |
| `pnpm test:e2e`        | Build the media fixture and run all browser projects; requires a current normal production build.                                             |
| `pnpm verify`          | Prepare, formatting check, lint, types, migration unit tests, application coverage, production build, and browser tests, stopping on failure. |

The canonical local and CI gate is **`pnpm verify`**. It prepares its generated prerequisites and builds both applications without a hand-started server. It does not install dependencies, rewrite maintained files, accept snapshots, or contact the legacy site.

For focused work:

```sh
pnpm exec vitest run --project unit
pnpm exec vitest run --project nuxt
pnpm build
pnpm build:fixture
pnpm exec playwright test --project chromium
```

Run the normal production build locally with `node .output/server/index.mjs`. This validates the portable Node target; infrastructure and public deployment remain outside M1.

## Application and test boundaries

- `app/` contains the SSR shell, semantic home page, CSS, and production audio adapter.
- `tools/migration/` contains the standard-library audit command and tests. The shared gate runs both its unit tests and the public artifact check; feed capture, database export, and source reconciliation remain explicit private-workspace operations.
- `test/unit/` tests adapter behavior in Node with controlled media events and promises.
- `test/nuxt/` mounts the real application and shell through Nuxt test utilities and happy-dom.
- `test/e2e/` checks production SSR/hydration, unknown-route status, keyboard focus, narrow-screen text scaling, fixture isolation, and real browser media behavior.
- `test/fixtures/media-app/` is a separate Nuxt app importing the production adapter. Its `/media-test` route and `/sample.wav` asset must return 404 in the normal production app.

`createAudioAdapter(element)` accepts an existing `HTMLAudioElement` or the narrow `AudioPort` interface. `load(url)` sets and loads a source without invoking play. `play()` returns the native promise, including rejection; `pause()` pauses. `subscribe()` returns an unsubscribe function. Disposal pauses and removes only the adapter's listeners, and is idempotent. Operations after disposal throw synchronously; create a new adapter to start a new lifecycle. Imports and construction never create browser globals or playback state. Seeking and player sequencing belong to later milestones.

The committed audio fixture is an original, deterministic two-second, mono, 22,050 Hz, 16-bit PCM WAV containing a quiet 440 Hz tone, generated with `node tools/generate-audio-fixture.mjs`. No recording or third-party licensed asset is used. The fixture is muted in browser tests. Its provenance is also recorded [alongside the fixture](test/fixtures/media-app/README.md). These tests establish browser integration, not historical MP3 integrity, final player behavior, or physical-device compatibility.

## Coverage and browser execution

Vitest includes every executable `app/**/*.{ts,vue}`, `shared/**/*.ts`, and `server/**/*.ts` file, including unimported files. Only declaration files are excluded within those source patterns. Tests, generated output, dependencies, and declarative project configuration are outside the production-source patterns. No application subsystem is excluded. Python migration tooling is tested by `test:migration` separately from V8 application coverage. Generated migration reports/manifests retain the audit tool’s canonical formatting and are excluded from Prettier; maintained documentation remains checked.

Coverage thresholds are **95% statements, lines, and functions; 90% branches**, with automatic threshold updates disabled. Reports appear in `coverage/index.html` and `coverage/lcov.info` as well as the terminal. Add meaningful behavioral tests as code grows; do not lower thresholds to make a gate pass.

Playwright runs Chromium, Firefox, and WebKit against the built Node application on `127.0.0.1:3100` and isolated media app on `127.0.0.1:3101`. Override these with `NUREVOLUTION_TEST_PORT` and `NUREVOLUTION_MEDIA_TEST_PORT` when needed. Playwright owns both servers, stops them after testing, and fails if a port is already occupied. Local runs use two workers; CI uses one. Neither retries automatically. Media assertions wait for state/events rather than fixed sleeps.

The browser report is `playwright-report/index.html`; failed tests retain screenshots and traces under `test-results/`. Inspect with `pnpm exec playwright show-report` or `pnpm exec playwright show-trace <trace.zip>`.

## Dependency choices and CI

The pinned Nuxt 4.5.2, Vue 3.5.42, and Vue Router 5.3.1 set uses standard SSR and Nitro's Node server preset. TypeScript 6.0.3 is within the selected ESLint parser's supported range. Vitest 4.1.11 matches `@nuxt/test-utils` 4.2.0 and the V8 coverage provider. Direct versions and their rationale are recorded in the [M1 toolchain contract](docs/milestones/M01-foundation-and-verification.md#toolchain-and-dependency-contract).

`pnpm-workspace.yaml` allows only the version-specific `esbuild@0.28.2` and `unrs-resolver@1.12.2` installation scripts to prepare their platform binaries. It supplies `cac@6.7.14` through `@nuxt/cli@3.37.0` to `@bomb.sh/tab@0.0.19`, whose optional peer requires `^6.7.14`; other tooling requires cac 7. This preserves the declared peer range without changing unrelated consumers or ignoring conflicts. Reassess this narrow extension when upgrading that package.

GitHub Actions checks pull requests and pushes to `main` on Ubuntu 24.04 using the declared Node/Python runtimes, a frozen installation, all three browsers, and exactly `pnpm verify`. Actions are pinned to verified commit SHAs, repository permissions are read-only, and available coverage/browser artifacts are retained for 14 days. The workflow requires no deployment secrets and performs no publication. A local successful run is separate evidence from an actual remote Actions run; the M1 completion record states both statuses.
