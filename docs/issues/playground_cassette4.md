# Playground Cassette v1

Define a small, portable cassette format for the Playground.

A Cassette is a zip archive that carries reusable FM sound knowledge: timbres,
editable examples, and samples.

The first format should stay small. Do not add categories until a real cassette
cannot be expressed by this layout.

## Archive Layout

```text
street-fighter-study.cassette.zip
|- timbres/
|  |- arcade-bass.tfi
|  `- metallic-lead.tfi
|- examples/
|  `- stage-loop.js
`- samples/
   |- hit.wav
   `- voice.flac
```

Top-level directories have these meanings:

- `timbres/`: sound colors. v1 accepts TFI files. More formats can be added
  later without renaming the directory.
- `examples/`: complete, editable Playground programs intended to be loaded,
  run, and adapted. Helper functions live directly in an example.
- `samples/`: optional audio files used by code or examples.

Additional root files are optional and are ignored by the loader. For example,
a cassette author may include `README.md`, `license.txt`, or `CREDITS.md` when
they want to provide documentation, license terms, or sample attribution.

## Naming and Discovery

There is no `cassette.json`, including as an optional file. The directory
layout is the format.

The archive filename is the cassette ID:

```text
street-fighter-study.cassette.zip -> street-fighter-study
```

The basename of each supported file is its public name:

```text
timbres/arcade-bass.tfi -> arcade-bass
examples/stage-loop.js  -> stage-loop
samples/hit.wav         -> hit
```

The loader discovers supported files in these directories. Duplicate public
names within one category are an error. The v1 format has no package-level or
component-level metadata, including resource requirements. Add metadata only
when a concrete use requires it.

## Runtime API

The exact API is still open, but discovered file names should map directly to
the runtime object.

```js
const cassette = await loadCassette(file);

cassette.timbre("arcade-bass");
cassette.example("stage-loop");
cassette.sample("hit");
```

`timbre` is used for the programmatic API because it is the standard English
term for a sound color. The Playground UI may still describe this category as
"Sound Colors".

## Keyboard Input

Keyboard mappings are written directly in an example rather than stored in a
separate cassette format. The Playground should eventually provide named input
handlers with the same lifecycle behavior as `liveLoop`:

```js
onKeyboardPressKey("arcade-input", (event) => {
  // note on
});

onKeyboardReleaseKey("arcade-input", (event) => {
  // note off
});
```

Handlers with the same name are replaced on the next run. The Playground also
removes them when that run ends, so examples do not accumulate browser keyboard
listeners and do not need to manage disposer functions themselves.

## Safety Boundary

TFI files and samples are data. Files under `examples/` are executable
JavaScript and should be shown as such before they run. The loader must reject
paths that escape the archive.

This keeps a cassette understandable as both a distributable archive and a
trusted source of reusable Playground code.
