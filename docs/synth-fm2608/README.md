# Tetorica FM2608 Synth

The product identifier is `tetorica-fm2608-synth`. The sound chip is the
YM2608 / OPNA used by PC-98 sound hardware.

[Open the Synth](index.html) · [PC-98 Playground](../playground/index.html?mode=pc98)

Play and edit one YM2608 with six FM channels, three SSG channels, six fixed
rhythm voices and one ADPCM-B sample voice. The workspace follows FM2612 Synth
with sound-section tabs, physical channels, a compact keyboard, Octave, two
Pitch controls, Files and JavaScript Code.

## Play and edit

Enable audio, choose a sound section and play the displayed computer keys or
pointer keyboard. Auto allocates melodic notes across the section's channels.
Choose a physical CH to edit and play that channel directly.
In Rhythm Auto, the pads show their F / G / H / J / K / L keyboard bindings.
Selecting a physical Rhythm voice sends all note keys to that voice, whose pad
shows Any key. Clicking a pad triggers its named sound.

The FM editor exposes the algorithm, feedback, four operators and hardware
LFO. SSG supports Tone and Noise mixing per channel, a shared Noise period
and the shared hardware envelope. Rhythm has six fixed instrument slots with
hardware level and left/right output controls. ADPCM-B plays a selected mono
sample with adjustable tuning, playback level and whole-sample Repeat.
Base rate sets the playback speed at the Root note. The Playback readout follows
the hardware rate while keyboard notes transpose that base rate.

The software Triangle starts at a zero crossing. ADPCM-B resets its predictor
at sample start / Repeat, so starting at the negative peak caused an avoidable
left-edge transient every cycle. The phase change retains its length, pitch
and level. The canvas continues to show actual decoded ADPCM; imported data
and the inherent reconstruction limits of abrupt Saw / Square edges are retained.

The generated 128-point Sine also uses an app-specific ADPCM encoding that
considers both the fresh decoder and Repeat reset. It reduces the initial
flat section without changing the PCM target, tuning, length or gain. The
canvas still shows decoded ADPCM, so its 4-bit quantization remains visible.
Other generated waves, drawings and newly loaded audio use a bounded lookahead
ADPCM encoder. It checks possible future codes rather than choosing solely by
the next decoded sample. Candidate output is checked against the ordinary
encoder for fresh and Repeat decoding. Source PCM timing, amplitude and length
are retained; existing preset bytes are not rewritten. To regenerate a saved
wave, press its **Software wave** button or reload the original audio.

ADPCM is lossy: a fresh decoder starts at zero with a small prediction step,
so a Saw beginning at −0.6 cannot reach that level immediately. Abrupt waveform
edges can remain rounded even after better encoding. The plot/export show
actual reconstructed ADPCM, including that limitation; they do not substitute
an ideal template. RF5C164 stores PCM amplitudes directly and has different
reconstruction behavior.

Keyboard ADPCM-B release and `opna.adpcm.noteOff()` use a **Synth software**
12 ms volume fade. One request reaches the dedicated Synth AudioWorklet, which
starts the fade on its own audio clock. Delayed message delivery delays its
start without compressing the fade into an abrupt cut. The renderer updates
changed integer volume levels at output-frame boundaries and leaves physical
volume zero after completion until a later gate or volume command restores it.
No stream of Main-thread timestamps or JavaScript timers renders this fade.
`opna.adpcm.keyOff()` retains the immediate hardware operation. An 8-bit volume
control can still leave small quantization steps; numerical silence at the
final Stop alone does not establish that the whole release is inaudible.
Authored volume and captured sample data remain unchanged. Retriggers, raw
gate/sample changes, presets, transport changes and later song writes retire
old release tails. Paused and playing reference-channel audition use the same
bounded release policy through their synchronous reference-render queue;
original VGM note commands remain raw.

**Menu → New → Cassette…** creates a fresh default sound and original starter
Code. Choose Cancel, export the current Cassette and create, or create without
exporting. New Code does not run automatically. Cancelled/failed replacement
retains portable Files/settings/identity; already-retired performance state is
not resumed automatically. Import / Export → Cassette · ZIP retain the existing
project format.

Import and export FM patches as TFI or VGI from the top-left menu. A complete
OPNA sound, including its ADPCM sample, can be saved as a JSON preset in Files.
The Mixer provides software channel mutes shared by Keyboard and Code.
The preset embeds the selected ADPCM memory range, including successful sample
uploads made by Code. Absolute sample addresses and the original playback tuning
are retained.

The rhythm sounds use Tetorica's original synthetic rhythm ROM. Its source and
BSD-3-Clause license are included in the standalone package.

## Reference songs

Use the top-left menu to import VGM, VGZ or S98 files. They are stored under
`/vgm/` in Files and included in project Cassette exports. Choose a song above
the sound tabs, then Play. The reference player supports a single YM2608 and
plays one pass using the existing OPNA core and its calibrated output gain.
Other chips and unsupported stream commands are identified before loading.

Import also extracts recorded instruments into `/presets/<song>/` as readable
`.opna.json` files. Files and the Saved sounds selector both load these voices.
Selecting one opens its FM, SSG, Rhythm or ADPCM section. Normal FM and SSG
voices populate Auto's channels. Special CH3 / CSM and Rhythm select their
physical channel. The selected section changes while the other sound sections
retain their settings. Import itself preserves the current sound and Code.

Repeated voices are deduplicated within each song. Snapshots retain static
parameters, shared LFO / envelope settings and complete recorded ADPCM sample
data. Later register automation follows the original song. Unsupported sample
ranges and other import notes are listed in Files under Import details.
Original recordings and presets are saved together with collision-safe names.
Imports share the existing 12 MiB project budget and allow up to 4,096 distinct
instruments per song. An import that exceeds these limits reports the reason
before adding its files.

Single-YM2203 files are detected automatically and played through the YM2608
core. The playback row shows `YM2203 → YM2608`, with the source and playback
clocks in its tooltip and help. Doubling the source clock preserves FM and SSG
pitch, envelope timing, prescaler changes and CH3 special mode. Song view offers
FM CH1–3 and SSG CH1–3. Live controls, paused audition, Seek, Mixer and Capture
remain available. The original imported file is kept intact in Files.

Compatibility playback uses the OPNA FM DAC model and existing calibrated
gain. Mixer enables YM2203 mode automatically for imported YM2203 songs,
applying an SSG output multiplier of 0.75 to match Tetorica's calibrated YM2203
balance. The editable Synth and Code continue to use the full YM2608.

VGM 1.70 extended headers are recognized separately from the main chip header.
First-chip YM2203 FM / SSG volume entries are retained with the imported file
and applied while YM2203 mode is on. Relative entries multiply the source
level. Absolute entries use the VGMPlay source defaults of 256 for FM and 128
for paired SSG. The first matching entry for each section takes effect.
Additional-chip clock entries remain unsupported. Extended-header fields follow
the [VGM format specification](https://github.com/vgmrips/vgmplay-legacy/blob/master/VGMPlay/vgmspec171.txt).

Song channels uses the same FM, SSG, Rhythm and ADPCM controls as Your sound.
Choose a physical channel and enable Auto update to follow its written settings.
The controls and keyboard can write directly into the playing song. A later
song write to that register takes effect in its recorded order.

Pause retains the exact song position and prepares an independent audition
chip. Play its selected channel, edit its settings or Capture to Synth. Resume
continues the original song from the retained audio. Capture copies the selected
channel into Your sound while preserving the transport's current state.
The position slider seeks by rebuilding the original register timeline.
After a song ends, the next channel edit or keyboard attack prepares paused
audition at the ending position. Selecting Song channels before playback also
prepares an editable paused view.

ADPCM Capture supports recorded data blocks and complete CPU-uploaded external
samples with 32-byte addressing. CPU-direct streams, 1-bit DRAM addressing and
incomplete sample ranges report the reason they cannot be captured. Rhythm
continues to use the bundled Tetorica synthetic ROM.

## Output Mixer

Mixer has separate 0–380% software levels for the FM / Rhythm / ADPCM stereo
bus and the SSG mono bus. They apply to Keyboard, Code and reference playback.
The current effective multipliers include the manual faders, YM2203 correction
and selected VGM volume entries. Channel mute buttons and the final Master
remain available alongside these levels.

YM2203 mode can also be enabled manually. A newly selected song sets the mode
from its source chip while retaining manual fader values. Gain changes preserve
notes, transport and paused position, following the short audio lookahead.
Mixer levels are host controls outside the saved instrument preset.

## Special FM modes

Operator buttons 1–4 select the hardware Key On mask. CH3 special mode gives
each of its four operators an independent Block / FNUM. Keyboard tuning moves
the four frequencies together and preserves their ratios. Auto allocation is
disabled in special mode, with CH3 selected for audition.

CSM uses the hardware Timer A to retrigger all four CH3 operators. Set Timer A,
then play CH3 to start the timer. Releasing the note stops its triggers. Its
mode and frequency settings are included in presets. Code also exposes
`setChannel3Mode()`, `setTimerA()` and `setCsm()`.

Keyboard Note On retriggers an enabled SSG hardware envelope so one-shot
envelope sounds can be auditioned repeatedly. That envelope is shared by all
three SSG channels, so its restart also affects other envelope-enabled voices.

## Files and Code

Save a sound to Files and select it to apply its settings. Export or import a
project Cassette to transfer the sound and editable JavaScript together.
Local drafts are restored when the same browser opens the app again.
JSON documents are opened on demand so large preset libraries use fewer editor
resources. Their edited text is saved when switching files. Each JSON document's
Undo history resets when leaving that document.

Choose Code to edit `/index.js`. Run starts a performance, Apply updates named
loops while keeping prepared state, and Stop releases the performance.
The code and the upper controls operate the same YM2608. Choose a physical
channel with Auto update enabled to follow its settings and edit them directly.
Changing sound presets or switching to Keyboard keeps the Code loops running.
Starting Code stops the reference transport. Starting a song stops Code.

```javascript
const opna = await useSoundChip("ym2608");
setBpm(120);

liveLoop("melody", async () => {
  opna.noteOn(CH1, choose(scale("E3", "minorPentatonic", 2)));
  await beat(0.5);
  opna.noteOff(CH1);
  await beat(0.25);
});
```

SSG, Rhythm and ADPCM-B are available through `opna.ssg`, `opna.rhythm` and
`opna.adpcm`. Hardware channel numbers in Code are zero-based. The `CH1` to
`CH6` constants correspond to FM channels 0 to 5.

`opna.capturePreset()` returns a validated portable sound, including Code-loaded
ADPCM data and its selected range. Memory transfers must finish before capture.
The Synth Code capture supports uploaded 8-bit DRAM samples. A raw CPU-data
stream reports a capture error. The reference-song decoder also captures
complete CPU-uploaded samples.

Keyboard allocation, keyboard Pitch and Code scheduling are software performance
features. The two Pitch controls bend keyboard-held notes. Code can control
pitch through the chip API. Code effects run in the host after the chip output. The FM, SSG,
Rhythm and ADPCM-B controls configure the YM2608 sections.

## Package

From the repository root, run the following command.

```sh
sh scripts/package_itch_fm2608_synth.sh VERSION
```

The script creates `release/tetorica_fm2608_synth_VERSION_itch.zip` and a staging
directory. Upload the ZIP as an HTML project with `index.html` as its entry.
The archive includes readable browser modules, matching WASM, native rebuild
sources, the synthetic rhythm generator and applicable licenses.

Looper / Event recording remains deferred. A dedicated Tauri application is
tracked separately in the project TODO.

## Sources

- [YM2608 high-level API](../../tetorica_src/runtime/ym2608synth.js)
- [FM2608 Synth source](https://github.com/kyorohiro/hello_ymfm_wasm/tree/main/docs/synth-fm2608)
- [Native sound-chip SDK](https://github.com/kyorohiro/tetorica-soundchip-native)
- [Tetorica license](../../LICENSE)
