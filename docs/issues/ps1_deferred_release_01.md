# PS1: defer ADSR through manual key-off

Date: 2026-10-29.

## Behavior

With **Apply ADSR / PCM edits while playing** disabled, editing RR while a note
was held did not change its sound immediately, but manual key-off reread the
edited ADSR registers. It therefore applied deferred RR at release, while the
ordinary `keyOff()` path retained the latched RR.

The shared C++ core now keeps the actual latched release slope separate from
the manual 128-native-frame release floor. Key-off never rereads pending ADSR
register edits. The next actual Note On or a changed explicit live ADSR edit
loads them. Both RR31→0 and RR0→31 follow the same rule in the Browser and Native
instrument paths. The manual click protection, long/infinite release, sample
position, note owners and other channels are retained.

This task does not add Pitch/Mod wheels or CH Mute controls. The C ABI and its
exports are unchanged, and pristine upstream MAME files are untouched.

## SDK and WASM

The canonical source is `w/tetorica-soundchip-native`, with nine changed paths.
A new local SDK 0.1.7 candidate was exported under
`release/soundchip-sdk-0.1.7-ps1-deferred-release/`; the earlier candidate archive
is retained. The source ZIP SHA256 is
`0c09e92c3147a83fe3e694c2a48af169415b4e7e3c0b0cb3000ffb91c250f7b4`.
Its base commit is `7dff18153413d6dfd5908ccafb9e985e268acd4a`, with the exact
nine changed paths recorded in `localCandidate`. Both consumers imported all
455 pinned files through their archive importers. Fixed snapshots were not
edited directly.

The rebuilt WASM SHA256 is
`8d068780223cc315560ccf202bd18caa8c8815a314e0bd42d5abb727edd91f6e`.
The source/license bundle includes the matching SDK sources and build receipt.
An isolated rebuild from those distributed sources reproduced both descriptor
and WASM bytes exactly. Browser cache revision is `ps1-deferred-release-1`.

## Verification

- The new core regression fails against the preceding core and passes against
  the corrected core. The canonical CMake fixture covers 15 new paired cases:
  deferred edits in Attack/Decay/Sustain, both RR directions, repeated manual/raw
  Off, next KON, explicit refresh and long release. CTest passes 1/1, SDK release
  Python tests 13/13, and the SDK collection check verifies 324 snapshots.
- [Before/after shipped-WASM proof](ps1_deferred_release_offline_01.json) retains
  both old/new binary identities and the four RR direction/version observations.
  Held envelopes stay at 32767. After the fix, the first release uses the old RR
  and the next note's release uses the edited RR.
- [Raw C API before/after comparison](ps1_deferred_release_raw_parity_01.json)
  compares 100,629 frames across RR0/10/31, voices 0/7/23 and a reverb case. All
  returned PCM/readback bytes match exactly. It does not claim hardware accuracy
  or physical listening.
- 149 JS/core/Worklet/Native-adapter/panel tests pass, including all eight new
  Worklet/Native-JS cases. SDK importer Python tests pass 26/26.
- The linked Native PS1 tests pass 19/19. Full Native regression passes 764,
  with two existing device/benchmark tests ignored and 38 filtered. No GUI or
  physical audio device is opened.
- [Existing manual/live-control checks](ps1_deferred_release_live_controls_01.json)
  still pass using the actual new WASM, including the release/retrigger click
  reduction, sample phase, public live setters and stale-note protection.

The new Native test initially compared the intentional manual ramp against raw
key-off at the transient boundary. Its settled-tail comparison uses the existing
256-frame guard; the deferred edit still compares all 512 frames against an
untouched manual reference exactly. Earlier failed logs are retained under
`/private/tmp/ps1-deferred-native-linked*.log`. No DSP change was made to satisfy
that test assumption.

## Calibration and distribution

New complete raw measurements are stored in
`ps1_chip_levels_deferred_release_01.json`,
`wonderswan_chip_levels_deferred_release_01.json` and
`pokey_chip_levels_deferred_release_01.json`. They retain exact current script,
served-source and WASM hashes. All 13 preceding raw reports remain byte-identical.
All pilots are continuous, stopped captures are exactly zero and these new
reports have no renderer-clock diagnostics. The calibration/history/Mixer suite
passes 494/494, both generator checks and actionlint pass.

PS1 remains `0.128832` and WonderSwan `1.172528`. POKEY is `0.413029` on all four
roles, a maximum decrease of about 0.00121% from the previous capture due to the
observed RMS phase variation. These values are derived from the new full matrix;
no manual gain or hash override is used.

Both Playground ZIPs pass CRC. The complete archive is 37,019,084 bytes, SHA256
`9d850ed4e46164fd3c13041ece7b0ee969e67d0f65212b986a501bdc975d6906`.
The Run archive is 37,411,511 bytes and 931 files, SHA256
`89c363698435a547a957ac37da1167c7e45c62a83c2d6a23286628f36164398a`.
Tauri imports its 1,066 nonmetadata frontend payloads, with the frontend lock and
new fixed-SDK candidate verified. Rebuild Tauri to use the new C++ and frontend.

The local npm build has 335 modules, 28 engines and 385 declarations. Its
1,004-file tarball passes isolated install, actual PCM, source/license and
NodeNext/Bundler/browser declaration checks. The tarball is 1,957,191 compressed
bytes and 7,419,275 unpacked bytes. No version is bumped or published.

[The actual Run ZIP browser report](ps1_deferred_release_run_browser_01.json)
passes WebKit Main and Worker. Both routes exercise the two unchecked RR edits
before manual key-off, retention of the old release, and adoption at the next
Note On. Existing live Release edits, graph/PCM controls, Keyboard, additional
SPU, reverb, Stop and recovery also pass. Every captured pilot is continuous.
Physical output stays muted; no human listening is claimed. See
[the structured record](ps1_deferred_release_01.json) for hashes and counts.

The first Emscripten build and calibration-server launch were blocked by sandbox
access and were rerun with required access. The calibration generation initially
omitted its required `--report` argument, then completed with the correct command.
None of those failed attempts was a successful validation, and no raw record was
edited to bypass a failure.

No commit, push, tag, remote CI or SDK/npm/itch publication is performed. Tauri
already had uncommitted changes at task start; they are retained.
