# Tetorica SID Player

Open a supported `.sid` file, choose its subtune and press **Play**. The file stays in your browser. The four **Load demo** choices are original Tetorica test programs; no game music or C64 ROM image is included.

The player runs a tune's 6502 program and follows its writes to the SID. The three voice rows and shared filter display the running program's registers. Waveform and Spectrum show output after the software Master control. This screen plays music; use [SID Synth](https://kyorohiro.github.io/hello_ymfm_wasm/synth-sid/index.html) to edit an instrument or [Playground](https://kyorohiro.github.io/hello_ymfm_wasm/playground/index.html?mode=c64) to write your own register code.

## Supported files

This first version accepts a deliberately small PSID subset:

- PSID **v2**, one SID, explicitly **PAL** and **6581** in the header.
- All VBI speed bits zero, with unspecified relocation (`0/0`).
- Loaded program RAM `$0800..$CFFF`, with effective init and explicit nonzero play addresses inside that payload. An init header value of zero defaults to the load address.
- At most **65,660 bytes**, with one-based song selection from `1..songs` (up to 256).

The header's default song is selected on load. A failed file, demo or subtune change keeps the previous selection and sound. **Stop** cancels startup or resets playback; **Play** starts the selected song again from its init routine. Playback needs a browser with Web Audio and AudioWorklet, served over HTTPS or localhost. The output sample rate must be 8..96 kHz.

Cancelling a pending subtune change restores the accepted song in the selector. If the browser caches this page for Back/Forward navigation, leaving stops its audio while keeping the selected file; press **Play** after returning.

RSID, IRQ-installed drivers, CIA timing, NTSC, 8580, multiple SIDs and ROM-dependent tunes are outside this version. A valid header does not establish that a tune avoids unsupported devices. Execution can still stop with a diagnostic and address.

## What is emulated

The host combines the pinned, cycle-stepped **chips/m6502** CPU with Tetorica's existing **chips/m6581 6581 approximation**. One CPU bus cycle advances one SID tick at 985,248 Hz. SID writes commit after that cycle's audio step; supported SID reads use real emulated readback. `$D400..$D7FF` register mirrors are supported.

This is a bounded init/play host, not a complete C64. It supplies initialized RAM, a CPU stack and a host-owned JSR trampoline. Init receives the zero-based subtune in A; X and Y are zero. Play receives A, X and Y zero. Both routines must return normally with RTS. There is no ROM dump, KERNAL replacement, CIA timer, VIC raster timing or interrupt controller. Unsupported memory banking, mapped ROM reads, other I/O and invalid returns fail explicitly.

The initial memory map is `$37`. Before calling an init or play entry in loaded RAM at `$A000..$BFFF`, the host exposes that RAM if BASIC is mapped: it clears only LORAM (`$37` becomes `$36`), preserving SID I/O and the other bank bits. An already suitable map is kept. This selects RAM for the supplied program; it does not provide a BASIC ROM or permit ROM calls.

Init has a 100,000-cycle limit; each play routine has a 16,000-cycle limit. The first play call is at the first strict 19,656-cycle PAL frame boundary after init completes, then once per frame. Audio produced during init is retained. These absolute scheduling times are not claimed to match libsidplayfp's complete C64 driver.

The SID's existing 12 Hz software DC blocker remains on the output. The software Master runs from 0 to 380%; above 100% it turns orange. There is no hidden gain calibration or new filter algorithm. The player's separate WASM does not change the existing SID Synth, Playground SID core, fixed SDK or calibrated mixer levels.

## Read, modify and reuse

The application is distributed as readable source modules and CSS, with their comments and original layout. There is no minified runtime bundle.

- [player.js](player.js): file selection, transport and live display.
- [audio.js](audio.js) and [processor.js](processor.js): Web Audio lifecycle and AudioWorklet commands.
- [core.js](core.js): bounded WASM player API.
- [sid_psid.js](../js/sid_psid.js): browser-safe, bounded input parser, also shared by the Node comparison CLI.
- [Demo sources, provenance and license](demos/README.md).
- [Native source kit and rebuild guide](../sources/sid-player/README.md), including unchanged upstream CPU source, adapted SID source, patch documentation and licenses.

In a standalone ZIP, `sources/sid-player-browser.json` lists the original browser/build inputs with SHA-256 hashes and points to `sources/sid-player-browser-inputs.zip`. The native receipt is `generated/sid-player/sid-player-build.json`; its input hashes match `sources/sid-player/`, and its output hash identifies the packaged WASM. The canonical parser in the browser-input archive matches the served module byte for byte. The separate source archive retains the original HTML before navigation links are adjusted for the standalone package.

To rebuild the WASM from the included native source kit, use Node.js, Python 3 and Emscripten from `sources/sid-player/`:

```sh
sh scripts/build_sid_player_wasm.sh /tmp/tetorica-sid-player-rebuild
```

Copy the resulting `sid-player.wasm` and `sid-player-build.json` into `generated/sid-player/` when trying the rebuilt player. To run a standalone ZIP locally, extract it and run this from its root, then open `http://localhost:8000/`:

```sh
python3 -m http.server 8000
```

From the full Tetorica repository, validate current build/source copies and create a new package with:

```sh
node scripts/sid_player_artifacts.mjs --check
node --test test/sid_psid.test.mjs test/sid_psid_browser.test.mjs
node scripts/package_sid_player.mjs local-preview
```

Each package uses a new stage directory and refuses to overwrite an existing ZIP. No npm publication is required.

Tetorica's host, parser, UI and original demos use **BSD-3-Clause**. The pinned chips/m6502 and chips/m6581 components use **zlib/libpng**; their notices, pristine sources and SID patch history are included in the source kit. The GPL libsidplayfp comparison tool stays in the separate [reference CLI](https://kyorohiro.github.io/hello_ymfm_wasm/sid-reference.md); none of its code, binaries or ROM stubs is linked or packaged here. Music you open retains its own copyright and is not added to the distribution.
