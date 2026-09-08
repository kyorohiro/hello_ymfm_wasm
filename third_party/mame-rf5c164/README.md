# MAME RF5C164 adaptation

Source: https://github.com/mamedev/mame/blob/d0f1c15a0f6df2dd51a754cb46e6175b7079c8f2/src/devices/sound/rf5c68.cpp

Revision: `d0f1c15a0f6df2dd51a754cb46e6175b7079c8f2`
Authors: Olivier Galibert, Aaron Giles. License: BSD-3-Clause (see LICENSE).
The original source is retained in `upstream/rf5c68.cpp` for comparison.

`rf5c164.cpp` adapts the register and sample generation routines. MAME device,
address-space, stream, save-state and CPU callback infrastructure is removed.
RAM is a local 64 KiB array; only the RF5C164 16-bit output variant is exposed.
The host wrapper adds deterministic reset (registers and resampler; RAM kept),
explicit RAM clear/load, and a phase-preserving sample-and-hold resampler.
VGM does not execute a CPU or use the sample-end callback.
