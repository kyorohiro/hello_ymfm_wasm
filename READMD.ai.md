# Tetorica — AI/SI development handoff

[English](README.md) | [日本語](README.ja.md) | [AI/SI](READMD.ai.md)

Updated: 2026-11-05 (English handoff; readable, editable Synth distributions and Tauri source workflows; Tetorica's own implementations are consolidated under `tetorica_src/`). This is an entry point for AI agents investigating the repository and resuming work.
This document records design decisions and work status. Before resuming, check the latest user request, the actual source and the Git state. Verification results recorded for a particular date do not guarantee the behavior of the latest published release.

## Check these first

```sh
pwd
git status --short
git diff
git diff --cached
git log -8 --oneline
```

- Preserve the user's in-progress and staged changes. Inspect the initial diff and distinguish those changes from your own.
- Read any `AGENTS.md` that applies to the files you will work on.
- Distinguish the parent repository from separate local repositories. Changes and commits inside `w/` are not automatically included in a parent-repository commit.
- Distinguish local implementations, generated distribution artifacts, published npm packages and releases on GitHub / itch.io. Confirm publication through release records and the actual distribution artifacts.
- Historical work records in this document do not authorize publishing, pushing or implementing a new feature. Work on the current request.

## Project direction and the role of each README

Tetorica is a toolkit for learning, playing and embedding many retro sound chips: Yamaha FM, Sega PSG, Game Boy / NES APUs, SNES S-DSP, PlayStation SPU, Saturn SCSP and more. Its original YM2612 goals now guide the wider toolkit. Preserving old game music and sound technology in a form that people can investigate and reconstruct is also a priority.

Distribution requirement clarified by the user on 2026-11-05: preserve readable,
modifiable authored JavaScript and CSS in Web ZIPs and Tauri applications. Copy
the original module files, comments and identifiers; do not minify, obfuscate or
serve a bundled rewrite in their place. `scripts/copy_readable_modules.mjs` uses
esbuild only to discover dependencies and copies the original bytes. Keep the
compiler-generated WASM / loader artifacts unchanged with their corresponding
C/C++ sources and rebuild recipes. A source ZIP alone does not make a minified
runtime sufficiently easy to modify. See the [work record](docs/issues/todo_readable_synth_distributions_20261105.md).

Keep these entry points clear in user-facing documentation:

- **Try immediately:** the [browser Playground](https://kyorohiro.github.io/hello_ymfm_wasm/playground/index.html) lets users try supported chips and live coding without installation.
- **High-level npm APIs:** the [`tetorica-fm2612` package](https://www.npmjs.com/package/tetorica-fm2612) provides Synth helpers for musical notes, presets and chip-specific sound controls, plus audio transports and an embeddable live-code runtime. The package name remains unchanged despite its multi-chip scope. Use the [API catalog](packages/fm2612/README.md#api-entry-points) for the actual imports and signatures.
- **Low-level APIs and WASM:** the same package provides register / RAM / PCM APIs, TypeScript declarations and prebuilt WASM. The [runtime source guide](tetorica_src/runtime/README.md) identifies wrappers and the complete generated artifact catalog.
- **Native C/C++:** reusable cores and build recipes are provided through [`tetorica-soundchip-native`](https://github.com/kyorohiro/tetorica-soundchip-native) for native apps and plug-ins.

API and backend coverage varies by chip. PS1 SPU and SCSP use explicit npm subpath imports; their Playground chip names are not automatically valid arguments to the package-root factory. Keep the original four goals while making this broader scope visible near the top of both user READMEs.

Decisions made during the README reorganization on 2026-10-10:

- Keep the English and Japanese READMEs as introductions for users, with an overview of the deliverables, links to the apps and simple npm usage examples.
- The user requested that app first-use instructions and Playground live-coding examples stay out of the READMEs. Direct readers to the actual apps.
- The user also requested removing the “Help and bug reports” section from both user READMEs.
- Retain the npm package's YM2612 do–re–mi example. It is a browser example using the sound-chip API, not code to run inside the Playground.
- Preserve the four established project goals: understanding the YM2612, documenting it so anyone can understand it, documenting how to embed it in apps and games, and preserving the technology as cultural heritage. The user values this specific list of goals.
- Move chip-specific details, limitations, implementation notes and verification records to `Memo.md`. Keep licensing and credits in the READMEs as well.
- Remove download instructions and outdated fixed version numbers. Put artifact creation, verification and publication procedures in `README_RELEASE.md`.
- Use `README.ja.md` for the Japanese README and the user-specified filename `READMD.ai.md` for the AI handoff. Do not silently change the spelling `READMD`. Write this AI handoff in English.

## Documentation references

| What to investigate | Reference |
| --- | --- |
| User-facing overview | [README.md](README.md), [README.ja.md](README.ja.md) |
| Chip-specific playback, limitations and implementation notes | [Memo.md](Memo.md) (English and Japanese; also preserves the original SN76489 reference links) |
| Support status by feature | [docs/feature-status.md](docs/feature-status.md) |
| Analyzer support matrix | [docs/vgm_analyzer/support.html](docs/vgm_analyzer/support.html) |
| CLI / Node API and format-specific limitations | [CLI.md](CLI.md) |
| Artifact creation and release procedures | [README_RELEASE.md](README_RELEASE.md) |
| npm publication records and procedures | [READMD_RELEASE_FM2612.md](READMD_RELEASE_FM2612.md), [READMD_RELEASE_VGM.md](READMD_RELEASE_VGM.md) |
| Audio package APIs and module catalog | [packages/fm2612/README.md](packages/fm2612/README.md) |
| Tetorica DMG Synth, one-APU allocation and portable presets | [Synth guide](docs/synth-dmg/README.md), [implementation TODO](docs/issues/todo_gameboy_synth_01.md) |
| 2A03 Synth, keyboard allocation, wave / modulation editing and portable presets | [Synth guide](docs/synth-2a03/README.md), [implementation TODO](docs/issues/todo_nes_fds_synth_01.md) |
| HuC6280 Synth, six-channel wavetable / Noise / LFO and software Envelope | [Synth guide](docs/synth-huc6280/README.md), [implementation TODO](docs/issues/todo_huc6280_synth_01.md) |
| VGM package examples | [packages/vgm/README.md](packages/vgm/README.md) |
| Virtual-file and shell APIs | [packages/virtual-files/README.md](packages/virtual-files/README.md) |
| Design and feature-specific work records | [docs/issues/](docs/issues/) |
| Audio-output design | [docs/issues/tetorica-audio-output.md](docs/issues/tetorica-audio-output.md) |
| Virtual-file / shell design history | [docs/issues/tetorica-virtual-files.md](docs/issues/tetorica-virtual-files.md), [docs/issues/tetorica-virtual-files-01.md](docs/issues/tetorica-virtual-files-01.md) |

`docs/issues/` also contains plans written before implementation. Compare the source, tests, update dates and publication records instead of determining the current state from an old “not implemented” or “not published” statement alone.

## Repository layout

| Location | Role |
| --- | --- |
| `src/` | ymfm-derived C++ sound-chip cores and related code |
| `tetorica_src/` | Entry point for Tetorica's own implementations; see the [source guide](tetorica_src/README.md) |
| `tetorica_src/wasm/` | WASM bridges for JavaScript |
| `tetorica_src/native/` | Parent-project C/C++ implementations, including native audio effects |
| `third_party/` | Pinned third-party cores, original sources, licenses and porting records |
| `tetorica_src/runtime/` | Reusable JavaScript runtime, chip wrappers, Synth helpers and audio engines |
| `tetorica_src/runtime/generated/` | Canonical artifacts for all 33 SDK builds and Native FX; shared manifests, synchronization and checks maintain the published copies |
| `tetorica_src/node/` | Node audio-output, Worker and Synth adapters |
| `docs/js/` | Copies of the shared runtime deployed to the website |
| `docs/playground/` | Playground UI, Monaco, Cassette, virtual-file integration, imports and runnable examples |
| `docs/synth/` | Browser synthesizer |
| `docs/synth-dmg/` | Tetorica DMG Synth (`tetorica-dmg-synth`): one APU, source-specific round robin, Wave RAM drawing and portable presets / JavaScript export; verify with `npm run test:dmg-synth` and `npm run test:dmg-synth:browser`. Icon: `docs/tetorica_dmg_synth.webp`. The former `/synth-gameboy/` URL redirects here; hardware API names and the portable preset format remain compatible. |
| `docs/synth-2a03/` | Tetorica 2A03 Synth (`tetorica-2a03-synth`): one NTSC NES APU + FDS, Pulse two-voice round robin, mono Triangle / Noise / DMC / FDS, 64-point Wave RAM and 32-command modulation editing, VGM / VGZ voice and DMC sample library import, raw DPCM loading / export and JavaScript export. Save DPCM writes committed original bytes as headerless 2a03-sample.dmc, excluding generated padding, drawing drafts and Redo data; it preserves audio, history and pending file reads. Playback settings stay in preset JSON. Standalone FDS / DMC default to Software click guard, a 5ms output-only smoothstep bridge in click_guard.js / processor.js: successful attacks and mono retriggers connect last emitted stereo sample to incoming PCM, matching releases / stops connect to zero and mute the raw off-filter tail. After5ms held PCM is byte-identical to the raw engine. Commands / registers / Envelope / owner timing remain immediate; stale noteOff(false) and invalid commands never change the bridge. Pulse / Triangle / Noise bypass it. setClickGuard(bool) is a standalone processor command, read exposes outputClickGuard metadata; the checkbox preference is session-only, outside preset v7 and Copy JS, with Off for raw comparison. This softens key edges, not internal sample / loop discontinuities; low-frequency onset transients may remain. panel_layout.js manages native details disclosures without rebuilding controls or changing sound commands. VGM / Hardware now / Instrument files / Output options start closed; Source / Keyboard / monitor and editor subsections start open. Disclosure state stays in page across preset edits and source changes, outside preset data. The monitor pins compactly only on wide / tall windows when Keep visible on desktop is checked; narrow / short windows release it automatically. Closing Source cancels only uncommitted FDS / DMC strokes, with closed-ancestor / zero-size checks at pointer move / up; committed data, history, held-key owners and VGM library survive. Hidden Source / Hardware stops observation, hidden monitor pauses visualization; summary pointer toggles blur for performance keys and native keyboard navigation remains. Hardware now is a passive software display: hardware_state.js projects actual core volume / Length, Triangle Linear (not amplitude), and FDS raw Volume / Depth gains (Volume effective cap32; Depth uncapped for authored33..63). hardware_monitor.js renders meters independently of editor.update, so drafts and focus survive. state_observer.js samples only visible running audio with a started held note, about100ms after each completed read, at most one outstanding read even across engine replacements; idle, hidden, suspended, failed and disposed leases discard stale replies and stop timers. Polling bypasses performance commands, never starts audio or changes preset data, and skips DMC (its existing DAC preview remains). Unknown / idle values display a dash, and fast changes between samples are explicitly disclosed. Preset v7 embeds Pulse / Triangle / Noise gates and counters plus Noise and FDS Volume / Depth Envelopes. Strict v1..v6 inputs migrate with previous Pulse / Noise fixed-volume Hold defaults (lengthHalt=true,lengthIndex1) and existing Envelope Loop behavior; missing Triangle controls use Hold defaults (control=true,linearReload127,lengthIndex1), missing Envelope controls stay off. Pulse / Noise store lengthHalt for fixed-volume mode and lengthIndex0..31; with Envelope enabled, envelope.loop selects the shared hardware Loop / Length-halt bit. UI gate choices show this bit and are disabled in Envelope mode, remembering the fixed-mode choice. Gate edits wait for the next attack, and live sound edits preserve the active bit. Copy JavaScript writes the authored Length index after frequency / helper defaults and before the final attack; index0 is valid. v4 extracts its volume-clock fields without changing values. Triangle stores control / linearReload0..127 / lengthIndex0..31, with a shared frozen LENGTH_TABLE (TRIANGLE_LENGTHS alias). Authored gate settings wait for the next note, expired counters keep held-key ownership, and Pitch retains active Length bits including index0; a timer-high boundary write reloads counters. VGM retains Triangle control / reload / Length settings while grouping pitch-only changes, and discloses the restarted elapsed-state / frame phase. fds_depth_controls.js provides an explicit slow-vibrato comparison setup: keep authored waveform / Volume controls / chosen direction / other sources, set modulation enabled with the Vibrato table, Rate8, Bias0, Depth Envelope on with Initial16 / Period31, and shared clock232 / unpaused. The button loads this setup and stops held notes; it does not rewrite Initial depth when direction is changed. Next-note hints explain endpoint / elapsed estimate / clock hold, not live gain. Increase means modulation amount rather than upward pitch: default Rate256 is fast FM, while Rate8 makes a clear vibrato comparison. Disabled / paused / no-change endpoints are visible, and retained counter / Bias can affect pitch even with table advance stopped. Preset v7 and core / WASM are unchanged. FDS Volume and Depth each store enabled / increase / period0..63 / initialGain0..63. Shared fds.envelopeClock stores masterSpeed0..255 / halt. Each new note restores fixed gains, seeds enabled envelopes after keyOn, sets the shared clock once and applies its halt line. Held Envelope / clock changes wait for the next note; Master / Pitch / Rate / Bias / modulation-enable edits preserve progress. VGM retains both known six-bit gains and clock settings; missing or progressed gains and missing master-speed defaults are disclosed, while modulation-table phase / counter remains a restarted audition. Pulse / Noise / FDS Envelope controls use the existing public register API; shared runtime / DSP / WASM are unchanged. Noise Envelope enable / period / loop edits apply on the next note; fixed volume and LFSR clock / mode remain live. VGM imports Noise Envelope settings without the former fixed-volume approximation. Copy JavaScript writes hardware Noise control after the existing noise.setVoice call and before noteOn. VGM DMC capture follows recorded CPU RAM (`0xc2`, raw bank `0x07` + RAM copy `0x68`) and real reader restart requests, snapshots owned bytes including address wrap, and discloses static DAC-level / live-change approximations. Missing RAM is never replaced with demo / zero bytes; compressed banks and NES DAC streams are not reconstructed. DMC uses 1..4081 bytes, padded to 16*n+1, one fixed-rate keyboard trigger, live Rate / Loop and next-trigger Initial level; Pitch is disabled. Explicit Synth release clears its DAC. Hardware output-unit byte continuation is retained; a completed one-shot keeps held-key ownership. Song / automation replay and audio-to-DPCM encoding remain follow-ups. Icon: `docs/tetorica_2a03_synth.webp`. The former `/synth-nes/` URL redirects here; NES APIs remain compatible. Verify with `npm run test:2a03-synth`, `npm run test:2a03-synth:browser`; package with `sh scripts/package_itch_2a03_synth.sh VERSION`. |
| `docs/synth-2a03/dmc_editor.js` | Passive DPCM editor: four-byte bit windows, exact DAC stairs / whole-data overview and manual target drawing. The session-only dmcAutoFit checkbox defaults Off; On uses dmc_fit.js to fit cursor height with nearby bits, including outside the Selected bytes page. Auto-fit pointer moves are coalesced per animation frame, with a synchronous final fit on release and cancellation of queued work when drafts are discarded. Cursor target / actual / error and neighbouring changes are reported. Switching the checkbox edits no committed data; checkbox focus retains editor Undo. The full fitted patch is one history step. Green is the requested after-bit DAC curve; blue is decoded DMC. Strokes preview locally and commit on release; source / sample / parameter / view changes, Escape, lost capture and resize discard drafts. Undo / Redo retains byte snapshots only (up to 64 edits, 256 KiB total bytes), one changed bit or committed stroke per step; cancelled / no-op edits add no step. Current Rate / Loop / Initial level and ordinary source changes keep history; successful file / Demo / VGM / preset loads and Reset clear it even for identical bytes. Shortcuts are scoped to editor focus; pointer edits blur for performance. Generated padding stays read-only; length and preset schema are unchanged. Uses existing DMC sound / VGM / preset paths. No audio-file PCM encoder or audio device. |
| `docs/synth-2a03/dmc_draw.js` | Pure manual DAC-target editing helper: nearest legal ±2 / boundary-hold step in LSB-first order, ties preserve the original bit, untouched bits and source length are retained. Bounded to the original 4081-byte sample, no padding edits, and tests compare drawn bytes with actual WASM. |
| `docs/synth-huc6280/` | Tetorica HuC6280 Synth (`tetorica-huc6280-synth`): one PC Engine PSG, six Wave voices, two Noise voices on physical CH5 / CH6, 32 five-bit samples, a single Main / LFO wave canvas, hardware CH2 → CH1 LFO with one carrier voice and muted modulator, explicit software ADSR, two Pitch wheels and portable preset v1 / JavaScript export. Shared runtime / WASM remain unchanged. Icon: `docs/tetorica_huc6280_synth.webp`; checks: `npm run test:huc6280-synth` / `npm run test:huc6280-synth:browser`. VGM import, DDA streaming and CD-ROM² audio are follow-up work. |
| `docs/synth-2a03/dmc_fit.js` | Pure optional height fitter for existing DPCM: exact 64-state dynamic programming obeys LSB-first ±2 / boundary holds and initial DAC parity. The inclusive edit window is minTarget−62 through maxTarget+63, clipped to original bytes. Lexicographic objectives: squared cursor error outside a ±2 DAC tolerance, squared window-end error outside the same tolerance, full piecewise-linear reference SSE, exact window-end error, then changed-bit count. The reference connects the original pre-window DAC, latest supplied target heights, and original window-end DAC (without overwriting a supplied final target). The one-step cursor and end tolerances prevent parity-fixing trips to 0 or 126/127; nearby levels may differ by one DAC step rather than forcing an exact rejoin. Do not restore exact cursor / end priority: that caused boundary spikes even for a center-height click. Metadata reports actual cursor error and exact rejoined status. Prefix and suffix bits outside the window stay unchanged; suffix waveform is preserved only when the reported rejoined flag is true. Dense targets / storage are bounded to 32,648 bits (4081 bytes); full trace uses about 2.09 MB. No padding / initial-level / Rate / Loop / length changes or PCM audio import. Unit oracle and actual 44.1 / 48 kHz WASM tests cover legality. |
| `docs/synth-2a03/dmc_decode.js` | Pure seven-bit DAC preview before mixer / filters / Master: LSB-first ±2 with boundary holds and unchanged parity, hardware-length `0xaa` padding, rate-based time axis and Loop continuation. Its tests compare every decoded bit with actual WASM at 44.1 / 48 kHz. |
| `docs/vgm_analyzer/` | Analyzer UI and shared analysis / export modules also used by the CLI |
| `docs/generated/` | Published chip JS / WASM and metadata synchronized from the canonical artifacts |
| `tetorica_src/cli/` | `tetorica-vgm` CLI / Node API implementation |
| `packages/fm2612/`, `packages/vgm/` | npm distribution metadata and READMEs; these directories do not contain the entire implementation |
| `packages/virtual-files/src/` | `tetorica-virtual-files` implementation: virtual files and a lightweight shell |
| `examples/` | ymfm-derived `buildall/` and `vgmrender/`; the upstream layout is preserved at the user's request |
| `tetorica_examples/` | Tetorica's own `nodejs/`, `browser/` and `cpp/` examples; sound-generation experiments are also consolidated under `nodejs/sound-color/` |
| `docs/tutorials/` | Canonical Markdown for YM2612 lessons and published C++ copies; the editable C++ sources are in `tetorica_examples/cpp/tutorials/` |
| `scripts/` | Builds, synchronization, packaging and verification |
| `test/`, `test/runtime/`, `docs/*/*.test.mjs` | Feature, shared-engine and UI tests; the 277 tests formerly directly under web have been moved to `test/runtime/` |
| `dist/`, `release/` | npm build outputs, staged browser / itch artifacts and ZIPs |

The root `package.json` is a development workspace with `private: true`. Do not publish the root as an npm package.

See the [layout plan and TODO](docs/issues/todo_repository_organization_01.md) for the top-level directory reorganization. The ymfm-derived `src/` and `examples/` retain their upstream layout. Tetorica's implementations are under `tetorica_src/`, its examples under `tetorica_examples/`, and shared tests under `test/runtime/`. Synchronization and distribution scripts preserve the published website and npm layouts. Check Git and the actual files when locating implementations. Verify generated artifacts with `npm run check:runtime-artifacts` and the published C++ lesson copies with `npm run check:tutorials`.

`npm test` runs both the root tests and `test/runtime/`. Use `npm run test:runtime` for only the shared runtime and `npm run test:runtime:types` for SCSP source type checking. `tetorica_src/runtime/spc_test_fixture.mjs` and `tetorica_src/runtime/native_genesis_extra_creation_fixture.mjs` remain beside the implementation because shared checks and calibration use them as inputs.

### When changing the shared runtime

1. Edit the core implementation and JSDoc in `tetorica_src/runtime/`. Edit UI-specific code in directories such as `docs/playground/` and `docs/vgm_analyzer/`.
2. Synchronize shared JavaScript to the website.

```sh
sh scripts/sync_web_js_to_docs.sh
```

3. If distribution contents change, also generate and verify the affected packages. An existing `release/itch_playground_dev` is not updated automatically.
4. When adding a module dependency, check whether synchronization inputs, distribution scripts, module catalogs and Monaco reference models also need updates.

Synchronization adapts relative WASM paths and other references to the destination layout. Do not remove required path transformations while trying to make `tetorica_src/runtime/` and `docs/js/` manually identical.

### Languages of the published home pages

`docs/index.html` is English and `docs/index-ja.html` is Japanese. They are static pages with the same design and tool links, a language switch and an AI/SI link. Match each page's `lang`, title, description, Open Graph metadata, visible text and aria-labels to its language.

Reflect new tools, introduction pages and link changes in both home pages.

The YM2612 introduction is also split into `docs/introductions/index.html` (English) and `docs/introductions/index-ja.html` (Japanese). Each home page links to the introduction in its own language. The Japanese version translates the body, buttons and algorithm-audition status messages while preserving embedded code and demo behavior.

Other introductions (Sega PSG, Mega CD, Game Boy, tuning, the register introduction, all 15 FX chapters and their contents page) and `docs/for-ai.html` use the original URLs for English and `*_ja.html` for Japanese. Articles formerly available only in Japanese retain their content in the Japanese versions, with English versions added. Do not rename the existing `index-ja.html` pages. Match language switches, alternate links, previous / next chapters and links from the English and Japanese home pages to the respective language. The Game Boy dynamic UI and generated code comments use `docs/introductions/introduction-locale.js` to follow the page's `lang`. Embedded Playground, Synth and Analyzer apps are outside this translation scope.

## Open the browser version locally

```sh
npm ci
python3 -m http.server 8083 -d docs
```

Run the server in a separate terminal, then open:

- `http://localhost:8083/playground/index.html`
- `http://localhost:8083/synth/index.html`
- `http://localhost:8083/vgm_analyzer/index.html`

Start browser sound examples from a user gesture such as a click. README samples with bare npm imports need a resolver such as Vite. Distinguish Playground user code from general web-app code that imports npm modules.

## Verification commands

Choose tests relevant to the change and run the necessary scope. The following list helps locate checks; it is not an instruction to run everything on every change.

```sh
git diff --check
npm test
npm run test:analyzer
npm run test:sbi
npm run test:virtual-files
```

Audio package and type declarations:

```sh
npm run build:fm2612
node scripts/check_fm2612_types.mjs dist/fm2612
npm run test:fm2612
npm run test:fm2612:browser
```

- `build:fm2612` generates `dist/fm2612/`, creates declarations from JSDoc and checks their types.
- `check_fm2612_types.mjs dist/fm2612` checks the generated distribution with NodeNext, Bundler and Browser consumers without Node ambient types. Without an argument, it also performs the build.
- `test:fm2612` installs the tarball into an independent consumer and checks it there. Successful imports inside the repository alone do not establish that the npm distribution works.
- `test:fm2612:browser` uses a real browser. Run `npm run setup:browser` if Playwright Chromium is needed.

VGM and virtual-file builds:

```sh
npm run build:vgm
npm run build:virtual-files
```

For chip-core changes, check the corresponding `scripts/build_*_wasm.sh` and chip-specific tests. Read each script for prerequisites such as Emscripten. JSDoc-only or README-only changes do not require rebuilding WASM.

## Audio API assumptions

- Direct Transport generates PCM synchronously. Generating PCM alone does not play it through speakers. Offline WAV generation does not require waiting for the song's real-time duration.
- With Worklet Transport, an AudioWorklet generates audio. JavaScript helpers such as `sleep` and `beat` wait for performance progress or continuation; they do not provide sample-accurate scheduling by themselves.
- Audify provides native Node audio output. It is a separate output path from browser Web Audio, with different package and runtime requirements.
- `transport.flush()` is a queue-processing check / barrier. It is not meant to be called after every register write, nor is it required to start a song.
- Passing an `AbortSignal` somewhere does not automatically interrupt every `await`. Each operation must observe the signal and handle stopping or exceptions where needed.
- YM2612 `block` / `fnum` represent chip pitch. Use the `pitch.js` helper `hzToBlockFnum` for Hz, or `createPitchFromMidi` for MIDI note numbers. The chip input clock in Hz and the audio sample rate are separate values.
- Inclusion of a WASM wrapper, playback-engine support, Worklet execution, high-level Synth APIs, and VGM transcription / voice extraction each have their own coverage. A supported-chip list does not imply identical support across all APIs.
- The initial Game Boy mixer balance is 28%; other chips start at 100%. Distinguish mixer balance, output gain and Master. Clipping caused by high output is not automatically an emulator defect.
- When omitted, `createSoundChip` assigns `chip.id` automatically. IDs are reserved before initialization; this is not probabilistic UUID collision avoidance. Consult the shared implementation for ID and mixer ownership / release behavior.

## Information moved out of the user READMEs

### Editing TFI instruments extracted from VGM

These steps are retained for development and verification. They do not need to be restored automatically to the user READMEs.

1. Import a supported VGM / VGZ in the Playground.
2. Open `presets/<filename>/` in the virtual files and edit a `.tfi`.
3. Change FM parameters, move focus out of the input field, and audition with number / letter keys.
4. Use Export Cassette to save the project, including its virtual files.

OPN FM voices captured at key-on are saved to paths such as `/presets/song/ym2612_ch1_001.tfi`. Duplicate voices within the same channel are merged. Reimporting a file with the same name uses a new directory such as `song-2`. TFI stores static FM parameters; it does not store pan, LFO or changes in pitch / volume over time. Editing updates virtual files and does not write back to the original files on disk.

### Distribution and implementation details

- The complete web runtime archives are `web_runtime` / `web_runtime_exsample`. Their generation commands and verification have moved to `README_RELEASE.md`.
- Chip-specific limitations and verification records for Note-ish, MIDI, SBI, OPM, MSX, NES / FDS, ADPCM and related features have moved to `Memo.md`.
- The old paragraph stating “local 0.2.0, published npm 0.1.0” was removed because those fixed values were outdated. Do not restore it. Check each package's `package.json` and publication records for current versions.
- `READMD_RELEASE.md` remains as a pointer to `README_RELEASE.md`. Do not casually delete it and break existing links.

## Separate repository: Tauri desktop version

This development environment has a separate checkout at `w/tetorica-fm2612-playground-tauri/`. It may not exist in other environments, so first check its location and README.

- The Tauri app imports the parent repository's Playground distribution ZIP and tracks the extracted `dist/` in Git.
- `release.lock.json` records the integrity of the ZIP and extracted contents. Manually changing only `dist/` makes `import_release.py --check` fail.
- To incorporate parent-runtime changes, regenerate the distribution ZIP and update it through the Tauri import procedure. Do not disable the lock check as a workaround.
- Cassette autosave uses IndexedDB in Tauri's WebView. It saves code, assets, the file being edited and the file selected to run, then restores them on the next launch. Its scope differs from the regular browser version.
- Chips and effects run through Web Audio. Final PCM is sent to Node/Audify only when that output is selected. Startup uses WebView output.

Commands to run from the Tauri repository directory:

```sh
npm test
python3 scripts/import_release.py --check
node scripts/prepare_audio_sidecar.mjs
node scripts/check_audio_sidecar_bundle.mjs
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

On Windows, replace `python3` with `python`. Audio resources must also be prepared before running Cargo directly; do not rely solely on the Tauri CLI's beforeBuildCommand.

### Windows Audify fixes through v0.52.6

- Select WASAPI explicitly to avoid automatic ASIO discovery.
- Patch RtAudio inside Audify 1.10.1 to release WASAPI device objects before COM shutdown, then rebuild the Windows module.
- In Node 22, passing a `\\?\C:\...` path into main-module resolution caused termination with `EISDIR ... lstat 'C:'`. A relative script path alone does not resolve this. Convert both the executable path and working directory to normal Windows path syntax.
- Native-side conversion is in `src-tauri/src/audio.rs`; CI-side conversion is in `scripts/node_resource_path.mjs`. Account for drive / UNC paths, spaces and Japanese paths.
- Verify device enumeration, garbage collection, normal Node shutdown, and server startup / JSON responses from an isolated bundled directory.
- Stopping an unused output must not start a new Node process. Show complete failure details in the menu and Console.
- Keep Audify selected after an error and allow copying the error with “Copy error.” Retain the error until “Clear error” is used. Switch the actual audio connection back to WebView.

**Hardware verification as of 2026-10-10: the user confirmed operation on macOS and Windows. Linux was unchecked because no physical test machine was available. The user explicitly chose to release with Linux marked unchecked. CI success and confirmed audio playback on real hardware are separate results.**

## Separate repository: npm usage examples

`w/tetorica-fm2612-examples/` in this environment is a separate checkout of [tetorica-fm2612-examples](https://github.com/kyorohiro/tetorica-fm2612-examples). It contains Web / Node examples that consume the actual npm package.

Working audio-package changes in the parent repository do not automatically update the published npm package or the examples. After publication, update dependencies, lockfiles and deployed build outputs, then verify running, stopping and disposing the examples.

## Historical work status and verification records

Local settings as of 2026-10-10 (not a comparison against published releases):

| Target | Configured version |
| --- | --- |
| `packages/fm2612/package.json` | `0.2.12` |
| `packages/vgm/package.json` | `0.2.8` |
| `packages/virtual-files/package.json` | `0.1.1` |
| Local Tauri checkout | `0.52.6` |
| `tetorica-fm2612` dependency used by the examples | `0.2.12` |

Changes and checks recorded in that work period:

- Added or expanded public-function JSDoc in 40 files under `tetorica_src/runtime/` and synchronized it to `docs/js/`. Documented `createPlaygroundClock` options, return values, seconds / beats / samples and stop behavior. Executable code was unchanged.
- Generated and type-checked 192 declaration files with `build:fm2612`. NodeNext / Bundler / Browser consumer checks against the distribution also passed.
- Passed 37 related tests for clocks, asynchronous tasks, OPN, S98 and native FX. This records the scope run during that work, not the latest result for the entire test suite.
- Checked the README's do–re–mi example in a browser: actual WASM / AudioWorklet initialization, C4 / D4 / E4 note calls and AudioContext disposal after playback. This was not a listening evaluation.
- README reorganization and moving information to `Memo.md` / `README_RELEASE.md` were documentation changes. Link targets, code fences and diff whitespace were checked.
- The README changes included the user's edits and staged changes. On resuming, inspect Git state; do not discard changes in bulk or commit / publish without authorization.

Temporary browser-check scripts under locations such as `/private/tmp` are not guaranteed to exist in another environment or session. For repeatable verification, use the repository's check scripts, relevant tests and the actual README code.

## Updating this handoff

Record changed features, checked targets, verification commands run, unchecked scope, publication status and remaining work separately. Date version numbers and test counts. Put feature details in `Memo.md` or `docs/issues/`, user-facing explanations in the English and Japanese READMEs, and publication procedures in `README_RELEASE.md`. Avoid duplicating the same long explanation across several documents.
