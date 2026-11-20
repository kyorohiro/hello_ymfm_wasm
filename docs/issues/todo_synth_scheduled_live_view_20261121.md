# Scheduled performance Live UI — next phase

Record the execution of timed operations in the Synth UI without coupling audio
timing to display updates. Start with ST YM2149, then evaluate other Synths.
This phase is deferred; no runtime implementation is authorized by this TODO.

## Existing behavior

ST coalesces synchronous instrument notifications in a microtask and pending UI
draw requests in requestAnimationFrame. Reference playback normally emits state
at most every 50 ms (20 Hz); explicit transport actions may notify immediately.
The shared output visualizer has a 30 fps limiter. These controls do not yet
provide renderer-state polling for scheduled-performance Live UI.

## Work

- [ ] Keep build/compile inspection-only. Show execution state for schedule,
      separate from the saved/editable preset and client-side register shadow.
- [ ] Refresh only visible controls for the selected chip/channel/tab. Suspend
      state polling when the relevant panel is hidden/collapsed, Live is off or
      the page is in the background. Refresh once when it becomes visible.
- [ ] Use a bounded display cadence (initial candidate: 10–20 Hz), independent
      of audio scheduling rate. Keep only the latest state; skip missed display
      ticks rather than enqueueing them. Allow only one outstanding renderer
      snapshot request per chip; discard late replies after view/owner changes.
- [ ] Read one suitable chip snapshot per display tick and share it between
      visible consumers; avoid a state request per control or register write.
      Update DOM values only when changed, and keep drawing requests coalesced.
- [ ] Keep controls usable during Live display: do not overwrite a control
      while it is being dragged/edited. Retain actual last-write-wins audio
      semantics and existing Run/Apply/Stop/reservation ownership rules.
- [ ] Provide a Live display On/Off control; evaluate a slower cadence option
      after measuring the initial implementation. No per-event animation or
      highlighting is required for this phase.
- [ ] Measure state requests, outstanding requests, DOM updates and main-thread
      cost with fast repeating schedules. Verify hidden/collapsed/background
      suspension, stale replies, view changes, manual editing and unchanged
      audio timing at 44.1/48 kHz in Chromium/WebKit with physical output muted.

A single-chip prototype is small; reliable visibility handling, asynchronous
state ownership and cross-Synth rollout need a separate implementation slice.
