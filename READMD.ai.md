# Tetorica — AI/SI development handoff

[English](README.md) | [日本語](README.ja.md) | [AI/SI](READMD.ai.md)

Updated: 2026-11-04 (English handoff; clarified the multi-chip toolkit and its API layers; Tetorica's own implementations are consolidated under `tetorica_src/`). This is an entry point for AI agents investigating the repository and resuming work.
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
| `docs/synth-2a03/` | Tetorica 2A03 Synth (`tetorica-2a03-synth`): one NTSC NES APU + FDS, Pulse two-voice round robin, mono Triangle / Noise / FDS, 64-point Wave RAM and 32-command modulation editing, strict presets and JavaScript export. Icon: `docs/tetorica_2a03_synth.webp`. The former `/synth-nes/` URL redirects here; NES APIs and portable preset format remain compatible. DMC and VGM voice-library import are follow-ups. Verify with `npm run test:2a03-synth`, `npm run test:2a03-synth:browser`; package with `sh scripts/package_itch_2a03_synth.sh VERSION`. |
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
