Cassette Concept

Use Cassette as the user-facing metaphor for a reusable FM knowledge package.

The previously described Pack concept should be treated as a Cassette.

A Cassette represents a portable collection of FM sound knowledge:

Cassette
├─ Presets
├─ Patterns
├─ Helpers / Utility Functions
├─ Examples
├─ Keybinds
├─ Resource Requirements
└─ Optional Assets

The intended distributable file format is:

<name>.cassette.zip

Examples:

street-fighter-study.cassette.zip
fm-bass-patterns.cassette.zip
pc98-sound-study.cassette.zip

A possible archive structure is:

example.cassette.zip
├── cassette.json
├── presets/
├── patterns/
├── helpers/
├── examples/
├── keybinds/
└── assets/

cassette.json should contain basic metadata and resource/capability requirements.

For example:

{
  "name": "example",
  "version": "0.1.0",
  "target": "ym2612",
  "requires": {
    "fmChannels": 3
  }
}

Do not finalize a large manifest specification yet. Keep the initial format minimal and extensible.

Runtime Object

Loading a .cassette.zip should eventually produce a JavaScript Cassette object.

Conceptually:

const cassette = await loadCassette("example.cassette.zip");
cassette.preset("bass");
cassette.pattern("bass-line");
cassette.helper("groove");
cassette.example("demo");
cassette.keybind("keyboard");

The exact API is not fixed yet.

Board Metaphor

A Cassette is the storage/distribution unit.

connect() represents assembling components onto a board and connecting them together.

Conceptually:

Cassette
   ↓ load components
[ Pattern ]
     ↓
[ Helper  ]
     ↓
[ Preset  ]
     ↓
[ YM2612  ]

Multiple Cassette components should eventually be mixable:

const board = connect([
  cassette.pattern("bass-line"),
  cassette.helper("groove"),
  cassette.preset("bass"),
]);

A key binding or MIDI adapter can then control the resulting object:

keySetting.set(
  "mpk-mini",
  adapter(board)
);

Important

Do not make Cassette tightly coupled to YM2612.

A Cassette may eventually target or require capabilities from:

YM2612
YM2608
YM2151

Resource requirements should describe capabilities where possible rather than hard-coded chip channels.

The goal is:

Turn FM sound research into portable, executable, playable knowledge.

A .cassette.zip should contain not only “a sound”, but also knowledge about how that sound can be used.