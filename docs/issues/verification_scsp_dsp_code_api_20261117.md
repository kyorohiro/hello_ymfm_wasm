# SCSP DSP authoring from Synth Code — 2026-11-17

The existing borrowed SCSP client now exposes local `compileDsp(source)` plus
acknowledged `applyDspProgram(words, options?)`, `getDspProgram()`,
`getDspCoefficients()` and partial `setDspCoefficients(patch)`.

## Try it

Fresh Files include **examples/dsp-iir-motion.js**. Open it in Code and Run.
Existing saved/imported projects are not reseeded: add the
[readable example](../synth-scsp/examples/dsp-iir-motion.js) with Files → Add files.
The default `index.js` melody is unchanged.

The example compiles the three-step IIR, atomically applies coefficients
`[4095,3840,256]`, and uses current PCM A through wet-only DSP output. Choose
Saw to make smoothing more evident. Its `beat()` melody follows BPM; independent
four-second `tween()` motion changes COEF1 / COEF2 together, adding to 4096.
These are hardware coefficient codes, not an automatic cutoff control.
`livePrepare()` runs setup once per Run, so Apply replaces loops while retaining
live setup; use Run after editing initialization / DSP source.

## Behavior and boundaries

- Compilation is synchronous on the calling JavaScript thread, returns a new
  512-word image and uses the same source / execution-profile validation as
  GUI Check. No RPC, rendering or chip / GUI mutation occurs during compilation.
  Acquiring the client with `useSoundChip()` still prepares audio.
- Remote parsing is not exposed. The Worklet independently validates program
  words and complete / partial coefficient requests using existing owner logic.
  Invalid requests keep the complete previous setup and held voice owners.
- Program-only Apply retains coefficients; supplying all three applies complete
  setup atomically. Partial coefficient edits retain history, program revision,
  sample allocation and notes. Program reads / Apply include detached
  `{words, custom, revision, coefficients}` snapshots; coefficient replies carry
  only `{codes:[c0,c1,c2], feedback}`. Arguments are copied before enqueueing.
- Successful mutation ACKs update Main's restart memo and Applied / coefficient
  display before the Code Promise resolves. Tween motion does not poll / copy
  the program image or rerender the full voice panel. GUI drafts and checked,
  pending example setups are retained.
- Code Stop retires its client and releases its owned notes while keeping the
  shared DSP. Already committed ACKs still update the same alive engine's memo
  if Stop retires their client before delivery; the stale Promise is rejected.
  Disposed / failed engines cannot publish into another engine's state.
- The primary Synth DSP is shared with GUI / keyboard and is independent of
  SSF and paused audition. Portable voice / idle formats, default sound,
  calibration, scheduling APIs and backend / SDK / WASM are unchanged.
  No public npm DSP export, commit, push or publication was performed.

Full usage and execution limits: [DSP_ASSEMBLER.md](../synth-scsp/DSP_ASSEMBLER.md).

## Verification

- `npm run test:scsp-synth`: **269 passed**, including real shipped-WASM PCM,
  owner / session fences, partial edits, atomic rejection, owned snapshots,
  exact IIR compilation, strict TypeScript / implementation navigation, fresh
  versus restored Files, ACK-before-return and late-ACK-after-Stop behavior.
- `npm run test:scsp-dsp-assembler`: **12 passed**.
- Both mixer / Playground calibration generators passed `--check` unchanged.
- New browser checker: source / isolated ZIP × Chromium / WebKit, **11 cases
  each (44 total)**. It checks actual Run / Apply, local compile without RPC,
  held keyboard + Code ownership, GUI draft coexistence, partial / program-only
  updates, the shipped independent loops, invalid input and a blocked-observer
  ACK → AudioContext-close → complete program / coefficient recovery.
- The consuming Code `.then()` observed Main codes `[1234,3500,596]` before any
  follow-up authoring read. Restart retained these codes and IIR words.
- Existing FIR / recovery checker: **15 cases in each browser (30 total)**,
  including older Apply ACK versus newer drafts, rejected transfers, continuity
  on no-op setup, Code Feedback and post-ACK recovery.
- No missing assets or uncaught errors; 390px document overflow **0**. Mobile
  source and coefficient screenshots were inspected. Each live context had one
  destination route, permanently fixed at gain 0 before application loading.
  Signal was measured upstream; no physical playback / listening was performed.
- All 102 served assets per source / ZIP run matched their respective files;
  the common 101 source / ZIP assets were byte-identical. ZIP entry relocation
  is intentional. Package tests also check deterministic archives, byte-exact
  editable assets and authenticated browser / native source receipts.

Validation ZIP: `release/tetorica_scsp_synth_dsp-code-20261117_itch.zip`.
367 files, 4,246,057 bytes, SHA-256
`532c9b07264dd9f716e61dea2997c42de764d1333f04c47cd18234a328d3e246`.

[Machine evidence](verification_scsp_dsp_code_api_20261117.json) records the
browser cases, muted graph, signal measurements, ACK recovery and asset hashes.

## Later work

Keep wider coefficient tables / RAM layouts, sample-timed DSP parameter
scheduling, a public npm DSP facade and automatic effect compilation separate.
The current milestone makes the existing experimental profile usable from Code.
