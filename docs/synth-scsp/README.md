# Tetorica SCSP Synth

Explore Sega Saturn PCM, envelopes, LFO and sound-stack FM with a shared
Keyboard / Code workflow. Serve the website over HTTPS or localhost and open
`synth-scsp/index.html`. The standalone itch.io ZIP starts at `index.html`.
AudioWorklet requires a secure context.

## Play and edit

Enable audio, then use the screen keyboard or its displayed computer-key
labels. Keyboard offers the common fretboard layout, instrument selection,
Octave controls and Pitch bend. Computer keys also work in Code view while
focus is outside the text editor. The two Pitch wheels spring back to zero.
Master ranges from 0 to 380 percent, with an orange bar above 100 percent.

Numeric fields have minus / plus buttons and horizontal dragging. Their
original number inputs also accept typed values. Selecting a choice releases
focus so computer keys can continue playing.

The permanent row below the SCSP tab chooses **Auto** or physical **CH1–CH32**.
Selection alone does not program the selected Synth slot, assign PCM or stop
Code. Auto provides the grouped instrument and its A–F editing sources.
A physical CH shows that slot's requested PCM, Envelope,
LFO, mix, frequency and sound-stack modulation, and the keyboard plays that CH.
Frequency is its requested pitch in Hz; Root frequency remains the PCM's
tuning reference. These are requested settings and gates, not a live native
envelope-phase meter.

In Auto, choose PCM, 2-operator FM, 4-operator FM or 6-operator FM. Physical
CH1–CH6 hold the A–F editing sources. The other 26 slots provide 26 PCM,
13 two-op, 6 four-op or 4 six-op simultaneous voices. Each key owns its complete
group. Released groups are stolen first, followed by the oldest held group.

Physical editing addresses one slot without spreading the change to other
voices. CH1–CH6 also edit Auto sources A–F. Selecting an empty CH leaves it
empty. Its first physical keyboard attack copies the current source A into
it; Apply can assign your edited PCM instead. Auto allocation can reuse and
overwrite CH7–CH32, including a silent modulator or a held manual note;
choosing a CH does not reserve it.
The last attack owns the slot, so releasing an older key cannot stop its
replacement. Runtime CH7–CH32 edits are not a saved bank and may be cleared
by Auto reuse or instrument replacement.

Chain connects operators in series. Pairs uses parallel two-op groups.
Branch provides a tree with up to two inputs per slot. The diagram shows
every connection and output, and its A–F buttons select the editing operator
on the same waveform canvas. These fixed connections and grouped allocation
are software tools over the SCSP slot modulation hardware. A graphical
free-wiring editor and operator-feedback tools remain follow-up work.

Draw a waveform or import browser-supported audio, apply the PCM, then play
a new note. Unapplied drawings stay with their Auto operator or physical CH
when you switch targets; Apply makes the edited PCM available for playback.
Each operator has its own PCM, envelope, LFO, mix and frequency ratio.
The waveform editor accepts audio files up to 64 MiB and selects 2–65,535
mono samples for SCSP RAM. Lower the selection rate for longer regions.
Set the recorded root MIDI note manually. Operators with incoming FM require
a full forward loop starting at sample zero. The software allocator adds
repeated waveform guards for supported modulation depths 0–12.

In Auto, PCM and envelope edits affect new notes. Sounding and releasing groups
keep their original PCM. Pitch, ratios, modulation depth, mix and LFO update active
groups. Mode and Connection changes stop existing notes after validation.
All modulator ratios sets A to 1 and B–F to the chosen ratio, after which each
ratio can be edited separately. PCM uses A at the keyboard pitch. Output
operators supply the audible Direct level and Pan.

Envelope includes **Attack / loop link**, the hardware LPSLNK setting. When
enabled, Attack transitions to Decay 1 when playback reaches the programmed
loop start, even if Attack has not reached its usual level. Until that
threshold, reaching the full Attack level holds it in Attack. This differs
from Attack hold, which is a separate hardware feature. The checkbox applies
to new Synth notes, including supported paused SSF audition. Live SSF editing
also writes this register on the selected song CH. Captured forward-loop
instruments retain both the loop start and this setting.

**Click guard · Software** starts On below the Keyboard / Code tabs. It
softens very fast releases for Auto keyboard groups, physical CH keyboard
notes, scoped Code `noteOff()` and paused SSF audition. Slower and infinite
programmed releases remain intact. This is a Synth performance preference,
not a hardware mode or a setting saved in instrument / Cassette files.
Changing it keeps notes and Code running and affects subsequent releases.

The software checks the effective native Release rate latched at note-on.
Only rates above index 50 receive a temporary RR=25 write before an immediate
hardware Key Off. Release starts from the current native envelope level;
there is no delayed Key Off or Master fade. Requested ADSR codes and saved PCM remain
unchanged, and the next note-on restores the authored RR. This is a selected
SCSP Release rate, not a fixed millisecond ramp or note-on / retrigger guard.
The shared Playground and npm APIs retain their existing hardware behavior.
The SSF song itself is unchanged; its paused audition uses a separate Synth.

## Code

Select Code and press Run. The starter plays the current sound using beats,
so changing BPM changes its tempo.

```javascript
const scsp = await useSoundChip("scsp");
setBpm(120);

liveLoop("melody", async () => {
  const notes = scale("C4", "minorPentatonic", 1);
  await scsp.noteOn(CH1, choose(notes));
  await beat(0.5);
  await scsp.noteOff(CH1);
  await beat(0.25);
});
```

Code borrows the same SCSP, authored PCM / FM patch, allocator and Master
output as the controls. Keyboard notes and parameter edits can run alongside
Code. Switching between Keyboard and Code keeps the program running.
Run creates a fresh context. Apply retains context and named loops.
Stop releases Code groups through a short software fade. Stop all sound also
stops keyboard groups, the recording player and shared DSP echoes.

Note and frequency methods address logical performance lanes 0–31. CH1–CH6
are supplied constants for lanes 0–5. Each lane receives a dynamically
allocated physical slot group for the selected PCM or FM mode. Source-editing
methods such as `setMix`, `setEnvelope`, `setLfo` and `applyPCM` address
operators A–F through indices 0–5.

The CH tabs always name physical slots. For example, Code `noteOn(CH1, ...)`
can allocate physical CH7; the channel summary displays that mapping. Selecting
CH7 lets you inspect or edit that destination while the program continues.
It does not reinterpret Code's CH1 constant. The scoped Code API retains its
logical lanes and A–F source operations; internal raw physical-slot commands
are not exposed as a new public Code API. Copy operator JavaScript remains
available in Auto.

`noteOff(lane)` follows the app's Click guard preference. `keyOff(lane)` always
bypasses it and follows the programmed hardware Release, which can still have
a long tail. Both address the current Code-owned group for that logical lane,
not the physical CH tab. Raw `keyOff()` is not a transport Stop. Read the host
preference with `(await scsp.getState()).clickGuard`; change it with the UI
checkbox rather than a Code setter.

```javascript
// Change source A's mix while the melody continues.
await scsp.setMix(0, { pan: 8 });
await scsp.setConfig({ fm: { depth: 8 } });
// Hardware Attack / loop link for source A, on its next note.
await scsp.setEnvelope(0, { loopLink: true });
```

The scoped API also provides `setPreset`, `getPCM`, `loadPCM`, `setNote`,
`setFrequency`, `keyOn`, `keyOff`, `allNotesOff`, `getState`, `setEffect`,
`exportPatch` and `loadPatch`. Await mutations to preserve their execution
order. Monaco supplies types, completion and implementation navigation.
Monaco loads from a CDN, and a visible textarea remains available when it
cannot load. Expand places Code beside Files. The live runtime supports
`livePrepare`, `liveLoop`, `stopLoop`, `context`, `tween` and `liveFx`.
`liveFx` applies a separate software effect rack after the SCSP output.

## Files and presets

Files contains `index.js`, reusable modules, JSON instruments and original
recordings. Use its context menu to duplicate, rename, delete or create files
and folders. Menu contains file and Cassette import / export. Save to presets
stores the applied Auto instrument in `presets/`. In a physical CH view the
button reads Save Auto sound. Presets and the Cassette's instrument settings
save A–F (physical CH1–CH6), not runtime CH7–CH32 overrides or sounding voices.
Selecting an instrument returns to Auto while keeping Code running.
Selecting JSON in Keyboard view retains that view. JSON can be inspected in Code.

Local drafts save in browser storage. Export Cassette creates a portable
project. Files uses a 12 MiB aggregate budget, reserving the remaining space
within the shared 16 MiB Cassette limit for project metadata and applied PCM.
The waveform editor's direct audio import has its separate 64 MiB input limit.
Loading a project requires Run to begin Code execution.

Instrument JSON uses version 4 and includes six applied PCM sources,
EG / LFO / mix, mode, connection, ratios, modulation depth, transpose and
experimental Delay settings. Direct instrument files are limited to 8 MiB.
Versions 1–3 remain readable. Version 1 becomes PCM, version 2 receives
default C–F operators, and version 3 retains all six operators. Older versions
receive disabled DSP settings. Unapplied waveform drafts stay in the editor.
Invalid replacements preserve the current instrument.

## Reference recordings

Menu → SSF folder imports Saturn SSF / MiniSSF songs and their SSFLib
dependencies together. Choose an unpacked folder containing the related
files. Their subdirectories are retained under `ssf/`. SSF / MiniSSF files
also accepts a multi-file selection. A file ending in `.ssf` can itself
depend on SSFLib data, so include its related library files.

Choose a song above Waveform / Spectrum, then Play song. Pause changes to
Resume and retains the same sound-CPU state and unconsumed audio. Stop
releases its player. Seek creates an independent machine and executes up to
the target position. Libraries are kept in Files and omitted from the song
selector. Loading and selecting a recording are silent.

SSF playback executes the 68000, SCSP, DSP, timers and interrupts in the
Mednafen-derived ssfplay engine. The browser checks container CRCs, resolves
the primary library before the song patch, then applies auxiliary libraries
in order. Paths are relative to the file that refers to them. Missing or
corrupt required files preserve the previous recording. A corrupt unrelated
entry can remain in Files while another song loads. Each native program
image fits the Saturn's 512 KiB sound RAM. Sources are bounded to 4 MiB per
file, 64 MiB per set, and 32 MiB of decompressed dependency programs. Files
imports also obey the existing 12 MiB project budget.

The entry's length, fade and relative volume tags control playback. With a
missing or invalid length tag, the player uses a three-minute preview and
shows that choice beside the transport. Seek may take time because the sound
program must execute from its reset state.

SCSP also has VGM register and RAM recording support. Menu → VGM / VGZ imports
the original file into `vgm/`. Select a recording above Waveform / Spectrum
and use Play song, Pause / Resume, Stop or the seek bar. Demo builds an
original short sine phrase for checking this path without a game recording.
VGM playback supports a single 22,579,200 Hz SCSP in VGM 1.71–1.72,
`C5` byte writes, `E0` RAM uploads, raw `06` banks and `68` RAM copies,
with playback following the recorded timeline once. It validates the source
before replacement. The parser bounds compressed, expanded and prepared
streams to 64 MiB each. Imports into Files also obey the project budget.
Recorded CPU timer, IRQ, MIDI and inactive DMA setup writes are omitted with
a message, as their resulting audio writes are already present in the log.
DMA execution, 256 KiB memory mode, extra-header overrides, additional chips
and unsupported core registers produce explicit errors.

Song playback uses its own SCSP state and RAM through the existing
AudioContext and Master output. During playback, the keyboard plays the
selected Synth target, independently of the song's machine. Starting a song
stops Code, and Run stops the song.
Live from SSF is enabled by default. The same permanent CH row shows sampled
native slot activity and envelope state. Select a CH to inspect its raw PCM
prefix, envelope codes, LFO, attenuation, pan and sound-stack modulation in
the existing controls. Envelope, LFO and mix parameters can be edited while
playing or paused; seeking remains read-only. The waveform previews up to
256 raw samples from the programmed start address. The inspector shows the
physical sample playback rate in samples per second. A recording's original
root note is unknown. The loop mode and programmed boundaries appear beside
the slot status. Noise and zero sources have their own source labels.

Pause freezes one native snapshot for all CH choices. Live Off keeps the
selected CH and shows its editable Synth slot, not the SSF slot. Stop and
natural end also return to that selected editor target. Choose Auto explicitly
to restore the grouped instrument and its unapplied operator draft; selecting
Auto turns Live off. Live On uses the selected CH, or the previously inspected
SSF CH when returning from Auto (initially CH1). Selecting an authored preset
while Live returns to Auto and keeps the song transport available. Save
actions become available in the editor view.

While paused with Live On, the keyboard auditions the selected supported PCM
slot. Reference key defaults to C4, with C2–C6 available. That key reproduces
the captured hardware sample playback rate; other keys transpose from it.
This establishes a tuning reference without guessing the sample's original
root note. Audition uses an independent native SCSP handle in the existing
AudioWorklet and AudioContext. The authored PCM, settings and unapplied draft
remain intact. The song stays paused while you preview its selected PCM.
Changing slot, reference key, Live mode or transport clears audition voices.
Live Off restores keyboard playing on the selected physical Synth CH.

With Live On, Envelope, including Attack / loop link, LFO, level and pan
controls write the selected song CH's emulated SCSP registers during playback
or Pause. This also works on Noise and linked slots that cannot be captured
independently. The driver may write the same parameter later and replace your
change. The original SSF files and sample RAM are not rewritten by these
controls. The PCM prefix, format, playback rate, loop boundaries and
slot-modulation display remain observations. Full waveform editing is
available after Capture to Synth.

Paused PCM preview uses the displayed edited parameters. Envelope changes
affect subsequent preview notes; LFO, level and pan update held preview notes.
The activity and ENV indicators still describe the song's slots, not the
independent preview. Changing CH or Reference key does not undo song-register
edits. Resume continues the edited machine; it does not restore the original
registers, and later driver writes may overwrite manual values. Stop and a
new Play start a fresh machine from the recording.

Capture includes the displayed edited parameters, after which Save to presets
retains them in the Auto instrument. Live register edits do not replace the
authored Synth or become part of a Cassette's instrument. Capture eligibility
is separate: unsupported instruments keep Capture unavailable with a reason,
while their supported live parameters remain editable. Invalid edits preserve
the previous register state.

Capture to Synth copies the click-time slot into the editable instrument,
selects Auto, switches Live Off and keeps Pause / Resume available. Capturing
during playback pauses the song first. The full programmed PCM, format, supported
loop boundaries, Envelope, LFO, total level, direct level and pan are copied.
Use Save to presets in the authored view to retain the instrument under
`presets/`, or export its portable JSON from Menu. Live On returns to the
song view, and Resume continues its current sound machine. The SSF source is
unchanged.

This first capture supports independent PCM8 / PCM16 slots with ordinary
one-shot or forward loops and 2–65,535 samples. Unsupported noise / zero
sources, source-bit operations, short-wave / extended pitch coding, reverse /
alternating loops, hold / bypass modes and linked sound-stack
modulation show their reason beside Capture. Slots without audible direct
output and loops too short for their playback step are also unavailable.
Attack / loop link is supported for forward loops and one-shots with a zero
threshold. A linked one-shot with a nonzero threshold is unavailable because
the current high-level one-shot adapter programs its loop-start register to
zero; capture does not silently replace that threshold or add a forward loop.
Failed validation preserves the authored instrument and paused recording.
Paired-slot capture remains follow-up work.

Audition and Capture start a fresh sample, envelope and LFO phase. The Synth
uses its own SCSP approximation and Master. Song DSP programs, send / return
processing and the song's global master volume are not copied, so this is a
dry instrument capture. Native interpolation boundaries and output level
can differ from the original recording.

The transport retains a bounded window of same-time slot and 512 KiB RAM
snapshots. It selects the latest state at or before the audible position,
accounting for native and Web Audio lookahead. Typical retention is a few
MiB, with a maximum of 16 snapshots, about 8 MiB. Live Off stops acquisition.
Activity indicates native waveform / envelope state, including silent
modulators. ENV percentages show normalized attenuation progress.

The recording formats are described in the original VGM and PSF specifications.
[VGM specification](https://github.com/vgmrips/vgmplay-legacy/blob/master/VGMPlay/vgmspec171.txt)
and [PSF / SSF specification](https://gist.github.com/SaxxonPike/11618bd321a45a70c01febae43ff564e).

## Experimental DSP program and Delay

The **DSP** tab contains an editable `.scspasm` draft, an explicit applied-program
status, and **Check** / **Apply to Synth**. Editing or Check leaves the current
sound unchanged. Check compiles the current text, reports syntax or execution-profile
errors with source lines, and shows the canonical result under **Checked instructions**.
Apply becomes available after the current draft passes Check.

Apply replaces the Synth DSP program. A changed program clears the wet Delay tail
while keyboard and Code voices continue. Rejected Apply keeps the previous program;
a transfer failure restores it before rendering resumes. If restoration itself
fails, audio stops and reports that it must be restarted.
SSF playback owns a separate DSP program in the song engine; **Apply to Synth**
does not edit that song program. **Reset draft** restores the built-in source in
the editor; use Check and Apply to restore that program in the Synth.

**Copy .scspasm** and **Save .scspasm** export the draft text, including invalid or
unapplied edits. Restoring saved draft text never applies it automatically. Voice
presets and Cassette exports retain their existing format and do not include DSP
source, so keep a `.scspasm` copy. The **?** explains this workflow and the execution
profile. The collapsed **Built-in Delay reference** retains the six-step role
explanations; it describes the original program, independently of the current draft.
On narrow screens its table scrolls horizontally, including with Left / Right keys.

### First execution profile

This version retains the existing packed-format 64 KiB DSP ring, coefficient
entries COEF0–2, address entries MADRS0–1 and EFREG0 return. Check rejects unsupported
controls; the audio owner validates again before applying. The lossless assembler
can still inspect broader bit patterns, but that does not make them executable
through this profile. [DSP field assembler guide](https://github.com/kyorohiro/hello_ymfm_wasm/blob/main/docs/synth-scsp/DSP_ASSEMBLER.md)

To try a small change, start with the built-in source and change `EWT=1` to
`EWT=0`, then Check and Apply. That removes its effect output. Restore with
Reset draft, Check and Apply. The direct voice output remains available.

### Delay parameters

The collapsed experimental section keeps the existing Delay configuration.
The tab indicates whether this effect return is enabled. The built-in program
produces mono Delay; an edited program can use those same parameters differently.

Time spans 20–700 ms, Feedback 0–0.85, and Send / Return hardware levels
0–7. Initial Send 7 / Return 6 produces a first echo near half the dry
amplitude for the built-in program. Output operators feed the effect. Direct
level zero allows wet-only output. Time / Enable changes clear the ring, and
ordinary release retains the tail. Stop all sound and Mode / Connection changes
clear it. The first 64 KiB of RAM remains reserved for the DSP ring, leaving
448 KiB for editor PCM and modulation guards. Feedback, Send and Return update
live. DSP Lab retains its dedicated built-in dry / wet comparison.

## Implementation and distribution

Slot PCM, EG, LFO, modulation and the fixed Delay execute in the SCSP core.
Drawing, conversion, guard samples, connection presets, grouped voices and
Code are software features. The editor core uses zero slot-write delay.
Physical SCSP timing, low-depth modulation and address clipping still need
hardware comparison. Large raw SCSP sums can saturate.

Runtime modules and WASM are local in the archive. Monaco is optional and
loads externally. Navigation links open the full website. The included demo
is original. SCSP / DSP C++ sources, pristine MAME upstream, licenses and
the Emscripten recipe are under `sources/`. Start with `sources/SCSP.md`.
The SDK retains its unpublished local-candidate provenance. See `LICENSE`
and `licenses/mame-scsp/LICENSE` for BSD-3-Clause terms.

SSF playback includes ssfplay_tools and Mednafen 1.32.1 under
GPL-2.0-or-later. The corresponding C/C++ source, copyright notices,
upstream hashes and standalone rebuild recipe are in `sources/ssf-player/`.
The C ABI wrapper uses the same license. See `licenses/ssfplay/COPYING` and
`generated/ssf-player/NOTICE.txt`. The browser loader and transport are
included as editable JavaScript. The player has an independent sound machine
for each playback or seek candidate.
ABI 2 adds passive slot and RAM observation through a checked temporary
build overlay. The source kit includes `ssf_observer.inc` and its recipe.
ABI 3 adds bounded masked writes for Envelope, LFO and direct mix registers.
Edits preserve CPU time, sample RAM, unrelated register bits and queued audio;
the next rendered audio reflects the write after the existing lookahead.
The UI keeps pending manual values until that native frame becomes audible,
then follows any later music-driver writes. Paused preview edits use their
own generation-fenced Synth owner and do not replace the song's machine.

Authored JavaScript and CSS are copied byte-for-byte into the distribution,
preserving comments, names and layout. Edit modules in `synth-scsp/`, `js/`
or `playground/` and reload the served page. The same frontend tree can be
packaged in Tauri. `sources/scsp-synth-browser.json` records source paths,
hashes and imports. `sources/scsp-synth-browser-inputs.zip` contains the
original inputs and packaging recipe. Generated Emscripten files retain
their original bytes under `generated/`. Code software-effect C++ sources
and a build recipe are included under `sources/code-effects/`.
