# PS1 editor: apply ADSR changes during Release

Date: 2026-10-29.

## Problem and change

With Release rate 31, a manual SPU audition continues sounding after key-off.
Changing the rate to 0 in the Playground UI previously updated the register but
left the active envelope unchanged. The inspector removed its manual audition
identity at key-off, and live envelope refresh incorrectly required that identity.

The **Apply ADSR / PCM edits while playing** option now applies changed ADSR words
to the selected voice's current stage, including Release and code-owned notes.
The write and refresh keep the current envelope level, sample position, gate and
note owner. Native sends them in the same edit batch. A released audition does
not acquire another manual lease. Retriggering PCM or using the legacy retrigger
option remains restricted to this editor's held audition.

Unchecked edits stay deferred. Same-value ADSR and unrelated volume/pitch edits
do not implicitly apply deferred settings. Release rate alone does not switch a
held note into Release: key-off still starts that stage. Other channels and the
shared reverb tail are unchanged.

The SDK, C++ core, raw register behavior and WASM binary are unchanged. No CH Mute
control is introduced by this fix.

## Verification

- [Before/after shipped-WASM comparison](ps1_live_release_offline_01.json): the
  same released RR31 voice retains ENVX 32767 and a nonzero PCM tail before the
  fix. After a live RR0 edit with the fix, ENVX and the captured tail are exactly
  zero. The report records both inspector source hashes and the unchanged WASM.
- 53 Worklet/Native adapter tests pass, including seven new regressions. Actual
  WASM at 44.1/48 kHz covers an unheld Release tail, explicit deferral, same-value
  safety and no KON/KOFF. Primary/additional Native adapters also retain the
  original script owner's cancellation and the sibling voice.
- The 33 existing SPU panel tests pass. The browser checker now exercises RR31
  key-off, unchecked RR0, then a changed checked RR0 and exact-zero PCM/ENVX.
- [The actual Run ZIP](ps1_live_release_run_browser_01.json) passes WebKit Main
  and Worker routes. Both include the new Release-tail regression, graphical
  ADSR/PCM editing, Keyboard, reverb, additional SPU, Stop and recovery. Physical
  output remains muted; no human listening or Tauri GUI/device test is claimed.

## Calibration and distribution

The shared cache revision is `ps1-live-release-1`. New full raw measurements
retain exact current source hashes; all ten earlier raw records remain immutable.
PS1 has 48 instrument captures plus eight FM controls; WonderSwan 48 plus eight;
POKEY 96 plus eight FM, eight Sega PSG and eight dual-combination checks.
All actual PCM pilots are continuous and stopped PCM is exactly zero. One POKEY
stopped-capture renderer-clock diagnostic remains in its raw report; it does not
indicate a gap in the independently captured pilot. No threshold was relaxed.

All Mixer gains remain exactly unchanged: PS1 `0.128832`, WonderSwan `1.172528`,
POKEY primary/additional `0.413033` and both dual roles `0.413034`. The calibration,
history and Mixer suite passes 490 tests; both generator checks and actionlint
pass. The new raw records are `*_chip_levels_live_release_01.json`.

Both Playground ZIPs pass CRC. The complete ZIP is 37,018,525 bytes, SHA256
`6eaae2ff556eadec951fd949567ea3419c6ee61c44833b1c24f713298a25c671`.
The Run ZIP is 37,410,795 bytes and 931 files, SHA256
`8f38e7cdd628e870ad0d36a088e6b277a6261bdca46b80f9d9e635abb8b81b5e`.
Tauri imports 1,066 nonmetadata payloads from the complete ZIP; the import lock
and unchanged fixed SDK verify offline. Tauri needs rebuilding to use the fix.

The local npm build contains 335 modules, 28 engines and 385 declarations.
The 1,004-file tarball passes isolated install, actual PCM, license/source and
NodeNext/Bundler/browser declaration checks. No version is bumped or published.

The sandbox initially blocked the browser test's local server and npm's cache.
Both checks were rerun with the required access; no cache ownership was changed.
An initial calibration-generation command omitted its required `--report`
argument and stopped before writing assets. Corrected generation and the final
strict suite passed. The measurement records were not edited to bypass checks.

## Scope and state

The main repository was clean at the start, at commit
`9315dbb1ea6efd404229fb05aba12755e2d25e0a`. Tauri already had uncommitted changes
from the preceding tasks. Its fixed SDK remains the same local 0.1.7 candidate.
No commit, push, remote CI or publication is requested or performed here.
