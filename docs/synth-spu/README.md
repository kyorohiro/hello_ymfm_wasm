# Tetorica SPU Synth

PlayStation 1 SPU synthesizer / emulator

[Open the synthesizer](index.html). This standalone sound laboratory uses the
same PS1 SPU WebAssembly core and editing controls as Tetorica Playground, with
the Guitar / Bass / Ukulele keyboard from the FM2612 Synth. Its silver panels,
charcoal displays and red / yellow / blue accents follow the supplied SPU
Synth icon. The original icon is used in the header and browser icons.
Master volume uses the existing calibrated PS1 System gain as its reference.
The Master slider reaches 380%; it turns orange above 100% and blue at or below 100%.

The upper-left **☰ Menu** follows FM2612 Synth's Import / Export layout and
stays available while Code is maximized. **Import** opens VAB / VH + VB, PSF
sets or folders, Audio samples, SPU instrument JSON, project ZIPs and project
files. **Export** downloads the instrument JSON, project ZIP or selected file.
Choosing Audio or a sound bank reveals its settings tab. Cancelling a file
picker keeps the current sound and Code performance.

## Play and edit

1. Select **Enable audio**. Opening the page does not start an audio context.

2. Play the displayed number/letter keys or click the on-screen keys.
3. Use **PCM**, **ADSR**, **FX**, **Audio** and **PSF / VAB** beneath the monitor to edit the
   common instrument. PCM is selected initially.

Software morph starts enabled, with Wave A = Sine, Wave B = Saw and amount 0%
(Sine only). Reset instrument restores this setup. Imported audio and bank Tones
disable morph; loaded presets restore their saved setting.

**PCM** draws a short repeating waveform. **ADSR** contains the envelope
parameters and draggable A / D / S / R guide. **FX** controls SPU reverb.
**Audio** sets the root note and looping option for recordings loaded from
Menu. **PSF / VAB** lists opened PlayStation sound banks and extracts supported
banks from PSF sets. Tab changes keep sounding notes and the current settings.
Use Left / Right, Home and End when a settings tab has keyboard focus.

Pitch and Morph wheels are available beside both the monitor and the keyboard.
Both locations stay in sync. Pitch returns to center when released; Morph keeps
its blend amount. Morph is disabled in both locations while Off or using Noise.

The keyboard rotates through the SPU's 24 physical voices, choosing an available
voice for each new note. All voices play the same instrument; there is no
per-voice selector. If all 24 voices are held, the new note replaces the oldest
held note. Releasing the older key cannot release its replacement. Guitar,
Bass, Ukulele, fret positions and octave shifts
change the visible keyboard tuning. The Pitch control bends all sounding
keyboard notes by up to two semitones, without restarting their samples or
envelopes, and returns to centre on pointer release. The **Sustain** checkbox
retains released keyboard notes; turning it off releases those notes without
releasing keys that are still held.

**Release notes** follows the programmed release stage. **Stop all sound** also
clears infinite releases and reverb tails, preserving samples and settings.
Leaving the page releases keyboard notes and stops Code.

**Click guard · Software** starts On for keyboard and Code's `noteOn()` /
`noteOff()`. This is a Tetorica software feature, not a PS1 register setting.
It uses the existing per-voice transition ramp and gives very fast releases
a minimum of about 3 ms. It does not change ADSR codes, shorten long or infinite
releases, or fade other voices and the shared effect bus. Turn it Off to use
raw gate transitions. Changing it affects subsequent gate operations and keeps
the current notes, sample bank and Code session in place. The switch is a Synth
preference, separate from portable instrument and project files.

## Play from Code and keep project files

The lower **Keyboard / Code** tabs share this Synth's existing SPU, sample bank,
Master and output monitor. Choose Code, then Run:

```js
const ps1 = await useSoundChip("ps1");
setBpm(120);
const state = await ps1.getState();
const channel = state.pmon.enabled ? CH2 : CH1;

liveLoop("melody", async () => {
  await ps1.noteOn(channel, choose(scale("E3", "minorPentatonic", 2)));
  await sleep(0.12);
  await ps1.noteOff(channel);
  await beat(0.5);
});
```

Await the existing PS1 methods, including `setPreset()`, `setEnvelope()`,
`setFrequency()`, `setReverb()` and `loadADPCM()`. Code uses physical channels
0–23: CH1 is 0, CH2 is 1, through CH6; use numeric indexes for the remaining
voices. Keyboard round robin is separate. The existing sample's declared root
pitch determines `setNote()` tuning. Noise retains its shared clock instead of
musical pitch. With PMON enabled, the even indexes are silent modulators and
the odd indexes are carriers; the starter chooses CH2 as the first carrier.

`keyOn()` / `keyOff()` always bypass Click guard, including when the switch is
On. For raw KON / KOFF, write:

```js
await ps1.setNote(channel, "E3");
await ps1.keyOn(channel);
await beat(1.12);
await ps1.keyOff(channel);
```

Raw KOFF still follows the programmed ADSR release; it is not an immediate
transport Stop. `noteOn()` / `noteOff()` follow the app's Click guard preference
only in this Synth. The ordinary Playground / npm API retains its existing raw
behavior.

**Run** starts a fresh context; **Apply** retains `context`, named preparations
and loops. **Stop** fades the software output and restores the edited instrument,
sample bank, Noise, PMON and Software audio. Returning to Keyboard stops Code.
Code uploads and raw changes are temporary; they do not overwrite the edited
instrument. Selecting another instrument or editing its controls stops Code
first. Master stays available during Code. Shortcuts are Ctrl/Cmd+Enter for Run
and Ctrl/Cmd+Shift+Enter for Apply. Maximize Code places the editor beside Files.

`liveLoop()`, `livePrepare()`, `tween()` and `liveFx()` are software features.
The hardware SPU still produces the notes and its shared reverb. `liveFx` runs
after the SPU, before the Stop fade and Master. There is no implicit `play()` or
independent chip factory here. Monaco provides PS1-specific types, completion
and navigation to readable API sources; a textarea remains available when its
CDN cannot load.

**Live from Code** is On by default. Choose CH1–CH24 to observe that channel's
applied PCM, ADSR and shared FX in the same controls. Observation is read-only,
does not allocate another voice and is limited to 20 updates/s; intermediate
register writes can be missed. Turn Live off to show the edited instrument
while Code continues. Changing that instrument then stops Code first. Stop
returns to the authored display. Software morph appears only when its blend
still matches the observed PCM; imported ADPCM does not have an editable
112-point source waveform.

**Files** stores `/index.js`, local modules, text/JSON and binary data separately
from other Synths. Code and text edits save locally. Use relative `await import()`
and `await file()` for project resources. **Save to presets** beside Instrument
name, or **Save sound** in Files, writes the current edited sound and its sample
to `/presets/<instrument name>.spu.json`. Change **Instrument name** before saving
to choose a name. Existing files are kept; repeated names get `(2)`, `(3)`, etc.
Saving opens Files and selects the new preset. Select a saved JSON to apply it.
Recalling an identical loaded ADPCM sample reuses it, including its tuning and
loop settings, so switching saved sounds does not keep consuming SPU RAM.
Only explicitly saved sounds become preset files; opening a bank does not
expand every Tone into a separate file. **Export project / Import project** retains Files and the selected Code
file. The project import / export commands are in Menu, with project files
and selected-file export. Restoring files never runs Code, creates audio or automatically loads an
instrument. Project ZIPs and their expanded contents are limited to 16 MiB;
use **Menu → Export → Instrument · SPU JSON** for larger Software audio instruments.

## Instrument display

**Envelope** shows the measured output RMS history on a dBFS scale. It is a
sound-level display; the editable ADSR guide is in the **ADSR** settings tab.
**Waveform** shows the live audio signal, and **Spectrum** shows its frequency
content on a logarithmic axis. All three read the final output after
Master volume; the ±2-semitone **Pitch** wheel stays beside each view.

The display observes a passive analyser branch without adding another speaker
connection or sending updates to the audio processor. Measurements run at up
to 30 frames per second while notes or release/reverb tails are audible.
Silence, a hidden page, and Stop suspend display updates.

## Audio and instrument files

The short-cycle editor uses loop-aware ADPCM prediction. The initial Sine and
the Sine shape share this encoding, reducing the former first-quarter
staircase while keeping 112 samples and four packets. Existing editable PCM
presets remain readable and use the improved preparation when restored.

Open the **Audio** tab, then set **Root MIDI note** and **Loop imported audio**
before choosing **Menu → Import → Audio sample…**.
Audio files supported by the browser (including supported M4A codecs) are decoded at 44,100 Hz and mixed to mono. Input files may be up to 32 MiB, with at most 30 minutes of decoded audio. Root MIDI note declares the source recording's pitch; it does not estimate or correct that pitch.

Short recordings that fit free SPU RAM are encoded as SPU ADPCM. Longer recordings automatically use **Software audio**: signed 16-bit mono PCM in host memory, outside the PS1's physical 512 KiB RAM. This is a Tetorica software extension, clearly shown beside the sample name. The native SPU still applies its Gaussian interpolation, per-note pitch, ADSR, PMON, stereo volume and reverb, with shared sample storage and independent voice positions. Long loops preserve the entire recording. This path does not add ADPCM encoding coloration. Loading another long recording replaces the host bank instead of appending another full copy. Large compressed files need more memory when decoded; the stated limits are bounds, not a guarantee that every device has sufficient memory.

The Audio tab shows decoding, preparation, success and error messages. Set root
and loop before loading; a changed setting applies on the next load.

**Menu → Export → Instrument · SPU JSON** downloads a `.spu.json` instrument containing its sample (ADPCM in version 1, base64 signed PCM in version 2 for Software audio),
tuning, ADSR, stereo volume, and shared reverb settings.
Editable short PCM cycles retain their drawing data too. **Menu → Import → Instrument · SPU JSON…**
validates the complete instrument before applying it to all 24 voices.
Loading audio, loading a preset or resetting the instrument first stops the
current notes. New keyboard notes then use the updated instrument.

The current instrument is in memory. Save instruments before reloading or
closing the page; Code and Files have their own local storage. A rejected PMON
or Noise mode change keeps held notes releasable.
If the audio engine stops responding, the page reports an error; select
**Enable audio** to restart. An explicit restart after an audio-engine failure also starts a fresh
sine instrument. This standalone version provides audio-file import and short
cycle drawing; microphone recording and the full Playground Sample Editor
remain available in [Playground](../playground/index.html?mode=ps1).

## PS1 sound banks

Choose **Menu → Import → VAB / VH + VB…**. Select one complete `.vab`, or
select its matching `.vh` and `.vb` together. Standard Sony versions 6 and 7
are supported. Opening a bank lists its Tones without changing the current
instrument. Select a Tone and choose **Load selected Tone**, then play the
keyboard. **Menu → Export → Instrument · SPU JSON** stores the imported sample and settings in the usual
`.spu.json` format.

For **PSF1 / MiniPSF**, choose **Menu → Import → PSF set…** and select the song and all
referenced PSFLib files together, or use **PSF folder…** in the same menu to retain library
subdirectories. Extract ZIP archives first. The **PSF song list** appears above
**Envelope / Waveform / Spectrum**, with the selected folder name and relative
song paths. PSF / MiniPSF songs are listed; their PSFLib dependencies stay in
the loaded set. Selecting a song does not play it. Select a **PSF entry** and choose
**Play song** to hear its original driver execute. **Pause** changes to
**Resume** and retains the unplayed samples; **Stop song** returns to the
beginning. File selection never starts audio. Master and the output monitor
also apply to the song. The separate Play! HLE player needs no external BIOS;
it keeps the edited SPU sample and settings intact. Playing the keyboard,
editing the instrument, running Code or **Stop all sound** stops the preview.
Selecting a different accepted entry also stops the old song. Failed imports
keep the previous selection. This first version has no song CH Live display,
Capture or seeking. PSF2 is not supported. Compatibility depends on the HLE
driver environment, so not every game's PSF is guaranteed to play correctly.
The initial player supports basic ADPCM, ADSR and reverb. Its Play! SPU does
not reproduce Noise, PMON or the hardware main / reverb output-volume registers;
those parts of a song can sound different or be missing. The Synth's Master
still controls the final bus. These are song-player limitations, not changes
to the existing keyboard SPU or its supported effects. Treat this as a preview,
not an exact PS1 recording reference.

To extract an instrument, choose **Extract VAB** beside **Play / Pause / Stop**
for the selected song. This opens **PSF / VAB** and shows progress and the bank
results. Select a **Sound bank** and **Tone**, choose **Load selected Tone**, then
use **Save to presets** to keep that sound in Files. You can try another Tone
and return to either saved preset later. This shares Playground's local PSF parser: CRC and
zlib validation, library resolution and RAM overlays precede standard VAB
detection. Opening files or extracting banks leaves the current instrument
and sounding notes in place. Missing dependencies and malformed input show an
error; finding no standard bank is a separate result and keeps the previous bank.
If only PSFLib files are selected, the row is labelled **Library** and supports
bank extraction; **Play song** is disabled until a song is opened.

Unavailable Tones are disabled with a reason in the option text and title.
The available count and expandable **Unavailable reasons** appear below the
Tone selector. The first playable Tone is selected automatically. This matters for banks with
unassigned samples or unsupported ADPCM packets. PSF input is limited to 512
files, 4 MiB per file and 64 MiB total, with bounded expansion and dependencies.
Extraction runs locally without executing game code or fetching libraries.
Separated VH/VB inside PSF are accepted only when full coverage, the sample-size
table and every sample's packet / END boundary identify one unambiguous body.
Ambiguous candidates are rejected. Split bodies currently require exact END
boundaries; layouts with additional sample padding, custom formats or
runtime-packed banks may need further support. Split bank labels show both
the VH and matched VB RAM addresses. The split pairing is inferred from sample
structure, not established by executing the original driver's transfer calls;
a unique structural match is not proof of the original mapping. Compare the
instrument with the source song before relying on it. This cannot recover every game's instruments.

The bank-extraction demo PSFs contain VAB data but no runnable song program;
they cannot be used to test song playback. The playback regression fixtures
contain an original, commented MIPS program instead of game assets.

The importer keeps the original SPU ADPCM payload, ADSR registers and loop
position. Bytes after the first END packet are excluded; unsupported packet
flags fail before the current instrument is stopped. Tuning uses the Tone's
centre note and fine adjustment, with positive shift raising playback pitch.
It uses continuous semitone conversion rather than a particular game's
integer pitch table. Volume/pan are static approximations. A Tone's reverb
send uses the existing shared reverb preset/returns; VAB does not specify them.
Loading a Tone stops notes and disables PMON, Noise and Software morph.

The selected Tone plays across the keyboard. Key zones, layers, driver
vibrato/portamento and per-game controller state are not reproduced. Sample
255 (libsnd Noise) and multiple loop-start markers are currently rejected.
A single loop-start marker is allowed in a one-shot sample; its original bytes
are retained and the END packet's Repeat flag determines whether it loops.
Imported samples use physical SPU
RAM; reopening banks or choosing different sample/tuning combinations can
exhaust the available space. Reusing a Tone in the same opened bank, including
after switching between extracted banks, reuses its sample allocation. Opening
or extracting banks again starts a new cache. Reload the page for a fresh RAM
bank after saving presets.

## Envelope behaviour

With **Apply ADSR / PCM edits while playing** on, changed ADSR parameters update
each sounding note's current envelope stage without resetting its level or
sample position. Attack changes do not restart a note already in Sustain;
Sustain Level is the Decay target. With the option off, the running note keeps
its ADSR through release, and the next Note On reads the latest instrument
settings. PCM edits update the common cycle. With the option on, held keyboard
notes restart with the edited waveform; with it off, they are not retriggered.
Because the sample RAM is shared, this does not preserve the old waveform for
notes that are already playing.

The envelope graph shows stage relationships, not measured elapsed time.
Rates are register indexes: lower is faster. In the retained core, release
rates 27–31 hold indefinitely. The core uses the same approximate ADSR,
four-point Gaussian interpolation and named reverb implementations as Playground.

## Development

Serve the repository's `docs` directory over localhost or HTTPS and open
`/synth-spu/index.html`. For example, from the repository root:

```sh
python3 -m http.server 8877 --directory docs
```

The application uses the existing generated PS1 WASM and JavaScript modules;
there is no second chip implementation. Audio blocks send no state messages.
Normal UI snapshots follow explicit edits and notes. While Code Live is enabled,
one passive observation request at a time runs at up to 20 updates/s, with stale
responses discarded after Stop, Live Off or an engine replacement.

```sh
npm run test:spu-synth
node scripts/check_spu_synth_browser.cjs
sh scripts/package_itch_spu_synth.sh dev
```

## itch.io release

From the repository root, build a versioned release ZIP:

```sh
sh scripts/package_itch_spu_synth.sh v0.1.0
```

The output is `release/tetorica_spu_synth_v0.1.0_itch.zip`. Change the version
argument for later releases; omitting it uses `dev`. The script copies the
authored JavaScript and CSS byte-for-byte, includes the icon, WASM, sources and
licences, and checks the ZIP's integrity. It does not upload or publish anything.

Upload this ZIP as an HTML project on itch.io and select the root `index.html`.

## Modify the distributed application

The live JavaScript and CSS in the ZIP are the original modules, with their
comments, names and directory layout preserved. They are not bundled or
minified. Edit files in `synth-spu/`, `js/`, `synth/` or `playground/` and reload
the served page to try a change; no JavaScript build step is required. The same
editable frontend tree can be used as the web assets of a Tauri application.
Rebuild that application after changing its packaged assets.

`sources/spu-synth-browser.json` records every live module's source path, hash
and local imports. The original inputs and packaging recipe are also included
in `sources/spu-synth-browser-inputs.zip`. The generated Emscripten loader and
WASM under `generated/` remain byte-identical to the fixed native SDK; changing
the chip implementation requires rebuilding the C++ sources described below.

The product code is BSD-3-Clause. Retained SPU source attribution, upstream
licenses, local changes and reproducible build inputs are described in
[PS1 SPU sources](../sources/PS1-SPU.md).
