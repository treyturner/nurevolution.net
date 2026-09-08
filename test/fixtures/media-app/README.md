# Isolated audio fixture

This Nuxt application imports the production audio adapter and exercises it in real browsers. It is built separately and never extends or adds routes to the production application.

`public/sample.wav` is generated locally: two seconds of a 440 Hz sine wave, mono, 22,050 samples/second, signed 16-bit PCM, with peak amplitude 0.05. It contains no third-party recording and can be freely reused as project test data. `tools/generate-audio-fixture.mjs` reproduces the bytes without external dependencies.

Tests cover browser audio capability and adapter integration; this WAV does not establish production MP3 compatibility or historical media integrity.
