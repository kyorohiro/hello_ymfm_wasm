# Tetorica SMSGEAR Synth

A PSG-first Master System / Game Gear sound laboratory with optional YM2413 FM.
Open `docs/synth-smsgear/index.html` through your local HTTP server.

- **PSG** is selected initially: three square-wave tones, one Noise voice,
  hardware attenuation and Game Gear left/right routing.
- **YM2413** offers 15 fixed instruments plus one shared User patch. User edits
  affect every instrument-0 voice. OP1 is the modulator, OP2 the carrier;
  Envelope fields use hardware codes. Rhythm uses physical CH7–CH9 and replaces
  those melody voices with five percussion instruments. The mode switch is
  shared by the whole chip. New Cassettes start with Rhythm On; existing saved
  presets retain their On/Off choice.
- **Auto** allocates keyboard notes in software; physical CH selection aligns
  the controls and keyboard target. Selecting a channel makes no writes.
- Keyboard: the same four compact computer-key rows as FM2612 (1… / Q… / A… /
  Z…). Pointer keys use the same mapping. Octave and Pitch are software
  performance controls. Code view keeps keyboard input active outside the editor.
  Pitch sits to the left of the keyboard and stays synchronized with the upper
  control. Fractional bends use frequency writes; the chip APIs keep their
  existing integer-MIDI/name contract. This also applies when a new key is
  pressed with Pitch already moved. Fixed-rate Noise and percussion are not
  retuned by this wheel; Tone-3 Noise follows its oscillator.
- **Mixer** source gains use Tetorica's calibrated output units. These software
  faders are separate from chip attenuation. Master permits 0–380%; boosting
  above 100% turns the bar orange and can overdrive the output.

In YM2413 Auto with Rhythm On, keys **1 / 2 / 3 / 4 / 5** trigger **Bass drum /
Snare / Tom / Cymbal / Hi-hat**; other keys play the six melodic channels.
CH1–6 keep all keys melodic. Selecting CH7 shows Bass drum (1), CH8 Snare (2)
and Hi-hat (5), CH9 Tom (3) and Cymbal (4). Those reserved CH views disable
unassigned keys and show their drum levels instead of melodic/User controls.
With Rhythm Off all nine CHs are melodic. Drum level writes are not sent while
Off, because the same register nibbles then select melodic instruments.
New audio sessions initialize the drum oscillators to C2 / C3 / G3 as software
startup tuning. Paused reference audition uses the song's oscillator tuning.

## User Envelope editing

New Cassettes start FM on **0 · User**, ready for operator editing. Existing
fixed-ROM selections are kept. Fixed instruments cannot be edited; **Select
User to edit operators** switches to the stored User patch and does not copy
the ROM instrument. Reference-song controls edit the selected physical channel directly. Capture to Synth
keeps an independent static copy.

OP1 (orange) and OP2 (blue) share one Envelope canvas. Select OP1 or OP2 above
the graph to choose the editing target; both curves remain visible. **AT** changes
AR horizontally and level vertically (OP1 TL, OP2 channel Attenuation).
**DS** changes DR horizontally and SL vertically; **R** changes RR horizontally.
Values stay in the actual 0–15 range. The numeric
+/− controls edit those same operator parameters. OP1 and OP2 use compact
horizontal rows with shared headings, matching FM2612; narrow screens scroll
inside the parameter area. Arrow keys on a focused handle
also adjust the values. Changes use the same Files/Auto-apply path as the knobs.

These are schematic control guides including schematic level attenuation but without KSL, not measured milliseconds or
a new software Envelope. AR 0 prevents attack; DR 0 holds the peak. With EG
sustain (EGT) On, the envelope holds SL and RR controls key-off release. With
EGT Off, RR controls the decay while held and key-off uses the chip's fixed
release rate. Channel Sustain can override the key-off rate. Built-in patches,
reference Live views and fixed percussion do not expose editable User envelopes.
Handles stay on the visible curve when a stage is inactive. For example, with
DR 0 the stored SL still changes when dragging S, but the guide keeps holding
the peak until decay is enabled. The readout identifies this inactive stage.

## Code and Files

Use `const psg = await useSoundChip("segapsg")` or
`const fm = await useSoundChip("ym2413")`. These borrow the same instrument chips
as the controls. There is no hidden YM2612. `liveLoop`, `livePrepare`, `tween`,
`beat`, `context` and software `liveFx` use the existing Synth Code runtime.
Run starts a new performance; Apply preserves context and named loops. Code
and reference playback are mutually exclusive; keyboard can accompany either.

Files reuses working/saved storage: Auto apply is On initially, dirty files have
●, Save/Save all/Discard/Discard all and Cmd/Ctrl+S are available. Cassette ZIPs
retain accepted files plus working differences. Import never runs source.
New Cassette is in Menu → New. Examples are seeded into new projects. Right
click file rows for basic operations. Selecting JSON never forces Keyboard into
Code view. Physical channel edits are direct and do not rewrite the Auto sound.

## VGM reference performance

Menu → Import → VGM / VGZ accepts PSG-only, YM2413-only and combined logs.
Original bytes stay in `/vgm/`; up to 512 static sounds are extracted under
`/presets/`. Choose a preset to load it. Import does not start audio.
Select the song, then Play. Pause/Resume retains chip state and position exactly;
Stop closes the reference player. Each song plays one pass.

After Play, use the position bar to seek. Playing remains Playing, Pause remains
paused, and Live registers update to the destination. Seek reconstructs the
oscillator, Noise and FM-envelope history from the beginning in bounded silent
AudioWorklet slices. Long jumps take time; progress is shown and Stop cancels.
**Cache** (default On) retains original-history native checkpoints in memory
every five seconds, for PSG-only, YM2413-only and combined songs. Later seeks
can start from a nearby played or prepared section. The first long jump still
needs history replay. Storage is bounded to 64 entries and a 2 MiB state
budget; no cache is saved to Cassette or browser storage. Off clears it.
Manual edits are never checkpointed; seeking restores original history.

FM checkpoints retain oscillator/feedback, Envelope/LFO/Noise, Rhythm, registers
and resampler timing, not just the visible controls. Mixer changes clear FM
checkpoints so a held resampler sample cannot carry an old gain/mute into a
new seek. New clean checkpoints then accumulate under the current settings.
Older WASM runtimes without native state support keep exact uncached
reconstruction; the checkbox is disabled with an explanation. Seeking to the
end leaves the song ended.

Mixer → **VGM channels · output mute** controls PSG CH1–3 / Noise and YM2413
CH1–9 independently. These reference-only output masks leave original registers,
chip timing and the separate keyboard/Code instrument unchanged. Choices survive
seeks and song replacement within the session. In Rhythm mode CH7 mutes Bass
drum, CH8 Hi-hat/Snare, and CH9 Tom/Cymbal together.

Song view displays the selected physical CH from applied registers. Auto update
can freeze this display. While Playing or Paused, sound controls directly edit
the selected physical song CH without restarting transport. Only touched
parameters are sent to the audio renderer; later VGM writes can overwrite them.
The User patch and Rhythm mode are chip-wide. Noise settings belong to the
Noise channel; Game Gear stereo controls edit the shared routing bits. Seek
rebuilds original history and clears manual edits. Edits do not modify the VGM
file or saved Synth preset. Capture to Synth copies its static parameters while
preserving reference transport. Paused keyboard audition uses the Synth route;
it does not overwrite the frozen reference chip. Controls changed during Pause
also update the held keyboard audition and subsequent notes. Pause itself stays
silent; use the keyboard to hear a channel with a playable pitch. Stop returns
to the editing Synth. Its PSG attenuation shows the configured next-note level,
not the temporary hardware value 15 used for key release. The curves above are output
RMS, waveform and spectrum after Master, not hardware ADSR reconstruction.

Supported events: Sega PSG writes, Game Gear stereo, YM2413 writes and VGM waits.
Limits: 16 MiB compressed/expanded file, two million writes, one-hour preview.
Dual chips, VRC7 variants, unrelated chip writes and DAC stream commands reject
explicitly rather than silently dropping audio. An undeclared YM2413 clock still rejects FM writes except zero User-register
initialization at time 0, which is ignored with a warning.
No games, ROMs or song files
are bundled. Synthetic demonstration data in `fixtures.js` is original.

## Current limits

Software PSG Envelope,
Looper/Event Rec, timed operation recording and Tauri deployment remain later
work. FM fixed patches are not exposed as editable ROM bytes; choose User to
edit the shared patch. Captures are static sounds, not complete game-driver
software automation or arbitrary rhythm/sample reconstruction.

## Modify / package

The UI and packaging follow the FM2612 Synth patterns. Existing shared Files,
Code, parameter drag buttons, expanded tabs and monitor helpers are reused.
Native chip code and shared mixer policy were not modified for this consumer.

```sh
npm run test:smsgear-synth
npm run test:smsgear-synth:browser
sh scripts/package_itch_smsgear_synth.sh dev
```

The ZIP keeps readable JavaScript, CSS, WASM, source kits and component licenses.
See `PACKAGE.md`, `js/RUNTIME.md` and `js/sources/` inside it. The application is
BSD-3-Clause; included components retain their own notices. This is an
independent Tetorica application, not an official Sega or SMS Power! product.
Hardware references: [SMS Power! sound documentation](https://www.smspower.org/Development/Sound-Index).

Pointer-operated Sound source, Noise type/rate and FM Instrument menus stay
inside the page so performance key-down/up events continue while choosing an
option. Reselecting the same option also returns focus. Text inputs and Code
editors retain their normal typing behavior.

The output monitor Pitch wheel sits vertically to the right of the display,
matching FM2612: up raises pitch, down lowers it. Both Pitch wheels stay linked.

### Timed PSG Code (SMSGEAR Web Audio)

New Cassettes include `examples/psg-timed.js`. This app-local first version adds
`build`, `compile`, `captureState`, `schedule` and `clearSchedule` to
`await useSoundChip("segapsg")`. YM2413 now has the corresponding app-local
adapter described below. Common Playground/npm/Native integration remains
follow-up work.

`build` runs its synchronous callback once and records serializable operations,
without copying or editing the live chip. `atSeconds` and `atSample` are absolute
pattern offsets. The sample reference defaults to 44100 Hz (configurable through
`build(callback, {referenceSampleRate})`), independent of the output device rate.
Use `await beat()` between patterns for BPM changes; offsets inside a built
pattern and `repeatSeconds` are deliberately measured in seconds/samples.

`await psg.compile(plan)` captures the renderer's current operation-resolution
state. `{initialState:"reset"}` uses a virtual reset without resetting audio;
a detached `await psg.captureState()` may be reused as `initialState` to compare
traces. PSG rows identify the logical register0–7, channel and actual command
byte `value`; Game Gear stereo rows contain `stereo`. The byte stream is PSG's
hardware format, not an invented address/value register bus. This trace predicts
one baseline; it is not a recording of concurrent live writes. Snapshots do not
include oscillator phase and cannot rewind audio.

The immediate client lacks complete period/Noise metadata, so
`{initialState:"client"}` explicitly rejects rather than returning a misleading
trace. No extra continuous synchronization is installed.

`schedule(plan, {name, repeatSeconds?})` resolves operations on AudioWorklet's
sample clock using the existing Performance Queue. It stores bounded repeating
patterns, not unrolled streams or JavaScript timers. Same-time operation order
and repeated Noise-register writes are preserved; manual changes affect later
partial operations. A valid same-name reservation replaces the old pattern;
an invalid replacement leaves it intact. `clearSchedule(name)`, Stop and loop
retirement cancel reservations and release only notes still owned by them.
Apply stages entry reservations before committing; a failed Apply preserves the
previous reservation. The scheduler is software; the command-byte effects are
hardware PSG operations. VGM playback remains exclusive with Code.

### Timed YM2413 Code

New Cassettes also include `examples/opll-timed.js`. `useSoundChip("ym2413")`
provides the same `build`, `compile`, `captureState`, `schedule` and
`clearSchedule` shape as the timed PSG prototype. These are SMSGEAR-local Web
Audio APIs; shared Playground/npm/Worker/Native adapters remain follow-up work.

The example schedules a two-second modulator-TL cycle independently of a
`beat()`-paced melody. OP1 here is the modulator (index0); the carrier (OP2) has
no shared TL control, so use per-channel attenuation for carrier loudness.
The existing User patch is shared by every instrument-0 channel. This scheduling
is software; all resulting Operator, pitch, Gate and Rhythm register writes use
the existing hardware-style YM2413 API and core.

The recorder accepts parameter methods, `writeRegister`, `keyOn`/`keyOff` and
`noteOn`/`noteOff`, but not initialize/reset or arbitrary functions. Arguments
must be plain serializable objects/arrays; a raw User patch can use a number[8]
instead of Uint8Array. Compile rows contain `offsetSeconds`, `register`, `value`,
`operationIndex` and `writeIndex`. Partial Rhythm trigger rows also retain an
`intentMask` so a shared R14 byte does not claim another drum's note.

`compile(plan)`/`{initialState:"current"}` captures authoritative Worklet
register-resolution state. `reset` uses virtual all-zero registers; a captured
snapshot can be reused without changing live audio. Unlike PSG, YM2413 already
has a complete64-byte client register shadow, so `client` is supported without
communication. It represents that local shadow and may omit scheduled changes
not reflected there. These snapshots are not oscillator/Envelope audio save
states and cannot resume a song.

User-Operator and voice partial updates resolve against the renderer's state at
the operation's actual application time. Rhythm trigger ownership is per drum,
including Hi-hat/Snare and Tom/Cymbal sharing physical channels and level bytes.
Clearing a drum pattern does not release its neighbor. Rhythm mode switches
retire obsolete melodic/drum ownership, so a stale melodic KeyOff cannot mute a
new percussion performance. Same-name replacement, failed Apply retention,
Stop and stopLoop use the same Code lifecycle as PSG. Rewriting the same On
value transfers ownership without inserting a synthetic hardware Off: like the
immediate API, a fresh Envelope attack requires an Off-to-On interval. UI sound
controls also resolve their parameter patches against current renderer state,
so an older Main-side Gate shadow cannot inadvertently release a timed note.
Later VGM playback stops Code as before.
