# Introducing tetorica-soundchip-native

I've published [tetorica-soundchip-native](https://github.com/kyorohiro/tetorica-soundchip-native): a collection of C/C++ sound-chip sources, native adapters, and WebAssembly build recipes for music players, synthesizers, games, and audio tools.

Collecting cores, carrying adaptations, putting build steps together, and tracking their licenses can take a lot of work before you hear the first note. This repository brings those pieces together, with source provenance and the differences between Native and WASM documented alongside them.

Applications can vendor a snapshot pinned by version and SHA-256, then update when they choose. The sources and component licenses are kept together, without Git submodules or a neighboring application checkout. The archive manifests also connect compiled WASM artifacts to their matching sources.

The first standalone Native CMake target is **YM2612 using ymfm**. Other Native adapters are included as reference sources while standalone targets are added. WASM recipes cover the wider collection; independent builds have been verified for YM2612 and DX7.

[tetorica-fm2612](https://www.npmjs.com/package/tetorica-fm2612) continues to provide the JavaScript APIs, Synth helpers, and AudioWorklet integration. This new repository supplies the lower-level sources and build foundation.

Original Tetorica code uses BSD-3-Clause. Third-party components and files with existing explicit licenses retain their own terms and notices.

The repository's README has build examples, the source catalog, and the current verification results:

[Explore tetorica-soundchip-native on GitHub](https://github.com/kyorohiro/tetorica-soundchip-native)

---

Posting notes (exclude from the post):

- Draft date: 2026-10-24.
- Intended for an itch.io devlog; this task creates the draft only.
