# Reusable SCSP DSP assembler: npm preparation — 2026-11-17

The pure SCSP DSP codec is ready in a local npm candidate. The user's manual
review of SCSP Synth remains on the unchanged `main` checkout at `c0b9a24e`.
No npm publication, version bump, commit, push or release tag was performed.

Follow-up: `tetorica-fm2612@0.2.42` was published and registry-verified on
2026-11-17. See [the npm release record](npm_scsp_dsp_release_20261117.md).
The original preparation details below remain historical.

## Worktree / resume

- Branch: `work/scsp-dsp-npm-20261117`.
- Worktree, relative to the main checkout: `w/_codex-scsp-dsp-npm-20261117`.
- Changes remain uncommitted in that worktree. They are not changes in `main`.
- The initial `/private/tmp` worktree was moved to the workspace so unfinished
  work survives temporary-directory cleanup / restarts. Its ignored dependency
  directory links to the already installed main dependencies; no dependency
  installation or lockfile change was required in either checkout.

From the main checkout, inspect / continue with:

```sh
cd w/_codex-scsp-dsp-npm-20261117
git status --short
npm run build:fm2612
node scripts/check_fm2612_types.mjs dist/fm2612
node scripts/check_fm2612_package.mjs --skip-build
```

When publication is actually requested, choose / update the package version,
rebuild, revalidate and publish. The candidate currently retains metadata version
`0.2.41`; it is an unpublished development payload, not a new registry release.

## Public API

```js
import {
  assembleScspDsp,
  disassembleScspDsp,
} from 'tetorica-fm2612/scsp_dsp_assembler.js';

const words = assembleScspDsp('003: EWT=1 COEF=1');
console.log(disassembleScspDsp(words));
```

The extensionless subpath exposes the same functions and types. Existing
wildcard package exports already support both paths. The default package entry
and sound-chip factory are unchanged.

The implementation is canonical at `tetorica_src/runtime/scsp_dsp_assembler.js`
with an explicit `.d.ts`. Public `docs/js/` and original Synth codec / declaration
paths are byte-identical copies. New drift tests and the shared synchronizer
maintain that relationship. The Synth's existing JS / declarations / HTML / CSS
remain unchanged; only its format guide gains the npm availability explanation.

The codec retains its complete provisional field syntax and 512-word logical
MPRO image. It does not configure coefficients / RAM / routing, run a program or
enforce the Synth's narrower execution profile. RAW inspection / preservation
remains distinct from authoring undefined bits. No parser algorithm, DSP runtime
facade, backend, native / WASM artifact or audio calibration was changed.

## Examples / documentation

The package includes `examples/scsp-dsp/README.md`, `roundtrip.mjs`, `index.html`
and the generated example declaration. Both examples use the actual npm subpath.

```sh
node node_modules/tetorica-fm2612/examples/scsp-dsp/roundtrip.mjs
python3 -m http.server 8080
```

Open `/node_modules/tetorica-fm2612/examples/scsp-dsp/` under that local server.
The example's import map resolves its installed package modules without a CDN.
Its source / canonical listing and successful round trip are visible in the
page. It does not produce sound.

The package README, shared runtime source map, SCSP guide and assembler format
guide explain the API / types, source ownership, provisional syntax, execution
boundary and BSD / upstream-core notices. Hand-authored public declarations are
installed before declaration inference and kept byte-exact rather than replaced
with broader inferred signatures.

## Verification

- `npm run build:fm2612`: PASS; 372 runtime modules / 28 chip-engine pairs,
  424 checked declarations. Existing runtime / native sources and licenses are
  retained. No native build was performed.
- `node scripts/check_fm2612_package.mjs --skip-build`: PASS. This installs the
  tarball into a separate offline consumer, checks the new JS / declaration /
  example bytes and runs both subpaths plus the packaged Node example. Network,
  AudioContext and WebAssembly access are trapped during pure-codec checks.
  Existing package checks load all 28 WASM engines and validate other chip APIs,
  ownership / PCM, assets, source kits, notices and declarations without a live
  audio output device.
- `node scripts/check_fm2612_types.mjs dist/fm2612`: PASS. Strict positive / negative
  consumer cases pass NodeNext, Bundler and browser DOM-only compilation without
  Node ambient types, including readonly inputs and invalid data / options.
- Public codec + existing assembler / CLI suite: **17 passed**. Tests include
  independent field vectors, step positions, RAW / arbitrary-word round trips,
  no implicit browser / fetch / WASM access, strict options, owned arrays,
  readonly data, line diagnostics and all three source / declaration copies.
- `npm run test:scsp-synth`: **288 passed**, with the original Synth implementation.
- External tarball browser checker: **Chromium / WebKit, 6 cases each (12 total)**.
  It serves only an isolated installed consumer, exercises both import-map paths
  and the packaged HTML / module example, checks actual word vectors / defaults /
  errors and audits side effects before imports. AudioContext, fetch, WASM and
  XHR attempts are **0** in both the direct consumer and example. No external
  requests, missing files or uncaught browser errors. No listening was performed.
- Main's branch, HEAD and tracked / untracked status are unchanged. Runtime
  source / declaration hashes match both served and original Synth copies.
- `git diff --check`: PASS. Broad website sync, Synth release packaging, npm
  login / publication and application releases were not run.

Local candidate: `dist/candidate/tetorica-fm2612-0.2.41.tgz`.
1,281 files, 2,870,215 compressed bytes, 11,653,647 unpacked bytes.
SHA-256: `a18aaa97985314e8d3691c3243e0fa665d4b37034093dd6dc63b70eef7af7cbc`.

Source hashes:

- JS (8,081 bytes): `1392ea532fc4c674b97f200e6dc1d8223288b4d3e167084e26dc78152b3ddf43`.
- Declaration (987 bytes): `3266ebf4a07852f978ed6639d590b71ff4b53bf4462a2f2b212be3f13132fc64`.

[Machine evidence](verification_scsp_dsp_npm_20261117.json) records the installed
tarball browser results, example output and served module hashes.

## Main integration follow-up — 2026-11-18

The user requested committing and reflecting the published 0.2.42 source into
main / GitHub. Earlier statements that main was unchanged or changes were
uncommitted describe the preparation / publication phases only. Current
integration status is tracked in
[todo_scsp_dsp_main_integration_20261118.md](todo_scsp_dsp_main_integration_20261118.md).

Main integration completed on 2026-11-18: source commit
`7c3a8f093ba5237864569a47bd73f67a01bc5cb2` was fast-forwarded into main and
pushed to GitHub. Local / origin / GitHub API commit equality and 17 focused
tests passed. The previous uncommitted-worktree / unchanged-main descriptions
are historical. See the linked integration TODO for the completion evidence.
