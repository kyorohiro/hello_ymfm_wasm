# SCSP Synth read-only SSF DSP Live — 2026-11-18

Base: `3ec3405625ad6007e87e1163c97b6b995dfb07b5`.
SSF playback now exposes its own DSP for observation. The Synth's authored
program/draft remains separate. No observation is applied or copied to Synth.

## Use it

Load an SSF / MiniSSF set, Play, leave **Live from SSF** enabled, and open
**DSP**. It shows **SSF DSP · Read-only**, with the native observation frame.
Expand Program / COEF / MADRS / Shared returns as needed. Tables keep their
disclosure state and scroll internally; detailed explanations stay under **?**.

- All **128** instructions have their four original words and decoded fields.
  The game program is not limited to the Synth's execution profile.
- All **64** signed COEF codes show their multiplier (`code / 4096`), and all
  **32** MADRS entries retain their raw addresses.
- The selected CH shows configured Direct/Pan and ISEL/IMXL Send. The **16**
  shared returns show EFSDL/EFPAN from CH1–CH16 and observed signed EFREG values.
  Instruction selectors are references, not a proven CH-to-return signal path;
  arbitrary connectivity remains program-defined. Raw EFREG samples are not
  audio meters.

Pause freezes the same snapshot for DSP and CH selection. Seek replaces it at
the new audible position. Selecting another CH keeps DSP selected. Live Off or
Stop restores the Synth DSP view and its unchanged draft/applied setup. Missing
or incompatible DSP data displays Unavailable, rather than invented zeros.
The view does not render tables while closed or steal focus; the whole SSF view
is updated only while the DSP tab is visible.

The listing follows the **Mednafen renderer dialect**. Its NOFL is word3 bit 8;
word3 bit 15 is opaque. The Synth/MAME decoder uses a different NOFL position.
A private display adapter handles this one difference, retaining every original
word and opaque bit. All 25 fields were compared: the other 24 positions/widths
match. The observation listing is not a promise of cross-engine assembly
compatibility. No Synth assembler/core behavior was changed.

## Native transport and preservation

SSF ABI **4** adds a passive DSP read alongside the unchanged 1040-word slot/RAM
observer. The DSP block has 632 words: header/frame plus program512, COEF64,
MADRS32 and EFREG16. The renderer owns detached arrays and checks both native
reads use the same frame. ABI3 still plays and exposes its old slot/RAM state;
its missing DSP capability remains explicit. TEMP/MEMS are outside this addition.

The observer uses const direct member copies, without emulated bus reads,
writes or sample clocks. It is inserted only into a temporary pinned-source
build copy. The vendor tree is unchanged. Rebuilt loader/WASM, C++ inputs,
notices and the source kit are included in the standalone distribution.

Audible-position history retains at most 16 snapshots and at most 8 MiB of
typed buffers, including RAM, slot registers and DSP data. Full observations
currently fit 15 snapshots. JavaScript object overhead is separate. The view
does not add a timer or another emulator instance.

## Verification

- **375** Synth/packaging tests pass. New coverage includes **7** native/schema
  tests, **8** display/model tests and **2** history-budget tests. Tests cover
  all fields and signed boundaries, opaque/NOFL handling, dynamic native
  COEF/MPRO/MADRS changes, owned/frozen snapshots, old ABI fallback, read-only
  display, focus/disclosure preservation, missing data and original rendering.
- **8** actual predecessor/new-observed/new-unobserved native cases preserve
  exact PCM, RAM, old 1040 words/decoded slot state and native frame. Repeated
  observation does not advance time or change final snapshots. Cases include
  PCM, multi-voice capture, native CPU writes and a nonzero DSP fixture. CPU registers are not
  directly exported; CPU noninterference is supported by the const/no-bus/no-
  clock implementation review, not a claimed CPU-register measurement.
- **67** proof/guard tests, **11** recorder checks and both Mixer generators
  pass. The final checker-only packaging-harness correction was repinned and
  verified with an additional **5** guard tests and source receipt check.
  Old measurement JSON, common SCSP runtime/core/gains, package versions and
  vendor source bytes remain unchanged. Only the authorized SSF assets change.
- Source and exact ZIP pass Chromium/WebKit at 48 kHz: **7 grouped cases per
  engine**, permanently muted, zero local errors/missing files, zero page
  overflow and silence after Stop. The existing Synth DSP-flow ZIP suite also
  passes both engines. Desktop/mobile tables were visually inspected.

Final source receipt object:
`325b1c52489ec484368344f7da71134cbd569ea417f94f457ab3a7217dbe12a3`.
The receipt pins 5 changed source pairs / 18 reverse hunks, 2 native asset
descriptors, 86 dependencies and 18 reports. It does not embed old binary data.
Independent byte reconstruction matches actual Git blobs, with zero mismatches.
All 887 historical issue JSON files, 1022 shared runtime/core files, 1085 vendor
files and 54 package/manifests retain their original bytes. The three authorized
SSF generated files are recorded separately with before/after hashes.
[Machine evidence](verification_scsp_ssf_dsp_live_20261118.json) records build,
native parity, guard, independent audit, browser, screenshot and artifact hashes.

## Distribution and remaining work

Tested candidate: `release/tetorica_scsp_synth_ssf-dsp-20261118_itch.zip`.
All **379** entries pass CRC and stage-byte comparison; **150** comparable
served files and every embedded original source input match current bytes.
The updated readable loader, view and native source/rebuild kit are included.
CI now verifies the new source/native proof and exact ZIP.

Real-game listening remains a manual check. Automatic game-DSP transfer,
cross-engine NOFL compatibility, DSP history copying and feedback remain later
work. No npm/itch publication, version bump, commit/push/tag or Tauri update
was performed.
