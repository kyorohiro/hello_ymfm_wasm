# OKIM6295 ADPCM sources

[The JavaScript engine](../../reference/javascript/okim6295audioengine.js) is an adaptation of the command handling,
ADPCM decoder and VGM bank mapping in these BSD-3-Clause sources:

- https://github.com/mamedev/mame/blob/master/src/devices/sound/okim6295.cpp
- https://github.com/mamedev/mame/blob/master/src/devices/sound/okiadpcm.cpp
- https://github.com/ValleyBell/libvgm/blob/master/emu/cores/okim6295.c

Copyright: Mirko Buffoni, Aaron Giles, Andrew Gardner. See LICENSE.
Adaptation: synchronous stereo Float32 output with held samples, persistent
fractional divider phase, VGM clock/pin7/bank controls. Muting advances voices.
No ROM or game data is included. ROM is supplied by VGM data block 0x8B.

## Included upstream sources

- [MAME C++ decoder and headers](upstream/mame/), unchanged from official commit `9d8a6727a206fc822b8b69d67a51e6fd7dbf4d4b`: `okim6295.cpp`, `okim6295.h`, `okiadpcm.cpp`, and `okiadpcm.h`.
- [libvgm C decoder](upstream/libvgm/), unchanged from official commit `bad50c571db45b872304bdcd0603dd2214f0663e`: `okim6295.c`, `okiadpcm.c`, and `okiadpcm.h`.

Each collected file explicitly declares BSD-3-Clause. Preserve its copyright header and [LICENSE](LICENSE). Each upstream directory contains `snapshot-manifest.json` with original paths, full commit pins, and SHA-256 hashes. These independent snapshots do not establish the historical revisions used by the JavaScript adaptation.

## Collection boundary

The C/C++ files are upstream references, not new SDK Native/WASM integrations. MAME's files require its device framework, which is outside this chip snapshot. The libvgm integration headers, including `okim6295.h`, and support code without explicit license declarations are not redistributed; see the [upstream license discussion](https://github.com/ValleyBell/libvgm/issues/129) and the libvgm snapshot manifest's omitted dependencies.

The JavaScript engine does not build or link these C/C++ frameworks. Its existing standalone example and the SDK's current Native/WASM targets need none of the omitted files.
