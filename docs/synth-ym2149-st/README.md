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
**Run** starts fresh; **Apply** updates named loops while retaining context.
**Stop** ends Code playback. Changing a tab or instrument setting keeps Code
running. **Stop all sound** is the main performance stop.

**Files** holds JavaScript, local modules, text and readable preset JSON.
**Save sound** keeps an instrument in `/presets/`; selecting a valid preset
loads its settings. Import and export files or **Cassette** projects from the
menu. Local project storage keeps drafts on this browser; export a Cassette
for a portable copy. Restoring a project does not execute its code. Master,
octave and transient playback state are host preferences.

### Try the Sync-buzzer example

Open **Files → Examples**, then choose **`examples/sync-buzzer.js`**, switch to
**Code**, and press **Run**. Adding examples keeps your `index.js`, existing
files and current Keyboard / Code mode; it does not start audio or execute Code.
The accompanying `examples/README.md` explains the experiment and controls.

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
at each occurrence. Reusing its name replaces future work atomically;
`await ym.clearSchedule("buzzer")` cancels future occurrences. In Synth Code,
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
These reference fields are read-only. Select **Auto**, or turn Auto update off,
to return to the editable Synth. **Code and reference playback are exclusive**:
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

Timed volume-modulation and volume-register sample-playback examples, Native
timed execution, Looper / Event Rec and Tauri remain follow-up work. No commercial
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
