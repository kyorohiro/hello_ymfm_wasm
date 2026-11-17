# Published timed API examples — 2026-11-17

User requested updating `w/tetorica-fm2612-examples` to published npm 0.2.41,
with YM2149 Sync-buzzer / volume-register scheduling, independently timed
YM2612 melody / Operator motion, and compilation / snapshot comparisons.
Both repositories were clean before work.

- [x] Inspect existing example, catalog, build and muted-check conventions.
- [x] Install the published exact 0.2.41 package and update dependency / lock.
- [x] Add original editable YM2149 and YM2612 timed-performance examples.
- [x] Add a register-inspection example comparing current / client / reset /
  captured state, explaining predicted traces versus interleaved execution.
- [x] Connect examples to the catalog / README and regenerate dist / docs.
- [x] Verify published-package imports, new behavior in muted Chromium / WebKit,
  and existing Node examples / deployment assets appropriate to the update.
- [x] Record results and restart information in both repositories.

Use the published npm package; no parent runtime imports, new runtime API,
bundling/minification, C++/WASM rebuild, external game assets, device audio,
commit / push or Pages publication. Default musical timing follows `beat()`
where applicable; sample-clock modulation is explicitly software scheduling.
Preserve original source, licenses, relative import layout and source links.

## Result / restart

Completed locally on 2026-11-17. New examples are in the separate nested Git
repository, pinned to published npm 0.2.41. Parent runtime files are unchanged.
No commit, push or Pages deployment performed.

- `atari-st/ym2149/01-sync-buzzer` (Web)
- `atari-st/ym2149/02-volume-modulation` (Web)
- `genesis/fm/07-timed-operators` (Web; ymfm / Nuked)
- `chip-raw/02-compile-compare` (Web / Node JSON)

Verified 20 new browser cases across Chromium / WebKit and 44.1 / 48 kHz,
52 offline Node cases, existing AY Envelope and VAB browser cases, VAB exact
round-trip checks, and a 1,589-file dist / docs byte match. All physical output
was permanently muted; no listening test was performed. Installed npm's 1,275
files are preserved byte-for-byte in both site vendors.

The comparison example now waits until the authoritative register actually
shows its scheduled baseline; accepting a reservation / advancing a frame alone
is not used as proof that the write is visible. The existing AY checker was
also corrected to route all physical output through a permanent zero gain,
while keeping its upstream PCM meter.

Evidence: [verification JSON](timed_api_examples_verification_20261117.json).
Detailed results and usage are in the nested repository's
`notes/timed-api-verification-20261117.md` / `.json`.
Review the two repositories independently before any future commit / push.
