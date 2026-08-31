# Noise Generator

Goal:

- add a simple noise generator for Tetorica Playground
- make ambient sound design such as sea, wind, rain, radio, and drone easier
- provide a path closer to Sonic Pi style `s = synth ...; control s, ...`
- make it practical to build:
  - wave / sea sound
  - wind
  - rain
  - radio noise
  - campfire-like air / texture
  - drone beds

Why:

- YM2612 FM alone is not a good fit for wave / wind / noise-first sound design
- Sonic Pi's `:bnoise`, `:cnoise`, and `:gnoise` are synths, not samples
- Tetorica already has `fm`, `psg`, `sample`, `stream`, and `fx`
- adding `noise` as one more audio layer is a natural extension

Related Sonic Pi notes:

- `etc/examples/illusionist/ocean.rb` uses:
  - `[:bnoise, :cnoise, :gnoise].choose`
  - long `attack / sustain / release`
  - `cutoff_slide`
  - `pan_slide`
  - `control s, ...`
- this suggests the important part is:
  - noise source
  - filter
  - envelope
  - stereo motion
  - post-control after start

## First API idea

```ts
type PlaygroundNoiseType =
  | "white"
  | "pink"
  | "brown"
  | "gray"
  | "clip";

type PlaygroundNoiseOptions = {
  type?: PlaygroundNoiseType;
  gain?: number;
  pan?: number;
  attack?: number;
  release?: number;
  autoStart?: boolean;
};

type PlaygroundNoiseVoice = {
  readonly type: PlaygroundNoiseType;
  attack: SimpleParamControl;
  release: SimpleParamControl;

  gain: AudioParamControl;
  pan: AudioParamControl;

  filter: {
    set(
      type: BiquadFilterType,
      frequency: number,
      q?: number
    ): void;
    cutoff: AudioParamControl;
    q: AudioParamControl;
  };

  start(): void;
  stop(): void;
  dispose(): void;
};

type PlaygroundNoiseAPI = {
  create(
    options?: PlaygroundNoiseOptions
  ): PlaygroundNoiseVoice;
  stopAll(): void;
};

declare const noise: PlaygroundNoiseAPI;

type NoiseControlOptions = {
  gain?: number;
  pan?: number;
  cutoff?: number;
  q?: number;
  slide?: number;
};

declare function control(
  voice: PlaygroundNoiseVoice,
  options: NoiseControlOptions
): void;
```

Example:

```javascript
const sea = noise.create({
  type: "pink",
  gain: 0.4,
});

sea.filter.set("lowpass", 1800, 0.4);
control(sea, {
  pan: -0.5,
  gain: 0.8,
  cutoff: 2500,
  slide: 2,
});
```

## First implementation scope

Keep the first version small:

1. `white`
2. `pink`
3. `brown`

Later:

4. `gray`
5. `clip`

Current status:

- `white`
- `pink`
- `brown`
- `gray`
- `clip`
- `attack`
- `release`
- `control(noiseVoice, ...)`

The first version does not need:

- Sonic Pi compatible `control(voice, ...)`
- ADSR in the public API
- per-voice custom LFO
- complex modulation routing

## Implementation options

### Option A: pre-generated AudioBuffer

Pros:

- simplest implementation
- likely enough for sea / wind / rain / radio style use
- easy to integrate with existing Web Audio nodes

Cons:

- less flexible than true realtime generation
- loops may need care to avoid obvious repetition

Idea:

- generate a few seconds of noise in JS once
- store as `AudioBuffer`
- loop playback
- route through gain, pan, and filter nodes

### Option B: AudioWorklet realtime generation

Pros:

- more flexible
- cleaner future path for per-voice evolution

Cons:

- higher implementation cost
- more state management
- more debugging effort

Recommendation:

- start with Option A
- move to AudioWorklet only if needed later

## Runtime shape

Likely chain per voice:

`AudioBufferSourceNode(loop)`
-> `BiquadFilterNode`
-> `GainNode`
-> `StereoPannerNode`
-> master FX chain

Notes:

- `start()` should create or restart the looping source
- `stop()` should stop playback but keep reusable nodes
- `dispose()` should fully release the voice
- `stopAll()` should stop every active noise voice

## Integration targets

1. `docs/playground/tetorica-playground-globals.d.ts`
2. `web/playground_runtime.js`
3. `docs/playground/playground_examples.js`
4. maybe later `web/README.md`

## Example targets

- `sea-noise`
- `wind-noise`
- `radio-noise-bed`
- `rain-noise`

## Open questions

- should `create()` auto-start by default?
- should `type` be mutable after creation?
- should we expose `play()` as a short alias?
- should `noise` live under `pg.noise` only, or also global `noise` like `fm` / `fx` / `psg`?

Current leaning:

- global `noise` is fine
- also expose `pg.noise`
- `autoStart: true` by default may feel best for beginners
