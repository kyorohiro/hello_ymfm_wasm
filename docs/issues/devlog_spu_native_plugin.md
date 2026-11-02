# Tetorica SPU Synth in a DAW with iPlug2

I've been working on a native DAW plugin alongside the browser version of Tetorica SPU Synth. Using [iPlug2](https://github.com/iPlug2/iPlug2), [tetorica-soundchip-native](https://github.com/kyorohiro/tetorica-soundchip-native), and Codex, I now have a working **PS1 SPU VST3 instrument**!

You can play it with MIDI, use it in your tracks, and save its sound settings and sample data inside your DAW project. The sound engine runs as native C++ inside the DAW.

The plugin brings over familiar sound-design features from SPU Synth, including PCM waveform editing, Software Morph, SPU ADSR, Noise, pitch modulation, and shared Reverb. It also supports VAB sound banks and imported WAV audio.

## Try the plugin preview

There are early builds for **macOS and Windows**. Both have VST3; the Mac download also includes an Audio Unit and a standalone app.

[Download the plugin preview on GitHub](https://github.com/kyorohiro/tetorica-spu-plugin/releases)

This is still a development preview. I'm continuing to check how it behaves in real DAWs and during longer sessions. For now, I wanted to share that the SPU Synth project has reached the point where we can make music with it inside a DAW.

## Build your own retro sound plugin

The same approach can be used for other retro console sounds. [tetorica-soundchip-native](https://github.com/kyorohiro/tetorica-soundchip-native) brings together C/C++ sound-chip cores, native adapters, build instructions, and component licenses. Alongside PS1 SPU, it includes sources for sounds associated with the Mega Drive, NES, Game Boy, PC Engine, and more.

You can use those cores as the sound engine, iPlug2 as the plugin framework, and Codex as a development partner to build and test your own instrument. The SPU plugin repository is a working example of that process.

If you've wanted to bring your favourite retro console sound into your DAW, these repositories give you a place to start. I'd love to see what other instruments people make with them!

---

Posting notes — exclude this section from the itch.io post:

- Draft date: 2026-11-02 JST.
- itch.io paste formats: `devlog_spu_native_plugin.txt` has a `#` title and `##` section markers for manual formatting; `devlog_spu_native_plugin.html` contains the HTML body without a title. The post title is "Tetorica SPU Synth in a DAW with iPlug2".
- Intended destination: the Tetorica SPU Synth itch.io devlog, alongside the browser synth. This is a development update about its native plugin companion, rather than a formal release announcement.
- The linked GitHub builds are the `v0.0.0` Preview. macOS 13+ has a signed/notarized Universal APP / AUv2 / VST3 DMG; Windows x64 has an unsigned VST3 ZIP.
- Posted to the Tetorica SPU Synth itch.io devlog on 2026-11-02 JST, as reported by the user. Codex prepared the draft; the user posted it.
- Tags: ps1,spu,vst3,daw,audio-plugin,synthesizer,chiptune,retro-sound,iplug2,codex
- Verification: plugin README and `w/tetorica-spu-plugin/docs/release_v0_0_0_20261102.md`; Native SDK README. The collection contains sound engines and adapters, rather than ready-made plugins for every listed console.
