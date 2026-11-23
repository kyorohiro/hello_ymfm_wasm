# Tetorica Virtual Boy Synth

Play the Virtual Boy's Virtual Sound Unit (VSU) with the on-screen keyboard, PC keys, or JavaScript. The five wavetable voices share five banks of 32 six-bit samples. Draw a waveform or edit one sample at a time. Choose a voice to adjust its four-bit left and right levels, select its wave bank, or choose one of the eight noise taps on channel 6. Waveform and Spectrum show the output after the app's Master control.

The VSU blocks wavetable writes while voices are active. The editor issues the VSU's global stop command before uploading the edited bank. JavaScript can do the same with `vsu.allNotesOff()` followed by `vsu.setWave(bank, samples)`.

## JavaScript

```javascript
const vsu = await useSoundChip("vsu");
vsu.setWaveBank(CH1, 0);
vsu.setVolume(CH1, 15, 5);
vsu.noteOn(CH1, "A4");
await sleep(0.25);
vsu.noteOff(CH1);
```

The helpers also accept zero-based channel numbers and MIDI note numbers. For wave voices the note is converted to the closest VSU period. For the noise voice the note controls the shift clock.

`vsu.write(offset, value)` takes an aligned byte offset from `0x01000000` and a register byte. Wave bank 0 starts at `0x000` and successive banks start `0x80` bytes apart. Modulation RAM starts at `0x280`. Channel 1 starts at `0x400`, successive channels start `0x40` bytes apart, and global stop is `0x580`. Each RAM cell or register occupies a four-byte slot.

| Channel-relative offset | Register |
| --- | --- |
| `0x00` | Start and interval |
| `0x04` | Left and right level |
| `0x08`, `0x0c` | Frequency low and high |
| `0x10`, `0x14` | Envelope and control, including the sweep/modulation or noise settings on channels 5 and 6 |
| `0x18` | Wave bank on channels 1–5 |
| `0x1c` | Sweep timing, shift, and direction on channel 5 |

## Run and build

Serve `docs/` over localhost, then open `http://localhost:8000/synth-virtual-boy/`.

```sh
python3 -m http.server 8000 --directory docs
```

Build the checked-in WASM with Emscripten on your PATH.

```sh
npm run build:virtual-boy-synth
npm run test:virtual-boy-synth
```

The browser AudioWorklet and native callers use the same BSD-3-Clause C++ core in [`tetorica_src/native/vsu`](../../tetorica_src/native/vsu). The core models the VSU's digital timing and exposes centered stereo PCM for playback. This version uses a held DAC output and leaves the console's analog output filters and exact per-channel DAC interleave outside the model.

## References

- Nintendo's 1995 *Virtual Boy Development Manual*, revision C, section 6, describes the VSU memory map, timing, mixing, and sound registers. [Original manual scan](https://cdn3.guidessimo.com/view/1144/1144575-virtual_boy.pdf#page=133)
- Hardware captures by dasi and Guy Perfect document the noise generator's initial state and feedback. [Noise generator measurements](https://www.virtual-boy.com/forums/t/the-secrets-of-the-noise-generator/)
