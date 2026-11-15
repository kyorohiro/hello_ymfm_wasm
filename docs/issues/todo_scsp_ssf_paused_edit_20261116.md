# SCSP live SSF channel parameter editing

Requested 2026-11-16: a paused SSF channel can be played on the keyboard but
its displayed Envelope / LFO controls are disabled. The user then requested
editing while playing too, and explicitly chose direct writes to the selected
SSF song channel. A later game-driver write may overwrite the manual value.

- [x] Add bounded live-register mutation to the SSF renderer / transport,
      separate from immutable observations and authored Synth drafts. Do not
      advance CPU time, drop queued audio or rewrite the source files / RAM.
- [x] Enable Envelope (including loop link), LFO and mix / pan controls for
      playing / paused song channels, including linked / Noise slots.
      Capture and independent audition restrictions remain separate.
- [x] Apply Envelope on subsequent preview notes, and LFO / mix to held
      preview notes. Use the independent audition core and keep owner fences,
      Click guard and selection / transport cancellation behavior.
- [x] Keep manual values visible until the affected rendered frames become
      audible; later driver snapshots take over. Preserve edits across paused
      CH / Reference changes. Resume continues the edited machine. Stop / seek /
      new song clears transient overlays. Capture includes displayed parameters.
- [x] Leave the PCM prefix, sample format / playback rate, linked-slot
      modulation and shared song DSP as observation data in this view.
      Full waveform editing remains available after Capture to Synth.
- [x] Verify raw snapshot / authored state / transport preservation, invalid
      edit atomicity, late-operation fencing, edited Capture and restoration
      through real WASM plus muted Chromium / WebKit standalone ZIP checks.

Native changes are limited to a bounded host-register write extension of the
owned Mednafen SSF wrapper / build overlay. No edits to pinned vendor originals
or shared MAME SCSP / npm APIs; no publication or extra AudioContext.

## Implementation / ownership

- SSF ABI3 adds validated masked writes for Envelope, LFO and Mix. Every
  native word/mask is validated before mutation; unrelated flags, DSP sends,
  returns and effect pan are retained. The source kit includes this overlay.
- Song transport fences edits by a per-run session. It neither advances the
  CPU nor drops queued audio. Changes take effect at the next render boundary.
  A bounded per-parameter journal holds requested values until a strictly
  later audible native-frame snapshot arrives, then follows driver writes.
- Pause retains edits across CH / Reference changes; a failed seek retains
  the old machine's overlays, while a successful new seek/run retires them.
  The old RAM/register observations remain immutable. Capture projects manual
  parameter words onto its click-time snapshot without changing PCM.
- Preview commands own generation tokens independent of song registers.
  A monotonic selection generation handles CH/reference A→B→A and Stop while
  a load ACK is pending. Unsupported edited captures invalidate the preview
  instead of replaying an unsafe/stale portable sample.
- Capture flushes parameter edits queued before its click and checks the
  native run identity, even when a replacement has the same path and position.
  The authored Synth changes only when Capture explicitly commits.

## Verification

- Full SCSP Synth / packaging suite: 198 passed. Runtime type check passed.
- Native/renderer/processor focused checks include live held sound, all32
  slots including Noise, invalid-patch atomicity, register masks, host-driver
  overwrite, source RAM, frame/phase and authored-state preservation.
- No-edit ABI2→ABI3 parity: four original fixtures ×88,200 frames, stereo
  Float32 PCM and complete snapshots/RAM byte-exact. Private reproducible
  evidence: `/private/tmp/tetorica-ssf-host-edit-R7ltLq/parity.mjs` and summary.
- The final 355-file ZIP passed Chromium/WebKit: new editing runner (8 groups
  each), Live (10), Capture (13), Channels (8), plus base Synth, Code and Click
  guard regressions. Physical output is intercepted at gain zero, one
  AudioContext per page, no page/asset failures; 390px UI inspected.
- Actual output: playing Pan15 moved centered L/R RMS≈0.00689/0.00689 to
  0/0.00689; amplitude LFO produced RMS≈0.00055–0.00553. Paused preview Mix/LFO
  changed held output; next-note AR changed onset/late energy ratio≈0.992→0.497.
  Frozen position, full PCM, authored patch/private drawing and edited Capture
  were retained, including delayed-load ABA and queued-edit/Capture races.
- Review ZIP: `/private/tmp/tetorica-scsp-ssf-edit-review-20261116/`.
  Final archive SHA-256:
  `6cb315f2b9fb6e24833b0f1b0752df5e5c8844398bec4bf9ccca5ecd8719f0b6`.
  Receipts: `/private/tmp/scsp-ssf-edit-zip{,-base,-code,-guard,-live,-capture,-channels}.json`.
  No release/tag/push performed; human listening remains a subjective check.
