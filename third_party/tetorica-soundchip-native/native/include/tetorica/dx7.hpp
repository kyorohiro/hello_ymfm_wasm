#pragma once
// Reference C ABI for the scalar MSFA DX7 synthesizer. This is a 16-slot,
// six-operator FM instrument with a fixed 44.1 kHz source and mono output;
// sample returns one float for the requested output rate (8000..384000 Hz).
// Creation returns null for an unsupported rate or allocation failure. The
// instance owns its copied patch, 16 preallocated notes, filter, LFO, and
// resampler. Rendering and control operations allocate no memory. All instance
// operations belong to one thread; destroy also accepts null.
//
// voice copies exactly 155 validated, unpacked DX7 parameter bytes. The caller
// supplies a stable voice identity. live=false selects future-note parameters
// and shared LFO controls while existing notes retain operator parameters.
// live=true with the current identity edits matching held/releasing notes:
// operator output level/frequency and feedback apply live, shared LFO controls
// update, and other parameters apply to future notes. A different identity is
// a selection. Payload bytes and MIDI notes/velocities require host validation.
//
// note_on returns a slot 0..15, or -1 when all eligible slots are held. Released
// tails may be reused. note_on_mask excludes every bit-set slot, including free
// slots and released tails; hosts must maintain their own protected leases.
// release_slot starts release, and kill_slot stops future computation for one
// slot. Kill retains the already mixed block (up to 64 source frames), output
// prefetch, and shared filter tail. Slots outside 0..15 are ignored. panic
// clears every note and output/filter/resampler history for immediate silence,
// resets the allocator, and retains the selected voice. core_size reports the
// instance plus its 16 note objects, excluding allocator/runtime overhead.
#include "native_genesis_dx7.h"
