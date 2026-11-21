# Nintendo DS 2SF playback experiment

This is a local test of 2SF and mini2SF playback through SkyEmu. It assembles
the cartridge image in memory from the selected track and its libraries. The
native test runs that image in SkyEmu and writes stereo PCM to a WAV. It uses
no audio device and requires no commercial music, ROM or original DS firmware.

Run from the repository root with Node 22+, Python 3.11+, CMake and a C
compiler. The experiment was verified on arm64 macOS.

```sh
sh scripts/nds-2sf/build_skyemu.sh
node --test scripts/nds-2sf/assemble.test.mjs
python3 scripts/nds-2sf/check_demo.py
```

The demo generates an original ARM7 program that starts a PCM16 loop while
ARM9 idles. Both mini2SF entries refer to one `demo.2sflib`. One entry
sets A4 on the left, the other sets E5 on the right. The check assembles and
boots each entry and measures its frequency and output on each side. Generated
files are kept under the ignored `build/nds-2sf/` directory.

At 48 kHz, the native renderer measured 440.035 Hz on the left and 659.511 Hz
on the right. Each output was 96,000 frames. On SkyEmu v5 the same input
measured 454.100 Hz and 680.581 Hz because the loop skipped its first
sample. The pinned revision advances the sample counter before wrapping.

A local user-supplied Chrono Trigger set also passed the first eight seconds
of four tracks: Presentiment, Chrono Trigger, Wind Scene and Corridors of Time.
All four resolved the same library and produced distinct non-silent stereo
PCM. This verifies startup and selection for that set. Listening, complete
tracks, loops and different game drivers still need verification. The input
set and its rendered files are local to the test workspace.

The same tools can test a local ROM-boot set.

```sh
node scripts/nds-2sf/assemble.mjs "/path/to/song.mini2sf" build/nds-2sf/song.nds
build/nds-2sf/render-skyemu build/nds-2sf/song.nds build/nds-2sf/song.wav 10
```

The optional third argument to `assemble.mjs` sets the folder that may
contain library files. It defaults to the selected entry's parent directory.
Use a larger set folder when tracks are nested and refer to a parent library.
The first experiment supports the ROM overlays and library order. It reports
unsupported state and driver options before writing a ROM. A WAV may still
be silent if the game driver fails to boot in SkyEmu or starts later than the
requested render duration.

The test uses the MIT [SkyEmu source at the pinned revision](https://github.com/skylersaleh/SkyEmu/tree/b64903f0fde8104d0796546b96859e9f682311b7).
The build verifies the source archive SHA-256 and retains upstream notices
for the BSD-2-Clause DS FreeBIOS and the MIT GBA replacement BIOS, ROM
database and libretro header. The 2SF assembly and test harness are Tetorica
BSD-3-Clause code.

## Local browser preview

With the verified SkyEmu archive in place, build the DS-only WASM and install
it for the [local Reference playback page](../../docs/synth-nitro-ds/README.md).
The browser shares the 2SF assembler with the CLI. The same DS-only module
runs in a Worker for 2SF and in an AudioWorklet for Keyboard, Code and paused
audition. Its source closure uses MIT SkyEmu, the MIT ROM database, and
BSD-2-Clause DS FreeBIOS. The build writes their notices alongside the WASM.

```sh
sh scripts/nds-2sf/build_skyemu_wasm.sh --preview
node scripts/nds-2sf/check_skyemu_wasm.mjs
node scripts/nds-2sf/check_browser.cjs
```

The checks verify Native and WASM PCM parity for two authored tracks and
verify that channel snapshots stay aligned at different render block sizes.
The PCM capture check rewrites a sample in ARM7 private WRAM and checks that
both the earlier snapshot and the new one retain their own bytes.
The browser check verifies loading, pitch, stereo balance, Live channel state,
Pause / Resume, Stop, recovery from a missing library, and the paused audition
and preset workflow with Chromium and WebKit output muted.

The WASM also exposes a CPU-free direct sound session. The parity checker
opens the same WASM in direct mode, copies the fixtures' PCM into main RAM
and writes their sound-channel registers. It compares the repeating stereo
sample values and the timing of each transition with the rendered 2SF and
checks that a pan write takes effect on the running channel. Production Synth
rendering uses the direct session's floating-point output with Tetorica's
software channel gain, note release and mixer Capture.
The browser check also loads the same WASM into an AudioWorklet at 48 kHz
and measures a note and a live pan change from host register writes.
The direct session can read channel registers and the running sample position.
PCM8 and PCM16 range updates write both bounds as a single operation. An
ADPCM sample loaded by the direct session can share a decoded table across
channels. The audio routine looks up the final predictor, index and loop
latch when it advances across many ADPCM samples in one output frame.
With a prepared table, live PNT/LEN edits within its bounds restore the
decoder state for the new loop. An overlapping RAM upload invalidates
the table and resumes incremental decoding from the current state.
The 2SF driver uses incremental decoding with live emulated RAM.

For a large upload, call `nds_synth_prepare_adpcm(offset, byteLength, frames)`
in separate steps before Key On. Each call decodes up to 16,384 frames and
returns 2 while more work remains, 1 when ready, or 0 for an invalid or
uncacheable range. The JavaScript wrapper returns a readiness boolean and
throws on failure. The audio budget checker measures both sustained
playback and preparation of a 1 MiB sample:

```sh
node scripts/nds-2sf/check_skyemu_audio_budget.mjs --blocks=1000
```

The Synth stages its own uploads in 16 KiB chunks, prepares up to 16,384
ADPCM frames per step and keeps every fourth predictor state. Lookups decode
up to three further samples. This fits sixteen 1 MiB playing samples and a
staged replacement in 34 MiB of decoder tables. The checker reports timings
for the same adapter and its floating-point output.

Pass `--wasm=PATH` to repeat the measurement with a baseline build. Pass
`--song=PATH` with its library accessible from `--set-root=DIR` to measure
2SF worker-size blocks. Timing is reported per machine rather than used as
a fixed test threshold. The standalone rebuild uses `patch` to apply
`skyemu_adpcm_cache.patch` to the pinned header in a temporary directory.

To compare the first eight seconds of each song in a local set, run the parity
checker with `--real-folder="/path/to/set"`. The supplied Chrono Trigger set
matched across all 71 tracks at 48 kHz. Give the browser checker the same flag
to check that it lists the set and can play a track. Both commands use temporary
output paths and leave the source set in place.

The format and compatibility notes are in the
[2SF author notes](https://github.com/soltune/procyon2sf/blob/main/docs/TECHNICAL.md).
The [Synth TODO](../../docs/issues/todo_nds_synth_20261121.md) tracks
verification and the remaining Native and 2SF compatibility work.
