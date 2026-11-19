# Reopen FM2608 audible release click — 2026-11-19

User still hears a click on keyboard release and sees the Saw startup dip.
The previous final-stop-edge, offline and eventual-silence checks did not
establish that the entire real browser release was click-free.

- [x] Capture continuous actual browser output before/during/after keyup,
  including audio-clock timing and ordinary/delayed MessagePort arrival.
- [x] Compare shipped Worklet behavior with the offline native test harness;
  distinguish the start of the fade, intermediate volume writes and final stop.
- [x] Recheck predictor startup / Repeat against primary core evidence before
  labelling the Saw shape a hardware compatibility bug. Do not hide actual
  decoded PCM or claim the unchanged nonzero first target can be exact.
- [x] Fix a demonstrated app timing/release issue without altering raw keyOff,
  other OPNA sources, authored state, or the shared core without evidence.
- [x] Add a regression that fails on the demonstrated case; report remaining
  audible uncertainty separately from numerical checks.

Do not make further unrelated codec changes on the strength of an ending-zero
measurement alone. No commit, staging, publication or permission flow is needed.

## Findings and narrow fix

- Both the user's localhost and `release/tetorica_fm2608_synth_dev_itch_0.1.2.zip`
  contained the preceding codec/guard changes. This was not explained by an old
  source package. Packaged HTML differs as expected due to rewritten paths.
- The main-thread guard sent193 separate absolute-time reservations. With3–5ms
  late delivery, part of the fade collapsed at one rendered frame;10ms or more
  could collapse it completely. The original offline harness delivered all
  messages before rendering, so it missed this actual-processor failure.
- Actual Chromium/WebKit continuous PCM: pausing the sender6ms after its first
  reservation collapsed194–195 writes at one frame and produced .064–.114
  jumps. Ordinary baseline runs did not demonstrate that delay. Even normal
  release had small .00005–.00060 steps at the first rounded volume-zero
  transition, before the final Stop. Testing only that Stop was insufficient.
- The primary Synth now sends one owner-scoped request to its dedicated
  `audio_worklet.js`. `adpcm_audio_receiver.js` starts and renders8ms on the
  receiving audio clock, with no Main timestamp stream. Physical volume stays
  zero after a soft Stop and is restored by a later gate/author volume write.
  Raw keyOff, saved volume, unrelated sources and queue owners are retained.
  Synchronous reference-song rendering keeps its original queue adapter.
- Level-only UI edits also unconditionally canceled the old tail. Removing
  that cancellation lets parameter edits update the receiver's current fade
  without moving its deadline. Real PCM/range replacement still retires it
  through the existing gate/memory observers. Native regressions cover both.
- Shared Worklets, native/WASM cores, SDK pins, codec and npm API are unchanged.
  The app processor's ordinary mixed FM/SSG/ADPCM rendering is sample-identical
  to the shared processor at44.1/48/96kHz, including timed/raw register writes,
  reset, range and clock changes; a permanent parity test guards the copy.
- Focused tests274/274 passed, including packaging. Actual app processor proof
  covers100 phase/rate/delivery-delay cases at0–30ms, preserving distinct fade
  frames. Prior failing proof is retained under
  `build/fm2608-release-click-20261119/delayed-worklet.json`; receiver-relative
  proof is `receiver-relative-worklet.json` in that directory.
- Continuous source and actual user-localhost recordings passed14/14 each
  across Chromium/WebKit, with0/6/15/30ms whole-request delays and Level/mute/
  retrigger checks. Each receiver fade is384frames at48kHz. The former large
  delayed cut is absent; small remaining steps up to about.00073 are not a
  claim of perceptual inaudibility. Evidence:
  `build/opna-release-pcm-20261119/final-after-level-fix/`.
- The user's original ZIP is retained. Fresh reviewed archive/log manifest:
  `build/fm2608-audio-release-20261119/final/package.json` and `tests.log`.
- Final source/actual extracted ZIP browser checker passed16/16 groups across
  Chromium/WebKit;113 non-HTML assets matched hashes, with no page/load errors.
  Receipts: `build/fm2608-audio-release-20261119/final-after-level-fix/browser-source.json`
  and `zip/browser.json` alongside it. Physical output was always muted.

## Hardware boundary and follow-up

Yamaha YM2608 Application Manual printedp44 specifies initial predictor0 and
step127. The first nibble can change the16-bit predictor by at most238, so an
unchanged Saw beginning at−0.6 cannot be reconstructed by its first sample.
The editor now labels its waveform as a first-pass decode; the running output
remains visible in the separate Waveform monitor. This is not a sample-address
offset fix. [Manufacturer manual scan](https://nemesis.hacking-cult.org/MegaDrive/Documentation/YM2608J.PDF).
Local transcription/provenance: `build/fm2608-core-audit-20261119/manual-evidence.txt`.

- [ ] Human listening on the reporting user's device: normal Sine key release
  after reloading the new app/ZIP. Quantized8-bit volume and short-envelope
  transients can remain. Do not close this by ending-zero measurements alone.
- [ ] Separately audit the pinned2022 ymfm ADPCM-B end/RESET/Repeat behavior
  against [hardware measurements](https://github.com/hyano/opna-analyze/blob/main/doc/OPNA.md)
  and [current MAME](https://github.com/mamedev/mame/blob/master/3rdparty/ymfm/src/ymfm_adpcm.cpp).
  Current hardware-backed findings differ in the last3nibbles and RESET/output
  holding behavior. A core update requires revalidating the existing tail-aware
  Sine encoding and Repeat scoring; it is not part of this host timing fix.
