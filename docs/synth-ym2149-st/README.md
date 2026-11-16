# Tetorica YM2149 ST Synth

Play and program the Atari ST's YM2149 sound chip in your browser. Three tone
channels share one noise generator and one hardware envelope. The instrument
controls, keyboard and JavaScript Code use the same chip and audio output.

Open [the Synth](index.html), press **Enable audio**, and play the on-screen or
computer keyboard. **Auto** allocates notes across the three physical channels,
replacing the oldest note when full. Choose **CH1–CH3** to display, edit and play
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

## Initial scope

This version is a browser instrument for the YM2149. It does not replay Atari
ST programs or provide a complete Atari ST machine. YM / SNDH reference
playback and instrument extraction remain follow-up work. STE DMA, high-rate
register reservation tools, Sync-buzzer demonstrations, sample playback
through volume writes, Looper / Event Rec and a Tauri application are also
outside this initial version. No commercial music or game files are included.

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
