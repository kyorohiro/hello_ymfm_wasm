# YM2612 Synth JavaScript authoring

Started 2026-11-14. Exercise the existing Synth through JavaScript while adding
features and correcting mismatches found through real use. Future Synth work
can reuse the resulting controls and APIs.

- [ ] Check the normal Code entry point and the current YM2612 client against
      its types, completion and existing audio controls.
- [ ] Exercise a beat-based melody alongside a separate timbre/modulation
      loop, including live knob edits, BPM changes, Apply and Stop.
- [ ] Add a focused improvement justified by the findings and a reusable
      example that can run in the Synth's existing Files/Code workflow.
- [ ] Verify the affected unit/type checks and actual browser operation,
      then record results and the next concrete authoring task.

The selected first scenario is an implementation choice based on the user's
previous melody/modulation examples. The user has not specified the next new
chip Synth yet. Existing S-DSP working changes are outside this task.
