# TODO 2

Last updated: 2026-08-24

## Current missing parts

The project is already usable, but several areas are still incomplete.

The main remaining work is no longer "make it work at all".
It is now mostly:

- filling missing YM2612 features
- polishing Playground and Synth UX
- improving documentation and tutorials
- stabilizing Looper and export-related workflows

## 1. YM2612 / YM2612Synth missing parts

`YM2612Synth` already supports the basic FM voice workflow, but it does not cover the whole YM2612 surface yet.

Main missing or weak areas:

- worklet-side async low-level read path
- busy handling
- timer A / timer B handling
- more readable raw-write / learning-oriented APIs

Already added recently:

- `RS`
- `AM enable`
- `SSG-EG`
- `LFO`
- `PMS / AMS`
- low-level `write(...)`
- low-level `writeAddress(...)` / `writeData(...)`
- direct low-level `read(...)`
- direct low-level `readStatus(...)`
- low-level `onWrite`
- direct low-level `onRead`
- low-level `onIrq`

### Low-level API status

Low-level access is now "mostly usable".

Current shape:

- direct transport:
  - `write(offset, data)`
  - `read(offset)`
  - `readStatus()`
  - `getIrq()`
  - `setHooks({ onWrite, onRead, onIrq })`
- synth low-level layer:
  - `write(port, register, value)`
  - `writeAddress(port, register)`
  - `writeData(value)`
  - `read(offset)` on direct transport
  - `readStatus()` on direct transport
  - `setHooks({ onWrite, onRead, onIrq })`
- worklet transport:
  - `write(...)`
  - `getIrq()`
  - `onIrq`

Main remaining low-level gap:

- `read()` across AudioWorklet is still missing as a synchronous API.
- If needed, this should likely become `readAsync()` instead of pretending to be synchronous.

After that, the next most YM2612-like low-level additions are:

- busy flag exposure / policy
- timer A / timer B exposure
- deciding whether external I/O style hooks are worth surfacing now or later

VGM playback is already practical for part of the Mega Drive / Genesis workflow,
but it is not a full VGM implementation.

Still weak:

- DAC / PCM related paths
- unsupported or partially supported VGM commands
- broader compatibility beyond the current practical subset

## 2. Playground remaining work

`docs/playground` is already useful, but still has important polish work left.

Main remaining items:

- FX tab
- envelope visualization integration
- guitar / fretboard-style input integration
- safer hot reload / live replace behavior
- protection against non-yielding `liveLoop()` code
- stronger autocomplete / discovery
- continued file splitting so `playground.js` does not grow large again

## 3. Synth app remaining work

`docs/synth` is already close to an app, but can still be improved.

Main remaining items:

- stronger 6-channel use
- better preset coverage
- more compact and clearer UI
- clearer learning flow around operator / algorithm / envelope relationships
- more game-usable voice examples

## 4. Looper remaining work

The looper direction is now clearer, but it is not fully finished as a musical tool yet.

Main remaining items:

- better unit management
- improved undo / mute / delete behavior
- more stable playback UX
- export connection
- cleaner handling of event metadata vs recorded loop audio

## 5. Documentation remaining work

Documentation is one of the project goals, so this area is still important.

Main remaining items:

- reorganize tutorials
- refine `ex00`, `ex03`, and related pages
- improve the "how to learn YM2612 here" path
- strengthen FM learning pages
- connect tutorials and Playground more naturally
- improve English / Japanese presentation strategy

## 6. Packaging / release work

Release and itch.io packaging already work much better now,
but release scripts still need occasional maintenance when files move.

Main remaining items:

- reduce file-pickup mistakes in package scripts
- keep release structure understandable
- continue checking standalone app packaging after refactors

## Suggested near-term priorities

If choosing only a few next steps, these are likely the highest value:

1. Fill the most important missing `YM2612Synth` parameters.
2. Improve Playground with FX / envelope / fretboard integration.
3. Reorganize tutorials and YM2612 learning documentation.
4. Stabilize Looper as a more practical musical tool.

## Notes about `docs/issues`

`docs/issues` is starting to grow large.

It may soon help to classify issue notes into groups such as:

- `now`
- `later`
- `memo`
- `done`

Some current notes also overlap and may be merge candidates later.
