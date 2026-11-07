# Tetorica adaptation

`upstream/m6581.h` is the unmodified original. `m6581.h` is produced by
`python3 scripts/prepare_sid_core.py`; `--check` verifies it without writing.
The original zlib notice is retained.

1. Use an integer rational sample clock (`tick_hz / sound_hz`), rather than
   rounding this ratio to sixteenths of a cycle. This avoids systematic output
   rate and pitch drift at 44.1/48/96 kHz. Per-cycle averaging is unchanged.
2. Correct a logical `&&` to bitwise `&` in the three-waveform combination,
   matching the two-waveform combination operations. Combined waveforms remain
   approximations, not measured 6581 DAC models.
3. Correct oscillator synchronization direction: voice 3 resets voice 1,
   voice 1 resets voice 2, and voice 2 resets voice 3. Preserve simultaneous
   sync-source suppression. Ring modulation already reads the preceding voice.
4. Clear the oscillator's rising-edge flag on every cycle, including TEST-held
   cycles. A TEST write coinciding with an MSB rise must not keep resetting the
   sync target on every subsequent cycle.
5. Keep the Attack counter within its physical 8-bit range. A rapid release /
   attack transition at 255 wraps to zero and freezes, rather than producing an
   envelope above 255 and unintended extra gain. This remains a simplified
   envelope implementation, without all cycle-level state-transition delays.

6. The C++ host initializes the shared cutoff table once through a thread-safe
   local static guard. Subsequent instance construction/reset does not rewrite
   data read by another instance. The fallback C header path retains upstream
   initialization behavior; the supplied Native/WASM host is C++17.

The wrapper also applies a **software 12 Hz DC blocker** after the core's mono
output. It is a host output stage, not an extra programmable SID filter.
Register reads/writes each consume one emulated clock cycle. Samples generated
during those accesses are queued and returned by the next render, not dropped.

This first implementation targets **6581 only**. The upstream filter is a
simplified digital model. It does not reproduce the analog variation between
individual 6581 chips, 8580 behavior, or all combined-waveform/noise interactions.
