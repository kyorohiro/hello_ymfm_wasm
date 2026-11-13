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
2. Choose **CH 1 / CH 2 / CH 3** to edit and play one physical channel, or
   **Round robin** to play across all three while keeping their sounds. Toggle
   Triangle, Saw, Pulse and Noise independently to use one or several waveforms
   in the same oscillator, and change the hardware ADSR codes. All four off is silent.
3. Enable the shared filter and move Cutoff / Resonance while holding notes.
4. Compare **6581** and **8580 · Preview** using the SID model buttons in the
   filter section. A model change stops held notes and resets Pitch.
5. **Save voice preset…** saves the current sound. **Save channel setup…** also
   saves all three channel patches and the selected target. **Copy JavaScript**
   produces readable Playground code for the selected physical channel.

Fixed channels retain separate oscillator, ADSR and modulation settings. Changing
the selected CH restores its patch. Entering Round robin preserves all three
patches. Editing a parameter there applies only that changed parameter to all
three, preserving their other differences. When editing mixed settings, the
controls use CH 1 as a reference and a short notice identifies the differences.
While Auto update is on, they show its observed song CH instead.
Each waveform button applies only its changed selection bit across the channels;
enabling Pulse does not clear their other waveforms.
Loading a voice preset in Round robin deliberately replaces the complete sound
on all three. Model and filter settings are shared.
Switching the target stops held notes and resets Pitch.

Opening the page and editing a preset start no audio device. Master is a
software output gain; values above 100% use the orange boost color. The
oscilloscope and spectrum observe the final Master-scaled output without
adding another speaker connection.

## Play from Code and keep project files

The lower **Keyboard / Code** tabs share this Synth's one SID and its selected
6581 / 8580 model, three channel patches, filter and Master. Code names physical
channels explicitly; keyboard round robin and Legato remain keyboard features.
These scheduling and project tools are software features, beyond SID registers.

New projects start with three independent loops: an E2 minor-pentatonic melody
every 0.25 beat, a 2-second Sync modulator ratio sweep from 0.2 to 0.8 and back,
and a 4-second LP + BP cutoff sweep from 100 to 600 and back. CH3 modulates CH1
without a direct output. Shared motion state survives Apply through
`livePrepare()`. Ring is enabled but only affects Triangle, not the starter's
Saw. Existing saved code is retained. A minimal melody example is:

```js
const sid = await useSoundChip("sid");
setBpm(120);
liveLoop("melody", async () => {
  const notes = scale("E3", "minorPentatonic", 2);
  await sid.noteOn(CH1, choose(notes));
  await sleep(0.12);
  await sid.noteOff(CH1);
  await beat(0.5);
});
```

**Run** starts a fresh context; **Apply** keeps `context` and named preparations.
**Stop** cancels pending work, fades the output and restores the current authored
channel setup. Keyboard / Code changes the input view while the same loops,
context and FX continue. The shared Run / Apply / Stop row stays visible above
the keyboard. The Code tab supports
`livePrepare()`, `tween()`, `liveFx()` and the common music helpers. Effects run
after the chip in host software. There is no implicit `play()` or independent
chip factory here; acquire the SID through `useSoundChip("sid")` and await its
acknowledged controls. Existing **Copy JavaScript** still targets the full C64
Playground separately. Maximize Code places the same editor beside Files.

Selecting a sound JSON in **Files**, loading a preset or changing its voice
settings keeps the current Run, loops, `context`, preparations and software FX.
The shared SID adopts the new authored settings; loads and topology changes
clear held hardware notes, so the next Code note uses the new sound. Presets
can also switch 6581 / 8580 within this same audio graph and Code client. A
failed model preparation keeps the old chip running. Explicit Stop restores
the latest selected sound; project replacement and starting a SID song still
stop Code. Code that sets its own waveform / filter again can overwrite those
particular settings on its next iteration.

While Code runs, **Live from Code** is On by default. The existing **Your sound**
controls show the selected Code channel's applied waveform flags, Pulse width,
hardware ADSR and shared filter, with the same change highlights as song Live.
The **CH 1 / CH 2 / CH 3** buttons choose the physical channel to inspect and
play from Keyboard. While Live is on, editing a control changes only that field
on the displayed channel and its authored settings; frequency, Gate and other
channels keep running. The hardware filter remains shared. Turn Live off to
edit the authored sound and use its keyboard allocation. Stop restores the
authored display. Observing alone never replaces a saved preset or Files sound.

Keyboard can play alongside Code. The most recent Key On owns a physical
channel: an older Code Note Off or keyboard key-up cannot stop its newer owner,
and old notes do not return automatically. Keyboard Pitch only retunes keyboard
owners. Parameter edits do not claim a gate; raw register writes and explicit
allNotesOff remain physical controls. Blur releases keyboard notes while Code
keeps running. Updates are limited
to 20/s, so register writes between observations can be missed; 8580 continues
to show its unavailable Envelope as unavailable.

**Files** keeps `/index.js`, local modules, text/JSON and opaque binary files.
Create or select a `.js` / `.mjs` file to edit it in Code. Use dynamic local
imports such as `await import("./lib/notes.js")`, and `await file("./data/notes.json",
{type:"json"})` for data relative to the active file. Other text files have a
small Files editor. Text edits save locally; saving, restoring or importing
files never runs them. JavaScript files are limited to 2 MiB.

**Save sound** writes all three current patches to
`/presets/current.sid-channels.json`. Selecting a supported voice/setup JSON
applies its settings after stopping the preceding performance. Editing its text
does not apply it automatically: select it again when ready. Legacy JSON files
and unfinished text remain unchanged in Files; invalid sound selections keep
the current instrument. Existing voice/setup save buttons and formats still work.

**Export project** creates a self-contained Cassette ZIP with the authored
channel setup, code selection and every project file. **Import project** checks
the complete candidate before replacing Files or the instrument. The common
Cassette loader's 16 MiB compressed/expanded limits apply. Imported `.sid` or
other binary data remains a file; it does not start song preview. Use the
separate **Load SID…** controls for song playback. Local recovery uses a SID-only
IndexedDB store, with a localStorage fallback; export a project for a portable
backup. The optional Monaco editor loads from its CDN; basic text editing and
Run remain available if that editor cannot load. Runtime sources and type
declarations used by definition navigation are included locally in the ZIP.

## Open a SID and use its sound

Open a local `.sid` directly in **Sounds from SID**, without visiting a separate
Player page:

1. Choose **Load SID…**. Loading checks a disposable C64 candidate and keeps
   your keyboard instrument; it does not start audio.
2. Choose a subtune with the − / + buttons and press **Play song**.
3. When you hear the sound you want, press **Capture voices**, or **Pause** to
   inspect the held settings before capturing.
4. Select **Voice 1**, **Voice 2** or **Voice 3**. The selected captured voice is
   loaded immediately: the preview closes and the preset becomes this keyboard's
   instrument. An unavailable voice shows its reason and keeps your instrument.
5. Play, edit, **Save voice preset…**, or **Copy JavaScript** as usual. The sound
   is applied to the selected CH, or all three in Round robin.

**Auto · file** follows a known 6581 / 8580 declaration. Unknown/either hints
use PAL / 6581 by default; manual selection can resolve an unknown/either model.
A known conflicting model or NTSC declaration is rejected without rewriting
the file. With **Auto update from song** on, compatible observed settings also
update the keyboard's selected target, including the model. With it off, use a
captured Voice to import a sound explicitly.

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

### Pause, inspect and resume

**Pause** holds the current song position and CPU / SID state. Its button becomes
**Resume**, which continues the same preview without reloading the file.
With Auto update on, **Your sound** keeps the same read-only controls at the
acknowledged pause point. Switch **CH 1 / CH 2 / CH 3** to inspect that held
state, or turn Auto update off to edit the latest playable settings. No periodic
reads are needed while paused.

**Capture voices** works while paused and reads that same fixed machine state.
You can Resume after capture, or select a captured Voice to stop the preview
and load it into the keyboard. A Synth key and **Stop all sound** also close
a paused preview. File cancellation or a failed replacement keeps it paused;
a successful file / model / subtune replacement starts ready for a new Play.

Pause is acknowledged at an audio-processing boundary. A short 5 ms host-output
bridge softens Pause / Resume edges while the paused chip remains completely
unclocked. It changes no CPU / SID state, pitch, envelope or filter history;
ordinary playback is unaffected. This is transport smoothing, not a chip effect.

The app entry, import controller, preview audio module and its Worklet use a
paired transport revision in their URLs. Startup checks the Worklet's protocol
and Pause / Resume support before playing. This prevents an updated Synth from
silently using an older cached audio module. If an already-open older page shows
`Unknown SID command: pause`, reload the page to load the paired modules.

### Automatically reflect a playing channel

**Auto update from song** is on by default. During song preview, **Your sound**
follows the selected physical **CH 1 / CH 2 / CH 3**. Compatible voice settings
are kept in that channel's keyboard patch. In **Round robin**, the last explicitly
selected song CH is observed and its compatible settings are applied to all three
keyboard channels when those settings change. Selecting Round robin alone, or
advancing to another observation of unchanged settings, does not copy them. The
song itself is never changed.

Turn Auto update off to keep the latest playable settings and edit or audition
them. CH selection remains available. While paused, the same controls inspect
the held state until Resume. Unsupported raw settings remain visible while Auto
is on, with their reason; they do not overwrite the last playable patch. Loading
a preset/setup or using Reset turns Auto update off so the explicit choice stays.

Live and editing use the **same controls in the same positions**: waveform
buttons, Pulse width, ADSR, filter and modulation controls update in place.
Live values are read-only and changes are highlighted. Turning Auto update off
keeps the same control nodes and folded sections and enables editing again.
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
Pulse width remains observable but is dimmed when the Pulse flag is off.
The Live **Observed frequency ratio** is the preceding oscillator's frequency
divided by this channel's frequency, not a separate SID register. It is dimmed
when both Sync and Ring are off. These values can continue changing even while
they do not affect the current sound; the tooltip explains the inactive state.

This uses the existing player's coherent Worklet read at up to 20 updates per
second, with one read at a time. It never writes the song or starts keyboard
audio merely to reflect settings. Fast register changes between observations can be
missed; this is a sampled view, not a complete register-write recording. Capture
still reads one fixed batch, and the captured Voice buttons load that batch.

## Three voices and oscillator modulation

**Round robin** uses the three physical SID voices in round-robin order.
**CH 1 / CH 2 / CH 3** plays only that selected physical channel, with one
sounding note at a time. **Keyboard · software** selects its overlapping-key
behavior:

- **Retrigger** (default) replaces the old key and restarts the hardware Gate / ADSR.
- **Legato** keeps Gate on while keys overlap and changes pitch without restarting
  ADSR. The last key pressed wins; releasing it returns to the most recently
  pressed key still held. Releasing the final key lowers Gate and starts hardware
  Release. It also retunes the silent source when Sync / Ring is enabled.

Legato is software key allocation, not an additional SID hardware mode. It is
inactive in Round robin, which keeps its existing allocation; the choice is
retained for the next fixed-channel selection. Changing keyboard mode stops
held keys and resets Pitch. Voice preset imports and automatic song updates
preserve this separate performance setting.

The SID envelope can wrap from 255 to zero and freeze when Gate is retriggered
before Release has reduced a full envelope (especially Sustain 15). Retrigger
keeps that chip behavior. Legato avoids that Gate cycle for overlapping keys;
it does not replace the hardware envelope or change SID song playback.

Allocation prefers a silent voice, then an older released tail, then the oldest
held voice. Releasing an old key cannot release its replacement. Key release
lowers the hardware Gate and leaves the hardware release envelope running.
The 8580 model has no per-voice envelope observation, so released slots are
treated as possible tails until reused; they are preferred over held voices.
**Stop all sound** flushes voices, queued PCM and output tails while retaining
the instrument. Stop, preset load and topology changes also reset Pitch.

Sync / Ring use the selected carrier's physical preceding oscillator:
**CH 3 → CH 1**, **CH 1 → CH 2**, or **CH 2 → CH 3**. In Round robin, if any CH
has Sync / Ring enabled, the first such CH becomes the single carrier with its
physical predecessor, giving one keyboard note. All saved channel patches are
kept. The source runs as
a silent Triangle oscillator; its saved channel patch is kept for a later target
selection. It is not an extra emulated chip.
Its Gate/envelope and selected output waveform do not control the modulation:
hardware Sync resets phase, and Ring changes the Triangle oscillator's sign.
Enable **Triangle**, alone or combined with other waveforms, to hear Ring.
Other carrier waveforms can still use Sync.

**Modulator ratio** is a software tuning control for the physical preceding
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

`voice.waveform` keeps its existing string field. It accepts the four single
names, `off`, or canonical combinations such as `triangle+saw` and
`triangle+saw+pulse`. Names are normalized in Triangle / Saw / Pulse / Noise
order. The API and **Copy JavaScript** use the same values, for example
`sid.setVoice(0, {waveform:'triangle+saw'})`. Existing single-wave presets retain
their format and values. The selected core approximates the chip's combined
waveform behavior; it does not mix extra software voices.

The separate `tetorica-sid-channels`, **version 2**, setup contains three portable
version-2 voice presets, `target` (`0`, `1`, `2` or `'round-robin'`) and
`keyboardMode` (`'retrigger'` or `'legato'`). Existing version-1 channel setups
load with Retrigger; new saves use version 2. All three
share their model and filter. Round robin can retain three different patches.
**Load preset / setup…** accepts either format. A voice preset
loads into the selected CH (all three in Round robin); a setup restores the
complete bank, target and keyboard mode. A voice preset leaves keyboard mode
unchanged. Both formats contain settings only, never song bytes.

To try a voice from [SID Player](https://kyorohiro.github.io/hello_ymfm_wasm/sid-player/index.html),
capture a supported voice in **Voice snapshot → SID Synth** and save its preset,
then choose **Load preset / setup…** here. On the same origin, the Player's explicit
**Open in SID Synth** link supplies that validated preset directly. This loads
the preset without starting audio; play a key or enable audio to hear it. The
temporary handoff expires after five minutes and is consumed once. Invalid or
expired requests keep the current preset and show a diagnostic. Standalone
packages on different origins use the portable JSON file workflow.

Snapshots retain the model, one carrier waveform, Pulse width, ADSR register
codes and the selected voice's shared-filter routing / settings and chip volume.
An isolated Sync / Ring pair also retains both carrier modulation flags and
the unrounded source/carrier frequency-register ratio. The original physical
connection is remapped to the selected carrier's **silent Triangle predecessor**
(the first paired CH in Round robin), using one keyboard note. SID Sync / Ring uses oscillator phase rather
than the source's audible waveform / Gate / ADSR. Both 6581 and 8580 allow a
source with no waveform selected; its phase continues while Gate is off too.
The original source's audible part and the third song
voice are not copied. Pairs with source / carrier TEST, zero frequencies, ratios
outside 0.125×..8× or three-voice modulation chains remain unavailable in the
Player. Snapshots restart as a keyboard-controlled instrument: the original musical pitch,
elapsed envelope, oscillator / noise phase and later song automation are not
recreated. Combined waveform flags are retained. No-waveform snapshots, TEST,
unsupported modulation dependencies and silent-routing cases still show reasons
when they cannot become a playable keyboard preset. The source modules remain readable in
[voice_snapshot.js](https://github.com/kyorohiro/hello_ymfm_wasm/blob/main/docs/sid-player/voice_snapshot.js)
and [handoff.js](handoff.js).

**Copy JavaScript** targets C64 mode in the Playground. A 6581 preset uses the
primary `sid`; an 8580 preset creates a separate `sid8580` instance with
`await createSoundChip('sid', {id:'sid:8580-voice', model:'8580'})`, supported in
Main and Worker execution. The code describes the fixed physical voices, routing and frequency ratio;
standalone keyboard allocation remains host software. The modules
[preset.js](preset.js), [channel_settings.js](channel_settings.js), [instrument.js](instrument.js), [audio.js](audio.js),
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
