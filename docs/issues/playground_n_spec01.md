Add TFI presets from Playground URL parameters

Add a small URL-based TFI preset loading feature to Tetorica FM2612 Playground.

Goal

The Playground should stay generic and minimal.

External sites, research pages, tutorials, fan projects, etc. should be able to open Tetorica FM2612 Playground with:

* JavaScript source code
* TFI instrument data
* IDs for those TFI instruments

The Playground itself must NOT implement:

* preset search
* external preset libraries
* categories or tags
* posting/sharing services
* Sonic-specific or other game-specific content
* external-site integrations

It should only provide a generic input interface.

Existing URL parameters

The Playground already supports URL parameters such as:

?src=<base64>&ex=<name>

Keep the existing behavior.

New URL parameters

Add:

tfi=<base64>,<base64>,...
tfi-id=<ascii-id>,<ascii-id>,...

Example:

?src=...&tfi=<TFI1>,<TFI2>&tfi-id=bass,bell

Each tfi-id corresponds to the TFI at the same array index.

For example:

tfi     = [TFI1, TFI2]
tfi-id  = [bass, bell]

means:

bass -> TFI1
bell -> TFI2

TFI format

For now, support TFI only.

Do NOT add VGI support yet.

A valid TFI instrument is 42 bytes.

Decode the Base64 data and validate it before exposing it to Playground code.

Invalid data should fail safely and must not break Playground startup.

IDs

Keep IDs intentionally simple.

Allow ASCII identifiers suitable for referring to presets from JavaScript.

At minimum support:

A-Z
a-z
0-9
_
-

Reject or safely ignore invalid IDs.

Handle mismatched numbers of tfi and tfi-id entries safely.

JavaScript API

Inspect the existing Playground preset API and integrate the URL-loaded TFI presets in the smallest and most natural way.

Do not create a parallel preset system if the existing preset infrastructure can be reused.

The intended usage should be simple, for example conceptually:

fm.setPreset(CH1, presets.bass);

Use the naming/style that best matches the existing Playground API.

Do not change unrelated public APIs.

Important design constraint

This feature is deliberately only an input mechanism.

The architecture should remain:

External research / tutorial / fan site
        |
        | generates Playground URL
        v
Tetorica FM2612 Playground
        |
        +-- src
        +-- tfi
        +-- tfi-id

The external site decides what the presets mean.

Tetorica does not know or care whether a preset is:

* bass
* horror
* RPG
* Sonic research
* a tutorial
* a user’s own instrument

Do not introduce any semantic classification into the Playground.

Compatibility

Preserve existing:

src=
ex=

behavior.

URLs without tfi / tfi-id must behave exactly as before.

Tests

Add tests for at least:

* one valid TFI
* multiple TFIs
* ID mapping
* invalid Base64
* invalid TFI byte length
* invalid ID
* mismatched TFI / ID counts
* no TFI parameters
* existing src / ex behavior remains unaffected

Keep the implementation small and focused. Do not expand this task into a general preset-library or sharing system.