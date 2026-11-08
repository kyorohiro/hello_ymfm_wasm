# Tetorica SID Synth

Product identifier: `tetorica-sid-synth`.

[Open the synthesizer](index.html) · [C64 Playground](../playground/index.html?mode=c64)

The selected beige / brown icon is [1254px WebP](../tetorica_sid_synth.webp),
with an [original PNG](../tetorica_sid_synth.png) and
[generation prompt](../issues/tetorica_sid_icon_prompt_20261107.txt).
The header, browser icon and Tetorica home use the same artwork; the standalone
ZIP includes its local WebP.

Play three SID voices from the keyboard and explore the chip's shared filter.
The browser UI follows Tetorica's FM2612 / SPU / DMG Synths: compact keyboard,
Octave, two synchronized Pitch controls, Master up to 380%, Waveform / Spectrum,
foldable sections and controls that leave computer keys available for playing.

## Play and change the sound

1. Select **Enable audio**, or play a key to prepare audio.
2. Choose Triangle, Saw, Pulse or Noise and change the hardware ADSR codes.
3. Enable the shared filter and move Cutoff / Resonance while holding notes.
4. Compare **6581** and **8580 · Preview** using the SID model buttons in the
   filter section. A model change stops held notes and resets Pitch.
5. Save the instrument as JSON, or copy its readable Playground JavaScript.

Opening the page and editing a preset start no audio device. Master is a
software output gain; values above 100% use the orange boost color. The
oscilloscope and spectrum observe the final Master-scaled output without
adding another speaker connection.

## Open a SID and use its sound

Open a local `.sid` directly in **Sounds from SID**, without visiting a separate
Player page:

1. Choose **Load SID…**. Loading checks a disposable C64 candidate and keeps
   your keyboard instrument; it does not start audio.
2. Choose a subtune with the − / + buttons and press **Play song**.
3. When you hear the sound you want, press **Capture voices**.
4. Select **Voice 1**, **Voice 2** or **Voice 3**. The selected captured voice is
   loaded immediately: the preview closes and the preset becomes this keyboard's
   instrument. An unavailable voice shows its reason and keeps your instrument.
5. Play, edit, **Save preset…**, or **Copy JavaScript** as usual.

**Auto · file** follows a known 6581 / 8580 declaration. Unknown/either hints
use PAL / 6581 by default; manual selection can resolve an unknown/either model.
A known conflicting model or NTSC declaration is rejected without rewriting
the file. Song model selection does not change the keyboard model until you
use a captured voice.

Preview supports PAL, single-SID PSID / RSID v2 through the existing C64
machine's limited built-in environment. It does not accept user ROMs or offer
Direct VBI here. For those choices, use the separate
[SID Player](https://kyorohiro.github.io/hello_ymfm_wasm/sid-player/index.html)
and transfer its preset. Header acceptance and initial preflight do not prove
whole-song compatibility; a later CPU/ROM error stops the preview and retains
the selected file and keyboard instrument.

Capture reads one coherent current Worklet state. The captured batch stays
fixed while the song continues, and an unavailable voice shows its reason.
This is an instantaneous register setting, not a recovered time-varying game
instrument: the keyboard restarts musical pitch and Gate / ADSR, without the
original phase, elapsed Envelope or later song automation. Independent
Sync / Ring pairs retain their frequency-register ratio; the source's audible
part is not imported. The same limits as Player snapshots below apply.

Playing the song clears Synth notes; playing a Synth key stops a pending or
active preview before the key sounds. **Stop all sound** stops both paths.
Master controls both. Cancelled/bad reads retain the preset, accepted SID and
captured batch; an accepted replacement stops its previous preview only after
validation succeeds. Opening a SID alone never replaces the keyboard instrument.
No song, ROM or PCM bytes are stored in a voice preset.

### Follow a playing channel

**Live CH view while playing** is on by default. During song preview, **Your
sound** displays the selected **CH 1 / CH 2 / CH 3** as it changes. Channel
selection affects observation only; the song continues and your keyboard preset
is preserved. Turn off Live view to return to the keyboard's normal editor.
Selecting a captured Voice closes the preview and returns to that editor with
the imported sound.

Live and editing use the **same controls in the same positions**: waveform
buttons, Pulse width, ADSR, filter and modulation controls update in place.
Live values are read-only and changes are highlighted. Switching back restores
the authored instrument, retaining the same control nodes and folded sections.
Long explanations are behind each section's **?** button, closed by default.

The passive display shows the actual waveform flags (including combined or no
waveform), frequency register / Hz, Pulse width, ADSR codes, Gate, Sync / Ring /
TEST, observable Envelope and shared filter routing / settings. A sound that
cannot be converted to a portable Synth preset can still be observed here.
The 8580 backend does not expose a live Envelope value; it is shown as unavailable.
Frequency, Gate, Envelope and other observation-only readouts appear in a compact
strip below the shared controls. Combined waveform flags can light multiple
waveform buttons; raw filter routing and out-of-range ratios are not narrowed
to a valid keyboard preset for display.

This uses the existing player's coherent Worklet read at up to 20 updates per
second, with one read at a time. It never writes the song or continually reloads
the authored instrument. Fast register changes between observations can be
missed; this is a sampled view, not a complete register-write recording. Capture
still reads one fixed batch, and the captured Voice buttons load that batch.

## Three voices and oscillator modulation

Normal playback uses the three physical SID voices in round-robin order.
Allocation prefers a silent voice, then an older released tail, then the oldest
held voice. Releasing an old key cannot release its replacement. Key release
lowers the hardware Gate and leaves the hardware release envelope running.
The 8580 model has no per-voice envelope observation, so released slots are
treated as possible tails until reused; they are preferred over held voices.
**Stop all sound** flushes voices, queued PCM and output tails while retaining
the instrument. Stop, preset load and topology changes also reset Pitch.

Sync / Ring use **voice 3 → voice 1** as one fixed pair, giving one keyboard
note. Voice 3 runs as a silent oscillator; it is not an extra emulated chip.
Its Gate/envelope and selected output waveform do not control the modulation:
hardware Sync resets phase, and Ring changes the Triangle oscillator's sign.
Choose **Triangle** to hear Ring. Other carrier waveforms can still use Sync.

**Modulator ratio** is a software tuning control for the physical third
oscillator. It follows the played note and Pitch, from 0.125× to 8×. It does not
add a hardware modulation-depth parameter. Ratios / notes / Pitch that exceed
the SID's frequency-register range are rejected before changing the current
sound. An unobservable, released 8580 tail retains its last valid tuning if it
would otherwise block a valid held-note Pitch / ratio edit. The hardware TEST
control holds/resets an oscillator; topology changes
such as TEST or Sync / Ring stop currently held keys before reconfiguration.

ADSR parameters are four-bit **hardware codes**, not seconds. The emulation
retains SID envelope state and timing behavior: changing a rate on a held note
does not start a fresh software envelope. Very rapid Gate transitions at a
maximum envelope can expose SID retrigger behavior. No hidden envelope reset,
automatic normalization or post-mix compensation is applied.

## One shared SID filter

All keyboard carrier voices share the same filter and chip volume. The LP, BP
and HP buttons switch each hardware output independently; selected outputs are
added together. LP + HP is Notch, and LP + BP, BP + HP and all three outputs
are available too. All use the same Cutoff (`0..2047`, a register code, not Hz)
and Resonance (`0..15`). Turning on an output enables the filter automatically.

Turning off the last output or disabling **Enable filter** routes the carriers
dry in this Synth. Enabling it again restores the selected outputs, or starts
with LP if none were selected. The silent modulation source stays out of this
path. This bypass is a Synth convenience: the low-level SID API can route
voices into an all-off filter, which makes those routed voices silent.

Pulse width is `0..4095`. Chip volume is the shared hardware `0..15` volume;
the separate Master control changes the host output gain. Live waveform,
pulse width, ADSR, filter, volume, ratio and Pitch edits preserve active voice
ownership. Model / Sync / Ring / TEST changes, preset load and Stop clear it.

## Presets and code reuse

The portable format is `tetorica-sid-voice`, **version 2**. It records `model`
(`'6581'` or `'8580'`), carrier waveform / pulse width / ADSR / TEST,
Sync / Ring / software ratio and shared filter / chip volume, including the
combined filter outputs. Existing version-1 presets load as **6581** and are
saved as version 2; Notch loads as LP + HP. Loading a preset selects its recorded
model. All-off mode saves with the
filter bypassed. It does not contain a SID tune or C64 program. Invalid
files, cancelled selection and rejected edits retain the accepted instrument.
Preset files are limited to 64 KiB.

To try a voice from [SID Player](https://kyorohiro.github.io/hello_ymfm_wasm/sid-player/index.html),
capture a supported voice in **Voice snapshot → SID Synth** and save its preset,
then choose **Load preset…** here. On the same origin, the Player's explicit
**Open in SID Synth** link supplies that validated preset directly. This loads
the preset without starting audio; play a key or enable audio to hear it. The
temporary handoff expires after five minutes and is consumed once. Invalid or
expired requests keep the current preset and show a diagnostic. Standalone
packages on different origins use the portable JSON file workflow.

Snapshots retain the model, one carrier waveform, Pulse width, ADSR register
codes and the selected voice's shared-filter routing / settings and chip volume.
An isolated Sync / Ring pair also retains both carrier modulation flags and
the unrounded source/carrier frequency-register ratio. The original physical
connection is remapped to this Synth's **silent Triangle voice 3 → carrier 1**
pair, using one keyboard note. SID Sync / Ring uses oscillator phase rather
than the source's audible waveform / Gate / ADSR. Both 6581 and 8580 allow a
source with no waveform selected; its phase continues while Gate is off too.
The original source's audible part and the third song
voice are not copied. Pairs with source / carrier TEST, zero frequencies, ratios
outside 0.125×..8× or three-voice modulation chains remain unavailable in the
Player. Snapshots restart as a keyboard-controlled instrument: the original musical pitch,
elapsed envelope, oscillator / noise phase and later song automation are not
recreated. Combined waveforms and unsupported modulation / silent-routing cases
are rejected with reasons in the Player. The source modules remain readable in
[voice_snapshot.js](https://github.com/kyorohiro/hello_ymfm_wasm/blob/main/docs/sid-player/voice_snapshot.js)
and [handoff.js](handoff.js).

**Copy JavaScript** targets C64 mode in the Playground. A 6581 preset uses the
primary `sid`; an 8580 preset creates a separate `sid8580` instance with
`await createSoundChip('sid', {id:'sid:8580-voice', model:'8580'})`, supported in
Main and Worker execution. The code describes the fixed physical voices, routing and frequency ratio;
standalone keyboard allocation remains host software. The modules
[preset.js](preset.js), [instrument.js](instrument.js), [audio.js](audio.js),
[processor.js](processor.js), [editor.js](editor.js) and [synth.js](synth.js)
retain comments and imports for modification. The engine reuses
[SidCore](../js/sid.js), [Sid8580Core](../js/sid8580.js) and [SidSynth](../js/sidsynth.js).

## Model and distribution

Choose the **6581 approximation** from chips/m6581 or the separate
**8580 Preview** from sidera. Both use a fixed PAL clock of **985,248 Hz** in
this Synth. Output follows the audio device (8–96 kHz). The 8580 adapter uses
the existing endpoint WASM's standalone batch API for keyboard voices, without running a C64 CPU;
the research cutoff and resonance fit profiles remain off. Switching models
replaces the instrument within the same audio engine and clears held notes,
tails and Pitch. A software 12 Hz output DC blocker follows each chip.
Filters and combined waveforms are approximations; neither model promises
real-chip fidelity or covers analog unit variation.
The separate SID-file preview runs a C64 CPU only when requested. Time-varying
instrument reconstruction, Native audio output, software LFOs and arbitrary
modulation routing remain separate work.

The 6581 chip is **zlib**, the 8580 [sidera core](https://github.com/kyorohiro/hello_ymfm_wasm/blob/main/third_party/sidera/README.md)
is **MIT**, and the Tetorica wrapper / UI are **BSD-3-Clause**. The
[6581 source kit](../sources/sid/README.md) contains its pinned original,
marked adaptation, Native host, WASM bridge, licenses and standalone rebuild
recipe. The ZIP also includes the unchanged 8580 matching C/C++/Rust sources,
licenses, toolchain notices and rebuild receipt. Its shared source kit retains
both machine WASMs for rebuilding and song preview; keyboard voices load only
`sid8580-endpoint.wasm`. The ZIP also includes the checked 6581 Direct Player
and C64 Player WASMs with their complete 14 / 29-input Native source kits,
licenses and rebuild recipes. Shared Player modules retain their default asset
URLs, including Direct VBI, although this panel uses the C64 path. These
application cores are separate from the fixed sound-chip SDK snapshot.

From the repository root:

```sh
npm run test:sid-synth
npm run test:sid-synth:browser
sh scripts/package_itch_sid_synth.sh dev
```

The ZIP includes readable browser JS / CSS, the original WASM, corresponding
native sources / licenses / rebuild instructions and a hash-checked archive of
the original browser inputs. Packaging does not bundle or minify these modules.
Automated browser checks mute the final speaker output; human listening and
real SID hardware comparisons remain separate checks.
