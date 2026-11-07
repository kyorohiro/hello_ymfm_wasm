# Tetorica SID Player

Open a supported `.sid` file, choose its subtune and press **Play**. The file stays in your browser. **Load demo** offers four original PSID tests and an original RSID CIA-interrupt example. No game music or C64 ROM image is included.

The player runs a tune's 6502 program and follows its writes to the SID. The three voice rows and shared filter display the running program's registers. Waveform and Spectrum show output after the software Master control. This screen plays music; use [SID Synth](https://kyorohiro.github.io/hello_ymfm_wasm/synth-sid/index.html) to edit an instrument or [Playground](https://kyorohiro.github.io/hello_ymfm_wasm/playground/index.html?mode=c64) to write your own register code.

## Supported files

The PSID path preserves the existing bounded init/play host:

- PSID **v2**, one SID and a **PAL / 6581** playback target. Unknown or either-standard/model flags require the visible **Use PAL / 6581** checkbox. Known NTSC or 8580 declarations remain unsupported even with the checkbox checked.
- All VBI speed bits zero, with unspecified relocation (`0/0`).
- Loaded program RAM `$0800..$CFFF`, with effective init and explicit nonzero play addresses inside that payload. An init header value of zero defaults to the load address.
- At most **65,660 bytes**, with one-based song selection from `1..songs` (up to 256).

The separate RSID path accepts **RSID v2**, one SID and a PAL / 6581 target:

- The reserved header load address, play address and speed fields must all be zero. RSID runs its own interrupt or continuous program; speed zero does **not** mean a host-scheduled VBI play call.
- The embedded little-endian load address must be at least `$07E8`. Payload RAM may extend through `$FFFF`, including physical RAM underneath ROM and I/O mappings. A non-BASIC init entry must be inside the payload at `$07E8..$9FFF` or `$C000..$CFFF`; a zero header init defaults to the load address.
- A BASIC flag requires a zero header init and the user-ROM environment. That zero requests BASIC startup, not a call to address zero.
- Unspecified or either-standard/model flags require the visible **Use PAL / 6581** checkbox. It starts unchecked. Known NTSC or 8580 declarations are rejected even with the checkbox checked.
- The same 65,660-byte file bound and one-based `1..songs` subtune selection apply. This version does not support additional SIDs, newer file versions or external MUS players.

The header's default song is selected on load. A failed file, demo or subtune change keeps the previous selection and sound. **Stop** cancels startup or resets playback; **Play** starts the selected song again from its init routine. Playback needs a browser with Web Audio and AudioWorklet, served over HTTPS or localhost. The output sample rate must be 8..96 kHz.

Cancelling a pending subtune change restores the accepted song in the selector. If the browser caches this page for Back/Forward navigation, leaving stops its audio while keeping the selected file; press **Play** after returning.

Header acceptance does not establish whole-song compatibility. Execution can still stop with a diagnostic and address. The PSID path continues to reject IRQ-only and CIA drivers; those limits have not been silently relaxed by adding RSID.

## Playback target and optional RSID ROM files

For an unspecified or either-standard/model **PSID or RSID**, open **Playback settings · PAL / 6581 & RSID ROMs**, check **Use PAL / 6581**, then press **Apply / retry SID**. You can retry the file that just failed without reopening it. Its original header and declared clock/model are retained; the selected playback target is shown separately.

The checkbox starts unchecked. The command-line reference parser still requires explicitly PAL / 6581 files; only the browser validator accepts these explicit target choices.

The RSID environment and firmware controls in the same panel apply to **RSID only**. PSID can load and retry without ROM files, even while draft RSID ROM files are being read. A failed candidate keeps the previous tune. Changing subtunes retains the accepted target and ROM snapshot until you explicitly apply new settings.

**Built-in IRQ environment** supplies an original, limited BSD IRQ/NMI shim with the C64 devices. It runs without a Commodore ROM dump and can play programs that use the supported environment. Unsupported BASIC, KERNAL or character-ROM reads stop with an explanation. It is not a replacement for all C64 firmware.

**Use my C64 ROMs** accepts three files: Character **4,096 bytes**, BASIC **8,192 bytes** and KERNAL **8,192 bytes**. The browser checks their exact sizes and makes detached copies. Size checks do not identify the firmware or guarantee compatibility. ROM bytes remain in browser memory; they are not saved, uploaded or included in packages. No firmware is downloaded automatically. The loader boots the supplied machine before loading the tune and requesting BASIC `RUN` or a machine-code `SYS`.

The user-ROM/BASIC path is experimental. Original synthetic test ROMs can exercise its loading and subtune plumbing, but playback with actual Commodore firmware and general BASIC tunes has not been verified. Use the built-in RSID demo to try the ROM-free environment.

## What is emulated

The PSID host combines the pinned, cycle-stepped **chips/m6502** CPU with Tetorica's existing **chips/m6581 6581 approximation**. One CPU bus cycle advances one SID tick at 985,248 Hz. SID writes commit after that cycle's audio step; supported SID reads use real emulated readback. `$D400..$D7FF` register mirrors are supported.

The **PSID** host supplies initialized RAM, a CPU stack and a host-owned JSR trampoline. Init receives the zero-based subtune in A; X and Y are zero. Play receives A, X and Y zero. Both routines must return normally with RTS. It does not emulate CIA timers, VIC raster timing or an interrupt controller. Unsupported memory banking, mapped ROM reads, other I/O and invalid returns fail explicitly.

The initial memory map is `$37`. Before calling an init or play entry in loaded RAM at `$A000..$BFFF`, the host exposes that RAM if BASIC is mapped: it clears only LORAM (`$37` becomes `$36`), preserving SID I/O and the other bank bits. An already suitable map is kept. This selects RAM for the supplied program; it does not provide a BASIC ROM or permit ROM calls.

Init has a 100,000-cycle limit; each play routine has a 16,000-cycle limit. The first play call is at the first strict 19,656-cycle PAL frame boundary after init completes, then once per frame. Audio produced during init is retained. These absolute scheduling times are not claimed to match libsidplayfp's complete C64 driver.

The **RSID** host instead uses pinned **chips/c64** system wiring: CPU, both CIA chips, VIC, SID and memory banking advance together. IRQ and NMI reach the emulated CPU, and the program's RTI returns to the interrupted code. There is no periodic host play-routine call. Programs may legitimately stay in an init busy loop. The built-in and user-ROM environments are distinct from the PSID trampoline and its per-subroutine budgets.

Both RSID environments perform a bounded 100,000-cycle preflight and retain its generated PCM. User-ROM mode first boots for at most 2,000,000 cycles and discards boot audio. Initialization that has not returned after preflight can continue during playback; it is not automatically treated as a failed PSID-style subroutine.

These devices and the SID remain approximations. The upstream C64 implementation has known CIA/VIC and interrupt/DMA limitations, so supported fixtures or individual tunes are not proof of complete C64 timing accuracy. Rendering, audio queues and diagnostic traces are bounded; Stop clears activity and output.

The current 6581 approximation does not reproduce **volume-DAC / D418-only digi sample playback**. A tune can execute correctly and write the volume register while that sampled part remains silent. RSID file support does not imply support for every SID sound technique or every HVSC tune.

The SID's existing 12 Hz software DC blocker remains on the output. The software Master runs from 0 to 380%; above 100% it turns orange. There is no hidden gain calibration or new filter algorithm. The two application-local WASM files do not change the existing SID Synth, Playground SID core, fixed SDK or calibrated mixer levels.

## Read, modify and reuse

The application is distributed as readable source modules and CSS, with their comments and original layout. There is no minified runtime bundle.

- [player.js](player.js): file selection, transport and live display.
- [audio.js](audio.js) and [processor.js](processor.js): Web Audio lifecycle and AudioWorklet commands.
- [core.js](core.js): existing bounded PSID API.
- [rsid_core.js](rsid_core.js) and [roms.js](roms.js): C64 RSID API and in-memory firmware input checks.
- [sid_psid.js](../js/sid_psid.js): shared bounded PSID input module. Its `parsePsid()` entry retains the CLI's strict header requirements; `validateBrowserPsid()` accepts explicit PAL/6581 choices for unknown/either declarations and preserves the original header.
- [sid_rsid.js](../js/sid_rsid.js): independent RSID parser with the same explicit browser target-selection policy. Neither browser validator overrides a known NTSC or 8580 declaration.
- [PSID demo sources and license](demos/README.md) and [RSID demo sources and license](demos/rsid/README.md).
- Separate [PSID native source kit](../sources/sid-player/README.md) and [RSID native source kit](../sources/sid-rsid/README.md), with pinned upstream sources, original host/shim, SID patch documentation and licenses.

In a standalone ZIP, `sources/sid-player-browser.json` lists the original browser/build inputs with SHA-256 hashes and points to `sources/sid-player-browser-inputs.zip`. The native receipts are `generated/sid-player/sid-player-build.json` and `generated/sid-rsid/sid-rsid-build.json`; their input hashes match their respective source kits, and their output hashes identify each packaged WASM. Both canonical parsers in the browser-input archive match the served modules byte for byte. The source archive retains the original HTML before standalone navigation adjustments. Only fixed source/demo inputs are copied: user-selected ROMs and songs are never package inputs.

Use Node.js, Python 3 and Emscripten to rebuild from the respective native source kit. From `sources/sid-player/`:

```sh
sh scripts/build_sid_player_wasm.sh /tmp/tetorica-sid-player-rebuild
```

From `sources/sid-rsid/`:

```sh
sh scripts/build_sid_rsid_wasm.sh /tmp/tetorica-sid-rsid-rebuild
```

Copy the resulting WASM and build receipt into the matching `generated/sid-player/` or `generated/sid-rsid/` directory when trying a rebuild. To run a standalone ZIP locally, extract it and run this from its root, then open `http://localhost:8000/`:

```sh
python3 -m http.server 8000
```

From the full Tetorica repository, validate current build/source copies and create a new package with:

```sh
node scripts/sid_player_artifacts.mjs --check
node scripts/sid_rsid_artifacts.mjs --check
node --test test/sid_psid.test.mjs test/sid_psid_browser.test.mjs test/sid_rsid.test.mjs
node scripts/package_sid_player.mjs local-preview
```

Each package uses a new stage directory and refuses to overwrite an existing ZIP. No npm publication is required.

Tetorica's hosts, original IRQ/NMI shim, parsers, UI and original demos use **BSD-3-Clause**. The pinned chips CPU/CIA/VIC/C64/SID components use **zlib/libpng**; their notices, pristine sources and SID patch history are included in the source kits. The GPL libsidplayfp comparison tool stays in the separate [reference CLI](https://kyorohiro.github.io/hello_ymfm_wasm/sid-reference.md); none of its code, binaries or ROM stubs is linked or packaged here. Songs and firmware you open retain their own rights and are not added to the distribution.
