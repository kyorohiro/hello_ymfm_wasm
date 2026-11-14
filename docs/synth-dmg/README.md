# Tetorica DMG Synth

Project identifier: `tetorica-dmg-synth`.

Product identifier: `tetorica-dmg-synth`.

[Open the synthesizer](index.html) · [Game Boy Playground](../playground/index.html?mode=gameboy)

Play Pulse, Wave and Noise as an instrument, draw a Wave RAM cycle and take
the settings away as a preset or JavaScript. This English-language browser
app uses the existing Game Boy DMG APU core and Synth APIs, with the compact
keyboard and output display used by Tetorica's FM2612 / SPU Synths.

## Play and edit

1. Choose **Synth (Round robin)** or **CH1–CH4** in the common **Channel** selector above the monitor.
2. Select **Enable audio**, then click a key or play the displayed computer keys.
3. In Synth, choose **Pulse**, **Wave** or **Noise** under **Source**. A fixed CH uses its hardware source.
4. Change its controls, use **Files → Save sound**, or **Menu → Export → Copy JavaScript**.

The same Channel selection controls the display, edits and keyboard in idle,
Code and VGM contexts. CH1 / CH2 are Pulse, CH3 is Wave and CH4 is Noise;
Sweep belongs to CH1 only. Choosing a CH does not copy its settings into
another channel, retrigger notes, stop Code or move a VGM song. **Synth (Round
robin)** shows the common authored instrument and uses its existing source
pool. Selecting Synth alone leaves different CH values intact. Changing one
control in Synth applies only that touched field across the relevant channels;
it does not replace their other settings. A mixed-settings indication explains
when the physical channels differ.

**Auto update** is On by default. It updates the displayed physical-CH values;
Off freezes automatic observation; deliberate edits still update their touched
fields. It does not change the selected CH, keyboard routing,
Code execution or song playback. Use this same selector and Auto update control
for Code and VGM observation.

The hamburger **Menu** beside Enable audio contains Import / Export and Reset.
Import a VGM / VGZ there to keep its original file and extracted sounds in
Files. Importing an instrument JSON also adds it to Files without applying it;
select the sound file when you want to replace the edited instrument.

Selecting a sound while Code is running applies it to the same APU without
restarting live loops, context, `livePrepare()` or software FX. The starter
reads the selected Pulse / Wave / Noise source for each new note. Other Code
continues to address its explicitly chosen physical channels. Uploading new
Wave RAM stops a held Wave note; the loop continues and can trigger it again.
Explicit Stop retains the latest selected preset. Importing a project or
starting a VGM song still stops Code before transferring ownership.

Automatic performance is **VGM or Code**, with manual controls and keyboard
available alongside either. Starting the other automatic source transfers
ownership; moving a knob, playing a key or loading a sound keeps that source
running. During VGM playback, hand operations use the reference APU's same four
channels, and the next recorded write can change the same parameter again.

Opening the page or editing a source does not start an audio device. Playing
a key can also initialize audio. In Synth, all keyboard keys play the selected
source; a fixed CH sends every key to that one physical voice. There is no
split by keyboard region.

One APU supplies the following physical channels:

| Source | Keyboard voices | Sound controls |
| --- | --- | --- |
| Pulse, Sweep off | Two, using CH1 / CH2 | Duty, initial volume and hardware volume envelope |
| Pulse, Sweep on | One, using CH1 | The same controls plus hardware pitch sweep |
| Wave | One, using CH3 | 32 four-bit samples and hardware output level |
| Noise | One, using CH4 | Clock divisor / shift, 7- or 15-bit LFSR and hardware volume envelope |

In Synth mode, the keyboard allocator prefers an available channel in round-robin order. If
all channels for the source are occupied, a new key replaces the oldest note.
Releasing the replaced key cannot stop its replacement. Changing Source or
enabling / disabling Sweep stops held notes. The voice capacity is shown above
the editor. Fixed-CH mode is monophonic and retains that CH's own settings.
The Synth does not duplicate APUs to add polyphony.

**Noise does not follow musical note pitch.** Every keyboard key triggers the
same configured noise; its clock and LFSR width set the character. Both Pitch
wheels are disabled for Noise.

Guitar / Bass / Ukulele, fret positions and visible string ranges change the
keyboard layout. **Octave − / +** shifts it by up to two octaves. Tone keys
below the selected hardware channel's frequency range are disabled; raise the
octave to use them. **Pitch** bends sounding Pulse / Wave notes by up to two
semitones and returns to center on release. The wheels to the right of the
output display and to the left of the keyboard stay synchronized. At the hardware pitch limit, an
unavailable bend is rejected while the previous valid pitch is kept.

**Stop all sound** stops notes while retaining the instrument. Leaving the
page, switching away from its window or hiding the page also releases keyboard
notes. Code has its own Stop control; leaving the page stops it too. If
the audio engine fails, select **Enable audio** to reconnect.

## Keyboard / Code, Files and channel editing

Select **Code** beside Keyboard to edit `/index.js` in the same Synth. **Run**
starts a fresh performance, **Apply** updates named loops while preserving
`context` and `livePrepare`, and **Stop** fades the software output and restores
your edited instrument and Wave RAM. Switching between Keyboard and Code keeps
Run, loops, `context`, preparations and FX running. The shared transport stays
visible in Keyboard, including explicit Stop.
Code borrows the same APU, Master and output display; it does not create extra
hardware voices. Instrument edits and preset selection keep Code running on
this APU; a Wave RAM replacement can release a held Wave note.

The starter uses the current sound: CH1 for Pulse, CH3 for Wave, CH4 for Noise.
Its note lengths and rests use `beat()`, so `setBpm()` changes the whole rhythm.
Use `await` for chip operations. You can also address all four physical channels:

```js
const gb = await useSoundChip("gameboy");
setBpm(120);

liveLoop("four-channels", async () => {
  await gb.pulse.noteOn(CH1, "E4");
  await gb.pulse.noteOn(CH2, "B3");
  await gb.wave.noteOn("E2");
  await gb.noise.keyOn();
  await beat(0.25);
  for (const channel of [CH1, CH2, CH3, CH4]) await gb.keyOff(channel);
  await beat(0.75);
});
```

Choosing Code keeps focus on the tab, so computer-key performance works outside
the editor, including after Stop. Click inside the editor to type; text/number
fields, selects and dialogs keep their own keys. Use `beat()` for musical note
lengths and rests to follow `setBpm()`. Existing saved scripts are kept.

CH constants are zero-based: CH1 is 0 and CH4 is 3. Noise uses `keyOn` /
`keyOff`; it has no musical note pitch. Wave uploads stop CH3, just as in the
existing API; trigger it again after changing Wave RAM. `initialize()` and
`reset()` retain their public chip meanings and can replace current register
settings; omit them when keeping the upper editor sound. `setClock` accepts
only the fixed DMG clock in this standalone Synth.

The common **Channel** selector remains the edit and keyboard target while
Code runs. Select CH1–4 to view and edit its physical Pulse / Wave / Noise
controls, or Synth to edit the common instrument. Selecting a CH does not
rewrite Code: existing scripts keep addressing their explicitly chosen
physical channels.

The channel values are sent/configured registers, including the initial volume,
Wave RAM and base pitch. They are not measurements of current hardware envelope
volume or Sweep frequency. **Auto update** is capped at 20 Hz, with only one
request at a time. Off freezes the displayed values while retaining the same CH
and keyboard route; it does not return to Synth or stop Code. Observation alone
does not rewrite a preset. A deliberate edit sends only the fields you touch,
keeping other channel settings, pitch and Gate. Those fields also update that
CH's authored sound for Stop and Save sound. Wave RAM replacement can end a
held Wave note. The physical CH determines Pulse / Wave / Noise, and Sweep
remains CH1-only.

Keyboard works alongside Code on this same APU. A fixed CH plays that physical
voice using its current settings, regardless of Auto update. Synth uses the
common sound's source pool and round robin. The latest Key On owns a physical
channel. An older Code release or keyboard key-up cannot cut its replacement;
releasing it does not restore an older note. Blur releases keyboard notes while
Code continues. Explicit Stop ends both. Code can automate Duty, pan or Noise
clock while you play the keyboard. If Code and a knob write the same parameter
repeatedly, the latest write wins.

`liveLoop`, `beat`, `tween`, `context`, scheduling and `liveFx`
are software facilities, separate from APU Envelope / Sweep.

**Files** opens the project tree. Add code, local modules or data; right-click
for Duplicate, Rename, Delete and new JavaScript / sound / folder. Use
**Menu → Import / Export** for external files and project ZIPs.
**Save sound** creates a readable JSON preset under `/presets`.
Selecting a valid sound JSON loads it; text and JSON are edited in Code. File
selection leaves Keyboard selected when Code is hidden. The maximize button
moves Code beside Files; restoring it returns to the controls.

Files, code and edited presets save locally, without automatically running code
or starting audio when restored. Export project to keep a portable Cassette ZIP;
the shared 16 MiB project limit applies. Master, octave and temporary Pitch are
not instrument settings. Code completion and source navigation use the existing
Game Boy API declarations and readable modules. Timing runs on the browser's
JavaScript clock and does not promise sample-accurate or background execution.

## Hardware controls and the waveform editor

Pulse Duty changes the square-wave width. Initial volume and hardware
Envelope / Sweep edits are used on the next note, rather than restarting a
held note. Envelope pace is a hardware code: 0 holds the initial volume;
1–7 changes it at multiples of 1/64 second. It is a rising or falling volume
envelope, not an ADSR editor.

Wave has a single drawing canvas. Choose Sine / Triangle / Saw / Square, or
draw the 32 samples yourself. Samples are integers from 0 to 15, matching the
four-bit Wave RAM. A shape selection applies immediately; a drawing applies
when you release the pointer. Interrupted strokes are discarded. Applying new
Wave samples stops held notes so the RAM can be updated; play a key again to
hear the result. There is no separate Apply button.

Wave level, Pulse Duty, Noise clock parameters and left / right routing can
change while a note is held. Source, Duty, directions, Wave level and Noise
width use choice buttons. Clicking an option leaves the performance keys
available immediately. Tab to the selected option and use Arrow keys or Home /
End to change it; letter and number keys remain available for playing notes.

Numeric sound controls use **− / value / +** buttons. Click to step by one, or
drag the center value horizontally. Pointer adjustments leave the performance
keyboard available. Tab to a control for Arrow keys and Home / End; buttons
disable at their hardware bounds. Sweep controls stay disabled while Sweep is Off.

The APU generates the chip sound. Waveform drawing, round robin, keyboard
layouts, the Pitch wheel and preset files are software performance tools.

## Output display and volume

**Waveform** and **Spectrum** observe the final output after Master volume,
through a passive analyser branch. The display does not add a second speaker
connection. Idle / hidden displays stop updating.

Master ranges from **0 to 380%** and turns **orange above 100%**. It scales
the output separately from the chip's authored volume / envelope settings,
using the existing Game Boy source balance as its reference.

## Reference VGM songs

**Menu → Import → VGM / VGZ…** keeps the original file under `/vgm` in Files and
extracts static sounds into `/presets/<song name>/`. You can add original files
without extraction through **Menu → Import → Project files…**, too. Name collisions create a new file;
original VGM/VGZ bytes are preserved. Sources without a usable static instrument
can still be retained independently of sound extraction. The Files project has
a shared 16 MiB limit. If a source cannot fit, the extraction workflow continues
and reports that the original was not saved.

Choose a track in the **VGM** list above the monitor, then press **Play**.
The same button becomes **Pause**, then **Resume**. Pause retains the exact
unheard PCM position; it does not restart the parser or retrigger the notes.
**Stop** returns to the start and restores the editable sound view. A file
selection, import or restored project never starts playback. The original
instrument and its Wave RAM remain separate from the reference APU.

Drag the **position bar** and release to seek. The exact preview time appears
beside it; moving the pointer alone does not change playback. Arrow keys and
Home / End also work. A seek keeps Play / Pause, and seeking from Stop prepares
the selected position paused. The destination refreshes all four channel
settings even with Auto update Off, so keyboard audition and Capture use the new
position. **Escape** cancels an unfinished drag or a seek; **Stop** resets to
the start.

Seeking silently rebuilds the reference APU from the beginning in bounded,
cooperative slices, including elapsed Envelope / Sweep and Noise state. It
retains future PCM for an exact Resume and never rewrites the editor APU. A
failed or cancelled seek keeps the old position; Stop, another source or Code
cannot be overwritten by a late seek. Progress is shown while preparing;
preparation has a 30-second work limit. Checkpoint caching is not enabled.

Use the common **Channel** selector to choose CH1–4 and follow recorded
Pulse Duty / envelope settings, Wave RAM / level, Noise clock and routing in the
same editor. While playing, change a control or play a key to intervene directly
on that physical song channel. Synth uses the selected source's round-robin
pool on this same reference APU. Keyboard notes use its current channel settings;
they do not add another set of hardware voices. A later VGM write wins for its
register, including a new recorded trigger replacing the keyboard note.
Releasing an older key or returning its Pitch wheel cannot cut or bend that
newer VGM note. Noise still ignores musical key pitch.

These numbered-CH edits are temporary song interventions. They do not rewrite
the original VGM or your authored preset. Synth controls and loading a preset
also update the authored instrument for Stop / Save, and send that edit to the
playing APU. A changed field is merged against the latest generated registers,
so a frozen UI cannot restore another field's old pan, frequency or envelope.
Wave RAM uploads can stop CH3; the other channels and song clock continue.

**Auto update** is On by default; Off freezes automatic observation of all four
channels, keeping the selected CH and keyboard route. Deliberate edits update
only their touched fields; the other displayed fields stay frozen. Changing CH
shows that same snapshot with its manual edits. Pause refreshes that
snapshot to its exact audible position even with Auto update Off. Updates are
capped at 20 per second and follow consumed audio time. Deliberately edited
fields appear immediately while that write waits for the queued audio prefix;
other fields keep following the audible song. Once the write reaches playback,
its temporary display override expires and later VGM writes are visible again.
Hand edits affect future PCM after the short queued prefix: the foreground renderer targets 35 ms of
lookahead, with small native slices, rather than discarding audio or skipping
song time. This is a software scheduling target, not a sample-accurate or
background latency guarantee. These are sent/configured registers, not measured hardware
Envelope volume or current Sweep frequency.

Once the last few milliseconds have already been generated, **Finishing song**
temporarily disables new intervention; it keeps the original duration and queued
audio. Stop, a source change, a successful seek or switching to Code clears
manual note ownership. Seeking reconstructs the original VGM at the destination
without replaying earlier manual edits. A cancelled seek retains the old queued
audio. Blur releases hand-played keys while the song continues.

While paused, the numbered-CH controls are read-only. Choose **CH1–4** and play
the keyboard to audition that frozen channel.
The trial temporarily borrows the editor APU and restores its instrument and
Wave RAM afterwards. It never changes the paused song APU, position or unheard
PCM. CH1 / CH2 use their captured Pulse settings, CH3 its 32 Wave samples, and
CH4 its Noise clock. Noise keys retrigger the same noise without adding pitch;
hardware Sweep remains CH1-only. Changing CH, resuming, stopping, starting Code
or changing the song ends the trial. A silent or invalid channel shows a reason
instead of playing another instrument.

**Capture to Synth** keeps the song paused and changes the common Channel
selection to **Synth (Round robin)**. Files saves the original instrument and a new captured
instrument as separate, uniquely named JSON presets. Edit or play the new sound,
or choose a song CH to return to the frozen registers without losing those edits.
Resume continues from the retained song position. Capture recreates configured
registers for a new trigger; it does not recover game note history, length
counters or the elapsed Envelope / Sweep phase.

**Song channels · software mute** provides separate On / Off switches for
CH1 Pulse (+ hardware Sweep), CH2 Pulse, CH3 Wave and CH4 Noise. Leave only the
channels you want to hear On. This is a reference-playback output control:
recorded registers, channel observation, paused keyboard audition, Code and Capture keep
their original settings. While playing, manual keys share the reference APU and
follow the same channel mute. An Off channel can still be selected and auditioned
while paused, or captured into an editable instrument.

All four channels start On. Switches work before loading a song and stay set
through Stop, source changes and seeks for the current page session. They are
not stored in instrument JSON or the Files project. Changes affect newly
generated PCM; the short pre-rendered buffer retains its old mix until consumed
(also after Resume). Keeping those samples avoids skipping song time or
resetting the oscillators, Envelope / Sweep and Noise state.

The reference uses its own DMG APU, sharing the existing audio context, source
balance, Master and output monitor. Master affects the song in real time. Starting
Code or importing a project stops the reference song. Loading an instrument
keeps playback or Pause; edits in the paused **Synth** view keep the position.
Repeated VGM loops are later work; this version plays the recorded command
stream once.

Playback currently accepts one normal-clock DMG (4,194,304 Hz) with direct
Game Boy register writes and ordinary VGM waits. Unsupported chip combinations,
dual/variant chips, different clocks, DAC streams/data blocks and other commands
are rejected with a reason before acquiring audio. The shared parser does not
implement Game Boy DAC stream target `0x13`; it is not silently skipped. Invalid
or cancelled source validation keeps the previous playable song and instrument.

## Import sounds from VGM

Select **Menu → Import → VGM / VGZ…** with a Game Boy VGM or gzip-compressed
VGZ file. Analysis writes Pulse, Wave and Noise presets into a uniquely named
folder under `/presets`, then opens Files. Choose a sound JSON in that folder
to load it, then play the keyboard. Import alone keeps the current instrument
and Code mode, and does not start audio. Re-importing a source creates new
paths rather than overwriting its previously edited sounds.

The import uses initial register settings at each recorded trigger: Pulse Duty,
volume envelope and CH1 Sweep; complete 32-sample Wave RAM and its output level;
Noise clock, LFSR width and envelope. Left / right routing is included when
recorded. Identical sound settings are grouped before saving.
Imported sounds remain editable and can be saved as presets or copied as JavaScript.

This extraction supplies a starting sound for keyboard performance. Original note
pitch, hardware length counters and later register changes are not imported into
that sound. Use the separate VGM reference controls to hear the recorded song.
The page reports missing settings and unsupported input; failed or cancelled
imports keep the current instrument and previously saved sounds. Original-file
storage and preset storage are reported separately: a log can be retained even
without static sounds, and sound extraction can succeed when the original log
does not fit. A sound batch is saved in full or not saved. Input files and
decompressed VGM data are limited to 64 MiB; the shared Files / project limit is
16 MiB. All analysis stays in the browser.

## Presets and reusable code

**Menu → Export → Instrument · DMG JSON** downloads `dmg-voice.json`, containing the instrument name,
selected source, Pulse settings shared by CH1 / CH2, Wave's 32 samples and level, Noise
settings, and left / right routing. The portable format is
`tetorica-gameboy-voice`, version 1. **Menu → Import → Instrument · DMG JSON…**
validates the file and adds it to Files; select its JSON there to apply it.
Malformed or oversized files preserve the previous sound. Loading a full
preset or resetting seeds all four authored channel sounds from that one
instrument. It can release held notes while keeping Code Run or VGM playback. Merely choosing
Synth or another CH does not seed or unify settings.

**Files → Save sound** and instrument JSON export save one ordinary single
instrument for the selected idle / Code CH, or the common sound when Synth is
selected. The four different channel sounds are a page-session bank, not a new
portable preset format. Project / local restoration uses its saved single
instrument to seed the four channels again; it does not restore an independent
four-CH bank. To save a song channel, use Capture to Synth first. The public SDK,
WASM and version-1 JSON schema are unchanged. Master, keyboard layout, octave and
the temporary Pitch wheel are performance controls and are not saved in the
instrument preset.

**Menu → Export → Copy JavaScript** generates the selected source's setup and a single-channel
audition. Open the Playground in **Game Boy** mode, replace its default script
with the copied code and Run it.
The snippet uses the initialized `gameboy` API and includes a release command
as a comment. Keyboard round robin belongs to this standalone app and is not
part of that single-voice snippet. Master volume and the temporary Pitch wheel
are not included. The generated code is also shown on the page
for manual copying if clipboard access is unavailable.

Use **Files → Save sound** / **Menu → Export → Project · ZIP** for the local project,
or **Menu → Export → Instrument · DMG JSON** for an individual instrument download. Analyzer-exported voice
JSON and audio recordings are not imported directly. The existing Analyzer and Playground provide separate extraction /
Sample Editor workflows.
GBS song playback and full Game Boy emulation are outside this APU Synth.

## API, source and licenses

- [npm API catalog](../../packages/fm2612/README.md#api-entry-points): reusable Synth helpers and low-level entry points.
- [GameboySynth](../../tetorica_src/runtime/gameboysynth.js) and [GameboyApu](../../tetorica_src/runtime/gameboyapu.js): musical controls and register / PCM access.
- [Standalone preset schema](preset.js), [instrument and allocator](instrument.js), [AudioWorklet](processor.js) and [browser audio lifecycle](audio.js).
- [Native Game Boy core and provenance](../../third_party/tetorica-soundchip-native/vendor/mame-gameboy/README.md): MAME-derived DMG adaptation; [BSD-3-Clause license](../../third_party/tetorica-soundchip-native/vendor/mame-gameboy/LICENSE), with upstream credits retained.
- [Project license](../../LICENSE) and [complete attribution](../attribution.md).

The Synth adds a browser UI around the existing core; it does not change the
shared WASM or claim complete hardware timing / analog-output fidelity. Reuse
the components you need and retain their source and license notices.

## Build and verify

From the repository root:

```sh
npm run test:dmg-synth
npm run test:dmg-synth:browser
npm run test:dmg-synth:code-browser
npm run test:dmg-synth:code-monaco
npm run test:dmg-synth:song-browser
npm run test:dmg-synth:song-capture-browser
npm run test:dmg-synth:song-seek-browser
npm run test:dmg-synth:menu-browser
npm run test:dmg-synth:song-channels-browser
npm run test:dmg-synth:channel-browser
npm run test:dmg-synth:vgm-manual-browser
sh scripts/package_itch_dmg_synth.sh dev
```

The package command creates `release/tetorica_dmg_synth_dev_itch.zip`.
Use a new version argument for another archive; an existing archive is preserved.
The ZIP has a root `index.html`, the original JavaScript / CSS modules, the
original WASM pair, component notices, authenticated native sources and browser
source inputs. It can be served independently of this checkout.

The running JavaScript and CSS retain their source paths, comments, identifiers
and imports without bundling or minification. Edit `synth-dmg/` for the UI and
instrument, `js/` for the reusable chip helpers, or the shared keyboard in
`synth/synth_keyboard.js`, then reload. No JavaScript build is needed. This also
keeps the ZIP suitable as editable input for the Tauri app. Compiler-generated
WASM loaders and binaries remain unchanged under `generated/`; their native
sources and rebuild instructions are under `sources/`. The browser-input ZIP is
an additional source snapshot with hashes, rather than the only editable copy.
