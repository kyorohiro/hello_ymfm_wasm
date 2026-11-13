# SPU Synth: manual controls during PSF playback

- [x] Inspect the CPU/SPU boundary and preserve ordinary playback bit-for-bit
      when no manual input is present.
- [x] Add unclocked, validated selected-channel edits to the existing PSF SPU:
      voice volume, ADSR and keyboard/Pitch. Preserve sample RAM, Start/Repeat,
      PMON dependencies, shared Noise/reverb and the other 23 voices.
- [x] Track later CPU writes independently of diagnostic traces. A newer PSF
      gate/pitch owner must survive an older keyboard release or Pitch reset.
- [x] Keep the PSF playing while using supported controls and the selected CH
      keyboard. Preserve Live observations, channel monitoring, Pause/Resume,
      Capture, Seek, source switching and Code/PSF exclusivity.
- [x] Keep unsupported sample/topology/shared-effect editing explicit; do not
      quietly stop the song or apply a whole stale observation to the chip.
- [x] Verify native PCM non-intervention, focused register changes, ownership,
      stale async work and lifecycle behavior in Node and muted Chromium/WebKit.
- [x] Package readable sources, update the guide and record verification.

## Scope

Start with selected physical CH volume, ADSR, keys and Pitch, using the running
PSF machine rather than another synthesizer. Manual actions reach the next
unrendered boundary and retain bounded playback lookahead; do not discard or
rerender scheduled PCM. PSF and Code stay mutually exclusive. Existing paused
audition/capture and the authored bank remain independent.

Shared Reverb/Noise/PMON editing and paired keyboard audition can be considered
after this slice. No physical audio, commit, push or publication during this work.

## Verification

The implementation uses the existing song machine and exposes selected-channel
PITCH and signed L/R volume beside the existing ADSR panel. Sparse edits read
the current native register state; source ownership is independent of the
diagnostic trace. Source memory and shared effect controls remain disabled.
Synth view keeps its separate authored bank and keyboard while the song plays.

- Node: 393 tests pass, including actual WASM, queued PCM preservation,
  source ownership, stale asynchronous work, transport and source packaging.
- ABI 4 vs ABI 5: 10 profiles / 655,360 mono PCM samples, all registers and
  complete 512 KiB SPU RAM match exactly without manual input.
- New same-machine manual UI check: nine groups each in muted Chromium and
  WebKit, including CPU takeover, Pause/Resume, Seek/Capture, Code handoff,
  authored Synth separation and desktop/mobile controls.
- The cold Code-to-PSF handoff loads trusted WASM through a captured host loader
  without weakening the running user-code network guard.
- Legacy playback, Live/monitor, paused audition, Capture, Seek and Code checks
  also pass in both browsers: 122 groups, plus the 18 manual groups above.
  Capture assertions now follow the existing preset-import behavior that keeps
  Code running and explicitly verify the restored authored RAM after Code Stop.
- Final distribution: all 344 ZIP files match the stage; original live modules
  and the generated native WASM match the working sources.
- [Verification receipt](verification_spu_synth_psf_manual_20261113.json).
  Detailed logs and muted screenshots: `build/verification/spu-psf-manual-20261113/`.

No physical listening, commit, push, tag or publication was performed.
