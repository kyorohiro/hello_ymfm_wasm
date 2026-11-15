# Tetorica ASWAN Synth

Play and program the WonderSwan's ASWAN sound hardware in your browser.
Four Wave channels share packed, 32-point, four-bit wave memory. CH2 can become
an eight-bit PCM DAC, CH3 provides hardware pitch Sweep, and CH4 provides Noise.
Draw a waveform, change its settings while a melody plays, then keep the sound
and its readable JavaScript in Files.

Open [the Synth](index.html), press **Enable audio**, and use the on-screen or
computer keyboard. The octave and Pitch controls are performance tools.
**Auto** allocates Wave notes across four channels; Sweep uses CH3, Noise CH4
and PCM CH2. Choose CH1–CH4 to display, edit and play a particular physical
channel. Selecting a channel alone does not write to the sound chip.

## Hardware and software

- **Wave:** exactly 32 samples in the range 0–15, with independent four-bit left
  and right levels for each channel. Drawing edits this small Wave RAM directly.
- **Sweep:** CH3's signed step and time register change its frequency counter;
  this is a hardware effect, rather than an ordinary software LFO.
- **Noise:** CH4 uses the hardware feedback generator and eight tap settings.
  Changing the frequency changes its clock, not a conventional pitched waveform.
- **PCM:** CH2's hardware Voice mode accepts unsigned eight-bit DAC samples.
  Loading audio, resampling it, tuning it from a chosen Root note, looping it
  and delivering it on the audio clock are software functions. JavaScript
  timers are not used as a sample clock. Each side has three hardware Voice
  routes: **Mute / Half / Full**, rather than the Wave / Noise 0–15 volume.
  These are output gain choices, not three-level PCM: Full retains the unsigned
  eight-bit sample byte, while Half shifts that byte right by one bit.
- **Software Envelope:** optional ADSR controls the chip's stepped Wave / Noise
  volume, or scales the PCM sample bytes around their midpoint. The ASWAN does
  not have an ADSR generator. Envelope settings belong to the Synth.

The output uses the core's headphone path. Speaker characteristics, HyperVoice,
DMA and WonderSwan CPU/game playback are outside this Synth. The native core is
MAME-derived; this is an educational instrument, with no claim of exact analog
hardware reproduction.

Mixer starts at the shared calibrated ASWAN gain, **117%** (×1.172528), with
Master initially at 70%. Mixer 100% means raw source gain ×1. This software
gain is separate from each channel's hardware volume / Voice routing and the
final Master control; the same Mixer gain applies to the keyboard, Code and
reference song.

## JavaScript and Files

**Keyboard / Code** switch views without stopping a running performance.
Code borrows the same chip, Master and display as the controls above.
The computer keyboard also works in Code when a text field or the editor does
not have focus. Editing settings or selecting a preset keeps Code running;
Code and manual writes to the same channel can overwrite one another.
Starting a VGM song stops Code; starting Code stops the song.

**Run** starts fresh; **Apply** updates named loops while retaining `context`
and `livePrepare`; **Stop** fades the software output, ends Code's lease and
releases Code-owned notes. Raw register or Wave RAM edits made by Code remain
until you change them or load an instrument again. Use `await` for chip calls. `CH1`–`CH4` are
zero-based JavaScript constants for the four physical channels.

```js
const ws = await useSoundChip("wonderswan");
setBpm(120);

liveLoop("melody", async () => {
  await ws.noteOn(CH1, choose(scale("E3", "minorPentatonic", 2)));
  await beat(0.25);
  await ws.noteOff(CH1);
  await beat(0.25);
});
```

The default example follows the selected Wave / Sweep / Noise / PCM source.
Its `beat()` timing lets you hear a tempo change by editing `setBpm()`.
`keyOff()` is a raw hardware gate operation; `noteOff()` uses the Synth's
software release. `setVoiceMode()` / `writeVoice()` expose the raw DAC latch,
while playing the editor's PCM sample uses the host's audio-thread streamer.
`liveFx` is a separate software effect rack, not ASWAN hardware.

**Files** keeps `/index.js`, local JavaScript modules, text, `/presets/` JSON
and original `/vgm/` files. Right-click for Duplicate, Rename, Delete, a new
instrument, a JavaScript file or a folder. Selecting a valid instrument JSON
applies it; editing its JSON alone does not. Selection does not force Keyboard
into Code. Importing a project never runs its code.

**Save sound** writes a self-contained `.aswan.json` preset. PCM bytes are
included. **Export project** creates a Cassette ZIP with Files, current sound
and Code selection. Local drafts use this app's own storage; export a Cassette
for a portable backup. Master, octave and transient playback state are host
preferences, separate from instrument data.

## VGM reference songs and sounds

Import a local WonderSwan **VGM / VGZ** through the menu or Files. The original
bytes go into `/vgm/`, and reusable static instruments go into
`/presets/<song>/`. Importing keeps the current instrument and does not start
playback. Select a sound in Files to load it, or use the song transport to play,
pause and stop the reference song. Channel On / Off is in Mixer.

Wave, Noise and Sweep settings can be extracted. Regularly timed CH2 DAC data
can become a PCM preset; irregular timing or routing automation can prevent a
portable static sample and is explained in the import warnings. The original
song remains separate from those presets. A snapshot is a moment of hardware
settings, not the game's changing software instrument or its whole score.
No commercial game files are included.

## Reuse and standalone package

The [public WonderSwan JavaScript implementation](../js/wonderswansynth.js),
[Playground](../playground/index.html?mode=wonderswan) and
[application source](https://github.com/kyorohiro/hello_ymfm_wasm/tree/main/docs/synth-aswan)
are available for reuse and modification. ASWAN is the product name here;
`wonderswan` remains the public API identifier.

```sh
sh scripts/package_itch_aswan_synth.sh VERSION
```

The ZIP has a root `index.html`, readable browser modules, local WASM and
licenses, plus authenticated native sources and a rebuild recipe. Serve it over
HTTP; opening from `file://` cannot reliably load ES modules and AudioWorklets.
Monaco completion and source navigation load on demand; the textarea remains
usable when the optional editor cannot load. Tetorica and the included
MAME-derived sound core use BSD-3-Clause; retain the included licenses and
attribution. Imported files keep their own rights.
