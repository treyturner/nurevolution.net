# M1 — Nuxt foundation and canonical verification

Status: **Implemented and locally verified** on 2026-09-07. The GitHub Actions workflow is written; a remote run has not been triggered.

Plan date: 2026-09-07.

Roadmap: [M1 — Foundation and verification](../../ROADMAP.md#m1--foundation-and-verification).

Project guidance: [BOOTSTRAP.md](../BOOTSTRAP.md). Companion plan: [M0 — Migration audit](M00-migration-audit.md).

## Outcome and scope

Create the smallest useful Nuxt foundation with strict typing, meaningful tests, and one complete local/CI verification command. M1 establishes the engineering prerequisites shared by all R1 requirements.

Include an accessible dark application shell and a minimal browser-audio adapter. Exclude archive import, RSS generation, final branding, episode navigation, persistence, scheduled publishing, production deployment, and rich player controls. Keep production test routes and fabricated episodes out of the public application.

M1 has no M0 dependency. Use a deterministic local audio fixture rather than waiting for historical MP3s or database access. Do not scaffold the project by overwriting the existing repository.

## Current evidence and confirmed decisions

At planning time the repository contains only the bootstrap and roadmap, both untracked, and has no commits. There is no package manifest, application, lockfile, CI workflow, or verification command. Re-inspect before implementation and preserve any newer user work.

The inspected environment provides Node.js 22.23.2, Corepack 0.34.6, and Python 3.14.4. Installed tooling is evidence, not a substitute for project version declarations.

On 2026-09-07 the owner confirmed:

- Chromium, Firefox, and WebKit checks are required from M1.
- Coverage thresholds are 95% statements, lines, and functions, and 90% branches.
- M0 waits for complete local source intake; M1 may proceed independently.

Use pnpm, normal Nuxt SSR, a portable Node server production build, Vitest, Nuxt test utilities, Playwright, Nuxt ESLint, and Prettier. No player library, CMS, component framework, utility-CSS framework, or deployment service is required here.

## Toolchain and dependency contract

Registry metadata was inspected on 2026-09-07. Use this version set, pin direct dependencies exactly, and retain the generated lockfile. This version set has passed a clean locked installation, production builds, and the complete local verification gate. The transitive peer correction below was required; direct JavaScript pins remain unchanged. Python 3.14.4, declared in `.python-version` and provisioned in CI, runs the M0 unit tests that appeared concurrently during M1 implementation.

| Package/tool          | Version | Purpose                                                       |
| --------------------- | ------- | ------------------------------------------------------------- |
| Node.js               | 22.23.2 | Project runtime, declared in `.node-version` and used by CI.  |
| pnpm                  | 12.3.4  | Exact `packageManager` declaration; frozen-lockfile installs. |
| `nuxt`                | 4.5.2   | Framework and portable Node production build.                 |
| `vue`                 | 3.5.42  | Application/component runtime.                                |
| `vue-router`          | 5.3.1   | Router version compatible with this Nuxt release.             |
| `typescript`          | 6.0.3   | Strict source/tooling type checks.                            |
| `vue-tsc`             | 3.3.11  | Vue type checking required by the Nuxt toolchain.             |
| `@types/node`         | 22.20.1 | Types aligned to the selected Node major.                     |
| `vitest`              | 4.1.11  | Unit and Nuxt runtime test runner.                            |
| `@vitest/coverage-v8` | 4.1.11  | Coverage provider matching the runner version.                |
| `@nuxt/test-utils`    | 4.2.0   | Nuxt-aware runtime and fixture testing.                       |
| `@vue/test-utils`     | 2.5.0   | Component interaction assertions.                             |
| `happy-dom`           | 20.14.0 | DOM environment for Nuxt runtime tests.                       |
| `@playwright/test`    | 1.63.0  | Chromium, Firefox, and WebKit browser tests.                  |
| `@nuxt/eslint`        | 1.17.0  | Project-aware Nuxt flat ESLint configuration.                 |
| `eslint`              | 10.10.0 | Static checks without automatic fixes.                        |
| `prettier`            | 3.9.6   | Formatting and formatting checks.                             |

The inspected Nuxt test-utils peer range requires Vitest 4; do not replace it with the latest Vitest 5 merely because it is newer. The inspected TypeScript ESLint parser supports TypeScript versions below 6.1, which is why the plan selects TypeScript 6.0.3 rather than 7. [Nuxt test-utils metadata](https://registry.npmjs.org/@nuxt%2Ftest-utils/4.2.0), [TypeScript parser metadata](https://registry.npmjs.org/@typescript-eslint%2Ftypescript-estree/8.69.0)

Do not bypass peer conflicts or broadly approve dependency lifecycle scripts. If installation exposes a conflict not visible in direct metadata, record the exact dependency evidence, make the smallest compatible correction, and update this table with the reason. Add only packages required by an actual toolchain capability.

Implementation evidence: `@nuxt/cli@3.37.0` brings `@bomb.sh/tab@0.0.19`, whose optional `cac` peer requires `^6.7.14`. Initial resolution supplied cac 7 from other tooling. The version-scoped `packageExtensions` entry in `pnpm-workspace.yaml` supplies `cac@6.7.14` under that Nuxt CLI version, leaving consumers requiring cac 7 unchanged. `pnpm peers check` reports no issues, and strict peer checks are enabled. The only permitted dependency build scripts are `esbuild@0.28.2` and `unrs-resolver@1.12.2`, which prepare their platform binaries. No peer ranges or coverage thresholds were weakened.

## File and subsystem responsibilities

| Area                  | Planned targets and responsibilities                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Project configuration | `package.json`, `pnpm-lock.yaml`, `.node-version`, `nuxt.config.ts`, Nuxt-referenced `tsconfig.json`, ignore/configuration files. |
| Application shell     | `app/app.vue`, `app/components/AppShell.vue`, `app/pages/index.vue`, and minimal dark CSS in `app/assets/`.                       |
| Media boundary        | `app/services/audio.ts`; browser-independent imports and an injected audio element.                                               |
| Unit/runtime tests    | `vitest.config.ts`, `test/unit/`, and `test/nuxt/`.                                                                               |
| Browser tests         | `playwright.config.ts`, `test/e2e/`, and a dedicated `test/fixtures/media-app/` Nuxt fixture using the real adapter.              |
| Verification          | Package scripts, explicit ESLint flat configuration, Prettier configuration, and coverage configuration.                          |
| CI                    | `.github/workflows/verify.yml`; checks only, without publication/deployment.                                                      |
| Contributor handoff   | `README.md` covering setup, commands, test boundaries, dependency choices, and verification evidence.                             |

Keep shared pure domain logic and server logic separate when those areas are introduced later. Do not create empty modules or placeholder endpoints for future milestones.

## Ordered implementation steps

### 1. Establish reproducible project configuration

- [x] Re-inspect repository state, instructions, source files, manifests, and existing checks.
- [x] Add the minimal package manifest manually or copy only required starter files, preserving existing documents.
- [x] Declare the runtime and package manager, install the pinned dependency set, and retain the lockfile.
- [x] Use strict Nuxt TypeScript project references for app, server, shared, and Node/tooling contexts. Ensure test/config files also receive type checking; do not assume the default include rules cover them.
- [x] Keep SSR enabled and select the Nitro Node server preset. Do not opt into Nuxt 5 compatibility or static-only generation.
- [x] Add ignore rules for dependencies, generated Nuxt/build output, coverage, browser reports, local environments, and private migration working files if any appear inside the checkout.

### 2. Build the minimal application shell

- [x] Render a semantic main landmark, a Nurevolution heading, document language `en`, and a useful document title.
- [x] Start with a dark color scheme, readable contrast, and visible focus styling; defer final branding and layout decisions to M4.
- [x] Provide correct unknown-route behavior with an HTTP 404 response.
- [x] Keep the home page free of invented episodes, broken RSS links, placeholder player controls, and development diagnostics.
- [x] Ensure initial HTML is meaningful before hydration and no browser APIs execute during SSR.

### 3. Implement the minimal audio adapter

Expose `createAudioAdapter(element)` from `app/services/audio.ts`. Accept an existing `HTMLAudioElement` through a narrow typed port so tests can supply a controlled implementation.

| Operation                    | Contract                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| `load(sourceUrl)`            | Assign/load the requested source without invoking play.                                   |
| `play()`                     | Return the browser's play promise; preserve rejection for the caller.                     |
| `pause()`                    | Pause the supplied element.                                                               |
| `subscribe(event, listener)` | Register a supported media listener and return an unsubscribe function.                   |
| `dispose()`                  | Pause playback and remove listeners owned by this adapter; repeated disposal is harmless. |

- [x] Support the events needed for initial playback verification: `loadedmetadata`, `play`, `pause`, `ended`, and `error`.
- [x] Keep module imports free of `window`, `document`, `Audio`, storage, and module-global playback state.
- [x] Create browser elements only in client lifecycle code in the test fixture; importing/constructing the adapter must not automatically play audio.
- [x] Do not add seek, volume, persistence, episode ordering, or navigation state machinery yet.
- [x] Cover meaningful adapter guarantees, particularly no play on load, rejection propagation, and listener cleanup.

### 4. Establish meaningful test boundaries

- [x] Configure a Vitest Node project for ordinary unit tests and a separate Nuxt runtime project using `defineVitestProject` and happy-dom.
- [x] Keep component/runtime tests on the Nuxt-aware utilities rather than mocking framework internals.
- [x] Test the real shell's rendered content/head metadata and relevant interaction behavior. Do not add counter demos or import-only tests to manufacture coverage.
- [x] Add a dedicated Nuxt media fixture that imports the production adapter and contains a small, local, generated audio sample with documented provenance.
- [x] Generate a two-second mono PCM WAV fixture with a deterministic low-amplitude tone. Keep it within test fixtures; production MP3 compatibility remains a later media check.
- [x] Use trusted Playwright clicks to initiate real playback in the fixture. Test no initial play, explicit play, pause, and natural completion without fixed sleeps.
- [x] Ensure fixture routes/assets are absent from the normal production application.

Nuxt's project-based testing guidance separates ordinary Node tests from tests needing an initialized Nuxt runtime. Follow those boundaries and pin test dependencies as a compatible set. [Nuxt testing guidance](https://nuxt.com/docs/4.x/getting-started/testing)

### 5. Configure formatting, lint, and coverage

- [x] Use Nuxt's generated flat ESLint configuration and an explicitly maintained root config. Keep automatic configuration creation and formatting rewrites out of verification.
- [x] Leave ESLint stylistic rules disabled and use Prettier for formatting, avoiding a second formatting engine.
- [x] Configure formatting checks for maintained source, configuration, scripts, and documentation. Preserve existing user-authored documents; any normalization needed to include them must be a reviewed formatting-only change, not a content rewrite.
- [x] Ignore generated output, dependencies, binary fixtures, and byte-preserved evidence in formatting checks.
- [x] Include executable app, shared, and server TypeScript/Vue files explicitly in coverage, including files not imported by tests.
- [x] Enforce aggregate thresholds of 95% statements/lines/functions and 90% branches, with automatic threshold updates disabled.
- [x] Exclude only tests, generated/dependency files, declarations, and specific declarative configuration files with a concise rationale. Do not exclude all Vue files, components, composables, or whole application subsystems.
- [x] Produce text, HTML, and LCOV coverage reports. Do not lower thresholds to accommodate missing tests.

Nuxt's ESLint module supplies project-aware flat configuration and can coexist with Prettier without stylistic rules. Vitest requires explicit coverage inclusion to account for unimported source files. [Nuxt ESLint guidance](https://eslint.nuxt.com/packages/module), [Vitest coverage configuration](https://vitest.dev/config/coverage)

### 6. Create the canonical verification command

| Script          | Required behavior                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| `dev`           | Start Nuxt development mode.                                                                                       |
| `build`         | Build the normal production Node application with `nuxt build`.                                                    |
| `format:check`  | Check formatting without rewriting files.                                                                          |
| `lint`          | Run ESLint without fixes.                                                                                          |
| `typecheck`     | Check application, server, test, and tooling TypeScript with Nuxt/Vue-aware tooling.                               |
| `test`          | Run unit and Nuxt runtime tests once, without watch mode.                                                          |
| `test:coverage` | Run those tests with coverage collection and threshold enforcement.                                                |
| `test:e2e`      | Run all three browser projects against controlled production/fixture servers.                                      |
| `verify`        | Prepare Nuxt, then run formatting, lint, types, coverage tests, production build, and browser tests in that order. |

- [x] Make `pnpm verify` stop at the first failed stage and return nonzero.
- [x] Ensure a fresh install can run the gate without a pre-existing `.nuxt` directory or hand-started dev server.
- [x] Do not put dependency installation, mutating formatters, remote feed checks, or automatic snapshot acceptance inside `verify`.
- [x] Do not add placeholder content/feed validators while those features do not exist. Extend the gate when M2/M3 add meaningful checks.
- [x] Keep the test fixture build separate from the normal application build so fixture-only pages cannot leak into production.

### 7. Configure browser execution and GitHub Actions

- [x] Require Chromium, Firefox, and WebKit projects from the start. Install the browser binaries and required system packages using the pinned Playwright CLI during environment setup.
- [x] Have Playwright start and stop its own normal production server and media fixture server. Test the normal application through its built Node entry point, not an unrelated development server.
- [x] Default to local ports 3100 and 3101, overridable through `NUREVOLUTION_TEST_PORT` and `NUREVOLUTION_MEDIA_TEST_PORT`. Bind locally, set `reuseExistingServer: false`, and fail if a selected port belongs to another process.
- [x] Use one CI worker, no automatic retries initially, and retained failure traces/screenshots. Browser assertions wait for events/state, not guessed playback durations.
- [x] Create an Ubuntu 24.04 GitHub Actions checks job for pull requests and pushes to `main`, with read-only repository permissions and no deployment secrets.
- [x] Pin checkout, Node setup, and artifact-upload actions to verified commit SHAs from their supported major releases. Use the same Node/pnpm declarations as local setup.
- [x] Install dependencies with the frozen lockfile, install all three browsers, then run exactly `pnpm verify` rather than maintaining a separate partial CI gate.
- [x] Retain coverage and browser reports for 14 days when available, including failure reports. Do not publish application images, deploy, or expose secrets to PR jobs.
- [x] Document environment setup, HMR expectations, each script, optional focused test commands, test fixture provenance, and full verification in `README.md`.

Browser installation is environment setup, separate from deterministic verification. Playwright documents its browser/system dependency installation and GitHub Actions workflow setup. [Playwright CI guidance](https://playwright.dev/docs/ci)

## Acceptance tests

| Scenario                             | Expected result and evidence                                                                                         |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Fresh locked dependency installation | Declared toolchain installs without forced peer-conflict bypasses; generated prerequisites are reproducible.         |
| Initial page request                 | Useful SSR HTML, correct document language/title, semantic main content, and dark styling.                           |
| Browser hydration                    | No browser-global exceptions, hydration mismatch warnings, or failed application resources.                          |
| Unknown route                        | Actual HTTP 404, not a successful response containing an error message.                                              |
| Keyboard interaction                 | Applicable fixture controls have names, visible focus, and work through trusted keyboard/browser actions.            |
| Audio load                           | Source loads and metadata becomes available; playback remains paused until a user action.                            |
| Play succeeds/fails                  | Browser promise resolves or rejects without being swallowed or triggering unwanted playback retries.                 |
| Pause/disposal                       | Playback pauses; owned listeners are removed; repeated cleanup is safe.                                              |
| Real local audio                     | Explicit play advances media time, pause stops it, and natural completion is observed through the media event/state. |
| Production fixture isolation         | Test-only route is absent from the normal build and returns 404 there.                                               |
| Browser matrix                       | Required smoke scenarios pass in Chromium, Firefox, and WebKit.                                                      |
| Coverage                             | 95% statements/lines/functions and 90% branches, including applicable untested source.                               |
| Verification failure                 | A failed stage returns nonzero and prevents subsequent stages from reporting success.                                |

Use controlled media behavior for rejection and cleanup tests and the local real-audio fixture for browser capability/integration checks. These checks do not prove production MP3 integrity or the final podcast player; those belong to later milestones.

## Verification, completion, and handoff

The required final local command is **`pnpm verify`**, now implemented in `package.json`. Run it after a locked installation and browser setup, inspect the full result, and record actual test counts, coverage, browser outcomes, and production build results.

Do not introduce deliberate faults into user source just to prove the command's failure behavior. Check shell/script exit propagation and use an isolated disposable test/config fixture for a failing-stage probe if needed.

If M0 tooling exists when M1 is implemented, retain its documented checks and integrate its deterministic tests into the gate without making private source access a CI requirement. Do not add no-op conditional stages for M0 files that do not yet exist.

Writing a workflow file is not evidence of a successful GitHub Actions run. Record local verification separately from remote CI status; do not push or create a commit merely to obtain a CI run without an authorized Git workflow.

- [x] Runtime, package-manager, dependency pins, and lockfile are documented.
- [x] Shell and minimal adapter follow SSR/browser boundaries.
- [x] Unit/runtime tests exercise meaningful behavior.
- [x] Production and isolated media-fixture browser checks pass in all three engines.
- [x] Coverage thresholds and narrow exclusions are recorded and enforced.
- [x] A fresh setup passes `pnpm verify` without manual source edits or server startup.
- [x] CI uses that same entry point; its actual run status is stated accurately.
- [x] Documentation includes setup, commands, reports, fixture provenance, and dependency rationale.
- [x] Final diff/whitespace checks are clean; existing source documents and unrelated work are preserved.
- [x] Record implemented scope, exact verification results, unresolved issues, and M2 readiness in the roadmap/handoff.

No production rollout is part of M1. Its changes are additive and can be revised locally without touching the existing WordPress site. The completed checklist is supported by the local evidence below; it does not imply deployment or a successful remote CI run.

## Completion evidence and handoff — 2026-09-07

The implementation contains the semantic dark shell and a minimal injected audio adapter, isolated Node/Nuxt/browser tests, exact toolchain pins, formatting/lint/strict type checks, and a checks-only GitHub Actions workflow. The normal application has no episode data, player controls, or test fixture routes/assets.

| Check                       | Actual result                                                                                                                                                                                                                                                                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean setup                 | Removed generated dependencies and both apps' Nuxt/build output, then `pnpm install --frozen-lockfile` succeeded with Node 22.23.2 and pnpm 12.3.4. Browser binaries and Linux dependencies were installed using the pinned Playwright CLI.                                                                                                        |
| Canonical gate              | `pnpm verify` exited 0 on local Ubuntu 26.04. Formatting, ESLint, strict application/test/tooling types, migration unit tests, application coverage tests, production build, fixture build, and all browser projects passed.                                                                                                                       |
| Unit and Nuxt runtime tests | 14 passed across two files: 12 adapter cases and two real application/shell cases. The separately developed M0 tooling adds six Python unit tests through `pnpm test:migration`.                                                                                                                                                                   |
| Coverage                    | 100% statements (32/32), lines (27/27), functions (10/10), and branches (6/6). The LCOV report includes all four current executable application files, including Vue components/pages. Enforced thresholds remain 95/95/95/90.                                                                                                                     |
| Browser checks              | 18 passed: six each in Chromium, Firefox, and WebKit, with no retries. Includes actual completed hydration, SSR HTML, focus/text scaling, HTTP 404s, fixture isolation, and real playback/pause/completion.                                                                                                                                        |
| Production output           | Both apps build with Nitro's `node-server` preset; the normal entry point is `.output/server/index.mjs`. Playwright starts and stops the built servers.                                                                                                                                                                                            |
| Failure propagation         | A disposable fixture copied the exact `verify` script, failed its formatting stage with exit 19, and confirmed no later stage ran. No faults were introduced into application source.                                                                                                                                                              |
| Fixture provenance          | Regeneration produced the identical 88,244-byte WAV; SHA-256 `8d694754760ecf88315324b50721cb4b34355657425b7761d666bbc4cb8b31e0`.                                                                                                                                                                                                                   |
| Existing documents          | Bootstrap content is unchanged. This task made only formatting changes to the M0 plan, verified against the preserved pre-format baseline before the concurrent M0 work appeared. New M0 source and generated reports belong to that separate work and are preserved. Roadmap changes record M1 completion and the available verification command. |
| Remote CI and deployment    | Workflow written and action SHAs checked against upstream release tags. GitHub Actions has not run remotely; no commit, push, branch creation, or deployment was performed.                                                                                                                                                                        |

Setup, commands, report locations, dependency rationale, and audio lifecycle behavior are documented in [README.md](../../README.md). `.nuxtrc` records the already configured test-utils version to avoid creating a setup marker during verification. Generated reports and local working evidence are ignored by Git.

M1's foundation is ready for M2 work, but M2 still requires the M0 source audit and its content decisions. M0 audit tooling and reports appeared from concurrent work near the end of M1. Their deterministic unit tests are included in the shared gate, but this milestone does not certify M0 completion or resolve its migration blockers. Generated audit artifacts preserve their canonical formatting. WAV browser checks do not establish archive MP3 integrity or physical-device playback; those remain explicit later requirements. There are no unresolved local M1 failures. The final source checksum comparison confirmed all pre-existing M1 files remained byte-identical during verification; newly appearing M0 files were identified as concurrent work. A development startup smoke check returned HTTP 200 with the rendered heading and stopped its own server. The outstanding external verification is the first GitHub Actions run when an authorized Git workflow occurs.
