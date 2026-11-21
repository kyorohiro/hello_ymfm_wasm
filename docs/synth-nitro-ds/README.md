# Tetorica Nitro DS Synth

The local preview plays 2SF and mini2SF recordings through the Nintendo DS
core from SkyEmu. Import an album with **Menu → Import → 2SF folder…**. Use
**2SF / mini2SF files…** for a standalone track or a song and its libraries
from the same directory. Choose a song, then press **Play song**. The same
transport provides **Pause / Resume** and **Stop**, with a waveform display
and Master control. Original files stay in memory for the current session.
If a new song cannot start, the previous session remains available.

## Build the local preview

Build the native experiment first if the pinned SkyEmu source archive is
missing. The native build downloads and verifies that archive. Building the
browser preview from a verified archive uses Python 3.11+ and Emscripten.

```sh
sh scripts/nds-2sf/build_skyemu.sh
sh scripts/nds-2sf/build_skyemu_wasm.sh --preview
python3 -m http.server 8787 --bind 127.0.0.1 --directory docs
```

Open `http://127.0.0.1:8787/synth-nitro-ds/index.html`. The preview binary and
its source notices are installed under `generated/` and ignored by Git. The
build uses the pinned MIT SkyEmu DS sources, MIT ROM database and BSD-2-Clause
DS FreeBIOS. See the [2SF experiment](../../scripts/nds-2sf/README.md) for
source provenance and test commands.

The preview supports ROM-boot sets with standard timing. It applies song
length and fade tags, with a three-minute fallback when length is missing.
The assembled cartridge is limited to 64 MiB. Legacy emulator save states and
timing overrides report an error. Keyboard, Code and persisted Files are
tracked in the [DS Synth TODO](../issues/todo_nds_synth_20261121.md).
