# OKIM6295 ADPCM reference

`web/okim6295audioengine.js` is a JavaScript adaptation of the command handling,
ADPCM decoder and VGM bank mapping in these BSD-3-Clause sources:

- https://github.com/mamedev/mame/blob/master/src/devices/sound/okim6295.cpp
- https://github.com/mamedev/mame/blob/master/src/devices/sound/okiadpcm.cpp
- https://github.com/ValleyBell/libvgm/blob/master/emu/cores/okim6295.c

Copyright: Mirko Buffoni, Aaron Giles, Andrew Gardner. See LICENSE.
Adaptation: synchronous stereo Float32 output with held samples, persistent
fractional divider phase, VGM clock/pin7/bank controls. Muting advances voices.
No ROM or game data is included. ROM is supplied by VGM data block 0x8B.
