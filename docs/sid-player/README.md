# Tetorica SID Player

Open a supported `.sid` file, choose its subtune and press **Play**. The file stays in your browser. **Load demo** offers four original PSID tests and an original RSID CIA-interrupt example. No game music or C64 ROM image is included.

The player runs a tune's 6502 program and follows its writes to the SID. The three voice rows and shared filter display the running program's registers. Waveform and Spectrum show output after the software Master control. This screen plays music; use [SID Synth](https://kyorohiro.github.io/hello_ymfm_wasm/synth-sid/index.html) to edit an instrument or [Playground](https://kyorohiro.github.io/hello_ymfm_wasm/playground/index.html?mode=c64) to write your own register code.

## Supported files

The PSID path chooses its backend from the selected subtune's speed bit:

- PSID **v2**, one SID and a **PAL / 6581** playback target. Unknown or either-standard/model flags require the visible **Use PAL / 6581** checkbox. Known NTSC or 8580 declarations remain unsupported even with the checkbox checked.
- VBI or CIA timing. A file may mix both timings; bit 31 applies to songs 32 through 256. Other songs' speed bits do not reject the selected song.
- Loaded program RAM `$0800..$CFFF`, with effective init and explicit nonzero play addresses inside that payload. An init header value of zero defaults to the load address.
- At most **65,660 bytes**, with one-based song selection from `1..songs` (up to 256).

PSID relocation metadata describes free RAM for the **player driver**, not a request to move the tune. `0/0` declares a clean file; `$FF/0` declares no free driver page. The VBI host accepts structurally valid relocation metadata, including `$FF/0`, because its caller does not use a driver page in that range. CIA playback needs one page: for an explicit free range, it selects the first page within `$0400..$9FFF` or `$C000..$CFFF`. A range with no such page, or `$FF/0`, is rejected for CIA. A range may extend across other memory areas if it still contains a usable page. Payload overlap, range overflow and inconsistent sentinel fields are rejected. The header, loaded payload and init/play addresses are preserved. See the [HVSC format specification, fields +78/+79](https://hvsc.c64.org/download/C64Music/DOCUMENTS/SID_file_format.txt).

The separate RSID path accepts **RSID v2**, one SID and a PAL / 6581 target:

- The reserved header load address, play address and speed fields must all be zero. RSID runs its own interrupt or continuous program; speed zero does **not** mean a host-scheduled VBI play call.
- The embedded little-endian load address must be at least `$07E8`. Payload RAM may extend through `$FFFF`, including physical RAM underneath ROM and I/O mappings. A non-BASIC init entry must be inside the payload at `$07E8..$9FFF` or `$C000..$CFFF`; a zero header init defaults to the load address.
- A BASIC flag requires a zero header init and the user-ROM environment. That zero requests BASIC startup, not a call to address zero.
- Unspecified or either-standard/model flags require the visible **Use PAL / 6581** checkbox. It starts unchecked. Known NTSC or 8580 declarations are rejected even with the checkbox checked.
- The same 65,660-byte file bound and one-based `1..songs` subtune selection apply. This version does not support additional SIDs, newer file versions or external MUS players.

The header's default song is selected on load. A failed file, demo or subtune change keeps the previous selection and sound. **Stop** cancels startup or resets playback; **Play** starts the selected song again from its init routine. Playback needs a browser with Web Audio and AudioWorklet, served over HTTPS or localhost. The output sample rate must be 8..96 kHz.

Cancelling a pending subtune change restores the accepted song in the selector. If the browser caches this page for Back/Forward navigation, leaving stops its audio while keeping the selected file; press **Play** after returning.

Header acceptance does not establish whole-song compatibility. Execution can still stop with a diagnostic and address. PSID still requires an explicit play subroutine; `playAddress=0` IRQ-installed drivers remain outside this subset. A dedicated 8580 model is under investigation; the current player does not substitute 6581 for a known 8580 declaration.

## Playback target and optional C64 ROM files

For an unspecified or either-standard/model **PSID or RSID**, open **Playback settings · PAL / 6581 & C64 ROMs**, check **Use PAL / 6581**, then press **Apply / retry SID**. You can retry the file that just failed without reopening it. Its original header and declared clock/model are retained; the selected playback target is shown separately.

The checkbox starts unchecked. The command-line reference parser still requires explicitly PAL / 6581 files; only the browser validator accepts these explicit target choices.

The environment and firmware controls in the same panel apply to **PSID CIA and RSID**, which use the C64 machine. **PSID VBI** uses its separate host and can load or retry without ROM files, even while draft firmware files are being read. A new CIA or RSID candidate in user-ROM mode waits for all three firmware files; accepted playback retains its own detached ROM snapshot. A failed candidate keeps the previous tune. Changing subtunes retains the accepted settings until you explicitly apply new ones.

**Built-in IRQ environment** supplies an original, limited BSD IRQ/NMI shim with the C64 devices. It runs without a Commodore ROM dump and can play programs that use the supported environment. Unsupported BASIC, KERNAL or character-ROM reads stop with an explanation. It is not a replacement for all C64 firmware.

**Use my C64 ROMs** accepts three files: Character **4,096 bytes**, BASIC **8,192 bytes** and KERNAL **8,192 bytes**. The browser checks their exact sizes and makes detached copies. Size checks do not identify the firmware or guarantee compatibility. ROM bytes remain in browser memory; they are not saved, uploaded or included in packages. No firmware is downloaded automatically. After booting the supplied machine, PSID CIA installs the original RAM init/play driver; RSID requests BASIC `RUN` or a machine-code `SYS` as appropriate. Firmware bytes themselves are not patched.

The user-ROM/BASIC path is experimental. Original synthetic test ROMs exercise its loading and subtune plumbing; compatibility with actual Commodore firmware and general BASIC tunes needs separate confirmation. Use the built-in RSID demo to try the ROM-free environment.

## What is emulated

Both PSID backends combine the pinned, cycle-stepped **chips/m6502** CPU with Tetorica's existing **chips/m6581 6581 approximation**. One CPU bus cycle advances one SID tick at 985,248 Hz. SID writes commit after that cycle's audio step; supported SID reads use real emulated readback. `$D400..$D7FF` register mirrors are supported.

The **PSID VBI** host supplies initialized RAM, the PAL identification byte `$02A6=1`, a CPU stack and a host-owned JSR trampoline. Init receives the zero-based subtune in A; X and Y are zero. Play receives A, X and Y zero. Both routines must return normally with RTS. This backend does not emulate CIA timers, VIC raster timing or an interrupt controller. Unsupported memory banking, mapped ROM reads, other I/O and invalid returns fail explicitly.

Before **every** init or play call, the host sets the bank from that entry address: `$37` below `$A000`, otherwise `$36` within the supported payload range ending at `$CFFF`. It does not inherit a bank left by the preceding routine. These maps keep SID I/O visible; they do not provide BASIC/KERNAL firmware or permit ROM calls.

Init has a 100,000-cycle limit; each play routine has a 16,000-cycle limit. These are this bounded host's limits, not limits imposed by the SID chip or PSID format. Timeout diagnostics distinguish initialization from play; a CPU JAM/KIL opcode has its own diagnostic. The first play call is at the first strict 19,656-cycle PAL frame boundary after init completes, then once per frame. Audio produced during init is retained. These absolute scheduling times are not claimed to match libsidplayfp's complete C64 driver.

An indexed `STA` to a SID register can first issue a discarded read on the preceding VIC mirror page. The VBI host recognizes only that exact CPU microcycle, with a verified corrected SID write address and a side-effect-free VIC register, and keeps its cycle timing. Mirrored collision registers `$1E/$1F` remain unsupported because reading them clears their latches. The exception does not turn a real `LDA` from VIC, CIA or ROM into a successful read, or emulate a VIC.

The **PSID CIA** backend instead clocks the continuous C64 machine, including both CIAs and VIC. An original RAM driver calls init with the zero-based subtune in A, then calls the explicit play routine from CIA1 timer-A interrupts. The initial latch is `$4025` (approximately 60 Hz on PAL), with the timer and its IRQ enabled. The tune can change its latch, control and interrupt mask; there is no host-periodic VBI substitute. Init and play must still return with RTS within their 100,000- and 16,000-machine-cycle bounds. The built-in environment supplies only limited original firmware; optional user-ROM mode boots the supplied firmware before installing the same RAM driver. Neither mode removes the PSID entry and RAM restrictions.

For clean `0/0` files the existing CIA driver layout remains unchanged. For an explicit free range, the original bootstrap, interrupt handlers and caller are packed into the selected page, including their branch targets and vectors. The browser validator returns `driverPage` (`null` for VBI, `0` for the clean-file layout); the C64 API reports the actual `driverAddress`. The VBI caller remains at `$0200..$0203`, outside the driver-page area, and still uses the CPU stack at `$0100..$01FF`. Accepting `$FF/0` does not prove compatibility with a program that overwrites that caller or stack. These host placements do not relocate or patch the music program.

The **RSID** host uses the same pinned **chips/c64** system wiring: CPU, both CIA chips, VIC, SID and memory banking advance together. IRQ and NMI reach the emulated CPU, and the program's RTI returns to the interrupted code. It runs the tune's own interrupt or continuous code without a host play-routine call. RSID programs may legitimately stay in an init busy loop, unlike the returning PSID init/play subroutines.

Both RSID environments perform a bounded 100,000-cycle preflight and retain its generated PCM. User-ROM mode first boots for at most 2,000,000 cycles and discards boot audio. Initialization that has not returned after preflight can continue during playback; it is not automatically treated as a failed PSID-style subroutine.

These devices and the SID remain approximations. The upstream C64 implementation has known CIA/VIC and interrupt/DMA limitations, so supported fixtures or individual tunes are not proof of complete C64 timing accuracy. Rendering, audio queues and diagnostic traces are bounded; Stop clears activity and output.

The current 6581 approximation does not reproduce **volume-DAC / D418-only digi sample playback**. A tune can execute correctly and write the volume register while that sampled part remains silent. RSID file support does not imply support for every SID sound technique or every HVSC tune.

The SID's existing 12 Hz software DC blocker remains on the output. The software Master runs from 0 to 380%; above 100% it turns orange. There is no hidden gain calibration or new filter algorithm. The two application-local WASM files do not change the existing SID Synth, Playground SID core, fixed SDK or calibrated mixer levels.

## Read, modify and reuse

The application is distributed as readable source modules and CSS, with their comments and original layout. There is no minified runtime bundle.

- [player.js](player.js): file selection, transport and live display.
- [audio.js](audio.js) and [processor.js](processor.js): Web Audio lifecycle and AudioWorklet commands.
- [core.js](core.js): bounded PSID VBI API.
- [rsid_core.js](rsid_core.js) and [roms.js](roms.js): continuous C64 API for RSID and PSID CIA, and in-memory firmware input checks.
- [sid_psid.js](../js/sid_psid.js): shared bounded PSID input module. Its `parsePsid()` entry retains the CLI's strict header requirements; `validateBrowserPsid()` selects the subtune's VBI/CIA timing, accepts explicit PAL/6581 choices for unknown/either declarations and preserves the original header. The reference CLI remains VBI-only.
- [sid_rsid.js](../js/sid_rsid.js): independent RSID parser with the same explicit browser target-selection policy. Neither browser validator overrides a known NTSC or 8580 declaration.
- [PSID demo sources and license](demos/README.md) and [RSID demo sources and license](demos/rsid/README.md).
- Separate [PSID VBI native source kit](../sources/sid-player/README.md) and [C64 / CIA / RSID native source kit](../sources/sid-rsid/README.md), with pinned upstream sources, original host/shim, SID patch documentation and licenses.

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
