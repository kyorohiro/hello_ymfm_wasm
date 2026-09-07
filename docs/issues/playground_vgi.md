# Playground VGI support

## Goal

Playground で VGI 音色を TFI と同じように読み込み、`fm.setPreset()` に渡せるようにする。

VGI は VGM Maker の YM2612 音色形式で、TFI に YM2612 のチャンネル設定を 1 バイト追加した形式。

## File layout

TFI は 42 bytes、VGI は 43 bytes。

```text
TFI: algorithm (1) + feedback (1) + operators (40) = 42 bytes
VGI: algorithm (1) + feedback (1) + B4 (1) + operators (40) = 43 bytes
```

Operator data is stored in physical slot order:

```text
S1, S3, S2, S4
```

The importer exposes readable logical operator numbers:

```text
OP1, OP2, OP3, OP4
```

## B4 byte

The VGI-only byte is the YM2612 channel `0xB4` value.

```text
bit 7    pan left
bit 6    pan right
bit 5-4  AMS (LFO amplitude modulation sensitivity)
bit 3    unused
bit 2-0  PMS (LFO phase modulation sensitivity)
```

This is not Channel 3 Special Mode. Channel 3 Special Mode uses the separate `0xA8`–`0xAC` frequency registers.

AMS and PMS have an audible effect only when the global YM2612 LFO is enabled. The VGI byte stores the per-channel
sensitivity; it does not replace the global LFO speed/enable setting.

## Shared preset shape

VGI should become the same preset shape used by `YM2612Synth` and Playground:

```js
{
  algorithm: 7,
  feedback: 0,
  pan: { left: true, right: true },
  ams: 0,
  pms: 0,
  operators: [op1, op2, op3, op4],
}
```

`fm.setPreset(channel, preset)` can then apply algorithm, pan, AMS/PMS, and all four operators through one API.

The current VGI parser also retains the raw `b4` byte for lossless export.

## Playground URL/API design

Keep the existing TFI query form and add a parallel VGI form:

```text
?tfi=<base64>
?tfi=<base64>,<base64>&tfi-id=bass,bell
?vgi=<base64>
?vgi=<base64>,<base64>&vgi-id=bass,bell
```

The worker should share one preset-loading path after decoding the bytes:

```js
const preset = bytes.length === 43
  ? parseVgi(bytes)
  : parseTfi(bytes);
fm.setPreset(channel, preset);
```

The byte length is authoritative: TFI is 42 bytes and VGI is 43 bytes. File extensions and URL ids are labels only.

## Implementation checklist

- [x] Add `parseVgi()` and `createVgiFromPreset()`.
- [x] Preserve B4 as `pan`, `ams`, `pms`, and raw `b4`.
- [x] Add TFI/VGI import to the Synth page.
- [x] Add VGI export to the Synth page.
- [ ] Add VGI decoding to `playground_logic_worker.js`.
- [ ] Add `vgi` / `vgi-id` query parameters to Playground startup parsing.
- [ ] Add tests for one VGI, multiple VGI files, invalid length, and AMS/PMS/pan mapping.

## Important edge cases

- A 42-byte file is TFI even if it has a `.vgi` name; a 43-byte file is VGI.
- If the VGI pan bits are both clear, preserve that state instead of silently forcing stereo.
- AMS/PMS values are meaningful only together with an enabled LFO.
- Do not interpret the extra VGI byte as Channel 3 Special Mode.
