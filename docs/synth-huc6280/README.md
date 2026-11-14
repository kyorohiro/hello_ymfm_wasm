# Tetorica HuC6280 Synth

Product identifier: `tetorica-huc6280-synth`.

[Open the synthesizer](index.html) · [HuC6280 Playground](../playground/index.html?mode=huc6280) · [PC Engine CD-ROM² Playground](../playground/index.html?mode=pc-engine-cd)

Play the PC Engine's six-channel PSG, draw a wavetable and take the sound away
as a preset or JavaScript. The English-language browser UI follows Tetorica's
SPU / DMG Synths: output monitor, compact keyboard, two Pitch wheels, Octave,
and controls that leave the computer keys available for playing.
The CD-ROM² sources share the same clock and final output. MSM5205 has a basic
sample player, and CD-DA has a WAV / track-manifest transport. Both share their
authored sources with Code.

## Play and edit

1. Select **Enable audio**, then click a key or use the displayed computer keys.
2. Choose **Wave**, **Noise** or **DDA PCM**. Every key plays the selected source.
3. Draw a waveform, change the controls, then save a preset or copy JavaScript.

## PC Engine CD-ROM² tabs and Mixer

The source tabs above the monitor are **HuC6280 / MSM5205 / CD-DA / Mixer**.
HuC6280 keeps the existing waveform, Noise, LFO, DDA and keyboard editor.
MSM5205 loads and plays an authored ADPCM sample from Files. CD-DA loads WAV
tracks or track manifests, with Play / Pause / Resume / Stop and Seek.
Changing tabs alone neither opens audio nor stops a performance.

**Mixer** gives each of the three sources an independent volume and **Mute**.
Its absolute gains match the shared Playground policy: **HuC6280 44%**, with
**MSM5205 and CD-DA 100%** until separate measured presets exist. Reset mixer
restores those values. HuC6280's previous standalone unit gain is therefore
quieter at this default. The source gains sit before the final **Master**;
Waveform / Spectrum observe the completed mix after Master. The sources share
one AudioContext and one speaker connection. A mixer change does not stop the
chip or restart a track; already rendered VGM PCM keeps its prior mix until it
has passed through the output.

## MSM5205 sample playback

Open the **MSM5205** tab, then:

1. Use **Add samples to Files…** or the Files import controls to add a WAV or
   packed ADPCM file to your project.
2. Choose **Sample in Files** and **Load as**: **WAV → ADPCM** converts supported
   PCM/float WAV data; **Packed ADPCM** uses the file bytes unchanged.
3. Press **Load selected sample**. Loading is silent; press **Play** to start.
   During playback the same button becomes **Replay**, which starts again from
   the beginning. **Stop** stops only this authored ADPCM source.

WAV conversion is software: channels are averaged to mono, resampled at the
selected Rate and encoded as four-bit ADPCM using the shared sample helper.
Packed ADPCM uses the **high nibble first** and must contain **1–65,536 bytes**.
The Files picker recognizes `.wav`, `.adpcm`, `.adp`, `.msm`, `.msm5205` and `.bin`.
Choose the format explicitly; an invalid WAV is not retried as packed data.
The memory meter shows the encoded usage against **64 KiB**, with sample count
and duration. An odd source count can occupy one extra packed padding nibble;
playback and the waveform use the original source count.

The waveform comes from the **actual shared offline WASM decoder**, summarized
into compact min/max intervals. Viewing it does not create an AudioContext or
an extra speaker connection. It shows the complete decoded authored sample,
without waveform drawing or trimming controls.

**Rate** uses the hardware code **0–15**, with its effective frequency displayed:
`1,536,000 / (48 × (16 − Rate))` Hz, from 2,000 to 32,000 Hz. Buttons and horizontal
dragging adjust it without taking the computer keys away from playing.
Changing Rate changes speed and pitch together. **Rate and Loop take effect on
the next Play**, without changing a sample already playing.

The tab and `await useSoundChip("msm5205")` share **one physical authored source**.
UI Play does not start or stop Code. Code loops and the HuC6280 continue while
you replace a sample; replacement stops only the authored MSM5205. Cancelled,
failed or superseded preparation keeps the previous sample. Code may replace
or play this same source, and its state appears in the tab. **Code Stop stops
playback but keeps the loaded MSM5205 sample** for another UI Play or Code run.
Its Mixer / Master / Waveform / Spectrum route is the same shared output.

Original sample files persist in Files and Cassette projects. The currently
loaded ADPCM selection and playback defaults are **session state**, outside the
HuC6280 voice preset and project settings. This stage does not add an MSM5205
preset format, keyboard instrument, waveform editor or VGM sample extraction.
The MSM5205 inside a VGM has its **own reference decoder**: this tab does not
show that recorded source as a Live authored sample.

## CD-DA tracks and long session WAVs

The **CD-DA** tab plays **44,100 Hz, stereo, uncompressed PCM16 RIFF WAV**.
There is no compressed-audio decoding, resampling or game-disc access.

For portable assets, use **Add to Files…**, choose a WAV or track manifest in
**Source in Files or session**, then press **Load selected source**. The picker
separates **Project Files** and **Session WAVs**. Loading a source or choosing a
track prepares it silently; press **Play** to hear it. The button becomes
**Pause** while playing and **Resume** while paused. **Stop** rewinds and keeps
the selected source. The position bar shows elapsed / total time. Seeking a
ready track sets its next starting position without opening audio; seeking a
playing or paused track retains its transport state.

Manifests use the existing format, for example `album.cdda.json`:

```json
{"tracks":[{"number":3,"file":"track03.wav","title":"Track three"},
           {"number":7,"file":"track07.wav","startFrame":44100,"endFrame":132300}]}
```

Track numbers are explicit, unique **1–99**; frame ranges are half-open at
44,100 frames per second. Relative WAV paths resolve from the manifest's folder.
Code resolves a relative source path from the executing Code file **at load
time**. Switching Code files later does not change that loaded album's paths.
Only the selected track's PCM is retained; selecting another track reads and
validates its candidate before replacing the current track. It does not cache
every WAV in an album or convert whole tracks into Float32 arrays.

**Files / Cassette retain their 16 MiB total limit.** For a longer song, use
**Open session WAVs…** to choose local WAV files. This retains File references
outside the Project, then loads the selected WAV without starting playback.
Unselected files are not read. The session limits are **99 files**, **512 MiB
of referenced files in total**, and **256 MiB of PCM per track**. The per-file
byte ceiling is **256 MiB plus a 1 MiB header allowance**. For files above
256 MiB, a bounded header-only preflight rejects excess PCM before reading the
complete file; those large files additionally allow at most 1 MiB of non-audio
headers and 256 RIFF chunks.

Session audio is **not saved, exported, backed up in local Project recovery or
restored on reload**. Keep the original WAVs and reopen them after restoring a
Project. Session paths use the CD-DA-only `/session-cdda/` namespace; they are
not ordinary Project Files. **Clear session WAVs** releases those references.
It also clears a loaded source that depends on a session file, while retaining
an independent Project-only source. Project files and other sound chips remain
available. The current CD-DA source, selected track and cursor are session state.

The UI and `await useSoundChip("cdda")` share **one authored track and cursor**.
UI transport operations do not stop Code, HuC6280, MSM5205 or VGM. A later Code
command can operate the same player; Apply retains it. **Code Stop keeps the
loaded CD-DA source and rewinds it**, so UI Play or a later Code run can reuse it.
For example, after loading a long session WAV in the tab, Code can simply call
`const cd = await useSoundChip("cdda"); await cd.play();` without importing it
into Files. Pending old Code operations cannot replace a newer UI source.
CD-DA uses the existing Mixer / Master / monitor route and remains separate
from a VGM recording. This player does not open CDs, ISO, CUE, BIOS or games,
and does not turn tracks into pitched keyboard instruments.

## Code and Files

Choose **Code**, then **Run** to play the same physical HuC6280 used by the
controls above. The starter `index.js` uses `await useSoundChip("huc6280")`,
`liveLoop`, musical scales and the chip object's methods. **Apply** updates code
while retaining `context`, named loops and `livePrepare` values. Run starts a
fresh performance. Switching back to **Keyboard** keeps Code running, so you can
play keys, edit controls or load another sound during the loop.

The starter and bundled melody examples use `beat()` for note lengths and rests,
so changing `setBpm()` changes the whole rhythm. The CD-DA example also repeats
on beats; tempo changes its restart interval while the track plays at 44.1 kHz.

Switching **Keyboard / Code** keeps the loop, context and chip session running.
Choosing the Code tab keeps performance focus on the tab, so keys can play
immediately; click the editor to type. Stop leaves the same view playable.
In Code view, typing in the editor edits text. Click a knob or the page background
to play keys without leaving Code; text fields, selectors and dialogs keep their
normal keyboard input. A later Code note can take over the same channel without
being cut by an older hand-key release. Code frequency changes also survive
returning the manual Pitch wheel to center.

The child tabs below **HuC6280** offer **Auto** and **CH1–CH6** in normal, Code and VGM modes.
Auto edits the common instrument and uses its automatic keyboard allocation
(round robin for an ordinary Wave sound);
a physical channel aligns the displayed settings, edits and keyboard with that CH.
Normal and Code modes allow editing. VGM channels remain individually editable
while playing or paused; Pause uses the heard-position settings for its separate
keyboard audition. The adjacent **?** holds detailed channel explanations and
register readouts, closed by default.
The **MSM5205** tab has one **CH1** source and **CD-DA** has one **Stereo** source;
their child tabs describe those single outputs. Mixer has no channel editor.
**Auto update** reads the configured wave and sent registers at up to 20 Hz;
turn it off to reduce readback. This is an observation of software writes, not
an oscillator-phase measurement. During Code, manual channel edits retain their changed
fields in the authored instrument. Raw Code register writes do not overwrite
the saved instrument. **Stop** fades the software output briefly, cancels Code
and restores the authored settings with all notes released.

In normal mode a physical CH has independent settings and keyboard ownership.
Selecting CH or Auto alone does not copy or unify settings. Stop / blur releases
manual notes while retaining these channel settings. Shared Auto edits broadcast
only changed sound fields; explicit sound loads, source / routing / PCM changes
replace the normal channel setup. The six-channel arrangement is session state;
**Save to presets** stores one selected sound, not the whole channel arrangement.
Starting and stopping Code restores the common
instrument. Selecting a physical CH before audio is enabled is passive; enable
audio or play a key before editing its actual settings.

`noteOn(channel, note)` / `noteOff(channel)` use this Synth's **Software
Envelope**; `keyOn(channel)` / `keyOff(channel)` operate the raw hardware gate.
Noise is available on CH5 / CH6 and does not follow note pitch. Hardware LFO
still has the fixed CH2 → CH1 route: Code must explicitly set CH2's period when
it should follow a melody. DDA uses the current shared PCM asset and software
sample feeding. Choose Auto to replace that asset; physical-channel controls
can adjust its playback settings. `liveFx` effects run in software after the Code mix.
Completion, type hints and source navigation distinguish these host tools from
the chip API.

Code also accepts `await useSoundChip("msm5205")` and
`await useSoundChip("cdda")`, using the existing Playground APIs on the Synth's
AudioContext. MSM5205 and CD-DA borrow their authored players above. **Apply**
keeps prepared sources. **Run** creates a fresh Code performance while retaining
the authored media. **Stop** fades the Code mix, cancels pending Code loads,
stops MSM5205 and rewinds CD-DA; both loaded sources remain available. Tab
changes do not create extra players. Types and source navigation cover all
three objects.

**Files → Examples** explicitly adds `examples/huc6280.js`,
`examples/msm5205.js` and `examples/cdda.js`. The existing **Add Code examples to
Files** buttons in the MSM5205 and CD-DA tabs use the same action. The HuC6280
example plays the current instrument; the media examples generate original tones
without external audio files. Only missing paths are added. Existing user files,
the current file selection, Keyboard / Code mode and running Code remain intact.
Choose an example in Code, then Run; adding it never runs it automatically.

Add your audio files through Files and use their displayed project paths:

```js
const adpcm = await useSoundChip("msm5205");
await adpcm.loadSample("/audio/voice.wav", {rate: 12});
await adpcm.play({loop: true}); // rate 12 = 8 kHz

const cd = await useSoundChip("cdda");
await cd.load("/audio/track02.wav"); // 44.1 kHz stereo PCM16 WAV
await cd.play();
```

MSM5205 `loadSample()` encodes decoded PCM or supported WAV data into its bounded
64 KiB ADPCM memory. `loadMemory()` accepts packed four-bit OKI ADPCM, high nibble
first; `play({offset, length, rate, loop})` uses **nibble** offsets and lengths.
The helper rate is 0–15 (2,000–32,000 Hz). Use `stop()` / `reset()` or inspect
`getState()`; it does not provide a keyboard `noteOn()` API.
CD-DA uses loaded audio tracks rather than an inserted game disc: `load()` is
silent, and `play()` starts the selected track. `pause()`, `resume()`,
`seek(seconds)`, `stop()`, `getState()` and `list()` use the existing track API.
Track playback, file preparation, scheduling and FX are software functions.

**Files** holds `index.js`, presets, text and binary assets. Selecting a sound
loads it without stopping Code; selecting JSON while Keyboard is visible keeps
the Keyboard tab. Right-click a file for duplicate, rename, delete and creation
actions. Save sound stores the common Auto instrument under `presets/`.
The **Save to presets** button beside Channel saves the selected Auto or physical
CH sound directly to `presets/`, without Capture, changing the channel view,
selecting the new JSON, switching Keyboard / Code or stopping playback. The new
file appears immediately in Files and the preset loader. Known Wave, Noise and
CH1 LFO-pair settings can be saved. An unknown Wave RAM or physical DDA snapshot
does not contain a complete PCM asset, so the button explains why it is unavailable.
Auto can save its complete authored DDA asset. Select the saved file or choose it
in the **Preset** list to load it later; saving alone does not apply it.
The menu imports
and exports files or a whole Cassette project. Local recovery and project import
restore editable data without running Code or opening audio. Cassette projects
are limited to **16 MiB expanded**, including settings and metadata; the existing
direct audio / preset imports retain their **32 MiB** input limit. A large sound
can therefore be played and saved separately even if it exceeds the project
limit.

## Sounds from VGM

Open the hamburger **Menu → Import → VGM / VGZ…**.
Choose a PC Engine VGM or gzip-compressed VGZ, then choose a sound from the
**Wave** / **Noise** / **LFO** / **PCM** list. Analysis alone keeps the current instrument; only an
explicit sound choice loads it. Cancel, failed imports and closing the library
keep the current sound. Files and expanded VGZ data are limited to 64 MiB.
Import also saves the original file under `vgm/` and the extracted instruments
under `presets/<VGM name>/`. Saved Wave/PCM sounds always keep the loudest volume
variant when their other settings match. Existing files are retained; importing
the same name creates a numbered folder. Select a saved preset in Files to load it.
Adding a VGM through the general **Add files** action only archives its source;
use **Menu → Import → VGM / VGZ…** to extract and save its instruments.
The shared **Auto / CH1–CH6** child tabs and **Auto update** controls sit below
the sound-source tabs, and remain available when a song is not playing.
The collapsible **Sounds from VGM** card stays near the VGM transport.
Extraction explanations
and the volume-grouping explanation are behind **?**, closed by default, while
the sound choices and **keep loudest volume variant** option remain available.
Collapse the sound list while following the same channel settings and output display.

**Wave / PCM: keep loudest volume variant** optionally groups Wave or PCM entries whose data
and all other sound settings match, showing the highest channel-volume version.
It is on by default and can be toggled after loading; turning it off restores
every entry in the library list without changing the automatically saved presets.
Different pan, rate, Loop or other sound settings remain separate,
as do Noise / LFO sounds. The representative retains its own channel,
timestamp and preset; uses, origins and warnings are combined. Equal volumes
keep the first entry. Switching the option keeps the current instrument and
held notes. If a selected quieter entry becomes hidden, its selection marker
clears; choosing the loud representative is a separate action.

Wave imports retain the recorded 32 five-bit samples, channel level and stereo
balance. Noise imports retain the CH5 / CH6 clock and channel settings. LFO imports
capture CH1 and CH2 together: both waveforms and periods, rate, depth, Reset and
CH2's output state / level / stereo balance. Different note pitches share ordinary
Wave / Noise entries; LFO period changes remain distinct paired settings.
PCM imports reconstruct supported complete HuC6280 DAC streams and uniform
direct DAC intervals, retaining the five-bit data, playback rate, channel level
and stereo balance. Their list entries identify **DAC stream** or **Direct DAC**
and show the rate, duration and Loop state. **C4 plays the recorded
rate**; other keys change the software playback speed. Selecting a PCM entry opens
the existing DDA PCM preview and controls, and Save preset includes its PCM data.
The first implementation accepts uncompressed banks and fixed CH1–CH6 DAC
destinations, with step / base, explicit or previous lengths, bank-end lengths,
millisecond lengths, fast block starts, Reverse and Loop. A positive recorded
interval must include every sample write. An interrupted sequence, changing rate,
overlapping DAC writes, compressed bank or current-selected-channel destination
is omitted. The final held DAC value after the stream ends is not replayed;
the Synth uses its normal one-shot silence / release behavior. Extraction is
limited to 65,536 bank blocks, 100,000 starts, 4,096 assets and 16,777,216 total
prepared samples, in addition to the VGM file limits.

Direct DAC extraction requires a recorded DDA key-on transition and an explicit
key-off or DDA-disable boundary. The first DAC write must be at the key-on
timestamp. At least three timestamped DAC values must have
the same positive write interval, and the final value must be held for one more
such interval before the boundary. Writes at the same timestamp use the final
value; a terminal write with no audible duration at key-off is excluded. Rate is
derived from the VGM 44,100-tick timebase without rounding fractional rates such
as **5,512.5 Hz**. A changing interval, audible mix change, unknown state or
overlapping DAC stream is omitted with an explanation. Direct imports are
one-shots: Loop and the original musical note are not inferred.
The list shows the original channel, first
time and occurrences, with 24 entries per page. Imported sounds turn **Software
Envelope off**, so audition starts from the recorded hardware settings. You can
turn it on afterward, edit the wave on the existing canvas, save a preset or copy
JavaScript. Editing clears the library's selected-sound marker.

Only fully known Wave RAM is used. The importer follows the write pointer and
its DDA reset; a write at an unknown playback position cannot be reconstructed
as an ordinary waveform. Such data is omitted with an explanation. Initial
settings and explicitly disclosed reset assumptions are used; the song's notes,
driver envelopes, vibrato and later automation are not replayed. Global balance
and nonstandard clocks may require approximation, reported in the library.

**Irregular or incomplete direct DAC intervals, unsupported DAC streams and
unknown settings are omitted with an explanation.** PCM extraction requires known source data, stream settings
and channel state; it does not infer an entire sample from an interrupted or
unexplained stream. Song notes and later register automation are not replayed.
LFO requires
both written period registers and both complete waveforms, plus the rate and
control settings. Unknown data is not replaced with a built-in wave. Song-time
oscillator phases and elapsed LFO counters are not reconstructed.

## VGM reference playback

Import with **Menu → Import → VGM / VGZ…**, or add a VGM through **Project files…**.
The original file is saved under `vgm/` in Files with a unique name. The **VGM**
selector above Waveform / Spectrum lists these files. Select a song, then press
**Play**. The same button becomes **Pause**, then **Resume**. **Stop** returns to
the beginning while retaining the selected song and your edited instrument.
Opening, selecting or restoring a project never starts playback automatically.

VGM **1.61–1.72** HuC6280 playback is retained. VGM **1.72** may also contain a
single **MSM5205** clock/flags and packed `0x32` ADPCM writes; both sources play
together, and MSM5205-only files are accepted. Such a file has no recorded
HuC6280 channel settings. Dual chips, MSM6585 variants, reserved flags and
unsupported declared chips fail with an explanation rather than disappearing
from the mix. The MSM5205 input clock is bounded to 20 MHz for this renderer.
CD-DA is a separate audio-track source, **not audio recovered from a VGM**.
The MSM5205 fields and command match the shared parser and
[libvgm's VGM player](https://github.com/ValleyBell/libvgm/blob/master/player/vgmplayer.cpp)
and [vgmtools command handling](https://github.com/vgmrips/vgmtools/blob/master/vgm_cnt.c).

The position bar previews a destination while dragging; release to seek. Arrow
keys and Home / End also work. Seeking while playing continues playback from
the destination; from Pause it stays paused. From Stop or the end of a song it
prepares the destination paused. Reaching the end while playing finishes the
song. **Cancel seek** or Escape cancels reconstruction, and Escape also cancels
an unfinished drag.

Seek rebuilds a separate reference chip from the validated song in short,
cooperative slices, without connecting the preparation audio to the output.
The current run and its unheard PCM are retained until the destination is ready.
Success replaces only that reference run and publishes all six channels at the
exact destination even with Auto update Off. The selected CH, channel On / Off
and your edited instrument are kept. Cancellation or failure restores the
previous position and Play / Pause state. Stop, Code Run, a replacement song or
project discards stale work. The displayed progress is preparation time within
the song, rather than a percentage of a download.

**Cache** starts On beside the position bar. Playback and Seek collect exact
checkpoints roughly every five seconds, plus requested destinations, within a
64-point / 8 MiB payload budget. Repeated moves start at the nearest earlier
point. The cache includes native oscillator / LFO / Noise / DDA and resampler
state, the parser's stream banks and waits, queued PCM and the known/unknown
Live timeline; it does not approximate a sound from its register values.
These exact checkpoints apply to HuC6280-only files. With MSM5205 present,
there is no complete paired HuC6280/ADPCM snapshot yet, so the UI explains that
Seek reconstructs from the beginning. It does not save only the PSG and lose
the decoder/FIFO state. Pause and Resume retain the same live mixed engine.

Stop and Code Run keep points for the accepted song. A different song or channel
output setting clears them. Changes to HuC6280/MSM5205 source mixer gains also
clear points; changing the separate CD-DA mixer leaves VGM points intact.
**Clear seek cache** is in the playback **?** help.
Switching Cache Off releases the points; neither operation changes the position,
your instrument or paused audition. New points accumulate while Cache is On.
Manual song edits keep existing clean points, but stop collecting new points
from that edited run. Seek always restores the original file's settings;
cancelling Seek retains the previous edited run and its unheard PCM.
The first move to an uncached region can still take several seconds. Unsupported
state backends or oversized checkpoints use ordinary reconstruction instead.

Reference playback renders the recorded HuC6280 writes with the existing chip
core, including timed Wave, Noise, hardware LFO and supported direct / streamed
DAC writes, plus declared MSM5205 ADPCM. It plays **once**, through the existing Master volume and output
monitor. VGM loop points do not automatically repeat. The reference chip is
independent of the authored instrument; Pause retains unheard PCM and its exact
offset so Resume continues at the heard song position.

Open the **Mixer** tab for **VGM output: CH1–CH6 On / Off**, alongside the three
source-level controls. These
software listening switches affect only the reference song mix, independently
of the Channel view selector. All six start On. Turning a channel Off does not
stop its oscillator, change its recorded Gate/volume/Wave/Noise/DDA settings,
or disable CH2's hardware LFO modulation of CH1. Live and Capture continue to
show the recorded sound. Keyboard audition, the common Auto instrument and Code remain
separate.

Changes apply to newly generated PCM after already buffered audio has played;
Pause retains that same buffered tail for Resume. On / Off never restarts the
song or changes its position. Flags remain selected across Pause / Resume,
Stop / Play and song changes in this session; they are not instrument preset
fields and are not saved in a Cassette.

Code and reference playback run one at a time. Play / Resume stops Code and
releases manual keys; Run stops the reference song. **Stop all sound** stops
both. Select **Auto** to play or adjust your own instrument while the song
continues. Preset loads in Auto view also keep playback; loading another sound
while viewing a physical song CH stops the reference and loads the authored
instrument. Capture deliberately keeps the song paused.

Select **CH1–CH6** to see the VGM's Wave, Noise, LFO, level, stereo balance,
period and Gate in the same instrument UI. While playing, change hardware
controls or play keys to write into that same reference channel. Later VGM
writes take over their corresponding parameters or gate; old hand releases and
Pitch resets do not undo a newer song gate or frequency. Existing generated PCM
is retained, so changes become audible after a short lookahead delay. Display
follows the **heard position**, rather than prefetched audio. Unknown Wave RAM stays
blank; missing register fields show an unknown marker. DDA shows the last
recorded five-bit DAC code, without assuming a continuous sample or root note.
These observations and manual song edits never replace your authored instrument
or modify the VGM file. Software Envelope and PCM asset controls belong to Auto,
not the recorded chip. DDA level and balance remain editable, but its changing
DAC code is not a keyboard-playable PCM asset. CH2 stays the LFO modulator;
choose CH1 for carrier keys, leaving the recorded CH2 period in place.

**Auto update** starts On and publishes at up to 20 Hz. Off retains a full-chip
snapshot, so changing CH views uses the same observation time. On catches up to
the heard position. Pause publishes one exact consumed-position snapshot even
when automatic updates are Off; Resume continues playback. A deliberate manual
edit also gets one update when its audio boundary is heard, while Auto stays Off.

While paused, select a recorded **CH1–CH6** to edit that channel and play the
keyboard to audition its configured sound. Only the fields you edit are projected
onto the exact heard-position snapshot; unrelated prefetched settings do not
replace that view. Edits persist when you switch between CH views. The song
position remains paused. Resume retains the already buffered PCM before the
updated settings become audible, and later VGM writes can replace those fields.
Seek rebuilds the original song settings rather than carrying manual changes
to the destination. Wave uses ordinary keyboard pitch. Noise retriggers the
recorded hardware clock and does not transpose. An active hardware LFO is
auditioned from **CH1** as the full recorded CH1 / CH2 pair: C4 reproduces the
carrier period, other notes transpose CH1 and CH2 keeps its recorded period.
Choose CH1 rather than its reserved CH2 modulator.

Audition uses one temporary, monophonic instrument in a dedicated Worklet on
the **same AudioContext and Master bus**. The newest key owns it. Its private
gain fades before retrigger, release and cleanup. It does not borrow the Code
chip or modify the edited instrument, normal per-channel settings, reference
position, native song state or unheard PCM. Changing views, Resume, Stop,
starting Code or replacing a project retires that trial instrument. No second
speaker connection is added.

Choose **Copy to Auto** to copy the configured Wave, Noise or CH1 LFO pair
into the editable common instrument. The song stays paused at the same position
and the view returns to **Auto**. Adjust it, then choose **Files → Save sound**
to keep a preset. Alternatively, **Save to presets** saves the selected CH directly,
without Capture or changing the view, song state or current Code file. Capture
itself does not create a file or resume the song.
Captured presets start with **Software Envelope Off**, keeping the recorded
hardware configuration separate from the song driver's later volume changes.
The recorded global left/right balance is folded into the preset's channel
volume and balance; both LFO outputs are handled separately. Exact attenuation
is preferred, with any quieter quantization disclosed. Neither output is made
louder, and the application's Master setting is unchanged.

Only known settings can be captured or auditioned. Incomplete Wave RAM, unknown
required registers and the active CH2-only LFO view explain what is missing.
A DDA snapshot contains one changing DAC value, not a complete PCM sample, so
it cannot be captured or auditioned as a sample. Use static PCM extraction when
a complete supported interval exists. A known but gated-off or muted sound can
still be captured, while its paused keyboard audition is disabled. Oscillator
phase and elapsed automation are not captured. Manual hardware edits are
temporary session changes; the original VGM file is kept intact.

The player accepts VGM **1.61–1.72** and requires one HuC6280 at the normal
**3,579,545 Hz** PC Engine clock. Other chips,
dual / variant chips, unsupported stream forms and malformed timelines are
rejected before the player acquires audio. An invalid song keeps the accepted
song and edited instrument. Song loading accepts up to **64 MiB** compressed or
expanded, but Files / Cassette still has its **16 MiB total expanded project**
limit. If a source cannot be copied into Files, sound extraction can still
finish and reports the copy failure separately. A valid file without a complete
static instrument can still be kept for reference playback.
Supported DAC streams use uncompressed banks; stop a stream before changing
its bank / stride setup. Preparation is bounded to one hour, four million
commands, 192,000 Hz per stream and 384,000 Hz across active streams. Extra
headers, compressed / ROM banks and excessive command bursts are rejected
with an explanation.

Opening the page or editing a sound does not start an audio device. Playing a
key can also initialize audio. One HuC6280 PSG renderer supplies these channels:

| Source | Keyboard voices | Hardware controls |
| --- | --- | --- |
| Wave, LFO off | Six, CH1–CH6 | 32 five-bit samples, volume and left / right balance |
| Wave, LFO on | One CH1 / CH2 pair | CH2's waveform modulates CH1; optional CH2 output has its own level / balance |
| Noise | Two, CH5 / CH6 | Per-channel noise-clock code, volume and left / right balance |
| DDA PCM | Six, CH1–CH6 | Five-bit direct DAC; samples are supplied by software |

Allocation uses available channels in round-robin order and replaces an old
voice when the pool is full. Releasing a replaced key cannot stop its new owner.
The common keyboard instrument applies its Noise settings to both noise channels;
Code and physical-channel edits can set them independently.
Changing source or the LFO routing can stop held notes; play a new note after
those changes. Editing only the Main or LFO wave keeps the held keys and the
software envelope's progress. There is no separate Apply button.

**Noise does not follow the keyboard note or Pitch wheel.** Its 0–31 clock code
sets the noise texture; it is not a frequency in Hz. Noise controls can change
while notes are held. LFO is inactive while Noise is selected.

## One waveform editor

Choose **Main** or **LFO** as the edit target on the same canvas. **Sine**,
**Triangle**, **Saw** and **Square** prepare a waveform, or draw all 32 samples
yourself. Each sample is an integer from 0 to 31, matching the PSG's five-bit
Wave RAM. A shape applies immediately; a drawing applies on pointer release.
An interrupted stroke is discarded. Wave edits keep sounding notes, their
pitch and envelope timing; releasing the key still releases the same voice.
The hardware wave-upload path resets the wave index / oscillator phase, so
this preserves the performance rather than the exact pre-edit phase.

Numbers use **− / value / +** controls with drag and keyboard adjustment.
Source and other discrete choices use buttons. Clicking sound controls leaves
the performance keys available; text fields retain normal text editing.
Sections can be collapsed while watching the output display.

## DDA PCM audio

Choose **DDA PCM**, then **Load audio…**. WAV is portable; other audio formats
depend on the browser's decoder. Loading uses an offline decoder and does not
open a speaker device. The source is mixed to mono, resampled at the selected
conversion rate and quantized to integers **0–31**, with **16 as silence**.
No automatic normalization is applied. Conversion rate is a preparation setting;
audio conversion choices remain **8,000–44,100 Hz**. The separate live DAC rate
changes how quickly the prepared data is read and supports finite rates
**1–192,000 Hz**, including fractional rates derived from direct DAC timing.
Rates above the
audio output rate skip intermediate DAC codes rather than increasing the host's
output sample rate.

**Root note** plays the sample at its prepared rate. Keyboard notes, the Pitch
wheels and **Speed** change the software reading speed. **Loop** repeats the
whole sample. Rate / Root / Speed / Loop edits keep held voices and their current
positions. Enabling Loop after a one-shot has finished applies to the next note.
One-shot completion silences the DAC but retains held-key ownership until release.
Stop, release, voice stealing and changing source silence the affected DACs.

The **five-bit DAC is a HuC6280 hardware feature**. Sample feeding, resampling,
pitch control, looping and Envelope scheduling are **software features**. There
is no separate sample RAM bank or automatic PCM playback unit in this UI's model.
Writes are scheduled at output-frame boundaries, at most one DAC update per
channel per output frame. High playback rates skip intermediate source samples.
Software Envelope also eases non-looping sample endings; turning it off exposes
the raw gate. Loop-boundary discontinuities are retained.

The software limits are **32 MiB per input file**, **30 minutes decoded audio**,
and **16,777,216 prepared DAC samples**. A high conversion rate reaches the sample
limit sooner. Failures, cancelled imports and late results keep the current PCM.
PCM is stored in preset JSON as compact base64, one five-bit value per byte.
Large data is sent to the audio processor only when changed; ordinary notes and
parameter edits reuse the accepted asset, and replies carry metadata only.

**Copy DDA preset JS** exports the portable data and a synchronous Instrument
usage example. It is not a single-register Playground audition: continuous DDA
audio requires timed software writes, supplied here by the AudioWorklet host.

## Hardware LFO and software Envelope

Hardware LFO uses the PSG's fixed **CH2 → CH1** path. It is not arbitrary FM
routing. Enabling it selects a single carrier on CH1, with the LFO waveform
on CH2. Frequency is the 0–255 register code and Depth selects one of the hardware
modulation ranges. Reset holds the hardware reset bit. **CH2 output** preserves
an audible modulator's own level and stereo balance; it is off by default.
CH1 and CH2 share one keyboard owner and stop together.

Two period modes are available:

- **Follow keyboard** keeps the previous behavior: CH1 plays the keyboard note,
  and CH2's period follows it. Old version-1 presets use this mode.
- **Recorded periods** keeps independent periods. **C4 plays the recorded CH1
  period**, other keys / Pitch transpose CH1 relative to that reference, and
  CH2 keeps its recorded period. This mode is selected for imported LFO sounds.

Periods are shown as 1–4096, with 4096 encoded as zero in the chip registers.
Extreme transpositions reach the hardware period endpoints. You can edit the
periods, rate, depth and CH2 mix while a note is held; changing mode or routing
stops held notes. Main and LFO waves still share the same drawing canvas.

**Software Envelope** is a host feature. The HuC6280 PSG does not have SPU-style
hardware ADSR or reverb. Attack, Decay, Sustain and Release schedule channel
volume writes in software. Turn it off to compare the sustained raw PSG voice.
The default short attack / release makes the instrument easier to play.

The main waveform, volume, balance, noise generator and LFO are chip features.
Drawing, envelope scheduling, keyboard allocation, preset files and Pitch wheels
are software authoring / performance tools.

## Output and keyboard

**Waveform** and **Spectrum** monitor the final signal after Master through a
passive analyser branch. The monitor does not add a second speaker connection.
Master ranges from **0 to 380%**, with an orange bar above 100%.

Both **Pitch** wheels bend Wave notes by up to two semitones, stay synchronized
and return to center on release. Noise disables them. **Octave − / +** and the
shared Guitar / Bass / Ukulele layouts change the visible playing range.
Hiding the page or leaving its window releases manual keys while Code continues.
Changing Octave or channel also clears manual release tails and centers Pitch
during Code, while the Code voices and loops continue.
**Stop all sound** releases held notes and stops Code.
If the audio engine fails, use **Enable audio** to reconnect.

## Presets and JavaScript

Save / Load uses the portable `tetorica-huc6280-voice` preset, version 3. Version-1
files migrate to Follow keyboard, Reset off and muted CH2, keeping their previous
behavior. Version-2 files retain their paired LFO settings and gain an empty
DDA configuration. The preset
contains the name, selected source, main and LFO waveforms, chip volume / balance,
noise clock, hardware LFO, embedded DDA PCM and Software Envelope. Preset JSON
is limited to 32 MiB. Invalid presets are rejected
before the current sound changes. Master, keyboard layout, octave and temporary
Pitch position are performance controls outside the preset.

**Copy JavaScript** produces a single-voice chip setup for the initialized
`pce` API in Playground's **HuC6280** mode. The snippet demonstrates hardware
parameters; keyboard allocation, software envelope scheduling and Master belong
to the host and are not reproduced by that chip-only audition. The generated
code stays visible for manual copying when the clipboard is unavailable.

Irregular or incomplete direct-write PCM extraction, unsupported DAC stream
forms and full PC Engine emulation are not included. MSM5205 has a basic sample
player and Code API; CD-DA has a shared UI / Code track player. Waveform editing,
an MSM5205 keyboard instrument / preset format, compressed CD-DA input and
actual CD-ROM access are not included.

## API, sources and licenses

- [npm API catalog](../../packages/fm2612/README.md#api-entry-points): musical helpers and low-level APIs.
- [Huc6280Synth](../../tetorica_src/runtime/huc6280synth.js) and [Huc6280AudioEngine](../../tetorica_src/runtime/huc6280audioengine.js): authoring and synchronous register / PCM access.
- [Preset format](preset.js), [instrument and allocator](instrument.js), [AudioWorklet](processor.js), [browser audio lifecycle](audio.js) and [editor](editor.js).
- [Code host and starter](code_host.js), [shared-chip client / software FX](code_audio.js), [Live channel view](code_live.js), [types](code_declarations.js), [project format](code_project.js), [Files](code_files.js), [selected-channel preset preparation](selected_preset.js) and [explicit Code examples](cdrom2_examples.js).
- [VGM / VGZ extraction](vgm_import.js), [DAC stream PCM extraction](vgm_dac.js), [direct DAC PCM extraction](vgm_direct_pcm.js) and [sound library](vgm_library.js): passive analysis and explicit sound selection.
- [Reference source validation](song_source.js), [playback and Pause timing](song_preview.js), [Files song controls](song_controls.js), [strict configured-voice capture](song_voice.js) and [isolated paused audition](song_audition.js).
- [HuC6280 / MSM5205 reference mix](song_engine.js), [Code media sources](cdrom2_audio.js), [MSM5205 decoder](../js/msm5205audioengine.js) and [CD-DA source](../js/cdda_player.js).
- [MSM5205 sample preparation and decoded waveform](msm5205_asset.js), [shared UI / Code source](msm5205_source.js), [sample controls](msm5205_controls.js) and [shared offline WASM renderer](../js/msm5205_pcm.js).
- [CD-DA controls](cdda_controls.js), [shared UI / Code source](cdda_source.js), [temporary session references](cdda_session_files.js) and [Project / session routing](cdda_inputs.js): app-local ownership and long-track inputs without changing Files / Cassette storage.
- [Five-bit PCM preparation](dda_pcm.js) and [offline audio import](audio_import.js): software conversion used by the DDA source.
- [Native core and adaptation notes](../../third_party/tetorica-soundchip-native/vendor/mame-huc6280/README.md): MAME-derived HuC6280 by Charles MacDonald, [BSD-3-Clause license](../../third_party/tetorica-soundchip-native/vendor/mame-huc6280/LICENSE).
- [Project license](../../LICENSE) and [complete attribution](../attribution.md).

The shared WASM is unchanged. The core retains MAME's imperfect / unverified
noise and LFO behavior; this UI does not claim complete hardware or analog
output fidelity. Reuse the modules you need and retain their source notices.

## Build and verify

From the repository root:

```sh
npm run test:huc6280-synth
npm run test:huc6280-synth:browser
npm run test:huc6280-synth:code-browser
npm run test:huc6280-synth:cdrom2-browser
npm run test:huc6280-synth:msm5205-browser
npm run test:huc6280-synth:cdda-browser
npm run test:huc6280-synth:manual-browser
npm run test:huc6280-synth:vgm-manual-browser
npm run test:huc6280-synth:song-browser
npm run test:huc6280-synth:live-browser
npm run test:huc6280-synth:capture-browser
npm run test:huc6280-synth:mixer-browser
npm run test:huc6280-synth:seek-browser
npm run test:huc6280-synth:cache-browser
sh scripts/package_itch_huc6280_synth.sh 0.0.1
```

The package command creates `release/tetorica_huc6280_synth_0.0.1_itch.zip`.
Use a new version argument for another archive; existing archives are preserved.
The ZIP has a root `index.html`, original editable JavaScript / CSS modules,
the original WASM pair, authenticated native sources, rebuild recipes, browser
source inputs and licenses. It can be served independently of this checkout.

Edit `synth-huc6280/` for the UI and instrument, `js/` for reusable helpers, or
`synth/synth_keyboard.js` for the shared keyboard, then reload. No JavaScript
build is needed. Authored files retain comments, identifiers and relative
imports without bundling or minification. Compiler-generated artifacts remain
unchanged under `generated/`, with corresponding C/C++ under `sources/`.

## 日本語での概要

PC EngineのHuC6280を、SPU Synthと同じ流れで試せるシンセです。
CD-ROM²向けにHuC6280／MSM5205／CD-DA／Mixerタブを追加しています。
MSM5205はFilesのWAV／packed ADPCMを読み込み、実際の復号波形・64KiB使用量・サンプル数・時間を表示してPlay／Stopできます。
Add samples to Files…で素材を追加し、Sample in FilesとLoad asを選んでLoad selected sampleを押します。読込だけでは音を出しません。
WAVは選択Rateでmonoへ変換してADPCMへ符号化し、packed ADPCMはhigh nibble firstで元のbytesを保持します。
波形は共有WASMの実復号結果で、表示のためのAudioContextやspeaker接続は追加しません。
Rateは0–15と実効Hzを表示し、Loopとともに次のPlayから反映します。再生中の値をその場で変更しません。
Codeと画面は同じ編集用MSM5205を共有し、UIのPlayやサンプル変更でCode／HuC6280を止めません。
Code Stop後もMSM5205素材を保持します。CD-DAも画面とCodeで同じsource／track／cursorを共有し、Code Stop後は音声を保って先頭へ戻します。
元ファイルはFiles／Cassetteへ保存し、現在のADPCM選択・再生設定はsession限定です。
VGMのMSM5205は別の参照decoderで、この画面へのLive表示ではありません。
CD-DAタブはFilesのWAV／track manifestをLoadし、Track選択とPlay／Pause／Resume／Stop／時間表示／Seekを使えます。
source読込とtrack選択だけでは再生せず、Ready中のSeekも音源を開きません。UI操作でCodeや他の音源は止めません。
WAVは44.1kHz stereo PCM16のみ。manifestのWAV相対パスはmanifest基準、Codeのsource相対パスは読込時の実行ファイル基準で固定します。
長い音声はOpen session WAVs…でFile参照を保持し、選択したtrackだけを読み込みます。Files／Cassetteの合計16MiB制限は変えません。
sessionは最大99ファイル・参照合計512MiB、1trackのPCMは256MiB。1WAV全体の上限は256MiB＋header余裕1MiBです。
256MiBを超えるFileは本文を読む前にheaderだけで容量を確認し、その大きいFileの非音声headerを1MiB・header walkを256chunkまでに制限します。
session音声はProject保存・export・local recovery・再読込に含まれません。元WAVを保管して、必要時に再度開いてください。
Clear session WAVsはsession依存のsourceを消し、独立したProject source・Projectファイル・他音源は保ちます。
`useSoundChip()`の引数に`"huc6280"`／`"msm5205"`／`"cdda"`を指定して選択し、同じAudioContext・Master・FXを共有します。
Mixerの初期値はPlaygroundと同じ絶対値でHuC6280が44%、MSM5205／CD-DAが100%。
従来の単体SynthのHuC6280等倍より小さくなり、Masterは引き続き0–380%です。
VGM1.72のMSM5205 clock／flags／0x32命令を含む曲をHuC6280と一緒に再生でき、MSM単独も受け付けます。
MSMを含むVGMは完全なペア状態がないためSeekを先頭から再構築し、Pause／Resumeは同じ再生状態を保ちます。
CD-DAはVGMには含まれず、Filesやsessionから読み込んだ音声トラックとして再生します。
MSM5205の波形お絵描き・鍵盤音程・専用preset、圧縮音声の変換、ディスク／ISO／CUE／BIOS／ゲーム実行は今回の範囲外です。
Waveは6声、Noiseは実機のCH5／CH6を使う2声。波形は32点・5bitで、
Main／LFOを切り替えて1つのcanvasで描きます。
Hardware LFOはCH2→CH1の専用配線で、有効時はCH1の単音へ切り替わります。
Software Envelopeはソフト側の音量制御で、実機のADSRではありません。
プリセット保存・読込とPlayground向けJavaScript出力に対応します。
Keyboard／Codeを切り替え、同じHuC6280を`useSoundChip("huc6280")`で操作できます。
Code実行中も鍵盤・つまみ・波形編集・音色の読込を使えます。
Keyboard／Codeを切り替えてもloop・context・接続は維持します。Code表示中も、
つまみや背景へFocusを移すと鍵盤演奏ができます。編集欄・文字入力・select・dialog内は演奏しません。
古い手動離鍵やPitch解除で新しいCodeの発音・周波数を巻き戻さず、Octave／CH変更は手動Releaseも解放します。
CH1–CH6の表示・編集と自動更新、Files・Cassetteの保存／読込、型補完・実装への移動に対応します。
HuC6280タブの下の子タブでAuto／CH1–CH6を選びます。Autoは共通音色と自動割当、各CHは表示・編集・鍵盤の対象を揃えます。
MSM5205は単一のCH1、CD-DAはStereoの音源を表示し、MixerにはCH編集タブを出しません。
FilesのExamplesボタンから`examples/huc6280.js`／`msm5205.js`／`cdda.js`を明示追加できます。
既存ファイルを上書きせず、不足分だけ追加し、選択・Keyboard／Code・実行中のCodeは変えません。
例を追加しただけでは実行せず、Codeでファイルを選んでRunします。
Runは新規実行、Applyはcontext等を保持、Stopは短くフェードして編集用設定へ戻します。
CodeのnoteOn／noteOffはSoftware Envelope、keyOn／keyOffは実機のゲート操作です。
liveFxやDDAのデータ供給もソフト側の機能です。復元したCodeを勝手に実行することはありません。
ハンバーガーメニューのImport → VGM / VGZ…から読み込みます。
読み込んだ元VGMはvgm/へ、抽出した音色はpresets/のVGM名フォルダーへ自動保存します。
同名ファイルは上書きせず、音量だけが異なるWave／PCMは最大音量のものを残します。
keep loudestは初期Onです。Offにすると一覧の全音量バリエーションを表示しますが、保存済み音色は変えません。
一般のAdd filesはVGMの元ファイルだけを保存するので、音色の抽出・保存はMenuのVGM Importを使います。
Auto／CH1–CH6とAuto update／Captureは、音源タブ直下で通常時・Code・VGMに共通です。
Channelの詳細説明・レジスタ表示とSounds from VGMの長い説明は、初期状態で閉じた?へまとめています。
VGM再生中は選択CHのhardware設定・鍵盤を同じ参照音源へ送れます。後のVGM命令が優先され、
先読み済みPCMの後から音と表示へ反映します。Auto update Offでも手動変更は聞こえた時点で一度表示します。
Autoを選ぶと自分の音色を曲と重ねて演奏・編集できます。DDAは音量／balanceを編集でき、
瞬間DAC値からPCMを推測しないため鍵盤試奏はできません。Software Envelope／PCM資産はAuto専用です。
手動変更したrunから原曲用cacheは収集せず、Seekは原曲状態へ戻り、取消は元の編集済みrunを保ちます。
その下に折りたたみ式の音色一覧、Waveform／Spectrumが続きます。
VGM／VGZからWave／Noise、CH1・CH2を組にしたLFO音色、対応する完全なDAC streamや一定間隔の直接DAC write区間のPCMを抽出できます。
Recorded periodsではC4が記録時のCH1周期、他の鍵盤はCH1だけを移調し、CH2は固定です。
両周期・速度・深さ・Reset・CH2の出力を保持します。
DDA PCMではWAV等をモノラル5bitへ変換し、6声で試奏、Root／Loop／Speedを変更できます。
DACは実機機能、データ供給・移調・Loop・Envelopeはソフト側の制御です。
PCM本体はプリセットv3へ保存し、v1／v2も読み込めます。
PCM一覧に由来・rate・時間・Loopを表示し、C4で記録時の速度、他の鍵盤で移調して試奏できます。
直接DACは既知のkey-on／key-offまたはDDA解除に囲まれた一定間隔の区間のみを採用します。最初のDAC writeはkey-onと同時刻が必要で、Loopや元の音階は推測しません。
音声変換は8,000–44,100Hz、live DAC rateは直接DAC由来の小数rateも扱える1–192,000Hzです。
間隔が変わる／終端が不明な直接DAC区間、未対応stream、不明な設定は理由付きで省略します。
VGM／VGZの元ファイルはFilesの`vgm/`へ保持し、モニター上の曲一覧からPlay／Pause／Resume／Stopできます。
位置バーはドラッグ中に候補を表示し、離すとSeekします。矢印／Home／Endにも対応します。
再生中は移動後も再生、Pause中はPauseを保持。Stop／終了後からは移動先をPauseで準備します。
再生中に末尾へ移動した場合は終了します。Escape／Cancel seekで取消できます。
元の曲・未消費PCMは成功まで保持し、別の音源を無音で目的位置まで短い単位で再構築します。
失敗・取消では元の位置・再生状態へ戻り、Stop／Code Run／曲やprojectの切替で古い結果を破棄します。
移動後はAuto update Offでも目的位置の6CH設定を一度表示し、CH選択・On／Off・編集中の音色は保持します。
位置バー横のCacheは初期On。約5秒おきと指定した位置の状態を、最大64点／8MiBのpayload範囲で保持します。
同じ付近へ戻る時は近い途中状態から再構築し、LFO・Noise・DDA・resampler・stream待機・未消費PCM・Liveの既知／不明状態も復元します。
Stop／Code Runでは保持し、曲やCH別出力が変わると破棄します。Cache Offや再生欄の? → Clear seek cacheで解放できます。
位置・編集用音色・Pause試奏は変えません。初めて移動する未cache区間は数秒かかることがあり、非対応backendや容量超過の点は通常の再構築で扱います。
模範演奏は1回再生で、現在のMasterと出力モニターを使い、編集中の音色を保ちます。
VGM outputのCH1–CH6 On／OffはMixerタブにまとめています。曲の聴き分け用のソフト側スイッチで、初期値は全CH On。
表示対象のChannel選択とは独立し、共通Auto音色／Code／Pause試奏には適用しません。
発振器・Noise・DDA・CH2→CH1のLFOと記録設定は保ち、出力だけを変更します。
生成済みPCMを保持し、その先の音から反映します。Pause中の変更も未再生の短いbufferの後から反映されます。
Pause／Resume、Stop／Play、曲切替でも選択を保持します。セッション内の状態で、音色presetやCassetteには保存しません。
Codeと曲再生は排他的で、RunとPlayが互いの演奏を停止します。Pauseは未再生PCMとoffsetを保持します。
CH1–CH6を選ぶと、聞こえた位置の設定を同じ音色UIへ表示し、再生中もPause中も個別に編集できます。
未記録Wave RAMは空欄、DDAは最後に書かれたDAC値を表示し、元のPCM音色や音階を推測しません。
自動更新は初期On・最大20Hz。OffはCHを切り替えても同じ観測時刻を保ち、Onで追従します。
Pause時は自動更新Offでも、実際に止まった位置を一度表示します。
通常時もCHごとに表示・設定・鍵盤を揃え、CHやAutoの選択だけで値を統一しません。
通常の6CH構成は一時的な状態です。Save to presetsは選択した1音色を保存し、6CH全体の割当は含めません。Code開始・終了では共通音色へ戻します。
Pause中にCHを選んで鍵盤を弾くと、その時点のWave／Noiseを試奏できます。
Pause中の編集は聞こえた位置のsnapshotへ変更した項目だけを投影し、先読み済みの無関係な値で表示を置き換えません。
CHを切り替えても編集を保ち、Resumeは未再生PCMを先に再生してから変更後の設定を反映します。
後のVGM命令はその項目を上書きでき、Seekは原曲状態を再構築します。
LFO有効時はCH1でCH1・CH2の組を試奏し、C4で記録時のCH1周期、CH2は固定です。
試奏は専用Workletとフェード用Gainを使い、同じAudioContext・Masterへ接続します。
曲の停止位置・未再生PCM・編集中の共通音色・通常CH設定は変更しません。
Copy to Autoは曲をPauseのまま設定だけを共通音色へ取り込み、Auto表示へ戻します。
FilesのSave soundはこの共通Auto音色を`presets/`へ保存します。Captureだけではファイルを作りません。
Channel横のSave to presetsは選択中のAuto／CHを直接`presets/`へ保存し、Capture・表示CH変更・Codeファイル選択・モード切替・再生停止は行いません。
保存したJSONはFilesとPreset一覧へすぐ追加され、後で選択して読み込めます。保存だけで音色は適用しません。
既知のWave／Noise／CH1 LFOペアを保存でき、未知のWave RAMや物理CHの一時的なDDA値は完全なPCM音色として保存できない理由を表示します。
AutoのDDAにはPCM資産があるため、その全データを保存できます。
曲の全体左右音量はプリセットの音量・左右balanceへ反映し、必要な量子化は音が大きくならない側へ丸めて説明します。
LFOはCH1とCH2の両出力を扱い、アプリのMaster値は変更しません。
未記録Wave RAMや必須設定が不明な音、DDAの単一DAC値は試奏・Captureできません。
既知のミュート／Gate Off音色はCaptureできますが試奏は無効です。手動編集は一時的な状態で、元のVGMファイルは保ちます。
他チップの音を黙って省略せず、単一HuC6280とVGM 1.72の単一MSM5205以外や未対応データは理由付きで拒否します。
MSM5205を含む曲のSeekは、両音源をまとめた状態保存形式がないため先頭から再構築します。
CD-DAはVGMに含まれず、Codeから別の音声トラックを読み込んで利用します。実CD-ROMの読込・ゲーム実行は対象外です。
