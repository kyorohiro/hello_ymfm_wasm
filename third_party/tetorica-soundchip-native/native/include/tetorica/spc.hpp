#pragma once
// Reference C ABI for the complete SPC700 + accurate eight-voice S-DSP player.
// No ROM image, output device, metadata duration/fade, or tempo conversion is
// provided. Creation accepts 8000..384000 Hz and returns null on failure.
// The source runs at 32000 stereo frames/s with a 128-source-frame render
// buffer, two-frame prefetch, and integer-phase interpolation. A valid instance
// and its views belong to one thread; ordinary reads/rendering require valid
// nonnull instance/output pointers. Destroy accepts null.
//
// load_control copies a caller-validated SPC file (0x10180..16 MiB), resets the
// player, counters, observer, and resampler, and pauses. The file storage may be
// released after success. The mute mask is retained. Invalid input or a playback
// error latches failure; a successful load is required to recover. These
// control-only operations must never run on a core installed in a callback.
// seek_control advances the CURRENT CPU position by 0..16000 native frames per
// call, only while paused and not observing. It discards cached output and
// resets the output/resampler counters, adding the requested frames to the base
// counter. It is not an absolute seek: rendered lookahead is already advanced.
// For a target position, prepare a freshly loaded core with repeated seek calls.
//
// set_playing pauses/resumes without advancing or discarding buffered audio.
// set_mute_mask accepts 0..255; changes affect future DSP rendering, while
// already buffered/prefetched samples remain audible. Rendering and callback
// controls allocate no memory. State and DSP-register reads do not advance the
// player. native_frames includes CPU lookahead; playback_native_frames is
// base_native_frames + output_frames * 32000 / sample_rate, rather than the
// emulated CPU position. State is observation, not a restorable saved state.
//
// snapshot needs a caller-owned workspace of at least 0x10200 bytes and writes
// analysis fields: RAM is [0x100,0x10100) and DSP registers [0x10100,0x10180).
// Initialize the workspace first; the function does not create a file header or
// metadata. This is neither a complete SPC file nor exact CPU/DSP/resampler
// state for seamless restoration. Copied fields remain valid after rendering
// or destruction. observe accepts capacities 16..8192 and
// clears queued events/overflow when enabled or disabled. Event data is a
// borrowed stable allocation, valid until destruction; contents/count change on
// rendering, clear, load, and observer reconfiguration. Drain only while
// excluding mutation. events_clear clears the count; overflow_take separately
// returns and clears the saturated lost-event counter. Observer clocks are
// 1024000 Hz SPC clocks, including source-buffer lookahead, not output frames.
#include "native_genesis_spc.h"
