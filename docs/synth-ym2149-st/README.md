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

High-rate JavaScript register reservation tools, standalone Sync-buzzer code
examples, Looper / Event Rec and Tauri remain follow-up work. No commercial
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
