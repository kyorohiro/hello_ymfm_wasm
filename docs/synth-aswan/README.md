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

Use **Code / Synth** beside Files to choose the workspace layout. Code opens
beside Files with **Code / ASWAN / Mixer / Keyboard** tabs. Changing those tabs
keeps the expanded layout and current performance; it does not run Code or stop
a VGM song. Master and Run / Apply / Stop stay available in every expanded view.
The maximize/restore button uses the same layout switch. **Synth** restores the
normal layout and the last ASWAN/Mixer choice, retaining Master and editor
contents. Left/Right arrows, Home and End move between the expanded tabs.

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
`keyOn()` and `keyOff()` gate the hardware at the configured timer and volume.
`noteOn()` and `noteOff()` use the Synth's software envelope. When an editor
PCM sample is selected, `keyOn()` also starts that sample's audio-thread
streamer for compatibility. `setVoiceMode()` / `writeVoice()` expose the DAC
latch directly. `allNotesOff()` releases Code-owned notes and leaves scheduled
operations available for later execution.
`setVolume(CH1, left, right)` and `setPan(CH1, left, right)` address the same
two hardware output levels. Both range from 0 to 15. CH2's level register
holds the eight-bit DAC sample in Voice PCM mode.
`liveFx` is a separate software effect rack, not ASWAN hardware.

**Files** keeps `/index.js`, local JavaScript modules, text, `/presets/` JSON
and original `/vgm/` files. Right-click for Duplicate, Rename, Delete, a new
instrument, a JavaScript file or a folder. Selecting a valid instrument JSON
loads it and links Auto's controls and wave drawing to that document. Valid
JSON edits follow **Auto apply**, which defaults On. A first Auto control edit
creates a sound document in `/presets/` if none is linked. Incomplete JSON
remains editable and keeps the last valid sound; finish or Discard that JSON
before using its controls. Selection does not force Keyboard into Code.
Importing a project never runs its code.

Turn **Auto apply** off to keep a working draft. Modified filenames show **●**.
**Save** (Cmd/Ctrl+S) accepts the selected file; **Save all** accepts all changes.
**Discard / Discard all** restores saved content. Auto sound edits wait for
Save; the keyboard keeps playing the accepted sound. Physical CH1–CH4 and VGM
hardware edits remain direct. Run/Apply reads saved entry points, modules and
data; saving JavaScript does not execute it or stop a running Code loop.
Enabling Auto apply accepts pending files. Saved means accepted content in
memory, separate from durable browser storage; export for a portable backup.

**Save sound** writes a self-contained `.aswan.json` preset. PCM bytes are
included. **Export project** creates a Cassette ZIP with Files, current sound
and Code selection. Local drafts use this app's own storage; export a Cassette
for a portable backup. Master, octave and transient playback state are host
preferences, separate from instrument data.

The project data layer now uses a version 2 working/saved workspace. Existing
version 1 local drafts and Cassettes migrate with their files and settings
intact. New Cassettes contain ordinary saved files plus recoverable working
differences, avoiding duplicate unchanged VGM/PCM files. The active sound,
accepted sound settings, pending renames and Auto apply mode are restored too.
Restoring either format never starts Code or audio.

**Menu → New → Cassette · ZIP…** opens a confirmation. **Cancel** keeps the
current project and performance. **Export current & create** downloads a
Cassette containing saved files and unsaved edits before replacing the project;
**Create without export** skips that backup. The new project contains the
original `/index.js` starter and default sound, clears imported VGM/sound
lists, and never runs Code or enables audio automatically. Auto apply, Master
and layout preferences are retained. Once creation begins, Code/song/keyboard
performances stop. Failed initialization restores the previous Files, sound
and editor selection; it does not restart the old performance automatically.
If browser storage fails, keep the page open and Export the new Cassette.

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

Source files and expanded VGZ data are bounded at 16 MiB. This Synth's host
reference player and sound extractor allow up to 32 MiB of prepared timeline
data, so long songs retain repeated register writes instead of merging them.
The density guard remains 512 writes per 128 output frames. Playground / Code
Worklet score preparation keeps its existing default 8 MiB admission budget.

### Edit and play while the song continues

Changed Live controls briefly highlight while you follow a VGM or Code CH.
Wave RAM, source, stereo volume, CH3 Sweep and CH4 Noise use the existing
controls; newly selected channels establish a baseline without flashing.
Open the channel **?** and turn **Live highlight** off to stop the visual
effects. It defaults On, is remembered on this device and never changes sound.
Pause, Stop, seek, Auto or frozen Auto update clears the highlights. Hidden or
unknown sample fields are not highlighted as recovered data.

Choose **CH1–CH4** during playback. Complete Wave / Sweep / Noise voices use
the usual controls: draw Wave RAM or change stereo levels, hardware Sweep or
Noise without stopping the song. Keyboard notes address that same reference
chip and use ordinary MIDI pitches. Auto remains your separate authored
instrument. Code and VGM still run one at a time.

Later VGM writes take over the fields they change. A frequency-byte write
reclaims that CH's pitch, so the wheel no longer changes its old manual note.
A full control-register write reclaims all gates; releasing an old key cannot
then cut the game's note. Until such a gate write, KeyUp releases the gate
owned by your key. A newer manual key also replaces the older key's ownership.
Wave / stereo-volume edits keep held notes running. Stop, seek and transport
changes retire stale keyboard owners without restoring old register values.

Already-rendered PCM stays queued, which adds a small delay before edits are
heard. **Auto update Off** freezes observation, not the hardware: explicitly
edited fields still acknowledge your changes. Copy / Save includes committed
edits without enabling Auto update or replacing the VGM bytes. Software-only
Envelope, name and PCM loading are unavailable on the playing reference CH.
Unknown Wave RAM or a transient CH2 DAC byte remains unavailable; no sample is
invented. Live manual input uses the song's source clock.

### Pause, audition and edit one channel

1. Play a VGM, **Pause**, and choose **CH1–CH4**.
2. A complete Wave / Sweep / Noise channel becomes editable in the usual
   controls. The computer and on-screen keyboard play that selected voice.
   **Reference key C4** matches the frozen recorded base frequency; change it
   to move that reference to another keyboard octave. Notes reach the chip's
   frequency limits when transposed beyond its hardware range.
3. Draw or change stereo levels, Sweep and Noise while a key is held. Channel
   selection retains each channel's hardware edits and preview Envelope/name.
   **Save to presets** keeps the edited selected sound as one JSON without
   replacing Auto; **Copy to Auto** takes it into the common keyboard instrument
   without stopping or rewinding the song.
4. **Resume** returns to the same song position. Buffered audio is retained, so
   edits become audible after the small already-rendered prefix. Subsequent
   VGM writes to the same settings take over. Seek restores the original VGM;
   a failed seek keeps the previous edited run.

Audition uses a private native voice in the existing AudioWorklet / AudioContext,
Master and calibrated output. It leaves the authored Auto instrument intact.
Selecting another CH, changing Reference key, seeking, Resume, Stop, starting
Code or replacing the project retires pending audition notes. Old key releases
cannot stop a newer preview. Selecting Auto still plays your common instrument.

**Software Envelope is preview-only** in this mode: its default short Attack /
Release shapes keyboard edges, and its settings can be saved with the preset;
the reference VGM has no hardware ADSR to receive them. Hardware settings apply
to the paused song channel and remain separate from the source file bytes.
Oscillator, Sweep and noise phases are not captured; audition starts a new note.
Unknown required settings, incomplete Wave RAM and transient Voice PCM bytes
show an unavailable reason instead of substituting a fake sample. Recorded PCM
can still be extracted through Sounds from VGM. Paused audition currently
requires the normal **3,072,000 Hz** clock; other clocks keep reference playback
and complete static sound extraction without an inaccurate preview.

## Timed operations in Synth Code

`useSoundChip("wonderswan")` now also provides `build`, `schedule`,
`clearSchedule`, `captureState` and `compile` in this Synth's Web Audio Code
endpoint. Immediate methods keep their existing meaning. Supported builder methods are
`setVolume`, `setPan`, `setFrequency`, `setNote`, `setNoise`, `setSweep`,
`noteOn`, `noteOff`, `keyOn` and `keyOff`. Wave RAM and Voice PCM feeding remain
separate work. Scheduled CH2 soft noteOn explicitly requires Wave mode.
In Voice mode, CH2's volume register becomes the DAC byte, so timed CH2
volume/pan is explicitly rejected rather than treating it as stereo gain.

```javascript
const ws = await useSoundChip("wonderswan");
const operations = ws.build(b => {
  b.atSample(0).setVolume(CH1, 12, 4);
  b.atSeconds(0.25).setVolume(CH1, 4, 12);
});
console.table(await ws.compile(operations));
await ws.schedule(operations, { name: "pan", repeatSeconds: 0.5 });
// Play with ordinary ws.noteOn / ws.noteOff or the keyboard.
// await ws.clearSchedule("pan");
```

Offsets are absolute from reservation start. `atSample()` uses a configurable
reference rate (`build(callback, {referenceSampleRate:44100})`), independent of
the device rate. The existing bounded Performance Queue executes on the
AudioWorklet sample clock; repeats stay compact. Noise/Sweep update shared R90
from the state at execution, preserving other channel gates and mode bits.
Repeated writes, including Noise resets, are kept. Another manual/Code write
can subsequently overwrite these parameters in normal application order.

`compile()` predicts one pass using the same WonderSwanSynth register conversion;
it does not change the live chip or stop audio. A plan containing Synth
`noteOn`/`noteOff` explicitly rejects compilation: register/RAM metadata alone
cannot predict the software Envelope and its release writes. Use `setNote` plus
raw `keyOn`/`keyOff` to inspect hardware Gate writes instead. A raw Gate trace
shows register intent; it does not simulate the Synth's live ownership guards,
which suppress releases for a note now owned by a different reservation/player.
Rows contain `offsetSeconds`,
`register` (hardware address 0x80–0x9f), `value`, `operationIndex` and `writeIndex`.
The default `initialState:"current"` captures coherent renderer authoring metadata
asynchronously. `"reset"` uses zero hardware registers without initializing the
live chip. A snapshot from `await ws.captureState()` can be reused in
`compile(operations, {initialState:snapshot})` without another round trip.
Snapshots are detached, instance/session/clock checked, and contain register/RAM
metadata rather than oscillator, Noise LFSR or Sweep phase. `"client"` is an
explicit error here because the Synth proxy has no complete local register/RAM
mirror. A forecast cannot include later manual writes or rendered hardware phase.

Run/Apply uses the shared Code transaction/loop lifecycle: a valid Apply replaces
named reservations together, a failed evaluation keeps the previous ones,
`stopLoop` cancels its own reservations and Stop ends the Code lease. Parameter
operations retain note ownership. Scheduled notes have separate reservation and
loop-owner tokens on the actual voice: a later keyboard, immediate Code note or
another reservation replaces that voice/token, so an old scheduled release
cannot stop it. `clearSchedule`, valid replacement and Stop/stopLoop release only
their own notes, including held notes from completed one-shot patterns. Invalid
replacements leave both the previous reservation and its held note untouched.
`noteOff` and cancellation use the existing Synth software Release. Raw `keyOn`
claims the Gate without a software Envelope; raw `keyOff` cuts only that
reservation's current Gate immediately. A note with Envelope disabled/zero
Release or raw Gate off can still click by design. A runtime mode conflict, such
as CH2 changing to Voice mode before a scheduled stereo edit, cancels the failing
pattern and reports a recoverable error without retiring the audio engine.

Fresh projects and Menu → New → Cassette include
`examples/timed-motion.js` and `examples/scheduled-notes.js` in Files. Existing restored projects are not silently
modified; New offers a backup before replacing them. Select the example in Code
and Run it for an independent hardware Sweep/pan clock over a beat-based melody.
The scheduled-notes example records a complete phrase. Its absolute offsets are
fixed when built: change its `bpm` constant and Apply to retime the phrase; later
`setBpm()` calls do not change an already admitted sample-clock reservation.
The general Playground/npm and direct Native APIs have not yet gained this
Synth-scoped endpoint; it does not claim parity for those backends.

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
