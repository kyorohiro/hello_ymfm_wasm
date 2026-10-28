# Component licenses and provenance

Tetorica's original code is licensed under the **BSD 3-Clause License** in
[LICENSE](LICENSE). This covers Tetorica-authored integration glue, SDK tooling,
build configuration, tests, and documentation, except where an existing explicit
file-level license applies. [LICENSE.tools](LICENSE.tools) retains the same BSD
3-Clause terms for the original integration and tooling code.

Third-party cores and adaptations keep their existing copyright notices and
licenses. These include BSD-3-Clause, Apache-2.0, MIT, and LGPL-2.1-or-later
components. Existing explicit Apache, MIT, LGPL, or other license declarations
remain applicable to their respective files and portions. The BSD default for
Tetorica's original code does not replace those component terms.

## Find the licenses for a component

- [catalog/chips.json](catalog/chips.json) maps each public chip to its source
  files, original license texts, WASM artifacts, and Native build status.
- [catalog/source_inventory.json](catalog/source_inventory.json) records upstream
  projects, source versions, import paths, and SHA-256 hashes. Reference WASM
  artifacts are identified separately from their source files. Its
  `javascriptReferences` section records the MSM5205 and OKIM6295 engines
  separately from compiled artifacts. The `applicationAudio` arrays identify
  the CD-DA and MSM5205 C cores, Native headers/targets and standalone WASM pairs.
- [catalog/native_inventory.json](catalog/native_inventory.json) maps Native
  wrappers to their sources and records existing file-level declarations and the
  BSD default for Tetorica-authored glue.
- [native/reference/SOURCES.json](native/reference/SOURCES.json) records the
  origin and original/packaged hashes of imported Native wrappers and overrides.
- `vendor/<component>/` contains the component's license text and accompanying
  README, NOTICE, authorship, or upstream records.

For example, [ymfm](vendor/ymfm/LICENSE) uses BSD-3-Clause,
[MSFA](vendor/msfa/COPYING) and [JSNES](vendor/tetorica-nes/LICENSE-JSNES) use
Apache-2.0, [FDS](vendor/tetorica-nes/LICENSE-FDS) uses MIT, and
[Nuked-OPN2](vendor/nuked-opn2/LICENSE) and [SNES-SPC](vendor/snes-spc/LICENSE)
retain their LGPL terms. Use the catalog's complete file list when selecting a
chip and its adapters.

[Tetorica Sega PSG](vendor/tetorica_sega_psg/README.md) is original Tetorica code
under its own [BSD-3-Clause notice](vendor/tetorica_sega_psg/LICENSE), separate
from ymfm. Its README credits the [SMS Power! SN76489 hardware documentation](https://www.smspower.org/Development/SN76489)
by Maxim and research contributors. The shared serialization helper
`vendor/ymfm/chip_state.h` is also original Tetorica code under [LICENSE](LICENSE);
its historical location does not assign Aaron Giles authorship to that helper.

[PlayStation SPU](vendor/mame-ps1-spu/README.md) retains the explicit **BSD-3-Clause** declarations by pSXAuthor and R. Belmont, with Tetorica's standalone adaptation also under BSD-3-Clause. The component includes all five pristine MAME source files at the recorded immutable commit, their original hash list and the exact adapted build inputs. Only this device is included; MAME's framework and unrelated devices are not linked. The `instruments` catalog section maps its sources, license and Native/WASM interfaces.

[WonderSwan](vendor/mame-wonderswan/README.md) uses a standalone adaptation of
Wilbert Pol's MAME sound device under the component's
[BSD-3-Clause license](vendor/mame-wonderswan/LICENSE). The pinned upstream
`wswansound.cpp` and `.h`, their copyright declarations, and the adaptation's
notices are included. MAME's project-wide license is not substituted for these
explicit per-file terms. The SDK public forwarder, fixture, and WAV host use
the repository's BSD-3-Clause default. No MAME framework, ROM, or game audio is
required by this target.

[POKEY](vendor/libvgm-pokey/README.md) retains the explicitly BSD-3-Clause-labeled libvgm `pokey.c` at its recorded immutable revision and the original Brad Oliver, Eric Smith and Juergen Buchmueller notices. Its standalone C++ adaptation and SDK glue retain BSD-3-Clause. Unmarked libvgm framework/helper headers are omitted; the core file's declaration is not extended to them. The upstream source is retained for provenance and is not compiled as a second provider. Native and WASM compile the same standalone adaptation.

The [MSM5205](vendor/libvgm-msm5205/LICENSE) and
[OKIM6295](vendor/mame-okim6295/LICENSE) JavaScript references retain their BSD
copyright notices and adaptation records. They are unchanged copies of the
Analyzer engines, with no sample ROM or third-party music bundled. Their vendor directories also contain independently pinned upstream C/C++ files whose headers explicitly declare BSD-3-Clause. Their snapshot manifests record immutable revisions and per-file hashes.

[Tetorica CD-DA](vendor/tetorica-cdda/README.md) is original 2026 kyorohiro code under its [BSD-3-Clause license](vendor/tetorica-cdda/LICENSE). The PCM core, public C ABI and WASM bridge contain no CD-controller or machine emulator.

[Tetorica MSM5205](vendor/tetorica-msm5205/README.md) retains the existing BSD ADPCM/FIFO adaptation credits to Aaron Giles, eito, cam900, Valley Bell and Mao, alongside the 2026 kyorohiro PCM host and PC Engine RAM driver notice. Its [LICENSE](vendor/tetorica-msm5205/LICENSE) and [NOTICE.md](vendor/tetorica-msm5205/NOTICE.md) accompany the compiled module. This C11 port preserves the existing JavaScript decoder model; it does not compile the separately collected libvgm reference or inherit a license for omitted framework files. Original SDK forwarders, build glue and tests use the repository BSD default.

libvgm's unmarked integration headers, support implementation, and player code are not included. Its [license discussion](https://github.com/ValleyBell/libvgm/issues/129) reports incomplete per-module assignment; the license of an emulator source file is not extended to the surrounding framework. MAME's included OKIM6295/ADPCM files likewise retain their own BSD declarations; the complete MAME framework is not bundled.

## Source and binary releases

Source releases include the collected sources, license texts, provenance
records, and build recipes. WASM releases identify their corresponding sources
and build outputs through the release manifests. Preserve the notices and
applicable terms for the components included in your chosen configuration.

[docs/chip-differences.md](docs/chip-differences.md) describes existing
adaptations and differences between upstream, Tetorica WASM, and Native
wrappers. [native/README.md](native/README.md) describes the Native build boundary.
The recorded upstream URLs provide provenance; accessing them is unnecessary
to build from a complete source release.
