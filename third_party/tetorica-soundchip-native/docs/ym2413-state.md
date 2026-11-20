# YM2413 WASM checkpoint extension

Unpublished local source candidate based on the pinned SDK snapshot.
`ym2413_save_state(handle, output)` returns the byte count, or writes that many
bytes when output is non-null. `ym2413_load_state(handle, bytes, size)` returns
1 on success and 0 for invalid length/null data before changing state.

States are opaque same-build, same-configuration checkpoints, not a portable
file format. Use only bytes returned by this build; JS wrappers additionally
restrict reuse to their owning instance. The existing ymfm serializer saves
oscillator/feedback, Envelope/LFO/Noise, registers and pending bus address.
The wrapper additionally saves interface timer/IRQ fields and output mute mask.
No pointers, whole object storage, output buffer allocations or JS hooks are
snapshotted. Restore does not issue a chip reset or reapply key-on registers.

Test: `node tests/ym2413_state_wasm_smoke.mjs path/to/wasm-output` after
`sh scripts/build-wasm.sh ym2413 path/to/wasm-output`.
