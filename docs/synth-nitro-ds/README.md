# Tetorica Nitro DS Synth

## Keyboard and Code

Press **Enable audio**, then play the displayed computer keys or click the
on-screen keys. **Auto** plays one instrument across compatible channels.
Select **CH1–CH16** to edit and play a physical channel when the reference song
is stopped. All 16 support
PCM8, PCM16 and IMA-ADPCM. Pulse is available on CH9–CH14, and Noise on
CH15–CH16. Code names CH1–CH16 correspond to hardware channels 0–15.

Keyboard, Code, paused audition and 2SF playback use the same MIT SkyEmu sound
renderer in WebAssembly. The Synth and paused audition drive the DS sound
registers directly from an AudioWorklet at 48 kHz. The browser handles any
conversion to the output device rate. The voice settings follow the DS timer,
volume, pan, pulse, and word-addressed sample controls. Sine, Triangle, Saw and
Square are built-in software samples.
The sample preview decodes the selected PCM16, PCM8 or IMA-ADPCM data and
shows its size. Pulse shows its duty control. Noise shows its generator and
clock, while PCM sample controls appear in the three sample modes.
Changing source, shape or repeat applies on the next note. Volume, pan,
divider and pulse duty can change while a keyboard note is held.
[DS sound-channel reference](https://mgba-emu.github.io/gbatek/#ds-sound-channels-015)

**Key tracking · Software** maps keyboard notes to the chip timer. In Noise
mode C4 maps to 4 kHz, and one octave doubles or halves the clock.
Drag the **PCM playback rate**, **Pulse frequency** or **Noise clock** slider
to set a manual rate while holding a key. You can also enter a rate in Hz.
The readout shows the actual rate and the hexadecimal timer value. Check
**Key tracking** again to resume tracking on held notes. The **Volume divider**
buttons and **Pulse duty** slider also work on held notes.

In the **Code** tab, use **Run**, **Apply** and **Stop** with the locally retained
`index.js`. Keyboard and Code use the same physical channels. The most recent
attack takes the channel, and releasing the older note leaves its replacement
playing. Code continues to play when you switch to the Keyboard tab.
Choose **CH1–CH16** on the **DS** tab during Code to inspect that physical
channel in the same instrument panel. Volume, pan, divider, pulse duty and
rate edits apply to the live channel. Later writes from Code can change those
values again.

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

## Mixer

Use **Mixer** to set the **DS output** level, stereo balance and mute for
Keyboard, Code, 2SF playback and paused 2SF audition. **Master** adjusts
the overall volume and stays visible across tabs. Set each channel’s
hardware Volume and Pan on the **DS** tab. Those values are stored in the
sound preset.

## WAV and sound presets

Choose a PCM format and click **Load WAV…**. The Synth converts the WAV
to a mono DS sample at its source rate. **Root note** sets the MIDI note that
plays at that rate. New WAVs start as one-shots.

Turn on **Repeat sample** to loop the shaded range. Drag either waveform marker
or edit **Loop start · frame** and **End · frame**. The end is exclusive. The
editor aligns both points to whole DS words and shows the resulting PNT and LEN
codes. You can hear the new range on held notes while dragging a marker.
Release to keep the new range or press **Escape** to restore it. For a
one-shot, edit **End** to change where the sample stops. If playback ends
during the edit, play a new note to hear it again. Format and root note
changes apply on the next note. Each converted sample can use up to 1 MiB
of encoded data. The first note on a large sample waits for its data to be
prepared in small steps while notes on other channels continue.

Choose **Draw** on the same canvas to edit a built-in, imported or captured
waveform. The stroke previews while you drag. Release to encode the edit into
the selected DS format for the next note. Drawing preserves the sample length,
source rate, root note and loop. Press **Escape** during a stroke to restore the
previous wave. **Range** returns to editing the loop markers.

**Save sound as…** writes a `.nds.json` file in `presets/`. It includes the
exact encoded sample, source rate, root note, loop points and channel controls,
including the timer value when using a manual rate.
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
version of the file when Auto apply is off. To play with the loaded fixed timer,
call `await nds.keyOn(CH1)` after `loadPreset()`.

In Code, pass `sampleRate` and `rootNote` together with encoded sample bytes
to `nds.configure()` or `nds.noteOn()` for source-rate tuning. Loop length is
independent of tuning for these samples.

## Sound Capture

Open **Sound Capture** in the Synth. Unit 0 records the left mixer and shares
the CH2 timer. Unit 1 records the right mixer and shares the CH4 timer.
Choose PCM8 or PCM16, enter a rate and a length in four-byte words, and press
**Record** while playing the Synth. **Stop** keeps the complete words recorded
so far. **Load as sample** puts the mono take into the current Synth sound as
a one-shot, with C4 at the starting capture rate. Use **Save sound as…** to keep
it in the Cassette.

Tetorica's Sound Capture reads the Synth mixer after the channel strips and
before Master. A new take applies the selected rate to the shared channel timer.
A later write to that timer changes the rate
during recording, and the panel flags the change. For a fixed-rate take, play
on a channel other than the capture unit's timer channel. This preview samples
the mixer at the browser's audio render rate and holds its value between
rendered samples. [DS capture circuit](https://mgba-emu.github.io/gbatek/#ds-sound-capture)

```js
const nds = await useSoundChip("nds");
setBpm(120);
const timer = 65536 - Math.round(16756991 / 16000);
await nds.noteOn(CH1, "A3", { mode: "pcm16", shape: "triangle", pan: 0 });
await nds.startCapture(0, { format: "pcm16", lengthWords: 1600, timer });
await beat(0.5);
await nds.stopCapture(0);
await nds.noteOff(CH1);
const take = await nds.readCapture(0);
if (take.format && take.bytes.length >= 16) {
  await nds.noteOn(CH5, "C4", {
    mode: take.format, bytes: take.bytes, sampleRate: take.sampleRate,
    rootNote: 60, loop: false,
  });
}
```

## Files and Cassette

Open **Files** to select `index.js`, browse the scripts in `examples/`, or add
your own files. Files sits to the left of the workspace on wide screens and
above it on narrow screens. Right-click a file or folder to duplicate, rename,
delete or create an item.

The **Code** button beside **Files** opens the expanded workspace with
**Code**, **DS**, **Mixer** and **Keyboard** tabs. **DS** shows the channel controls and
sound editor. **Synth** restores the standard layout with its Code or Keyboard
panel below the sound editor. Layout and tab changes keep Code playback running.

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

For 2SF and mini2SF playback, the SkyEmu DS core runs the original song driver
in a separate Worker and feeds its writes to the shared sound renderer.
Import an album with **Menu → Import → 2SF folder…**. Use
**2SF / mini2SF files…** for a standalone track or a song and its libraries
from the same directory. Choose a song, then press **Play song**. The same
transport provides **Pause / Resume** and **Stop**, with a waveform display
and Master control. **Reference playback** can be collapsed in either layout.
Importing a set adds its songs for the current session.
If a new song cannot start, the previous session remains available.

**Save song to Files** keeps the selected song and its required libraries as
original files under `2sf/`. Their relative paths are preserved. Songs saved
from the same set can share a library. The song appears under **Saved in
Files** after reloading the page or importing the Cassette. Choose it and
press **Play song**. Clicking the saved song in Files also selects it.
The Cassette has a 16 MiB limit. Larger sets can still be played from the
session import.

While a reference song is playing or paused, choose **CH1–CH16** to see its
hardware settings in the same instrument panel used for Synth. **Auto** keeps
the authored sound available while the reference song plays. **Live view**
follows the playback position and lights active channels.
The display samples the emulated DS about once per video frame and refreshes
at most ten times per second during steady playback. **Pause** freezes the
same snapshot for all sixteen channels, so you can inspect any of them while
the song is paused. Paused PCM channels that support audition also show their
decoded sample waveform.

Pause the song and choose a channel to audition it directly on the keyboard.
The **Reference key** (C4 by default) plays the recorded sample rate. A key starts
the sample from its beginning with the captured pan, volume and loop.
Audition supports PCM8, PCM16 and IMA-ADPCM from main RAM or ARM7 private WRAM.
Song effects, driver envelopes and sample phase are outside the saved sound.

Press **Capture to Synth** when you want to copy the auditioned sound into
**Auto** for editing. The song stays paused. Use **Save sound as…** to save
it to `presets/`. Code can load that sound via `loadPreset()`.

## Build the local preview

Serve the `docs/` directory to use the included browser preview.

```sh
python3 -m http.server 8787 --bind 127.0.0.1 --directory docs
```

Open `http://127.0.0.1:8787/synth-nitro-ds/index.html`. The shared WebAssembly
renderer and its source notices are in `generated/`. To rebuild it after
changing the renderer, install Python 3.11+ and Emscripten and run the command
below. The script downloads and verifies the pinned SkyEmu archive on the first
build.

```sh
sh scripts/nds-2sf/build_skyemu_wasm.sh --preview
```

The build uses the pinned MIT SkyEmu DS sources, MIT ROM database and
BSD-2-Clause DS FreeBIOS. See the [renderer guide](../../scripts/nds-2sf/README.md)
for source provenance and test commands.

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
`release/tetorica_nitro_ds_synth_0.0.1_itch.zip`. It includes the shared DS WASM,
its build inputs and notices, and editable browser modules. The archive opens
at `index.html` when served over HTTPS or localhost. With no version argument
the script uses `dev`. An existing ZIP with the same name is preserved.
