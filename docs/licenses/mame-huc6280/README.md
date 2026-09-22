# MAME HuC6280 adaptation

Source: https://github.com/mamedev/mame/blob/ad84df9d8a14c9f2bdd996b22d2832bcdb2e4f24/src/devices/sound/c6280.cpp
Revision: `ad84df9d8a14c9f2bdd996b22d2832bcdb2e4f24`.
Author: Charles MacDonald. License: BSD-3-Clause (LICENSE).
Original .cpp/.h retained under upstream/.

The six-channel wavetable, DDA, noise, LFO, balance and register logic comes
from MAME. Device/stream/save-state infrastructure is removed; the host sends
VGM-timed writes. The adapter adds deterministic cold reset, channel mutes
(which leave oscillator/LFO state advancing), and clock-rate sample averaging
to 44100 Hz with integer phase retained across render blocks. Signed LFO shifts
use multiplication to avoid undefined behavior. Reset retains host mute controls.
MAME's imperfect/unverified noise and LFO behavior is retained.
Only one HuC6280 is supported. No external ROM is required.
VGM stream channel selection follows libvgm emu/dac_control.c.
