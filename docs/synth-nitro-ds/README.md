# Tetorica Nitro DS Synth

## Keyboard and Code

Press **Enable audio**, then play the displayed computer keys or click the
on-screen keys. **Auto** plays one instrument across compatible channels.
Select **CH 1–16** to edit and play one physical channel. All 16 support
PCM8, PCM16 and IMA-ADPCM. Pulse is available on CH9–CH14, and Noise on
CH15–CH16. Code names CH1–CH16 correspond to hardware channels 0–15.

The CPU-free AudioWorklet runs original BSD-3-Clause JavaScript. The voice
settings follow the DS timer, volume, pan, pulse, and word-addressed sample
controls. Sine, Triangle, Saw and Square are built-in software samples.
Changing source, shape or repeat applies on the next note. Volume, pan,
divider and pulse duty can change while a keyboard note is held. The DS
noise timer changes the rate of the noise generator.
[DS sound-channel reference](https://mgba-emu.github.io/gbatek/#ds-sound-channels-015)

Under **Code**, use **Run**, **Apply** and **Stop** with the locally retained
`index.js`. Keyboard and Code use the same physical channels. The most recent
attack takes the channel, and releasing the older note leaves its replacement
playing. Code continues to play when you switch to the Keyboard tab.

```js
const nds = await useSoundChip("nds");
setBpm(120);
liveLoop("pulse", async () => {
  await nds.noteOn(CH9, "C4", { mode: "pulse", duty: 3, pan: 64 });
  await beat(0.35);
  await nds.noteOff(CH9);
  await beat(0.15);
});
```

`noteOff()` applies an 8 ms software release. `keyOn()` and `keyOff()` give
direct channel control. `configure()` accepts raw volume, pan and timer codes,
and optional word-aligned PCM or ADPCM bytes. `getState()` reads physical
channel settings. The output monitor offers Envelope (measured RMS history),
Waveform and Spectrum. Master controls the Synth and 2SF playback levels.

## Files and Cassette

Open **Files** to select `index.js`, browse the scripts in `examples/`, or add
your own files. Right-click a file or folder to duplicate, rename, delete or
create an item. Selecting a file keeps the current Keyboard or Code view.
Maximize Code to use a taller editor beside Files.

**Auto apply** is on by default. When it is off, a dot marks working changes.
Use **Save** (Ctrl/Cmd+S) or **Save all** to make them available to Run and
Apply. **Discard** and **Discard all** return to the saved versions.
In manual mode, **Save all** and **Discard all** include both paths in a rename.

Use **Menu → New → Cassette · ZIP** to start with the default files. The
confirmation allows you to export the current project first. **Import** and
**Export** under the same menu open and save portable Cassette ZIPs, including
both saved files and working edits. Opening a Cassette leaves Code stopped.
The expanded Cassette limit is 16 MiB.
The 2SF reference collection uses its own folder and file pickers.

## Reference playback

The local preview also plays 2SF and mini2SF recordings through the Nintendo DS
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

The 2SF player supports ROM-boot sets with standard timing. It applies song
length and fade tags, with a three-minute fallback when length is missing.
The assembled cartridge is limited to 64 MiB. Legacy emulator save states and
timing overrides report an error. The [DS Synth TODO](../issues/todo_nds_synth_20261121.md)
tracks the sample loading UI, hardware sound capture and release packaging.
