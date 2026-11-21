# Tetorica Nitro DS Synth

## Keyboard and Code

Press **Enable audio**, then play the displayed computer keys or click the
on-screen keys. Choose **Synth** under **View / keyboard**. **Auto** plays one
instrument across compatible channels. Select **CH1–CH16** to edit and play
one physical channel. All 16 support
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

## WAV and sound presets

Choose a PCM format and click **Load WAV…**. The Synth converts the WAV
to a mono DS sample at its source rate. **Root note** sets the MIDI note that
plays at that rate. New WAVs start as one-shots.

Turn on **Repeat sample** to loop the shaded range. Drag either waveform marker
or edit **Loop start · frame** and **End · frame**. The end is exclusive. The
editor aligns both points to whole DS words and shows the resulting PNT and LEN
codes. Format, tuning and range changes apply on the next note. Each converted
sample can use up to 1 MiB of encoded data.

**Save sound as…** writes a `.nds.json` file in `presets/`. It includes the
exact encoded sample, source rate, root note, loop points and channel controls.
To recall it, choose **Saved sounds** or select the file in **Files**. Export a
Cassette to keep the saved sound with its Code. After importing the Cassette,
choose the sound again to play it.

Code can use the same saved sound. Replace the path with a file from `presets/`.
`loadPreset()` prepares the selected physical channel. `noteOn()` plays the
loaded sample using its saved root note, source rate and loop settings.

```js
const nds = await useSoundChip("nds");
await nds.loadPreset(CH1, await file("/presets/My sound.nds.json"));
await nds.noteOn(CH1, "C4");
await beat(1);
await nds.noteOff(CH1);
```

`loadPreset()` accepts JSON text or a parsed DS preset. `file()` reads the saved
version of the file when Auto apply is off.

In Code, pass `sampleRate` and `rootNote` together with encoded sample bytes
to `nds.configure()` or `nds.noteOn()` for source-rate tuning. Loop length is
independent of tuning for these samples.

## Files and Cassette

Open **Files** to select `index.js`, browse the scripts in `examples/`, or add
your own files. Right-click a file or folder to duplicate, rename, delete or
create an item. Selecting a file keeps the current Keyboard or Code view.
The **Code / Synth** buttons beside **Files** switch between the larger
editor and the keyboard layout while keeping Code playback running.

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
and Master control. Importing a set adds its songs for the current session.
If a new song cannot start, the previous session remains available.

**Save song to Files** keeps the selected song and its required libraries as
original files under `2sf/`. Their relative paths are preserved. Songs saved
from the same set can share a library. The song appears under **Saved in
Files** after reloading the page or importing the Cassette. Choose it and
press **Play song**. Clicking the saved song in Files also selects it.
The Cassette has a 16 MiB limit. Larger sets can still be played from the
session import.

Choose **2SF** under **View / keyboard** to use the same channel buttons for
the song. **Live view** follows the playback position and lights active
channels. Choose **CH1–CH16** to see activity, format, hardware volume,
pan and sample or step rate.
The display samples the emulated DS about once per video frame and refreshes
at most ten times per second during steady playback. **Pause** freezes the
same snapshot for all sixteen channels, so you can inspect any of them while
the song is paused. Turn off **Live view** to hide the values.

While paused in **2SF** view, choose a channel to audition it on the keyboard. The
**Reference key** (C4 by default) plays the recorded sample rate. A key starts
the sample from its beginning with the captured pan, volume and loop.
Audition supports PCM8, PCM16 and IMA-ADPCM from main RAM or ARM7 private WRAM.
Song effects, driver envelopes and sample phase are outside the saved sound.

With the audition ready, press **Capture to Synth** to load the sound into
the current Synth slot and keep the song paused. Use **Save sound as…** to
save it to `presets/`. The same sound is available to Code via `loadPreset()`.
Choose **Synth** to play the edited sound. **Capture to Synth** also selects
that view.

## Build the local preview

Building the browser preview requires Python 3.11+ and Emscripten. The script
downloads and verifies the pinned SkyEmu archive on the first build.

```sh
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
tracks hardware sound capture, support for more source formats and release packaging.

## Build the itch.io ZIP

From the repository root, with the locked npm dependencies installed:

```sh
sh scripts/package_itch_nitro_ds_synth.sh 0.0.1
```

Use the version you intend to distribute. The ZIP is written to
`release/tetorica_nitro_ds_synth_0.0.1_itch.zip`. It includes the 2SF WASM,
its build inputs and notices, and editable browser modules. The archive opens
at `index.html` when served over HTTPS or localhost. With no version argument
the script uses `dev`. An existing ZIP with the same name is preserved.
