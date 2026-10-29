# SPU Synth: envelope, waveform, spectrum and Pitch

Date: 2026-10-29

## Behaviour

The top instrument display switches between **Envelope**, **Waveform** and
**Spectrum**, with a vertical ±2-semitone **Pitch** wheel beside every view.
The existing editable ADSR graph is moved into Envelope; the numeric controls
remain in the ADSR card. Its illustrative stage axis is separate from the
measured output RMS history underneath it.

Waveform and Spectrum observe the real output after Master volume through
one passive AnalyserNode branch. The analyser never connects to the speakers,
does not send audio-processor commands, and reuses its sample buffers. Drawing
and measurements run at up to 30 frames per second while notes or tails are
active. Silence, page visibility and Stop suspend updates. Master and live
parameter changes can wake measurement of a release tail without acquiring
a keyboard voice or restarting a note.

Pitch continues to use the common instrument command, bending held notes and
release tails without retriggering. Its pointer release returns it to centre.
The shared Playground editor, SPU core, generated WASM and Native backend are
unchanged by this display work.

## Validation

`npm run test:spu-synth` passes **36 tests**, including actual WASM playback,
instrument files, round-robin ownership, passive analysis, measured levels,
frame limiting under repeated parameter events, quiet-tail wake, visibility
and immediate Stop. The package test builds only an isolated temporary test
artifact; it does not update the release ZIP.

The final source UI verification passes Chromium 153.0.8010.12 and WebKit
26.6: real output RMS follows Master, Spectrum has the expected fundamental,
mode changes send no gate/sample commands, idle and Stop produce no analyser
polling, Pitch works with an actual pointer gesture, and all three modes fit
1440px and 390px layouts. The existing PCM/ADSR/reverb, keyboard, file import,
preset and recovery regressions also pass. Physical audio output is muted;
these are automated PCM and UI checks, not human listening. Each browser
captured 344,064 frames across 33 captures with continuous pilots and callback
clocks, and no clock anomalies. The RR31 release → Master mute → measurement
sleep → Master unmute case resumes both audio and display without Note On.

One intermediate WebKit check treated setup edits as already idle inside the
documented 400 ms quiet-tail window. The checker now lets that window finish
before asserting zero reads over a further 250 ms. The strict idle assertion
is unchanged; the final run passes both engines.

- [Initial source browser report](spu_synth_monitor_source_browser_01.json)
- [Final source browser report](spu_synth_monitor_source_browser_02.json)
- [Intermediate test-precondition failure note](spu_synth_monitor_wake_idle_precondition_01.json)

## Release status

Update: the supplied icon has been integrated and the release ZIP is verified;
see [icon and release work](spu_synth_icon_release_01.md). The following records
the earlier pause before that asset was supplied.

The user is making the icon and explicitly requested waiting before final
colours. The present palette is provisional. Icon integration, final colours,
the new release ZIP and distribution verification remain pending that asset.
The earlier round-robin release ZIP and its reports are retained unchanged.
No commit, push, tag or publication has been performed for this display work.
