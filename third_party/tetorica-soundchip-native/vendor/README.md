# Included cores

These directories are source snapshots, not external dependencies. Builds do
not fetch upstream repositories. `catalog/source_inventory.json` records the
original workspace path and SHA-256 of every included component file. Its
SHA-256 values describe the packaged, locally adapted bytes; upstream revisions
remain separately identified in each component's original notices.

`ymfm/` is the single shared copy of the original workspace `src/` tree. It also
contains the local Sega PSG implementation and `chip_state.h`; the workspace
licenses its original additions under the same BSD-3-Clause terms. Native and
WASM wrappers both use this directory. Its upstream ymfm commit was not pinned
in the reference workspace; the recorded workspace commit and file hashes are
the exact source identity, rather than an invented upstream version.

Most `mame-*` directories retain locally adapted chip cores, unmodified upstream
reference files and the pinned-revision notices. `mame-okim6295/` and
`libvgm-msm5205/` contain the JavaScript adaptation notices and separately pinned
BSD-declared C/C++ originals for inspection. Their READMEs list framework
dependencies and libvgm files omitted because no license is declared. Those
upstream references are not standalone SDK targets. `nuked-opn2/` and `snes-spc/`
retain their LGPL texts. `tetorica-nes/` retains the Apache-2.0 JSNES and MIT FDS
notices for its C++ port. The optional 32X reference source is kept under
`mame-32x-pwm/`; its compiled shared implementation is `wasm/pwm32x_core.h`.

`msfa/` is the source corresponding to the imported standalone DX7 package
0.3.1. The reference Native port changed six files for portability; those exact
variants live in `native/reference/overrides/msfa/` and have separate hashes in
`native/reference/SOURCES.json`. Unchanged files are shared with `msfa/`.
The two variants are not claimed byte-identical.

Imported WASM artifacts retain their reference-file checksums in the inventory.
They are not claimed to be reproducible byte-for-byte with a different compiler.
Build into a separate directory to preserve those imported reference files.
The SDK contains no sample ROM, voice bank, game asset or application UI.
