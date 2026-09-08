# BOOTSTRAP.md

## Project

Rewrite `nurevolution.net` as a modern podcast-focused web application using **Nuxt 4**.

The existing site is a WordPress installation that historically supported a podcast, studio services, and soundsystem services. The new site should remove the service-oriented material and focus exclusively on the podcast.

The existing podcast feed is currently published at:

`https://nurevolution.net/feed/podcast`

The replacement must continue to publish an **iTunes/Apple Podcasts-compatible RSS feed** at that URL or preserve compatibility with that URL through routing/redirects as appropriate.

The project should be designed for long-term maintainability and extensive automated testing.

---

# Product Direction

The new site should feel more like a focused podcast player application than a traditional podcast homepage.

The main experience should be a reactive single-page-style player interface backed by podcast and episode metadata.

The intended landing page consists primarily of:

1. A large episode artwork display.
2. A prominent audio player.
3. Podcast episode navigation.
4. A tracklist for the currently selected mix.
5. Minimal additional site chrome.

The site should be usable as a podcast website first, while the same underlying structured data should also be capable of generating the podcast RSS feed.

Avoid carrying forward WordPress architecture or assumptions unless required for migration compatibility.

---

# Core Player UX

The player should ultimately support at least the following controls:

- Previous episode
- Previous track
- Skip backward 30 seconds
- Play / pause
- Skip forward 30 seconds
- Next track
- Next episode
- Seek/progress bar
- Volume control
- Mute toggle

The primary layout beneath the player should contain two major areas:

## Episode list

A list of podcast episodes.

Selecting an episode should:

- load that episode into the player
- update its artwork
- update its metadata
- load the corresponding tracklist
- preserve a smooth application-like experience

## Tracklist

Display the tracks contained in the currently selected mix.

Each track should contain a timestamp or equivalent start position.

Selecting a track should seek playback directly to the point where that track begins.

The tracklist should therefore be treated as structured playback metadata rather than display-only prose.

---

# Content and Data Model

Prefer a **structured, repository-native content model** initially rather than introducing a traditional CMS.

The current assumption is that JSON, YAML, TypeScript data, Nuxt Content, or another simple structured representation may be sufficient.

The same canonical episode data should ideally drive:

- website episode listings
- player metadata
- tracklists
- artwork references
- episode ordering
- audio URLs
- publication dates
- podcast RSS generation

Avoid maintaining duplicated independent sources of truth for the website and RSS feed.

A probable high-level model will include:

- podcast/site metadata
- episodes
- episode artwork
- audio asset
- publication date
- description/show notes
- duration if known
- tracklist entries
- track title
- artist
- optional label/release metadata
- track start timestamp

Do not prematurely over-model fields that are not required.

Use schema validation for structured content.

---

# RSS Requirements

The application must generate a standards-compliant podcast RSS feed suitable for Apple Podcasts/iTunes-compatible clients.

The current production feed path is:

`/feed/podcast`

Preserving this URL is strongly preferred to avoid breaking existing subscribers and directories.

The RSS feed should be generated from the same canonical episode data used by the frontend.

Do not depend on WordPress or podPress after migration.

Before implementation is considered production-ready, validate the generated feed against relevant podcast-feed requirements and test its XML output automatically.

---

# Nuxt Architecture

Use **Nuxt 4**.

Prefer idiomatic Nuxt patterns over generic Vue patterns where Nuxt already provides an appropriate abstraction.

Likely areas include:

- Nuxt pages/layouts
- composables
- Vue components
- Nitro server routes
- `useFetch`, `$fetch`, or appropriate Nuxt data APIs
- Nuxt Content if it proves appropriate
- runtime configuration where necessary

Keep domain logic separate from presentation logic.

Do not put significant business logic directly into large Vue components.

In particular, logic for:

- episode ordering
- track navigation
- timestamp seeking
- RSS generation
- parsing/normalizing content
- playback state transitions

should be implemented in independently testable modules or composables where practical.

---

# SPA Behavior vs SSR

The site should feel like an SPA during normal interaction, especially around the player.

That does **not** imply disabling Nuxt SSR globally.

Prefer Nuxt's normal hybrid/SSR architecture unless a concrete requirement makes client-only rendering necessary.

Important public pages and episode URLs should remain indexable and directly addressable if doing so does not conflict with the desired player UX.

Do not convert the entire project to a client-only SPA merely because the player itself is highly reactive.

---

# Audio Player Design

The player should be based on normal browser audio capabilities unless a library demonstrates a clear need.

Prefer a thin abstraction around `HTMLAudioElement` or equivalent browser media APIs over a large player dependency unless requirements justify one.

Player state should be modeled deliberately.

Potential state includes:

- selected episode
- selected track
- playback position
- duration
- playing/paused state
- volume
- muted state
- loading/buffering state
- previous/next episode availability
- previous/next track availability

Track navigation semantics should be explicit and tested.

For example, determine what "previous track" means when playback is several seconds into the current track versus near its start.

Do not invent ambiguous UX behavior silently; ask when product behavior materially affects implementation.

---

# Accessibility

Treat accessibility as a first-class requirement.

At minimum:

- player controls must be keyboard accessible
- controls must have accessible names
- focus states must be visible
- track and episode selection must work without a mouse
- artwork must use meaningful alt text where appropriate
- controls should expose relevant state such as play/pause and mute
- seek and volume controls must be operable accessibly

Prefer semantic HTML before adding ARIA.

Accessibility behavior should be covered by automated tests where practical.

---

# Responsive Design

The primary two-column episode/tracklist layout should degrade gracefully on smaller screens.

Desktop may use:

- episodes on the left
- tracklist on the right

Mobile will likely require stacking, tabs, drawers, or another compact presentation.

Do not finalize mobile information architecture without inspecting the evolving design and asking if multiple reasonable choices exist.

---

# Testing Philosophy

Testing is a major project priority.

Do not treat tests as cleanup work performed after implementation.

Favor designing units and boundaries that are easy to test from the beginning.

The intended broad stack is:

- **Vitest** for unit and integration tests
- **Playwright** for browser/end-to-end testing
- Nuxt's testing utilities where they provide useful framework-specific support

Use additional tooling only where it clearly improves coverage or maintainability.

---

# Unit Testing

Unit-test meaningful domain behavior, especially:

- episode ordering
- track ordering
- timestamp parsing
- playback navigation logic
- previous/next track behavior
- previous/next episode behavior
- RSS serialization helpers
- content normalization
- schema validation
- utilities and composables containing logic

Do not write meaningless tests that simply import files to increase coverage.

---

# Integration Testing

Use integration tests where multiple pieces need to be validated together.

Examples:

- episode data -> normalized model
- episode data -> generated RSS item
- selected episode -> loaded tracklist
- track click -> player seek request
- player state -> rendered control state

Nuxt-specific runtime behavior should be tested through appropriate Nuxt test utilities rather than excessively mocking framework internals.

---

# End-to-End Testing

Use Playwright for important user journeys.

Likely eventual scenarios include:

- homepage loads successfully
- initial/latest episode loads
- selecting an episode changes the player
- selecting a track seeks to its timestamp
- play/pause controls operate
- ±30 second controls operate
- previous/next track controls behave correctly
- previous/next episode controls behave correctly
- seek control works
- mute/volume behavior works
- direct navigation to an episode works if supported
- responsive/mobile experience works
- keyboard navigation works

Avoid tests that depend unnecessarily on timing-sensitive real audio playback.

Where possible, make media behavior deterministic by controlling or abstracting browser media APIs appropriately.

---

# Coverage

Coverage is a quality signal, not the product goal.

Maintain strict coverage on meaningful application/domain logic.

Declarative framework configuration files may be excluded from coverage when exercising them would only create artificial import-only tests.

Do not broadly exclude directories or file classes just to satisfy coverage.

When excluding a file, keep the exclusion narrow and leave a concise explanation if the reason is not obvious.

Never lower established coverage thresholds merely to make CI pass without discussing it first.

---

# Verification

The repository should have **one obvious canonical verification command**.

Prefer a script such as:

`pnpm verify`

or the existing equivalent if the repository already defines one.

That command should eventually cover the project's complete local quality gate, including as applicable:

- formatting checks
- lint
- Nuxt/type checking
- unit/integration tests
- coverage
- production build
- other deterministic validation required by CI

CI should use the same command where practical.

Before declaring an iteration complete:

1. run the canonical verification command
2. confirm it exits successfully
3. inspect the full result
4. report any relevant test/coverage/build summary

Do not claim completion solely because an individual test command passed.

---

# Development Server / HMR

Assume Nuxt HMR is active during ordinary development.

Do not restart the development server for routine changes to:

- components
- pages
- composables
- styles
- normal source files

Restart it only when required, such as certain:

- configuration changes
- environment changes
- dependency changes
- framework/plugin changes that cannot be applied through HMR

Do not include boilerplate statements such as:

- "The dev server has been restarted."
- "The new pages are available in the App tab."

Only mention server restarts or manual runtime actions when they were actually required or the user must take action.

---

# Agentic Development Rules

Treat the repository as the source of truth.

At the beginning of each substantial task:

- inspect relevant existing code
- inspect package scripts
- inspect test configuration
- inspect CI configuration when relevant
- understand existing conventions before introducing new ones

Do not assume prior agent commentary accurately describes the current repository.

The repository may contain commits or edits made by the user or another agent between iterations.

Never undo user changes merely because they differ from an earlier implementation.

Prefer small, coherent changes over large speculative rewrites.

Do not introduce dependencies without a clear reason.

Before adding a package:

1. determine whether Nuxt/Vue/browser APIs already solve the problem
2. determine whether an existing project dependency already solves it
3. justify the new dependency by concrete functionality or maintenance benefit

Avoid unnecessary abstraction during early iterations.

Do not build infrastructure for hypothetical future requirements unless it meaningfully improves the current design.

---

# Completion Reports

Keep completion reports concise and evidence-based.

Include:

- what changed
- important implementation decisions
- tests added or changed
- exact verification command run
- whether verification passed
- relevant coverage/build/test summary
- genuine unresolved questions or risks

Do not include generic runtime narration.

Do not claim something works unless it was validated appropriately.

---

# Git and Iteration Discipline

Assume work may be organized into explicit iterations.

Respect existing commit history.

Do not rewrite or squash history unless specifically requested.

Do not commit unrelated cleanup during a focused task unless necessary for correctness.

If unrelated problems are discovered, report them separately rather than silently expanding scope.

At iteration boundaries, a new agent may take over.

Therefore, important project decisions should live in:

- code
- tests
- repository documentation
- this file or more specific `AGENTS.md` files

rather than existing only in chat history.

---

# Migration

The existing WordPress site is reference material, not the target architecture.

During migration, identify what must be retained, including:

- historical podcast episodes
- feed metadata
- enclosure/audio URLs
- publication dates
- descriptions/show notes
- artwork
- existing tracklists if present
- redirects or stable URLs
- podcast GUID behavior
- RSS compatibility

Avoid changing podcast identifiers or URLs casually because podcast clients may use them to identify existing episodes.

Before replacing production RSS, specifically investigate how existing episode GUIDs are generated and preserve them where necessary.

---

# Performance

The application should remain lightweight.

Pay particular attention to:

- artwork sizes
- responsive images
- unnecessary JavaScript
- audio preload behavior
- large episode lists
- hydration cost
- client-side state duplication

Do not preload all episode audio.

Prefer lazy loading of non-current media and artwork where sensible.

---

# Security

Do not expose secrets to the client bundle.

Use Nuxt runtime configuration correctly for any server-only values.

Treat episode metadata as untrusted input when rendering HTML.

Avoid introducing raw HTML rendering unless content has a clear sanitization strategy.

---

# Deployment

Deployment architecture has not yet been decided.

Do not tightly couple the application to a proprietary hosting platform unless there is a concrete reason.

Prefer a normal Nuxt/Nitro deployment that can run on conventional self-hosted infrastructure.

The user operates substantial self-hosted infrastructure and may choose to deploy there.

Do not assume Vercel, Netlify, Cloudflare, or another managed platform.

---

# Outstanding Product Questions

The project is intentionally being bootstrapped before every product decision is known.

When an unanswered question materially affects architecture or UX, ask the user rather than silently choosing.

Questions likely to require resolution include:

## Existing content and migration

- How many historical podcast episodes must be migrated?
- Where are the audio files currently hosted?
- Where is artwork currently hosted?
- Are episode descriptions and tracklists currently stored in WordPress/podPress?
- Should historical WordPress URLs be preserved or redirected?
- What current RSS fields and GUID values must remain stable?

## Episode routing

- Should individual episodes have their own canonical URL?
- Should selecting an episode update browser history/URL without a full navigation?
- Should the root page always default to the newest episode?

## Player behavior

- What should "previous track" do when playback is already partway through a track?
- Should playback continue uninterrupted when navigating elsewhere within the site?
- Should playback position persist across page refreshes?
- Should playback position persist between browser sessions?
- Should episode selection autoplay or load paused?
- Should selecting a track begin playback automatically or only seek?
- Should Media Session API integration be implemented for OS/browser media controls?

## Tracklist metadata

- What metadata exists for tracks today?
- Are timestamps already available?
- Are timestamps exact or approximate?
- Should tracks optionally link to Bandcamp, Discogs, Beatport, labels, artists, or releases?
- Should currently playing track highlighting update automatically based on playback position?

## Podcast feed

- What namespace/features from the existing podPress feed must be preserved?
- Does the feed need Podcasting 2.0 namespace support?
- Are episode-specific artwork, chapters, transcripts, or other modern podcast metadata desirable?

## Content authoring

- Is direct repository editing acceptable long-term?
- Is a visual/WYSIWYG editor needed for episode descriptions?
- Who besides the user will edit podcast metadata?
- Is draft/publish workflow required?

## Design

- Is the existing Nurevolution visual identity being retained?
- Is there existing artwork/logo material that should drive the new design?
- Should the aesthetic remain tied to electronic music / breakbeat culture?
- Is dark mode preferred, mandatory, or optional?

## Analytics

- Are privacy-preserving site analytics desired?
- Should audio plays, track selections, episode navigation, or completion behavior be measured?
- Is existing historical analytics data relevant?

Do not block early foundational work on questions that are not yet relevant.

Ask questions when the answer changes the implementation being undertaken.

---

# Initial Development Bias

Until the user specifies otherwise, prefer:

- Nuxt 4
- TypeScript
- strict typing
- repository-native structured episode data
- schema validation
- Vitest
- Playwright
- minimal dependencies
- accessible semantic HTML
- Nitro server route for podcast RSS
- shared canonical content model for UI and RSS
- SSR/hybrid rendering rather than client-only SPA mode
- application-like client navigation/player behavior
- portable self-hostable deployment
- strong automated verification

These are defaults, not immutable requirements.

If repository evidence or a user decision contradicts them, follow the newer source of truth.
