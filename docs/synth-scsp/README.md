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
are software tools over the SCSP slot modulation hardware.

In **2-, 4- or 6-operator FM**, choose **Connection → Custom** to set each
operator's inputs and direct output independently. Select A–F in the diagram,
choose its first modulation input **X**, then optionally a second input **Y**
in 4/6OP mode. Choose **None** for X to remove both inputs. The direct output
checkbox is independent: an operator can reach the output while it modulates
another. No direct output is required when an explicit DSP Send is the intended
route. The current Chain, Pairs or Branch connections seed the first Custom graph.

The hardware averages X and Y before applying modulation depth. With one external source,
the Synth assigns that source to both hardware inputs, preserving its strength;
with two sources, it uses their average. This editor accepts at most two distinct
external sources per target in Custom4/6. Custom2 keeps one source per target.
Each Custom size supports one self-feedback operator, described below. Two self
operators, self plus an external input at the same target, and multi-operator
cycles are rejected before changing the current sound. These are software
editor limits; raw physical-CH sound-stack controls remain available.

In **Custom2/4/6**, select an operator and choose **Self · A–F (2 taps)** for Input X.
Choosing Self replaces that operator's previous inputs. Input Y is disabled:
both hardware inputs belong to its two histories. Other operators can receive
the self-feedback operator, including as one source of a two-input merge.
For example, let B feed itself and select B as A's input. Self uses hardware
X32/Y0: in this pinned core, they average the preceding one- and two-frame stack
values while that slot writes continuously. This is a sound-stack feedback
prototype, with the existing simplified slot pipeline; it does not claim exact
physical SCSP timing. The other operator can still be an independent output.

Selected depth controls the receiving operator's MDL. **Depth 0 is Off** through
the existing JavaScript adapter, which writes a zero modulation register; this
differs from a raw native MDL0 register with nonzero offsets. Changing depth on a
held or releasing group retains its history. A new Auto / Code self-feedback
attack clears only the self slot's two owned stack cells as **software
initialization**, so old notes do not seed that new feedback loop. Raw physical
CH attacks and non-self notes retain their previous behavior. This is not a claim
that physical hardware clears its stack on Key On.

Changing the operator count preserves surviving connections. New operators start
disconnected with no direct output; shrinking removes inputs and outputs that
refer to removed operators. A graph supplied explicitly through Code must match
the selected mode's count. Selecting a fixed template keeps the Custom graph for
later editing. Resizing preserves a self edge when its operator survives; shrinking
past that operator removes it and references to it. A graph left dormant under
a fixed template is projected the same way when Custom is selected at that size.

Custom operator IDs stay A–F even when the allocator changes their physical
order so the modulation source runs first. Source waveform, ratio, mix, LFO,
DSP Send and keyboard/Code controls follow that mapping. Graph changes release
the current Auto groups after validation while the Code session continues.
The next notes use the new graph. Physical manual owners remain separate.

**Selected depth (MDL)** edits the receiving operator's hardware modulation
depth in either fixed or Custom connections. The editor supports codes 0–12;
this is its guarded sample range, not the full hardware field's limit.
X and Y share that one MDL
after their inputs are averaged; this is not a separate depth for each edge.
The common **All FM depths** control is a software batch edit: changing it sets
A–F to the same code. A compact summary shows when their values differ.
Depth changes apply to held and releasing Auto / Code groups without restarting
notes or DSP. An operator without an input keeps its value for later routing;
changing the operator count also retains all six authored values. Physical CH
and SSF controls continue to edit their displayed slot rather than this Auto
operator configuration.

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
groups. Mode and Connection changes retire Auto groups after validation; the
Code session and independent physical owners continue. All modulator ratios
sets A to 1 and B–F to the chosen ratio, after which each
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
// Batch edit: use one MDL for every receiving operator A–F.
await scsp.setConfig({ fm: { depth: 8 } });
// Independent receiving-operator MDL codes, always A–F (including unused OPs).
await scsp.setConfig({ fm: { depths: [2, 4, 6, 8, 10, 12] } });
// Hardware Attack / loop link for source A, on its next note.
await scsp.setEnvelope(0, { loopLink: true });
```

Custom A → B can be set with the same configuration API:

```javascript
await scsp.setConfig({
  mode: 'fm2',
  fm: {
    algorithm: 'custom',
    custom: { inputs: [[], [0]], outputs: [1] },
  },
});
```

`fm.depths` is optional. Without it, every operator uses the existing `fm.depth`.
An explicit six-entry array takes precedence when supplied with `depth`.
Updating only `depth` clears those differences and sets all six operators;
a uniform array is normalized to the same scalar representation. Depth edits
use each sounding group's own operator / physical-slot mapping, including a
group retained while a running Code session loads a different instrument.

Each `inputs` entry lists that target's modulation sources: A is index 0,
B is index 1, through F at index 5. A four-OP merge, D → B/C → A, uses both
hardware inputs of A:

```javascript
await scsp.setConfig({
  mode: 'fm4',
  fm: {
    algorithm: 'custom',
    custom: { inputs: [[1, 2], [3], [3], []], outputs: [0] },
  },
});
```

`outputs` independently lists direct-output operators. The Synth validates the
complete graph before applying it. `getState().voiceGroups` includes
`operatorSlots` for custom groups, mapping authored A–F to actual physical
slot indices; logical Code lanes and physical CH tabs retain their existing
meanings.

The supported Custom2 self graph uses the same API:

```javascript
await scsp.setConfig({
  mode: 'fm2',
  fm: {
    algorithm: 'custom',
    custom: { inputs: [[1], [1]], outputs: [0] }, // B self → A
    depths: [7, 4, 9, 9, 9, 9],
  },
});
```

Fresh / New projects include [examples/self-feedback.js](examples/self-feedback.js)
for Code performance with this sound. Existing projects are not overwritten.
The six-operator example [examples/self-feedback-6op.js](examples/self-feedback-6op.js)
uses F self-feedback through a fan-out and merge:

```javascript
await scsp.setConfig({
  mode: 'fm6',
  fm: {
    algorithm: 'custom',
    custom: { inputs: [[1, 2], [3], [4], [5], [5], [5]], outputs: [0] },
    depths: [7, 5, 5, 4, 4, 3],
  },
});
```

This example is also included only in fresh / New projects.
The [source research](../issues/scsp_fm_self_feedback_research_20261118.md)
records the manufacturer register example, core history model and timing limits.

With a common depth, saving an active two-OP Custom sound produces a version-5
instrument preset. Four- and six-OP Custom sounds use version 6, preserving
their graphs. Fixed connections still save version 4 and keep the legacy format;
inactive custom edits are not included in that fixed-connection file. Loading
old versions 1–4 keeps their established behavior. A custom preset is never
silently converted into Chain or another fixed template.

Different per-operator depth values save as version 7, with all six `fm.depths`
entries and the complete active Custom graph when applicable. This also preserves
unused-operator values while in PCM or a smaller FM mode. Older versions 1–6
retain their common-depth behavior and reject an added `depths` field. Version 7
presets and Cassette projects need a Synth version that supports individual MDL.

A supported Custom2 self graph saves as **version 8**; Custom4/6 self graphs save
as **version 9**. Both include the complete graph and optional individual depths,
taking precedence over earlier Custom formats. Versions 1–7 reject self graphs;
version 8 requires an actual Custom2 self graph and version 9 requires an actual
Custom4/6 self graph. Non-self sounds retain their established v4–v7 formats.

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

Instrument JSON uses version 4 for fixed connections with common depth,
versions 5–6 for Custom connections, version 7 for differing operator depths,
version 8 for supported Custom2 self-feedback, and version 9 for Custom4/6
self-feedback.
It includes six applied PCM sources,
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

During SSF Live, the **DSP** tab shows the song machine's **read-only DSP**,
separate from the Synth's program and draft. Its frame badge matches the selected
CH's audible-position snapshot. Pause freezes that frame across CH choices;
seek replaces it with the new position. The bounded observation history keeps
up to 16 snapshots, with retained typed-array buffers limited to 8 MiB. This
includes RAM, slot registers and DSP arrays; JavaScript object overhead is separate.

Expand Program to inspect all 128 instructions and their four raw words.
The whole-instruction decoder displays game programs without applying the
Synth editor's execution-profile restrictions. The listing follows the Mednafen
renderer dialect: `NOFL` is word3 bit 8, while word3 bit 15 is opaque. It is not
a promise of compatibility with Synth/MAME assembly. Opaque bits remain explicit
`RAW` fields or Opaque labels; an undecodable instruction retains its raw words. Separate
disclosures contain all 64 signed COEF codes, 32 MADRS addresses and 16 shared
returns. COEF codes divide by 4096 to give their multiplier.

The selected CH's direct level / pan and `ISEL` / `IMXL` send are configured
routes. Instruction selector references and `EWT` selectors describe the program,
and the observed signed `EFREG` values are sampled hardware state. They are
not audio meters or proof that one CH reaches a particular return: arbitrary
DSP connectivity is **program-defined**. Return 0–15 use the `EFSDL` / `EFPAN`
fields in CH1–CH16's register sets. The `?` disclosure explains these distinctions.

Viewing, expanding tables or switching CH never applies or copies the song's
DSP to Synth. Live Off and Stop reveal the existing Synth draft again. A player
without DSP observation data displays **Unavailable**, rather than an invented
zero program or zero outputs.

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

## Experimental DSP programs

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

### Two-tap FIR low-pass / high-pass examples

In **DSP → Example**, choose **2-tap FIR low-pass**.
Use **Check → Apply program + coefficients**. Choosing the example changes only the draft and its staged
coefficient recommendation. Apply replaces the program and all three recommended
coefficients together, while keyboard / Code voices continue. Choose **Built-in
Delay** and use the same workflow to return to its program / default coefficients.
**Reset draft** still replaces only source text and retains live coefficients.

The FIR runs on the SCSP DSP. It combines the current input with one preceding
native 44.1 kHz sample. Recommended codes are `[4095,2048,2048]`:

```text
h[n] = Q12(x[n] × COEF0)
y[n] = Q12(x[n] × COEF2) + Q12(h[n−1] × COEF1)
     ≈ 0.5 × x[n] + 0.5 × (4095/4096) × x[n−1]
```

Choose **2-tap FIR high-pass** and apply it to subtract the previous sample.
Its codes are `[4095,-2048,2048]`: only COEF1 changes sign. All 512 program
words remain identical to the low-pass example.

```text
Low-pass:  y[n] ≈ 0.5 × x[n] + 0.5 × (4095/4096) × x[n−1]
High-pass: y[n] ≈ 0.5 × x[n] − 0.5 × (4095/4096) × x[n−1]
```

Adding neighboring samples reduces high frequencies; subtracting them reduces
low frequencies. The high-pass has a small fixed-point DC residual because
positive unity is represented by 4095/4096, not exactly 1. Compare both with
direct level 0 / DSP return enabled and use Spectrum to follow the change.

The **Applied** label follows actual program words and all three coefficients.
Changing COEF1 to −2048 / +2048, or using Code `setEffect({feedback:-0.5})` /
`setEffect({feedback:0.5})`, switches the named variant when the other values
match. Other FIR weights display **2-tap FIR (custom coefficients)**. Loading a
different draft does not relabel the currently applied sound. Both variants
retain FIR routing / tap roles and disabled Time.

Q12 uses integer floor divisions and 24-bit saturation; the source comments give the
exact steps. COEF0 captures history, COEF1 weights the previous sample, and COEF2
weights the current sample. Its four microsteps demonstrate the previous-ACC
pipeline and rotating TEMP addressing. It does not access the Delay RAM ring.
The applied label and coefficient roles follow the recognized program; **Time**
is disabled for this FIR and **Previous tap · COEF1** replaces the Feedback label.

Enable **DSP return** and set the voice's direct level to 0 for a wet-only
comparison. The low-pass gently reduces high frequencies: low sine notes
change little, while high notes, Saw / Noise and Spectrum make its effect easier
to observe. It has no variable cutoff or resonance. At a program switch the
first processed frame can contain old TEMP history; the next frame already uses
the current input history. Stop still resets the core and clears that history.

Editable fixtures are [fir2-lowpass.scspasm](examples/fir2-lowpass.scspasm) and
[fir2-highpass.scspasm](examples/fir2-highpass.scspasm).
Copy / Save keeps source comments containing the recommended codes, but does not
embed an applied configuration. Reload restores source only, without staging or
applying coefficients. Choose the example again to stage its complete setup.

### First execution profile

This version retains the existing packed-format 64 KiB DSP ring, coefficient
entries COEF0–2, address entries MADRS0–1 and EFREG0 return. Check rejects unsupported
controls; the audio owner validates again before applying. The lossless assembler
can still inspect broader bit patterns, but that does not make them executable
through this profile. [DSP field assembler guide](https://github.com/kyorohiro/hello_ymfm_wasm/blob/main/docs/synth-scsp/DSP_ASSEMBLER.md)

To try a small change, start with the built-in source and change `EWT=1` to
`EWT=0`, then Check and Apply. That removes its effect output. Restore with
Reset draft, Check and Apply. The direct voice output remains available.

### One-pole IIR low-pass example

Choose **DSP → Example → 1-pole IIR low-pass → Check → Apply program + coefficients**.
The SCSP DSP stores the preceding **24-bit internal output** in TEMP and mixes
it back with current input. Recommended codes `[4095,3840,256]` give:

```text
y[n] = sat24(floor(0.9375 × y[n−1]) + floor(0.0625 × x[n]))
EFREG0 = y[n] >> 8
```

COEF1 controls output feedback; COEF2 controls new input. COEF0 is unused and its
control is disabled. Delay Time is also unused. The example's two active codes
sum to 4096 for approximately unity passband gain. To compare another matched
pair, use COEF1 = 3072 and COEF2 = 1024. Independently changing them also changes
gain; the controls do not calculate tuning or compensation automatically.

This feedback reuses previous output across many samples. Inherited TEMP history
does not disappear after one frame as it does with the FIR example. Recommended
feedback is below unit magnitude and decays; the full raw coefficient range is
still exposed, so other values can sustain history. Q12 floor divisions can leave
a small negative zero-input residual: the shipped core can settle at internal
state −15, emitted as −1 PCM16 step. Stop resets DSP history. Clearing Delay RAM
with Apply / Enable does not reset TEMP.

Enable DSP return and use direct level 0 for comparison. Saw / Noise and Spectrum
make smoothing easier to observe. All voices share this DSP state. The Applied
label follows default / custom active coefficients, including existing Code
`setEffect({feedback})`. Since COEF0 is unused, its value does not affect named
IIR recognition. The readable source is
[iir1-lowpass.scspasm](examples/iir1-lowpass.scspasm). Source-only restore,
coefficient session scope and portable preset formats follow the same rules as
the other DSP examples; a voice preset alone does not restore the program.

### Live coefficients

**Synth DSP coefficients · live** exposes COEF0–2 as signed 13-bit integer
codes from −4096 through 4095. Each card shows the actual multiplier
`code / 4096` and the word written to register `0x700`, `0x702` or `0x704`.
For the built-in Delay, COEF0 scales the ring read, COEF1 controls feedback,
and COEF2 scales input. An edited microprogram may use these entries differently.
The **?** contains the encoding and persistence details.

Coefficient changes apply immediately, retaining the DSP ring tail, held voices
and Code session. They do not require program Check / Apply. Invalid edits leave
the old coefficients in place. These controls address the Synth's DSP, separately
from SSF playback / audition. While SSF Live is active, its read-only observation
replaces these Synth controls in the DSP tab; Live Off restores the Synth view.

COEF1 and **Feedback** are two views of the same coefficient. Feedback displays
the quantized hardware multiplier, including after Code calls
`await scsp.setEffect({feedback:-0.5})`. That example writes code −2048
(`0xC000`) and reverses the sign of successive feedback repeats in the built-in
Delay. Setting COEF2 to 2048 halves new input; setting it to zero stops new input
while existing ring contents continue. Restore COEF0 / COEF2 to 4095 for their
built-in values. The initial Feedback request remains 0.35, represented by code
1433 and multiplier 0.349853515625 in the hardware.

COEF0 / COEF2 last for the Synth session, including Stop, mode changes and voice
preset loads. Page reload starts them at 4095. COEF1 follows the existing Feedback
field in voice presets. `.scspasm` exports contain instructions only; program
Program-only Apply and Reset draft do not reset coefficients. Example Apply
explicitly includes the three staged values. Portable formats are unchanged.
New negative / above-0.85 Feedback values require this version of Synth; older
versions accepted only 0–0.85.

### DSP routing / Delay parameters

The collapsed experimental section keeps the existing Delay configuration.
The tab indicates whether this effect return is enabled. The built-in program
produces mono Delay; an edited program can use those same parameters differently.

Time spans 20–700 ms, Feedback −1–4095/4096, and Send / Return hardware levels
0–7. Initial Send 7 / Return 6 produces a first echo near half the dry
amplitude for the built-in program. Output operators feed the effect. Direct
level zero allows wet-only output. Time / Enable changes clear the ring, and
ordinary release retains the tail. Stop all sound and Mode / Connection changes
clear it. The first 64 KiB of RAM remains reserved for the DSP ring, leaving
448 KiB for editor PCM and modulation guards. Feedback, Send and Return update
live. DSP Lab retains its dedicated built-in dry / wet comparison.

## Implementation and distribution

Slot PCM, EG, LFO, modulation and the authored Delay / FIR / IIR execute in the SCSP core.
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
