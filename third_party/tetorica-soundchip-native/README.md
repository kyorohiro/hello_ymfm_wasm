# tetorica-soundchip-native

**Sound-chip emulation library for commercial use, with GPL-only cores excluded.**

Self-contained C/C++ sound-chip sources, native adapters, and WebAssembly build recipes for music players, synthesizers, games, and audio tools.

The collection includes the required core sources, component licenses, local modifications, and verification tools. Source archives build from their own contents: no submodules, sibling checkouts, or sound-core downloads are required.

Commercial projects can select cores under **BSD-3-Clause, MIT, and Apache-2.0**. The default YM2612 backend uses BSD-3-Clause **ymfm**. Optional **Nuked-OPN2 and SNES/SPC** components retain their **LGPL** terms, including the applicable distribution and relinking requirements. Select the components you need and follow their licenses; [LICENSES.md](LICENSES.md) maps the sources and terms.

## Supported sources and build status

The source catalog covers 22 chip API identifiers:

- **Yamaha FM:** YM2612, YM2203, YM2608, YM2610, YM2610B, YM2151, YM2413, YM3526, YM3812, Y8950, and YMF262.
- **PSG:** Sega PSG and AY-3-8910.
- **Console audio:** Game Boy, NES with optional FDS, SNES S-DSP, SPC700/S-DSP playback, and PC Engine HuC6280.
- **PCM and ADPCM:** RF5C164, OKIM6258, and Sega 32X PWM.
- **FM synthesizer:** MSFA-based DX7.

Additional WASM recipes cover YM3438, YMF276, YMF288, YMF278B, Sega PCM, and K051649. YM2612 also includes the optional Nuked-OPN2 engine.

[Tetorica Sega PSG](vendor/tetorica_sega_psg/README.md) is an original BSD-3-Clause implementation, maintained separately from upstream ymfm. Its component directory includes the license, source provenance and credit to Maxim and the contributors to [SMS Power! SN76489 documentation](https://www.smspower.org/Development/SN76489).

The collection also includes the VGM Analyzer's **MSM5205 and OKIM6295 JavaScript reference implementations**, plus separately pinned upstream C/C++ source references under [libvgm-msm5205](vendor/libvgm-msm5205/) and [mame-okim6295](vendor/mame-okim6295/). SDK Native/WASM integrations for these two engines are not yet provided.

The upstream references include files explicitly marked BSD-3-Clause. libvgm support files without an explicit license declaration are omitted, following the [upstream licensing status](https://github.com/ValleyBell/libvgm/issues/129). The component READMEs and snapshot manifests describe the omissions and framework dependencies. These reference-only files are separate from the self-contained build targets and runnable JavaScript engines.

| Deliverable | Current status |
| --- | --- |
| Standalone native CMake targets | **YM2612, YM2151, YM2413, YM2203, YM2608, YM2610/YM2610B and YM3526/YM3812/YMF262/Y8950 using ymfm, plus Sega PSG, AY-3-8910, OKIM6258, RF5C164, Game Boy, HuC6280, NES with optional FDS, 32X PWM, MSFA DX7, SNES S-DSP and SPC700/S-DSP playback**, with the alternative Nuked YM2612 engine: twenty-two chip IDs in nineteen static libraries, with offline test fixtures |
| Other native adapters | Analyzer-only MSM5205/OKIM6295 are not ported; Nuked is an alternative YM2612 engine, not an additional chip ID |
| WASM build recipes | 27 artifacts; independent builds verified for YM2612 and DX7 |
| Initial compiled WASM archive | YM2612, with its matching source archive embedded |
| JavaScript references | MSM5205 and OKIM6295; runnable ES modules, with no Native/WASM port yet |

Source availability does not imply that every adapter is ready to link unchanged. The [chip differences](docs/chip-differences.md) document records required combinations and SDK amendments, including the applied Game Boy friend declaration for state observation and gate-only Stop. See the [machine-readable catalog](catalog/chips.json) and [verification record](docs/verification.md) for details.

[Verify SDK](.github/workflows/verify-sdk.yml) runs on pushes, pull requests, and manual dispatch. Its Native matrix is configured for Windows x64, Linux x64/ARM64, and macOS Intel/Apple Silicon. Each job builds nineteen static libraries covering the twenty-two Native chip IDs in Release mode from an independently extracted source ZIP, runs twenty-four CTest tests from twenty-three fixture executables, renders eighteen offline WAV examples, and checks the JavaScript references. A separate Ubuntu job compiles YM2612 WASM, verifies the matching source archive and synchronous ABI, and rebuilds from the extracted archive. See the [verification record](docs/verification.md) for completed runs; the earlier YM2612-only matrix does not establish coverage for subsequently added targets.

## Build the native libraries

Requirements: CMake 3.20 or newer and a C++17 compiler.

```sh
cmake -S . -B build/native -DCMAKE_BUILD_TYPE=Release
cmake --build build/native --config Release
ctest --test-dir build/native -C Release --output-on-failure
```

To embed a source distribution in your project:

```cmake
add_subdirectory(vendor/tetorica-soundchip-native)
target_link_libraries(your_application PRIVATE tetorica::ym2612)
# For the eight-channel OPM chip, select tetorica::ym2151 instead.
# For the independent Sega PSG, select tetorica::segapsg.
# For OPLL melody/rhythm, select tetorica::ym2413.
# For AY tones/noise/envelope, select tetorica::ay8910.
# For OPN's three FM plus three SSG voices, select tetorica::ym2203.
# For OPNA FM/SSG/rhythm/ADPCM-B, select tetorica::ym2608.
# For OPNB FM/SSG/ADPCM-A/B, select tetorica::ym2610 or tetorica::ym2610b.
# For a separate OKI ADPCM voice, select tetorica::okim6258.
# For eight-channel Mega-CD PCM, select tetorica::rf5c164.
# For the OPL family, link tetorica::opl and select kind in the constructor.
# For the four-channel DMG APU, select tetorica::gameboy.
# For PC Engine wavetable/DDA/noise, select tetorica::huc6280.
# For NES APU plus optional FDS, select tetorica::nes.
# For the independent 32X PWM FIFO/DAC, select tetorica::pwm.
# For the sixteen-slot six-operator synthesizer, select tetorica::dx7.
# For eight S-DSP BRR voices without an SPC700 CPU, select tetorica::snes.
# For SPC700/S-DSP file playback, select tetorica::spc.
```

Include the matching `<tetorica/<chip>.hpp>` header and link its CMake alias. The [native guide](native/README.md) lists all targets and existing ABIs, including compatibility names `native_game_gear_*`, `native_extra_okim6258_*` and the two RF5C164 profiles. YM2610/YM2610B share one library and retain `native_ym2610b_*`; the constructor selects the immutable four/six-FM variant explicitly.

The OPL family also shares one library: `tetorica::opl`, `tetorica::ym3526`, `tetorica::ym3812`, `tetorica::ymf262` and `tetorica::y8950` use `<tetorica/opl.hpp>` or the matching chip forwarder. **The alias/header does not select the chip.** Pass kind 0/1/2/3 to `native_opl_create()` or `native_extra_opl_create()` for YM3526/YM3812/YMF262/Y8950. Each handle constructs one selected core/profile. These twenty-four aliases/headers cover twenty-two chip IDs in nineteen static libraries.

The targets provide their chip-level FM, SSG/PSG, rhythm and sample controls independently. Encoded samples remain a host responsibility: OPNA owns fixed ROM/RAM, primary OPNB owns dense ROM banks, additional OPNB borrows immutable pages, OKIM6258 borrows sample bytes, RF5C164 owns 64 KiB PCM RAM, Y8950 borrows writable ADPCM RAM pages, and NES owns 64 KiB of copied DMC RAM. Follow the native guide's validation, synchronization and buffer/page lifetime contracts; no application scheduler or ownership queue is included.

`tetorica::gameboy` and `<tetorica/gameboy.hpp>` expose the existing `native_gameboy_*` ABI for two pulse channels, a 32-nibble wave channel and noise. Each handle owns its 16 wave-RAM bytes. Register writes use offsets from `0xFF10`; clock conversion, source mute, Stop and observational state retain the Native wrapper's behavior. This target provides DMG sound synthesis; applications supply event scheduling and output.

`tetorica::huc6280` and `<tetorica/huc6280.hpp>` expose the unchanged `native_huc6280_*` ABI: six audible channels, owned 32-sample unsigned 5-bit waves, DDA, noise on channels 4/5 and LFO. Waveform uploads copy immediately and preserve channel selection; no sample buffer is borrowed. The native guide documents helper phase changes, retained DDA/Stop output and reset behavior. The target compiles the wrapper, which includes the vendor implementation; it does not compile that implementation twice.

`tetorica::nes` and `<tetorica/nes.hpp>` expose the unchanged `native_nes_*` ABI for both pulses, triangle, noise, DMC and optional FDS. `native_nes_create(rate, base_clock, fds)` selects NTSC/PAL timing and the immutable FDS flag; FDS needs no separate alias. DMC uploads copy into owned 64 KiB RAM, and each handle owns its FDS wave/modulation tables. The Native renderer retains mono output on both channels, nonlinear mixing and filters. Reset clears DMC RAM and FDS wave data; Stop retains them and can leave held/filter output. The native guide describes FDS I/O gates and the distinct per-source Stop behavior. This port retains its explicit Apache-2.0 AND MIT terms.

`tetorica::pwm` and `<tetorica/pwm.hpp>` expose the unchanged `native_pwm_*` ABI and `NativePwmState`. Each handle owns its two three-entry FIFOs and output latches, with the Native 23,011,361 Hz default clock, duty mode and gain 1. FIFO writes copy raw counts immediately; no sample buffer is borrowed. Tagged writes/cancellation retain additional-instance ownership metadata without importing a scheduler. Raw zero is negative full scale once latched: duty silence is `cycle/2`. The [Native PWM guide](native/README.md#embed-32x-pwm) explains routing, feed timing, Stop/reset and the different reference JavaScript DAC/gain defaults.

`tetorica::dx7` and `<tetorica/dx7.hpp>` expose the unchanged `native_dx7_*` ABI: six operators, 32 algorithms and 16 preallocated note slots. Supply a validated, unpacked 155-byte voice; selection and matching-identity live edits copy it immediately. Note On returns a slot 0–15 for explicit release or kill; release keeps the envelope tail, kill can retain pending PCM/filter output, and panic clears pending output immediately. The fixed 44.1 kHz core supports 8–384 kHz output through the Native interpolation adapter. Access stays on the caller's serialized thread; no scheduler or portable save state is supplied. The [Native DX7 guide](native/README.md#embed-dx7) describes voice layout, slot ownership and the six Apache-2.0 Native overrides and SDK panic-restart correction.

`tetorica::snes` and `<tetorica/snes.hpp>` expose the unchanged `native_snes_*` ABI: eight stereo S-DSP BRR voices, ADSR/GAIN, noise, pitch modulation and echo, with owned 64 KiB sample RAM and 32 kHz synthesis interpolated to 8–384 kHz output. RAM uploads copy immediately; a separate timeline API borrows validated immutable initial RAM, DSP registers and clocked events. Stop retains RAM/authored settings and clears active voices; retained echo RAM can still sound. Reset clears RAM and the DSP. This target links only the accurate DSP, without an SPC700 CPU, IPL or file player. The [Native SNES guide](native/README.md#embed-snes-s-dsp) describes tuning, echo RAM, pointer lifetimes and host scheduling. The original wrapper, included ABI header and core retain LGPL-2.1-or-later terms; the new forwarder/integration use the SDK BSD default.

`tetorica::spc` and `<tetorica/spc.hpp>` expose the unchanged `native_spc_*` player ABI: SPC700 execution with the accurate S-DSP, copied SPC loading, pause/resume, eight-source mute, observational snapshots and a bounded DSP-write observer. Fixed 32 kHz synthesis uses 128-frame source blocks and interpolation to 8–384 kHz output. Create/load/seek/destroy on control before publishing a prepared handle to the callback; the host owns synchronized handoff and retains original file bytes for Stop-to-start or absolute seeking. Pause freezes output without rewinding; mute can retain cached PCM and echo. No full Nintendo IPL, metadata-driven ending/fade or portable save state is supplied. The [Native SPC guide](native/README.md#embed-spc700-file-playback) describes limits and lifetimes. Retain the core/wrapper/included-header LGPL-2.1-or-later terms separately from the public forwarder's BSD default.

This YM2612 example configures a simple voice and generates a stereo buffer:

```cpp
#include <tetorica/ym2612.hpp>

int main() {
    void* chip = native_ym2612_create(48000);
    if (!chip) return 1;
    const auto write = [chip](unsigned reg, unsigned value) {
        native_ym2612_write(chip, 0, reg, value);
    };
    for (unsigned slot = 0; slot < 4; ++slot) {
        const unsigned offset = slot * 4;
        write(0x30 + offset, 1);
        write(0x40 + offset, slot == 0 ? 20 : 127);
        write(0x50 + offset, 31);
        write(0x60 + offset, 0);
        write(0x70 + offset, 0);
        write(0x80 + offset, 15);
    }
    write(0xb0, 7);    // Algorithm 7: independent carriers
    write(0xb4, 0xc0); // CH1: left + right
    write(0xa4, 0x22);
    write(0xa0, 0x69);
    write(0x28, 0xf0); // CH1 key on

    float left[512], right[512];
    for (unsigned i = 0; i < 512; ++i) {
        native_ym2612_sample(chip, &left[i], &right[i]);
    }
    // Send these buffers to your audio output or file renderer.
    native_ym2612_destroy(chip);
}
```

In a real-time application, create and configure the chip before the audio callback, retain it between callbacks, and destroy it after playback has stopped. Your host supplies audio output, scheduling, and synchronization. The [native API notes](native/README.md) describe state access, lifetime requirements, and the current ABI.

## Render sound-chip WAV examples

The default build produces eighteen offline examples using the actual SDK libraries. `tetorica_32x_wav` auditions original PWM PCM/percussion on the left and then the right before adding YM2612 and Sega PSG. It retains the 23,011,361 Hz Native clock, cycle 960 and exact FIFO-tick timing. `tetorica_nuked_genesis_wav` renders the same original notes through the alternative Nuked YM2612 engine and Sega PSG. `tetorica_genesis_wav` combines a YM2612 melody with PSG tones and short noise percussion. `tetorica_master_system_wav` combines YM2413's built-in piano and rhythm voices with Sega PSG tones. `tetorica_msx_wav` combines AY tones, noise and a hardware envelope with an OPLL flute melody. `tetorica_pc98_ym2203_wav` uses all three FM channels and three SSG voices, including noise and envelope, within one YM2203. `tetorica_pc98_ym2608_wav` combines OPNA FM/SSG with original synthetic ADPCM-A percussion and an ADPCM-B pluck, uploading both ROM and RAM data. `tetorica_neogeo_wav` uses the four-FM YM2610 variant, three SSG voices and original synthetic ADPCM-A/B ROM samples. `tetorica_x68000_wav` combines YM2151 FM at 4 MHz with an OKIM6258 percussion sample at 8 MHz/divider 512. `tetorica_megacd_wav` combines YM2612, Sega PSG and the primary RF5C164 with an original looping PCM waveform. `tetorica_dos_opl_wav` renders OPL, OPL2 and OPL3 in three one-second sections, including rhythm and OPL3 four-operator/stereo controls. `tetorica_msx_audio_wav` combines Y8950 FM and original ADPCM-B with AY and OPLL. `tetorica_gameboy_wav` demonstrates both pulses, an original wave-RAM triangle and noise, with deliberate left/right routing at the 4,194,304 Hz DMG clock. `tetorica_pcengine_wav` uses original triangle/sine/pulse waves, host-fed 5-bit DDA and both noise sources, separating left/right phrases at the 3,579,545 Hz HuC6280 clock. `tetorica_nes_fds_wav` uses both pulses, triangle, noise and original copied DMC bits, then an original FDS wave, then all six sources at the 1,789,773 Hz NTSC clock. Its mono signal is written to both stereo channels. `tetorica_dx7_wav` uses three original 155-byte voices with all six operators: algorithm 1 and a live timbre edit, algorithm 5 FM pairs, then an algorithm 32 chord with explicit note release. Its mono output is duplicated to stereo. `tetorica_snes_wav` copies original 64-sample sine/triangle/pulse BRR loops into owned RAM, auditions a sine left and an ADSR triangle right, then plays an eight-voice stereo chord with ADSR/direct GAIN and explicit KOFF releases. It uses the fixed 32 kHz DSP rate for pitch and disables echo writes. `tetorica_spc_wav` builds a complete original SPC file in memory. Its SPC700 program configures the DSP, polls timer 0 to schedule a stereo melody and three-voice chord, and releases the notes; original BRR samples, fixed gain/fades and a bounded DSP-write observer require no IPL or external assets. They demonstrate SPC700 playback, SNES S-DSP, DX7, 32X, Genesis, FM-enabled Master System, MSX/MSX-AUDIO, two PC-98, NeoGeo, X68000, Mega-CD, DOS PC, Game Boy, PC Engine and NES with FDS sound configurations. Each writes three seconds of 48 kHz stereo PCM16. No audio device, external ROM, asset or npm dependency is needed. The generated sample data is not copied from hardware or game ROMs.

```sh
# After the root CMake build above, with a single-configuration generator:
./build/native/native/tetorica_32x_wav "32x demo.wav"
./build/native/native/tetorica_genesis_wav "genesis demo.wav"
./build/native/native/tetorica_nuked_genesis_wav "nuked genesis demo.wav"
./build/native/native/tetorica_master_system_wav "master system demo.wav"
./build/native/native/tetorica_msx_wav "msx demo.wav"
./build/native/native/tetorica_pc98_ym2203_wav "pc98 ym2203 demo.wav"
./build/native/native/tetorica_pc98_ym2608_wav "pc98 ym2608 demo.wav"
./build/native/native/tetorica_neogeo_wav "neogeo demo.wav"
./build/native/native/tetorica_x68000_wav "x68000 demo.wav"
./build/native/native/tetorica_megacd_wav "megacd demo.wav"
./build/native/native/tetorica_dos_opl_wav "dos opl demo.wav"
./build/native/native/tetorica_msx_audio_wav "msx audio demo.wav"
./build/native/native/tetorica_gameboy_wav "gameboy demo.wav"
./build/native/native/tetorica_pcengine_wav "pcengine demo.wav"
./build/native/native/tetorica_nes_fds_wav "nes fds demo.wav"
./build/native/native/tetorica_dx7_wav "dx7 demo.wav"
./build/native/native/tetorica_snes_wav "snes demo.wav"
./build/native/native/tetorica_spc_wav "spc demo.wav"
# With Visual Studio on Windows:
./build/native/native/Release/tetorica_32x_wav.exe "32x demo.wav"
./build/native/native/Release/tetorica_genesis_wav.exe "genesis demo.wav"
./build/native/native/Release/tetorica_nuked_genesis_wav.exe "nuked genesis demo.wav"
./build/native/native/Release/tetorica_master_system_wav.exe "master system demo.wav"
./build/native/native/Release/tetorica_msx_wav.exe "msx demo.wav"
./build/native/native/Release/tetorica_pc98_ym2203_wav.exe "pc98 ym2203 demo.wav"
./build/native/native/Release/tetorica_pc98_ym2608_wav.exe "pc98 ym2608 demo.wav"
./build/native/native/Release/tetorica_neogeo_wav.exe "neogeo demo.wav"
./build/native/native/Release/tetorica_x68000_wav.exe "x68000 demo.wav"
./build/native/native/Release/tetorica_megacd_wav.exe "megacd demo.wav"
./build/native/native/Release/tetorica_dos_opl_wav.exe "dos opl demo.wav"
./build/native/native/Release/tetorica_msx_audio_wav.exe "msx audio demo.wav"
./build/native/native/Release/tetorica_gameboy_wav.exe "gameboy demo.wav"
./build/native/native/Release/tetorica_pcengine_wav.exe "pcengine demo.wav"
./build/native/native/Release/tetorica_nes_fds_wav.exe "nes fds demo.wav"
./build/native/native/Release/tetorica_dx7_wav.exe "dx7 demo.wav"
./build/native/native/Release/tetorica_snes_wav.exe "snes demo.wav"
./build/native/native/Release/tetorica_spc_wav.exe "spc demo.wav"
```

Each executable's single required argument selects the output file; its parent directory must exist. All use fixed example gains, with MIDI notes for DX7 and chip-clock pitch conversion for the register-based chips. Sega PSG stereo `0xff` retains Genesis/Master System mono output on both channels; AY, OPLL, YM2203, NES/FDS and DX7 output is also mono on both channels. These are sound configurations, not whole-console emulators or measurements of a motherboard's analog mix. Set `-DTETORICA_NATIVE_BUILD_EXAMPLES=OFF` to omit them when embedding the libraries.

## Build WebAssembly

Requirements: an installed Emscripten toolchain, Node.js, and a POSIX shell.

```sh
sh scripts/build-wasm.sh --list
sh scripts/build-wasm.sh ym2612 build/verified-wasm
```

Most artifacts produce an Emscripten ES module (`*_wasm.js`) and its matching `.wasm` file. Ship both files together. DX7 produces the standalone `msfa.wasm` artifact. Synchronous register reads and PCM generation remain available through the corresponding low-level exports; the native and WASM entry points are documented separately.

Each build records its compiler, input hashes, and output hashes in `build-info.json`. A separate output directory keeps rebuilt artifacts apart from any imported reference binaries.

## Run the JavaScript ADPCM references

Requirements: Node.js 22 or newer. No npm installation, audio device, or external sample ROM is required for the example.

```sh
node reference/javascript/examples/render-adpcm.mjs build/adpcm-reference
```

The example generates MSM5205 and OKIM6295 WAV files from synthetic data. The two reference engines are unchanged copies of the Tetorica Analyzer implementations and can also be imported as ES modules. They provide a behavioral reference for future native ports. See [the JavaScript reference guide](reference/javascript/README.md) for their APIs and limitations.

## Use a release archive

Keep a versioned source archive in your own project and record its SHA-256. Updates are explicit; an application can keep using its pinned version independently of this repository.

To create and verify archives locally:

```sh
python3 scripts/check_sdk.py
python3 scripts/package_release.py --out-dir releases --wasm-dir build/verified-wasm
python3 tests/check_standalone_release.py \
  --source-zip releases/tetorica-soundchip-native-0.1.2-sources.zip \
  --wasm-zip releases/tetorica-soundchip-native-0.1.2-wasm.zip
```

The source ZIP includes sources, build recipes, licenses, provenance, and tests. The WASM ZIP includes compiled artifacts and the exact matching source ZIP. Both carry per-file SHA-256 manifests. Omit `--wasm-dir` to create only the source archive. See [release packaging and integration](docs/releases.md).

For JavaScript Synth helpers, AudioWorklet integration, and higher-level APIs, see [tetorica-fm2612](https://www.npmjs.com/package/tetorica-fm2612).

## Documentation

- [Native API and build notes](native/README.md)
- [Per-chip source and backend differences](docs/chip-differences.md)
- [MSFA/DX7 modifications](docs/research.md)
- [MSM5205 and OKIM6295 JavaScript references](reference/javascript/README.md)
- [Release packaging and integration](docs/releases.md)
- [Architecture and source maintenance](docs/architecture.md)
- [Verification results](docs/verification.md)

## License

Original Tetorica code, adapters, tooling, tests, and documentation use the **BSD 3-Clause License**, matching tetorica-fm2612, unless a file explicitly specifies otherwise. See [LICENSE](LICENSE).

Third-party cores and explicitly licensed adaptations retain their existing licenses and copyright notices, including BSD, Apache-2.0, MIT, and LGPL components. [LICENSES.md](LICENSES.md) and the source catalogs identify the applicable files and license texts.
