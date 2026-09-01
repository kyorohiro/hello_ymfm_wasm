Tetorica FM Playground: Knowledge Pack / Resource Constraint Design

Goal

I want to represent FM sound research as reusable JavaScript objects instead of only documentation.

A reusable sound package should be able to contain:

* utility functions
* sound patterns
* timbre / sound presets
* usage examples
* key bindings
* performance helpers

The important idea is that these objects should be composable.

Example:

const obj = connect([
  startDrumPattern("player-select"),
  soundPickPattern("ryu-stage"),
]);
keySetting.set("mpk-mini", adapter(obj));

The user should be able to load a pack, play with it, modify it, and reuse parts of it.

⸻

Knowledge Pack

A pack may look conceptually like this:

definePack("example-pack", {
  presets: {
    bass: {},
    lead: {},
    bell: {},
  },
  functions: {
    playBass,
    tensionArp,
    driftingPad,
  },
  examples: {
    intro: {},
    battle: {},
  },
  keybinds: {
    keyboard: {},
    mpkMini: {},
  },
});

The exact API is not fixed yet.

Please prefer a small and extensible design over a large framework.

⸻

Important YM2612 Constraint

YM2612 only has 6 FM channels.

Therefore composable objects must NOT blindly own fixed channel numbers.

For example, avoid designing every object like:

pattern({
  channel: 2,
});

because multiple reusable objects may collide.

Instead, each object should be able to declare its resource requirements.

Conceptually:

requires: {
  fmChannels: 2,
}

or:

requires: {
  fmChannels: 1,
  ch3Special: true,
  dac: false,
}

Some resources may be exclusive.

Examples:

* FM channels: maximum 6
* CH3 special mode
* DAC usage / CH6 conflict
* possibly PSG resources later
* YM2608 / YM2151 may have different capabilities later

⸻

Resource Allocation

connect() should eventually be able to inspect the requirements of its children and allocate channels/resources.

Example:

connect([
  bass(),
  lead(),
  pad(),
  arp(),
]);

The system should be able to detect something like:

Requested FM channels: 7
Available FM channels: 6

Do not silently produce an invalid configuration.

For the first implementation, reporting a clear resource conflict is enough.

Automatic voice stealing or sophisticated allocation is NOT required initially.

⸻

Fallback / Degradation

In the future, a reusable object may optionally describe a degraded configuration.

Example:

requires: {
  fmChannels: 2,
},
fallback: {
  fmChannels: 1,
}

A two-channel pad could then become a one-channel pad when resources are limited.

Do not over-engineer this now, but design the resource model so this can be added later.

⸻

Separation of Concerns

Try to keep these concepts separate:

Preset
  = sound/timbre parameters
Pattern
  = musical/event generation
Function / Helper
  = reusable musical behavior
Keybind
  = human input mapping
Adapter
  = connects keyboard/MIDI/controller input to an object
Resource Requirement
  = hardware/chip capabilities required by the object
Pack
  = collection of the above

A Pack should not need to know concrete hardware channel numbers unless the behavior specifically requires one.

⸻

Future Compatibility

The current target is YM2612, but the design should not make YM2612 assumptions everywhere.

Possible future backends:

YM2612
YM2608
YM2151

These chips have different resources.

The goal is NOT to build all of them now.

The goal is simply to avoid an API that makes supporting them unnecessarily difficult later.

For example, prefer:

requires: {
  fmChannels: 2,
}

over:

requires: {
  ym2612Channel1: true,
  ym2612Channel2: true,
}

unless a YM2612-specific feature is actually required.

⸻

First Implementation Scope

Please implement only the smallest useful foundation:

1. Define a lightweight common object/resource interface.
2. Allow objects to expose resource requirements.
3. Make connect([...]) combine those requirements.
4. Detect resource conflicts for YM2612’s 6 FM channels.
5. Keep current Playground behavior working.
6. Add a very small example demonstrating:
    * one preset
    * one pattern/helper
    * one key binding
    * two or more connected objects
    * resource requirement inspection

Do not build a complex scheduler, dependency-injection framework, or automatic voice-stealing system yet.

The main objective is to establish a clean foundation for turning FM sound research into reusable, playable JavaScript knowledge objects.