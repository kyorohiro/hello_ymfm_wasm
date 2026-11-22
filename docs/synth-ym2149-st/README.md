# Tetorica YM2149 ST Synth

Play and program the Atari ST's YM2149 sound chip in your browser. Three tone
channels share one noise generator and one hardware envelope. The instrument
controls, keyboard and JavaScript Code use the same chip and audio output.

Open [the Synth](index.html), press **Enable audio**, and play the on-screen or
computer keyboard. **Auto** allocates notes across the three physical channels,
rotating through voices when full. Choose **CH1–CH3** to display, edit and play
one channel. Selecting a channel does not copy its settings to the others.
Selecting Auto also preserves per-channel differences until a value is edited.

## Hardware controls

- **Tone period:** 0–4095. With the Atari ST's 2,000,000 Hz clock, frequency is
  `2,000,000 / (16 * period)`. Zero behaves as one. The lowest representable
  tone is about 30.53 Hz; keyboard pitches outside the range are limited to
  the hardware range.
- **Tone / Noise:** independent gates for each channel. A voice can use either
  generator or combine both.
- **Fixed volume:** 0–15. **Hardware envelope** selects the chip's shared
  envelope instead of the fixed level for that channel.
- **Noise period:** 0–31, shared by every channel using Noise.
- **Envelope period / Shape:** one shared envelope generator, with 16 register
  shapes. Several register values intentionally produce the same pattern.
  Writing Shape or pressing **Retrigger envelope** restarts it for every channel
  using the envelope. A period-only edit does not restart it.

These are hardware envelope controls. There is no software ADSR in this Synth.
The **Envelope** monitor shows output level history; **Waveform** and **Spectrum**
show the mixed audio. **YM2149 gain** in Mixer scales the chip output, then
**Master** scales the final output. They start at 100% and 60%, respectively.
Both are software gain controls and are separate from channel volume.

The engine uses the existing YM2149 endpoint at **2 MHz**, type `0x10`, flags
`1`, with the existing AudioWorklet output centering. The host explicitly
initializes the client. Pitch bend and keyboard note allocation are software
performance tools.

## JavaScript and Files

The **Code / Synth** buttons beside Files select the workspace layout.
**Code** opens the existing editor beside Files, with a combined
**Code / YM2149 / Mixer / Keyboard** tab row. Changing tabs retains expansion;
**Synth** or Restore returns to the normal layout. These actions do not Run
or Apply source, stop playback or cancel named register reservations.

The same Master slider and Run / Apply / Stop controls remain available in
every expanded view. No second editor, audio context or output gain is created.
The Song selector and reference Play / Pause / Stop also remain available in
Code and Keyboard views. Click **Reference playback** to fold or expand the
panel without changing playback. It starts expanded. Code and reference playback
keep their existing exclusion: starting one stops the other, independently of
the displayed tab.
Reference playback sits above the Files and workspace columns. In expanded
view, Master shares this upper area so the Files heading and workspace tabs
start at the same height on desktop.
Selected files and editor models stay attached while the controls move between
their normal and expanded positions. Keyboard navigation of expanded tabs uses
arrows, Home and End; computer keys still play outside text fields.

**Keyboard / Code** switch views without stopping Code. Manual controls and
keyboard notes stay available during a performance; writes to the same channel
or shared generator can replace one another. Click outside a text field or
the editor to use computer keys.

```js
const ay = await useSoundChip("ay8910");
setBpm(120);

liveLoop("melody", async () => {
  ay.noteOn(CH1, choose(scale("E3", "minorPentatonic", 2)));
  await beat(0.25);
  ay.noteOff(CH1);
  await beat(0.25);
});
```

`CH1`, `CH2` and `CH3` are zero-based constants for the three physical channels.
Use the object returned by `useSoundChip("ay8910")`. Its hardware controls are
synchronous; `await beat()` advances the performance in musical time.
`setMixer(CH1, {tone: true, noise: true})` lets one channel mix the tone and
shared noise together. One `keyOn(CH1)` gates both through that channel's
volume or hardware envelope. `allNotesOff()` releases Code gates and keeps
keyboard notes and future reservations.
**Run** starts fresh; **Apply** updates named loops while retaining context.
**Stop** ends Code playback. Changing a tab or instrument setting keeps Code
running. **Stop all sound** is the main performance stop.

**Files** holds JavaScript, local modules, text and readable preset JSON.
**Save sound** keeps an instrument in `/presets/`; selecting a valid preset
from **Instrument** loads its settings without changing the workspace tab or
opening its JSON in Code. Choose a file in **Files** to edit its contents.
Import and export files or **Cassette** projects from the
menu. Local project storage keeps drafts on this browser; export a Cassette
for a portable copy. Restoring a project does not execute its code. Master,
octave and transient playback state are host preferences.

While a reference song is paused, select CH1–CH3 to edit its Tone, Noise,
hardware envelope, periods and level for keyboard audition. Noise and envelope
generators are shared. These temporary settings survive key release and channel
selection; Capture to Synth saves the edited sound. Resume, seek or Stop clears
them and resumes the original reference program without changing the saved Synth.

During **VGM / SNDH / YM** playback these hardware controls edit the selected channel in
the reference renderer directly. Writes reach the next render block after the
short audio lookahead already queued for playback. Later song writes can replace
them; shared Noise/Envelope affect all three channels. Code running on the Synth
also permits manual controls, with the same last-write-wins behavior.

### Try the Sync-buzzer example

Open **Files**, choose **`examples/sync-buzzer.js`**, switch to **Code**, and
press **Run**. The `examples/` folder is supplied at startup, after any saved
project has been restored. Existing `index.js`, edited examples, settings and
Keyboard / Code mode are kept; only missing example files are added. Nothing
runs or opens audio automatically. Missing sample files are supplied on the
next startup. `examples/README.md` explains the experiment and controls.

If a project is full or its `examples` path is occupied by a file, it is kept
intact and Files reports that automatic insertion could not complete. A failed
local-project read never saves new defaults over the unknown stored project.

The script uses CH1 for a melody while a separate named loop changes the R13
Envelope retrigger rate through 100 / 125 / 160 / 200 Hz. Individual writes are
scheduled on the Worklet. The melody advances every half beat; rate steps last
two beats. Edit the arrays or `beat()` values, then **Apply**. `setBpm()` changes
those musical intervals, while the rates in Hz stay fixed. Console shows the
compiled R13 write and each new rate; Waveform / Spectrum show the mixed output.

Select **CH1** to edit its Tone / Noise gates while Code plays. Envelope period
changes the descent between retriggers; R13 is deliberately rewritten to Shape 8.
Every envelope-enabled channel shares that generator. Each rate step replaces
and restarts its named reservation. Removing the entire `buzzer-motion` loop on
Apply cancels its writes; **Stop** ends both loops and their reservations.

At the Synth's 2 MHz clock, period 100 and Shape 8 naturally repeat at 78.125 Hz.
Repeated R13 writes at 100 Hz restart the shape every 10 ms, shortening that
descent. This demonstrates hardware envelope behavior driven by host scheduling;
it does not emulate Atari ST CPU / MFP timer timing. See the
[Yamaha YM2149 datasheet](https://ftpmirror.your.org/pub/misc/bitsavers/components/yamaha/YM2149_199209.pdf)
and [the included envelope implementation](../../third_party/mame-ay8910/ay8910.h).

### Play a melody using only the Envelope

Choose **`examples/envelope-melody.js`** in Files, switch to Code and Run.
CH1 Tone and Noise are both off. Periodic R13 writes restart the shared
hardware Envelope at the note frequency: E3 is about 164.814 Hz, A3 is 220 Hz.
No Tone-frequency writes are needed. The ordinary Tone pitch control does not
transpose this melody; edit `notes` in Code instead.

Shape 9 descends once and holds zero. A shorter Envelope Period finishes the
descent sooner; it does not repeat another ramp without a new R13 write.
Select **CH1** and try **Envelope period** 30, 100 or 200 while Code runs.
The reservation writes R13 only, so it preserves live Period changes to
R11/R12. **Apply** reruns the setup and restores its Period.

The software retrigger frequency sets the repetition pitch; the hardware
Period changes the waveform between retriggers. `setBpm()` changes note/rest
lengths without transposing the notes. Each note has a compact reservation;
release cancels it before Key Off. **Stop** or removing `envelope-melody` on
Apply also silences CH1. Console shows the R13 write and note / target Hz;
Waveform and Spectrum show the result.

Envelope remains shared by every Envelope-enabled channel. Manual writes
compete in application order. Timing is rounded to output samples; this is a
software-retriggered experiment, not Atari ST CPU / MFP cycle emulation.

### Try fixed-volume modulation

Choose **`examples/volume-modulation.js`** in Files, switch to Code and Run.
It writes CH1's R8 through a 16-step volume-code pattern at 25 / 50 / 100 Hz,
while a continuous melody changes pitch every half beat. A separate motion
loop changes the modulation rate every two beats. Console shows the 16 compiled
R8 writes and nominal write rates of 400 / 800 / 1,600 per second.

Edit `levels`, `modulationHz` or `beat()` values, then Apply. The reservations
use the Worklet sample clock; these are software-timed writes to the chip's
16 fixed-volume levels. Those levels are nonlinear and are separate from the
shared 32-level hardware envelope. Replacing the named reservation restarts
its phase. BPM changes melody / rate-step timing; modulation rates stay in Hz.

The melody uses `setNote()`, without per-note releases: repeated R8 writes
could turn output back on after `noteOff()` writes zero. Removing the entire
`volume-motion` loop runs `liveCleanup()` to silence its final level; Stop ends
the performance. Selecting CH1 and turning Tone off with Noise off isolates
the volume-only waveform. Use CH2 / CH3 for keyboard notes that do not compete
with this example's CH1 writes.

### Try volume-register sample playback

Choose **`examples/volume-sample.js`** in Files, switch to Code and Run. The
script generates an original 80 ms kick-like waveform at 8 kHz and converts it
to CH1's fixed-volume codes. Tone, Noise and Envelope are disabled on CH1:
scheduled R8 writes create the waveform. This is software-driven playback
through the chip's volume register, without a dedicated PCM unit.

The conversion chooses the nearest gain from the included YM2149 resistor
model. Rounding `sample * 15` would distort the amplitude because the levels
are nonlinear. The generated positive-lobe input deliberately has an envelope
bias and zero endpoints; this example is not a general signed WAV / PCM decoder
or a calibration of a physical chip.

Each hit has 640 data writes plus an explicit zero at reference sample 640.
Console previews the first 24 of the full 641 compiled rows. One hit per
`beat(1)` follows `setBpm()`; the sample stays 80 ms long at either 44.1 or
48 kHz output. `await schedule()` waits for acceptance, not playback completion.
Reusing the same reservation name retriggers CH1 and cuts unfinished tails
instead of layering voices.

Stop, or removing the entire `drums` loop on Apply, cancels future writes and
runs `liveCleanup()` to silence the last volume. Keep CH1 Tone / Noise /
Envelope off for this waveform. Manual volume edits compete with its scheduled
writes; CH2 / CH3 remain available for keyboard notes.

### Start a new project

Choose **Menu → New Project…**. Before starting creation, **Cancel** or Escape
keeps the current project and performance. **Export current & create** downloads
the current Cassette before creating a fresh project; **Create without export**
replaces it directly.

The fresh project contains the default sound, `index.js` and `examples/`.
Code, reference playback and held notes stop; channel selection returns to
Auto, Pitch and Octave to zero, and the input view to Keyboard. Master / mixer
volume, the audio device and keyboard-layout preferences are retained. The
new project does not automatically start audio or run Code. If local saving
is unavailable, export the new project to keep a portable copy.

### Timed register operations

The browser AY / YM2149 client can record operations, inspect their register
writes and reserve sample-timed execution on the same AudioWorklet. The
reservation is host software; the shared Envelope and the effect of writing
its Shape register are hardware behavior.

Paste this into Code and Run. R13 is written repeatedly even when its value
does not change. The melody and keyboard remain usable while it runs.

```js
const ym = await useSoundChip("ay8910");
setBpm(120);
ym.setVoice(CH1, { tone: true, noise: false, volume: 9, envelope: true });
ym.setEnvelope({ period: 80, shape: 8 });

const retrigger = ym.build(b => {
  b.atSample(0).setEnvelope({ shape: 8 });
});
console.table(await ym.compile(retrigger, { initialState: "client" }));
await ym.schedule(retrigger, { name: "buzzer", repeatSeconds: 1 / 110 });

liveLoop("melody", async () => {
  ym.noteOn(CH1, choose(scale("E3", "minorPentatonic", 2)));
  await beat(0.4);
  ym.noteOff(CH1);
  await beat(0.1);
});
```

`build()` runs its callback once without reading or changing chip state.
Recorder methods use the familiar AY names, but do not return calculated
periods or frequencies. `atSeconds()` and `atSample()` select absolute offsets
from the reserved start. Samples use 44,100 Hz by default, configurable with
`ym.build(callback, {referenceSampleRate: 48000})`, independently of the device.

`compile()` returns only the operation-generated writes and changes no live
state. Its baseline options are:

| `initialState` | Baseline |
| --- | --- |
| `"current"` (default) | An asynchronous coherent capture of applied Worklet state |
| `"client"` | Existing local state, without a state request; it can lag or precede actual rendering |
| `"reset"` | Hardware reset registers and defined retained metadata |
| A snapshot from `await ym.captureState()` | The same captured state for repeated comparisons |

Every compile uses private work state. Client mode rejects missing retained
metadata instead of filling defaults or requesting current state. Supplied
snapshots must match the chip instance and configuration. Capture does not
pause audio, and comparing a supplied snapshot makes no new capture request.
Compilation still consumes JavaScript time; keep large inspections outside
the melody loop. Compiled output describes its selected baseline, not a
recording of manual edits that may interleave during actual playback.

`schedule()` resolves when a reservation is accepted. A repeating reservation
stores one compact pattern; partial register edits resolve from actual state
at each occurrence. Reusing its name replaces the pattern atomically.
`await ym.clearSchedule("buzzer")` cancels future occurrences and releases
any note the pattern still owns. In Synth Code,
entry reservations commit only after successful Run / Apply, omitted entry
names are removed on successful Apply, and failed Apply preserves the previous
pattern. A staged receipt has `staged: true`; its final start frame is chosen
at commit. Loop reservations follow their loop's lifetime; Stop cancels them.
Detached callbacks without an identifiable entry / loop owner cannot mutate
reservations in Synth Code.

Current bounds are 4,096 operations per pattern, 128 active patterns and
48,000 repeating operations per second in aggregate, subject to the existing
65,536-command storage limit. Over-limit submissions are rejected. These are
processing bounds, not a guarantee of original Atari ST CPU / MFP cycle
accuracy or of sustainable maximum-rate playback on every device. Native
timed execution / authoritative capture are not implemented; valid local
client and reset inspection remain available there. Existing immediate calls
and YM2612 `scheduleWrites()` retain their behavior.

## Reference performances: VGM / VGZ, SNDH and YM

Choose **Menu → Music · VGM / SNDH / YM…**. Original VGM / VGZ bytes are kept
in Files `/vgm/`; SNDH / YM bytes are kept in `/music/`. They are included in
Cassette exports. Loading music preserves the edited sound and does not open
audio. Files imported through the general Files menu also appear in the song
selector when their extension is supported.

The song selector above the output monitor provides **Play**, **Pause / Resume**,
**Stop**, seeking and SNDH subsongs. Playback is one pass. An unknown duration
has a disclosed three-minute limit. Pause retains its native renderer and
unconsumed PCM; Resume continues at the same position. The Synth, reference
player and visualizer share one AudioContext and post-Master output.

**Auto update** is on by default. Select **CH1–CH3** to see the heard song's
tone/noise gates, period, volume and shared envelope in the existing controls.
These hardware fields directly edit the playing reference channel; the song
can overwrite them later. During Pause they edit a temporary keyboard audition.
Select **Auto**, or turn Auto update off, to return to the editable Synth. **Code and reference playback are exclusive**:
starting either stops the other.

While paused, the keyboard auditions a sounding selected channel without
altering the song position or the edited instrument. C4 plays its recorded
tone pitch. **Capture to Synth** copies that channel and its shared generator
settings to Auto, saves a readable preset and keeps the previous sound as a
second preset. The song remains paused and can still resume. Other reference
channels remain available when selected again.

Capture is a static instrument snapshot. It does not recover later register
changes, timer effects, volume-register sample data, oscillator phase or the
current envelope phase. Silent, incomplete and direct DAC levels are not
advertised as playable static instruments. Captured clock-dependent periods
are converted to the editable 2 MHz Synth's representable range.

VGM / VGZ supports one AY-3-8910 or YM2149 using the existing AY core, with raw
register writes and waits. Companion chips, dual chips, unsupported commands
and streams are reported; VGM loop repetition is not added. Source clocks and
repeated Envelope Shape writes are retained.

VGM flag `0x02` (**Single Output**) uses the pinned MAME nonlinear
tied-channel resistor model, including fixed-volume / envelope combinations.
Bits `0x01` (legacy table normalization) and `0x10` (YM2149 clock divider) can
be combined with it. The shared native host applies its usual factor of
one third to the resulting mono level. The independent-channel speaker
baseline adjustment is not applied to this output model. Resistor / raw
output and stereo-pan flags remain unsupported.
This flag belongs to reference playback. Static Capture copies register
settings into the existing 2 MHz YM2149 instrument; it does not copy the
reference chip's analog output model or the other channels' interaction.

SNDH / YM replay uses a separate, pinned **AtariAudio 1.31** reference component
inside a disposable Worker. It supports raw or ICE-packed SNDH and raw or
level-0 LH5/LHA-packed YM2, YM3, YM3b, YM5 and YM6 register formats. PCM-only
MIX1 / YMT files are explicitly unsupported. SNDH can include STE DAC audio;
Live observes the three YM register voices. This does not add STE DMA to the
editable Synth or implement a general-purpose Atari ST emulator.

VGM source / expansion limits are 16 / 32 MiB. AtariAudio source and expanded
data are limited to 8 MiB, with a 64 MiB WASM ceiling, per-request deadlines
and a maximum of four native Workers. Project data retains the existing
16 MiB Cassette limit. Failed or cancelled preparation keeps the previous
song and edited sound.

Native timed execution, Looper / Event Rec and Tauri remain follow-up work. No commercial
music or game files are included.

Serve the application over HTTP. Opening `index.html` through `file://` cannot
reliably load JavaScript modules and AudioWorklets. The optional Monaco editor
loads on demand; plain text editing remains available if it cannot load.

## Source and credits

The [public AY JavaScript API](../js/ay8910synth.js) also serves the YM2149;
`ay8910` is its API identifier. See the [Playground](../playground/index.html?mode=atari-st)
and [repository](https://github.com/kyorohiro/hello_ymfm_wasm) for source and
related instruments.

Tetorica uses the MAME-derived AY-3-8910 / YM2149 core, copyright **Couriersud**,
under **BSD-3-Clause**.
Retain its copyright notices, attribution and license when redistributing.
See the [AY core license](https://github.com/kyorohiro/hello_ymfm_wasm/blob/main/third_party/mame-ay8910/LICENSE) and the repository's
[BSD-3-Clause license](../../LICENSE). This instrument makes no claim of exact
analog Atari ST output reproduction. Imported files retain their own rights.

Reference playback uses [AtariAudio](https://github.com/arnaud-carre/AtariAudio)
by Arnaud Carré / Leonard, pinned to commit
`1dd9fca810a4f00b4b5e6a5348872ac0a21d88fb`. Its MIT license, Karl Stenerud's
Musashi notice, Hans Wessels' public-domain ICE attribution and LZH credits
are retained in [the vendored source](../../third_party/atari-audio/).
[Local patches](../../third_party/atari-audio/PATCHES.md), source hashes, the
[rebuild script](../../scripts/build_atari_audio_player_wasm.sh) and the
native wrapper are included in the readable itch distribution.
