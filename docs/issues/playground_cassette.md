# Playground Cassette

## Why

The playground can now use built-in sample files such as the Sonic Pi set.
This is convenient, but bundling all samples directly into every release will
make packages too large as more sample sets are added.

So the next idea is to treat sample collections like "cassettes".


## Concept

A cassette is a named sample pack that can be plugged into Tetorica.

Examples:

- `sonic-pi`
- `sonic`
- `retro-fx`
- `drum-pack-01`

The goal is to make sample packs feel like optional media sets, not part of the
core YM2612 runtime.


## Distribution Direction

Split distribution into layers:

- `core`
  - YM2612 / PSG / playground runtime
  - no large sample pack
- `demos`
  - browser demos
  - maybe a very small starter sample set
- `cassette-*`
  - optional sample packs
  - for example `cassette-sonic-pi`

Possible release names:

- `hello_ymfm_wasm_core_...zip`
- `hello_ymfm_wasm_demos_...zip`
- `hello_ymfm_wasm_cassette_sonic_pi_...zip`


## Runtime Direction

Possible API directions:

```javascript
await cassette.load("sonic-pi");
await sample.play("sonic-pi/ambi-choir");
```

or

```javascript
await megaSynth.loadCassette("sonic-pi");
await sample.play("ambi-choir");
```

The second form is convenient, but it changes alias resolution rules more.
The first form is simpler and safer as a first step.


## Minimum First Step

Start with a simple manifest-based cassette system.

Each cassette can define:

- cassette name
- human-readable title
- available sample aliases
- actual file paths
- license / credits info

Example image:

```javascript
{
  id: "sonic-pi",
  title: "Sonic Pi Cassette",
  samples: {
    "ambi-choir": "./samples/sonic-pi/ambi_choir.flac",
    "drum-heavy-kick": "./samples/sonic-pi/drum_heavy_kick.flac",
  },
  credits: {
    license: "CC0 / Sonic Pi bundled sample set",
  },
}
```


## Benefits

- package size can be controlled
- sample sets can grow without bloating every release
- sample ownership / credits can be organized per pack
- the idea is memorable and fits the retro direction
- users can understand which sample world they are loading


## Open Questions

- Should `cassette.load("sonic-pi")` eagerly preload all samples?
- Or should it only register aliases and lazy-load on first use?
- Should `sample.load("sonic-pi/ambi-choir")` keep working even without an
  explicit cassette load?
- Should cassette metadata also include example code snippets?
- Should `stream` also support cassette manifests?


## Likely Good First Version

- Keep current `sonic-pi/...` alias support
- Add cassette manifest files
- Add `cassette.list()`
- Add `cassette.load(name)`
- At first, `cassette.load(name)` only registers aliases and credits metadata
- Real sample bytes are still loaded lazily by `sample.load(...)`


## Notes

- This does not need to be YM2612-specific.
- It should live at the playground / MegaSynth layer, not YM2612Synth.
- This can also become the base for future user-provided sample packs.


## How Users May Add a Cassette

Two user-facing directions look natural.

1. Import a packaged cassette

- drag and drop `xxxxxx.cassette.zip`
- or choose it with an Import button
- Tetorica reads the manifest and registers its contents

2. Place an unpacked cassette directory

- unpack the cassette manually
- place it under a local `cassettes/` folder
- Tetorica scans and registers it on startup

The first path is better for ordinary users.
The second path is better for local development and custom packs.


## Suggested Cassette Layout

Packaged:

```text
sonic-pi.cassette.zip
  manifest.json
  samples/...
  presets.json
  examples/...
  LICENSE
  CREDITS.md
```

Unpacked:

```text
cassettes/
  sonic-pi/
    manifest.json
    samples/...
    presets.json
    examples/...
```


## When To Introduce This

Do not rush this immediately.

Introduce `cassette` when:

- sample packs start increasing
- release size becomes annoying
- multiple sample worlds need to be distributed separately
- sample credits need to be organized per pack

Until then, the current direct `samples/sonic-pi/` approach is good enough.
