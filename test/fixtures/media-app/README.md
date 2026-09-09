# Isolated audio fixture

This Nuxt application imports the production audio adapter and exercises it in real browsers. It is built separately and never extends or adds routes to the production application.

`public/sample.wav` is generated locally: two seconds of a 440 Hz sine wave, mono, 22,050 samples/second, signed 16-bit PCM, with peak amplitude 0.05. It contains no third-party recording and can be freely reused as project test data. `tools/generate-audio-fixture.mjs` reproduces the bytes without external dependencies.

Pause/resume and disposal tests enable native looping on their own audio element so browser interaction delays cannot let the short clip finish first. The pause test waits for an actual loop boundary before clicking Pause. A separate test leaves looping disabled and checks natural completion. These controls use real browser media events; no playback or button actionability is mocked.

Tests cover browser audio capability and adapter integration; this WAV does not establish production MP3 compatibility or historical media integrity.

M4 adds `public/sample.mp3`, an original two-second 440 Hz test tone encoded as mono MPEG audio at 64 kbps. It contains **16,509 bytes**, SHA-256 `cd3bd01539b90056bdd20a3e079e640799e926ec5bfce84a0386759efa3256ab`. `python3 tools/generate-mp3-fixture.py` regenerates it with the system libmp3lame encoder (3.100 at creation); the encoder is needed only for regeneration, not installation, builds, tests, or CI. The small SVG cover is also original fixture artwork. Both are freely reusable project test data.

The `/player-test` page imports the production player and list components. Fixture-only controls select between two genuine small media records, and the fixture download route imports the production streaming responder and connection handler with a local upstream. These files remain isolated from the production application. Tests verify real MP3 decoding, natural completion, saved download bytes and punctuation, and disposal; public historical-media and physical-device acceptance still belong to M5/M6.
