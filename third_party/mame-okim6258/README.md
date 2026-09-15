# MAME OKIM6258 adaptation

Core source: https://github.com/mamedev/mame/blob/70743c6fb2602a5c2666c679b618706eabfca2ad/src/devices/sound/okim6258.cpp
Revision: `70743c6fb2602a5c2666c679b618706eabfca2ad`.
Author: Barry Rodewald. License: BSD-3-Clause (LICENSE).
Original .cpp/.h retained under upstream/.

The difference table and ADPCM decoding are adapted from MAME. Device, stream,
CPU and save-state infrastructure is removed; the host delivers VGM-timed writes.
Control/data behavior follows MAME (a data write resets the nibble selector;
missing data repeats the latch). Signed output scaling uses multiplication to
avoid shifting a negative integer. The host adds deterministic reset, fractional
sample-and-hold resampling, and VGM pan/clock/divider registers (2, 8–12).
4-bit ADPCM only; 3-bit and recording remain unsupported, as in this upstream.
No sample ROM is needed. VGM carries the ADPCM bytes.

Preceding project and reference review:
https://github.com/h1romas4/libymfm.wasm/blob/bb006894793c573b33a79a211e2769d021556aec/src/rust/sound/chip_okim6258.rs
Hiromasa Tanaka's BSD-3-Clause Rust port identifies the same MAME revision.
Our C++ adaptation takes decoder code directly from MAME; the Rust port was
reviewed as a reference and is not copied here.
VGM register mapping/header flag reference:
https://github.com/ValleyBell/libvgm/blob/master/emu/cores/okim6258.c
https://github.com/ValleyBell/libvgm/blob/master/player/vgmplayer.cpp
These mapping references are not the decoder source used by this adaptation.
