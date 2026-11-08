# Tetorica SID Player

Open a supported `.sid` file, choose its subtune and press **Play**. The file stays in your browser. **Load demo** offers four original PSID tests and an original RSID CIA-interrupt example. No game music or C64 ROM image is included.

**SID model** defaults to **Auto · file**: declared 6581 files use the existing 6581 core, and declared 8580 files use the **8580 Preview** core. The original declaration and selected target are shown separately. Changing the model checks the latest file again; successful changes require **Play**.

The player runs a tune's 6502 program and follows its writes to the SID. The three voice rows and shared filter display the running program's registers. Waveform and Spectrum show output after the software Master control. Capture a supported voice's current settings for [SID Synth](https://kyorohiro.github.io/hello_ymfm_wasm/synth-sid/index.html), or use [Playground](https://kyorohiro.github.io/hello_ymfm_wasm/playground/index.html?mode=c64) to write your own register code.

## Capture a voice for SID Synth

1. Load a tune and press **Play**.
2. Open **Voice snapshot → SID Synth** and choose Voice 1, 2 or 3.
3. Press **Capture now** when the sound you want is playing.
4. Use **Save preset** to download the selected voice's JSON. In SID Synth,
   open **Preset · save, load and JavaScript** and choose **Load preset…**.
   When both pages share an origin, **Open in SID Synth** transfers the preset
   directly; enable audio or play a key there to audition it.

Capture reads the running AudioWorklet at the click, rather than reusing a
potentially older display update. The captured batch stays fixed while the tune
continues; choosing another voice inspects that same moment. Capture again for a
later moment. Stop, load/subtune/model changes and late reads cannot replace an
accepted snapshot with an obsolete result. Capturing sends no register writes,
does not stop the tune and never copies its program or audio.

The preset retains the running **6581 / 8580 Preview** model, one Triangle,
Saw, Pulse or Noise waveform, Pulse width, hardware ADSR codes and shared
Cutoff / Resonance / chip volume. Whether the selected voice is routed through
the filter controls the Synth's filter enable state. Combined LP / BP / HP
outputs are retained. A voice routed into an all-off filter is unavailable
because the Synth's all-off convenience bypass would change that silent case.
Combined carrier waveforms, held TEST and a muted voice-3 dry path show reasons
instead of silently replacing those settings.

Selecting a carrier with **Sync / Ring** automatically captures a supported
isolated pair. The SID connection is the preceding oscillator: voice 3 → 1,
1 → 2 or 2 → 3. Capture retains the carrier's Sync / Ring flags and the
unrounded ratio of source frequency register to carrier frequency register,
within **0.125×..8×**. The preview identifies the original connection and ratio.
Carrier ADSR, waveform, Pulse width, model and filter settings stay the same.

In the Synth, every imported pair uses **silent Triangle oscillator 3 → carrier
1**, with one keyboard note. SID Sync / Ring uses oscillator phase rather than
the source's audible waveform or envelope, so that oscillator supplies the
captured relative tuning. The current **6581 approximation** changes phase when
the source has no waveform selected, so that case is unavailable for pair
import; an **8580** source with no waveform selected remains supported.
The original source's audible song part and the third voice are not
copied. Ring affects Triangle carriers; Sync can also affect other supported
carrier waveforms. Captured oscillator phases are not restored.

Pairs with a held carrier/source TEST, a zero carrier/source frequency or an
out-of-range ratio remain unavailable. Sync / Ring on the source or third
oscillator indicates a three-voice chain or cycle and is rejected with a reason;
capture does not silently reduce that graph to a two-voice pair.

This is an **instantaneous register snapshot**, not a recovered song instrument.
The Synth follows its keyboard pitch and starts a fresh Gate / ADSR attack;
original musical pitch, oscillator / envelope phase, elapsed Envelope, noise
state and later software automation are not restored. A released Gate may still
be captured, with that restarted-note behavior disclosed. Pair modulation keeps
its frequency ratio as keyboard pitch changes. Unavailable Envelope
values in 8580 remain unknown, rather than being interpreted as zero.

The direct handoff stores only a validated preset under a temporary random key
on the same browser origin. It expires after five minutes and is consumed when
the explicitly requested Synth page loads; the URL carries the key, not song,
firmware or preset contents. It does not start an audio device. A standalone
Player ZIP links to the published Synth on another origin, so use **Save preset**
and **Load preset…** there. This file workflow also works when browser storage
is unavailable. No automatic cross-origin transfer is attempted.

## Supported files

PSID uses the selected subtune's original speed bit. VBI defaults to the C64 machine's raster interrupt; CIA uses its timer interrupt. **Direct VBI** keeps the earlier bounded subroutine host as an explicit compatibility option.

- PSID **v2**, one SID and a **PAL / 6581 or 8580 Preview** playback target. Unknown or either-standard/model flags use PAL / 6581 by default; selecting 8580 chooses that model for an unspecified/either declaration. Known NTSC remains unsupported.
- VBI or CIA timing. A file may mix both timings; bit 31 applies to songs 32 through 256. Other songs' speed bits do not reject the selected song.
- Loaded program RAM `$0800..$CFFF`, with effective init and explicit nonzero play addresses inside that payload. An init header value of zero defaults to the load address.
- At most **65,660 bytes**, with one-based song selection from `1..songs` (up to 256).

PSID relocation metadata describes free RAM for the **player driver**, not a request to move the tune. `0/0` declares a clean file; `$FF/0` declares no free driver page. C64 VBI and CIA need safe driver RAM: for an explicit free range, they select the first page within `$0400..$9FFF` or `$C000..$CFFF`. A range may extend across other memory areas if it still contains a usable page. For 6581 VBI, Direct VBI can try a file with no free driver page; 8580 requires the C64 machine and keeps the reasoned rejection. The player does not silently write outside that range. Direct VBI accepts structurally valid relocation metadata without adding a driver page there. Payload overlap, range overflow and inconsistent sentinel fields are rejected. The header, loaded payload and init/play addresses are preserved. See the [HVSC format specification, fields +78/+79](https://hvsc.c64.org/download/C64Music/DOCUMENTS/SID_file_format.txt).

The separate RSID path accepts **RSID v2**, one SID and a PAL / 6581 or 8580 Preview target:

- The reserved header load address, play address and speed fields must all be zero. RSID runs its own interrupt or continuous program; speed zero does **not** mean a host-scheduled VBI play call.
- The embedded little-endian load address must be at least `$07E8`. Payload RAM may extend through `$FFFF`, including physical RAM underneath ROM and I/O mappings. A non-BASIC init entry must be inside the payload at `$07E8..$9FFF` or `$C000..$CFFF`; a zero header init defaults to the load address.
- A BASIC flag requires a zero header init and the user-ROM environment. That zero requests BASIC startup, not a call to address zero.
- Unspecified or either-standard/model flags use the same target-selection policy as PSID. Known NTSC and multiple SIDs remain unsupported.
- The same 65,660-byte file bound and one-based `1..songs` subtune selection apply. This version does not support additional SIDs, newer file versions or external MUS players.

The header's default song is selected on load. A failed file, demo or subtune change keeps the previous selection and sound. **Stop** cancels startup or resets playback; **Play** starts the selected song again from its init routine. Playback needs a browser with Web Audio and AudioWorklet, served over HTTPS or localhost. The output sample rate must be 8..96 kHz.

Cancelling a pending subtune change restores the accepted song in the selector. If the browser caches this page for Back/Forward navigation, leaving stops its audio while keeping the selected file; press **Play** after returning.

Header acceptance does not establish whole-song compatibility. Execution can still stop with a diagnostic and address. PSID still requires an explicit play subroutine; `playAddress=0` IRQ-installed drivers remain outside this subset. A known model declaration is preserved: selecting a conflicting model is rejected and keeps the accepted sound.

## Playback target and optional C64 ROM files

The **SID model** choices are **Auto · file**, **6581** and **8580 · Preview**. Auto follows a known header declaration. The checked default-target setting supplies PAL / 6581 for unknown/either declarations in Auto; a manual model choice supplies 6581 or 8580 for an unknown/either model. The original header is retained and the selected target is shown separately. A model change preflights the latest file, stops the old sound only after a successful selection, and requires Play to start the new selection.

To require a declared PAL clock and a declared or manually selected model, open **Playback settings · PAL / SID model & C64 ROMs** and uncheck the default-target setting. Press **Apply / retry SID** after changing it; you can retry a failed file without reopening it. The existing command-line reference parser and 6581 browser-validator defaults are unchanged. The application-specific model policy chooses the appropriate core.

The **PSID VBI playback** selector defaults to **C64 machine · VIC / CIA** and offers **Direct VBI · limited I/O** for 6581 only. The environment and firmware controls apply to **C64 VBI, CIA and RSID**, including 8580. Direct VBI stays independent of ROM settings and pending firmware reads. A new C64 candidate in user-ROM mode waits for all three firmware files; accepted playback retains its own detached ROM snapshot. A failed candidate keeps the previous tune. Changing subtunes retains the accepted settings until you explicitly apply new ones.

**Built-in IRQ environment** supplies an original, limited BSD IRQ/NMI shim with the C64 devices. It runs without a Commodore ROM dump and can play programs that use the supported environment. Unsupported BASIC, KERNAL or character-ROM reads stop with an explanation. It is not a replacement for all C64 firmware.

**Use my C64 ROMs** accepts three files: Character **4,096 bytes**, BASIC **8,192 bytes** and KERNAL **8,192 bytes**. The browser checks their exact sizes and makes detached copies. Size checks do not identify the firmware or guarantee compatibility. ROM bytes remain in browser memory; they are not saved, uploaded or included in packages. No firmware is downloaded automatically. After booting the supplied machine, PSID C64 VBI/CIA installs the original RAM init/play driver; RSID requests BASIC `RUN` or a machine-code `SYS` as appropriate. Firmware bytes themselves are not patched.

The user-ROM/BASIC path is experimental. Original synthetic test ROMs exercise its loading and subtune plumbing; compatibility with actual Commodore firmware and general BASIC tunes needs separate confirmation. Use the built-in RSID demo to try the ROM-free environment.

## What is emulated

The 6581 backends combine the pinned, cycle-stepped **chips/m6502** CPU with Tetorica's existing **chips/m6581 6581 approximation**. One CPU bus cycle advances one SID tick at 985,248 Hz. SID writes commit after that cycle's audio step; supported SID reads use real emulated readback. `$D400..$D7FF` register mirrors are supported.

**8580 Preview** connects the same pinned C64 CPU / CIA / VIC environment to the separate MIT **sidera** 8580 model through two directly linked WASM modules. Its experimental resonance / cutoff reference-fit profiles stay off. Live per-voice Envelope observations are unavailable and shown as a dash, rather than zero. Waveform, register settings, filter and elapsed playback remain visible. The model is an approximation; finite test runs do not establish real-hardware sound or glitch-free playback. The real-file research checks observed some WebKit render-budget overruns, so listening and longer/background/device tests remain separate work.

The **Direct VBI** host supplies initialized RAM, the PAL identification byte `$02A6=1`, a CPU stack and a host-owned JSR trampoline. Init receives the zero-based subtune in A; X and Y are zero. Play receives A, X and Y zero. Both routines must return normally with RTS. This explicit legacy option does not emulate CIA timers, VIC raster timing or an interrupt controller. Unsupported memory banking, mapped ROM reads, other I/O and invalid returns fail explicitly.

Before **every** init or play call, the host sets the bank from that entry address: `$37` below `$A000`, otherwise `$36` within the supported payload range ending at `$CFFF`. It does not inherit a bank left by the preceding routine. These maps keep SID I/O visible; they do not provide BASIC/KERNAL firmware or permit ROM calls.

Init has a 100,000-cycle limit; each play routine has a 16,000-cycle limit. These are this bounded host's limits, not limits imposed by the SID chip or PSID format. Timeout diagnostics distinguish initialization from play; a CPU JAM/KIL opcode has its own diagnostic. The first play call is at the first strict 19,656-cycle PAL frame boundary after init completes, then once per frame. Audio produced during init is retained. These absolute scheduling times are not claimed to match libsidplayfp's complete C64 driver.

An indexed `STA` to a SID register can first issue a discarded read on the preceding VIC mirror page. The VBI host recognizes only that exact CPU microcycle, with a verified corrected SID write address and a side-effect-free VIC register, and keeps its cycle timing. Mirrored collision registers `$1E/$1F` remain unsupported because reading them clears their latches. The exception does not turn a real `LDA` from VIC, CIA or ROM into a successful read, or emulate a VIC.

The **C64 VBI** backend clocks the CPU, both CIAs, VIC, SID and memory banking together. It starts with a VIC raster interrupt below line `$100`, enabled; CIA1 timer A runs with latch `$4025` (approximately 60 Hz), with its IRQ masked. Other timers start disabled at `$FFFF`. The original RAM driver calls init and then play through actual interrupts. It acknowledges VIC and CIA after play, allowing the program to inspect the triggering flags. The tune can change its timers, raster and masks; the host does not rewrite its speed bit to CIA or substitute a fixed periodic callback.

C64 VBI performs a 100,000-cycle preflight, then continues a pending init through bounded render chunks while retaining the PCM from startup. Init must return before a **2,000,000-machine-cycle deadline measured from the driver bootstrap**, and each play call retains its 16,000-cycle limit. UI candidate validation yields between chunks and adopts the tune only after init returns; playback starts a fresh machine and streams its initial PCM. The longer init is bounded host policy, not a PSID hardware limit.

The **PSID CIA** backend uses CIA1 timer-A interrupts from the same C64 devices, with its IRQ initially enabled and VIC IRQ initially disabled. The tune's timer latch/control/mask changes remain in effect. Its existing 100,000-cycle returning-init and 16,000-cycle play bounds remain separate from the new C64 VBI init policy. User-ROM mode boots the supplied firmware before installing the appropriate original RAM driver. Neither mode removes the PSID entry and RAM restrictions.

For clean `0/0` CIA files the existing driver layout remains unchanged. C64 VBI and explicit free ranges use their selected driver page. The C64 API reports the actual `driverAddress`. Direct VBI keeps its caller at `$0200..$0203` and CPU stack at `$0100..$01FF`; accepting `$FF/0` does not prove compatibility with a program that overwrites that caller or stack. These host placements do not relocate or patch the music program.

The **RSID** host uses the same pinned **chips/c64** system wiring: CPU, both CIA chips, VIC, SID and memory banking advance together. IRQ and NMI reach the emulated CPU, and the program's RTI returns to the interrupted code. It runs the tune's own interrupt or continuous code without a host play-routine call. RSID programs may legitimately stay in an init busy loop, unlike the returning PSID init/play subroutines.

Both RSID environments perform a bounded 100,000-cycle preflight and retain its generated PCM. User-ROM mode first boots for at most 2,000,000 cycles and discards boot audio. Initialization that has not returned after preflight can continue during playback; it is not automatically treated as a failed PSID-style subroutine.

These devices and the SID remain approximations. The upstream C64 implementation has known CIA/VIC and interrupt/DMA limitations, so supported fixtures or individual tunes are not proof of complete C64 timing accuracy. Rendering, audio queues and diagnostic traces are bounded; Stop clears activity and output.

The new C64 VBI path rejects unimplemented expansion I/O at `$DE00..$DFFF` when I/O is mapped. Cartridge devices, disk loading and arbitrary C64 software are not added by routing VBI through the machine. The prior CIA/RSID execution policies remain distinct.

The current 6581 approximation does not reproduce **volume-DAC / D418-only digi sample playback**. A tune can execute correctly and write the volume register while that sampled part remains silent. Accurate DAC/digi and combined-wave quality in 8580 also remain research items. RSID file support does not imply support for every SID sound technique or every HVSC tune.

The SID's existing 12 Hz software DC blocker remains on the output. The software Master runs from 0 to 380%; above 100% it turns orange. There is no hidden gain calibration. The four application-local WASM files do not change the existing SID Synth, Playground SID core, fixed SDK or calibrated mixer levels.

## Read, modify and reuse

The application is distributed as readable source modules and CSS, with their comments and original layout. There is no minified runtime bundle.

- [player.js](player.js): file selection, transport and live display.
- [models.js](models.js) and [model_policy.js](model_policy.js): Auto / explicit model policy and core selection, retaining original declarations.
- [core8580.js](core8580.js): application-specific 8580 adapter over the separate model; no 6581 substitution.
- [audio.js](audio.js) and [processor.js](processor.js): Web Audio lifecycle and AudioWorklet commands.
- [voice_snapshot.js](voice_snapshot.js): read-only register-to-preset conversion and unsupported-state reasons.
- [handoff.js](../synth-sid/handoff.js) and [preset.js](../synth-sid/preset.js): validated, temporary same-origin transfer and portable preset format.
- [core.js](core.js): explicit Direct VBI API.
- [rsid_core.js](rsid_core.js) and [roms.js](roms.js): continuous C64 API for RSID and PSID CIA, and in-memory firmware input checks.
- [sid_psid.js](../js/sid_psid.js): shared bounded PSID input module. Its `parsePsid()` entry retains the CLI's strict header requirements; `validateBrowserPsid()` selects the subtune's timing, accepts explicit PAL/6581 choices for unknown/either declarations and preserves the original header. Its `vbiBackend` option defaults to `direct` for existing API callers; the UI and C64 wrapper explicitly select `c64`. The reference CLI remains unchanged.
- [sid_rsid.js](../js/sid_rsid.js): independent RSID parser with the same explicit browser target-selection policy. Neither browser validator overrides a known NTSC or 8580 declaration.
- [PSID demo sources and license](demos/README.md) and [RSID demo sources and license](demos/rsid/README.md).
- Separate [PSID VBI native source kit](../sources/sid-player/README.md) and [C64 / CIA / RSID native source kit](../sources/sid-rsid/README.md), with pinned upstream sources, original host/shim, SID patch documentation and licenses.

In a standalone ZIP, `sources/sid-player-browser.json` lists the original browser/build inputs with SHA-256 hashes and points to `sources/sid-player-browser-inputs.zip`. The 6581 native receipts are `generated/sid-player/sid-player-build.json` and `generated/sid-rsid/sid-rsid-build.json`. The 8580 receipt and two binaries are under `generated/sid8580-machine/`; matching C / C++ / Rust inputs, generators and Rust / Emscripten license notices are under `sources/sid8580-machine/`. Input hashes match their source kits, and output hashes identify the packaged WASMs. Both canonical 6581 parsers in the browser-input archive match the served modules byte for byte. The source archive retains the original HTML before standalone navigation adjustments. Only fixed source/demo inputs are copied: user-selected ROMs and songs are never package inputs.

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

The 8580 kit has its own pinned Rust / Emscripten build profile, compiler requirements and notices in `sources/sid8580-machine/README.md`. From that directory:

```sh
sh scripts/build_sid8580_machine.sh build/sid8580-machine
```

Copy its two resulting WASMs and receipt into `generated/sid8580-machine/` at the package root. Packaging existing checked binaries needs Node / Python only; rebuilding the 8580 engine requires the toolchains described in that kit. The 6581 chip uses zlib-licensed chips code, the 8580 model uses MIT-licensed sidera, and Tetorica adapters / UI use BSD-3-Clause. The original component and toolchain notices are included with their sources.

From the full Tetorica repository, validate current build/source copies and create a new package with:

```sh
node scripts/sid_player_artifacts.mjs --check
node scripts/sid_rsid_artifacts.mjs --check
node --test test/sid_psid.test.mjs test/sid_psid_browser.test.mjs test/sid_rsid.test.mjs
node scripts/package_sid_player.mjs local-preview
```

Each package uses a new stage directory and refuses to overwrite an existing ZIP. No npm publication is required.

Tetorica's hosts, original IRQ/NMI shim, parsers, UI and original demos use **BSD-3-Clause**. The pinned chips CPU/CIA/VIC/C64/SID components use **zlib/libpng**; their notices, pristine sources and SID patch history are included in the source kits. The GPL libsidplayfp comparison tool stays in the separate [reference CLI](https://kyorohiro.github.io/hello_ymfm_wasm/sid-reference.md); none of its code, binaries or ROM stubs is linked or packaged here. Songs and firmware you open retain their own rights and are not added to the distribution.
