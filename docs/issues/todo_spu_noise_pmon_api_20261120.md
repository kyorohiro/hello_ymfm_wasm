# SPU Noise / PMON operations

先にTODOを記録してから実装。既存timed APIの続きを扱う。

- [x] `setNoiseEnabled(channel, enabled)`：NONの選択bitのみを変更。
- [x] `setNoiseClock(code)`：0–63の共有clock、SPUCNTの他bitを保持。
- [x] `setPmonEnabled(channel, enabled)`：直前の物理voiceを変調源とする。
  CH1(index 0)はcarrierにできない。サンプル選択・source発音・音量・ペア確保は自動化しない。
- [x] 即時APIとbuild/schedule/compileで同じ検証・レジスタ変換を利用。
- [x] Main/WorkerとSynth Codeへ接続。Nativeは共有レジスタのmasked updateが未対応のため明示拒否。
- [ ] Native callbackのglobal mask対応とWorker facadeのcapability gateは別作業（ADSR専用maskを流用しない）。
- [x] Snapshotは既存register imageで保持。getStateで実際のNoise/PMON bitとclockを確認。
- [x] Synthの変調波形・ratio・source自動発音とは分離し、Stopで著者の音色へ戻す。
  手動の対象CH操作はそのCHのraw overrideを置き換える。部分更新は他CHのbitを保持。
- [x] 型・補完・FilesのNoise/PMON Example。
- [x] high/low mask、共有bit、無効入力、snapshot、44.1/48kHzの実SPUコア、
  手動割り込み、Run/Apply/Stop、無音ブラウザー・配布チェック。
- [x] 配信モジュール更新後の必要な校正を実測更新し、チェックを迂回しない。

Noiseはサンプルの音程ではなく共有clockで変化する。Exampleは既存のループ音色を使用し、
RAM転送を予約しない。PMON sourceの左右Volumeを0にしても変調に使えることを実コアで確認する。

## API / resolver details

| API | Hardware update |
|---|---|
| `setNoiseEnabled(ch, boolean)` | NON `0x194/0x196`, selected voice bit |
| `setNoiseClock(0..63)` | SPUCNT `0x1aa`, mask `0x3f00` |
| `setPmonEnabled(ch, boolean)` | PMON `0x190/0x192`, selected carrier bit; ch 1..23 |

Addresses above are byte offsets from `0x1f801c00`. CH1 is JavaScript channel 0.
`getState().noiseClock` / `channels[ch].noise` / `channels[ch].pmon` report actual
registers; the Synth's top-level `pmon` object remains its separate pair helper.
Code Live shows the actual bit values independently of helper settings.

`captureState()` already stores these registers, so no snapshot schema change or
extra state synchronization is necessary. Existing-sample note operations remain
unchanged. Reset clears hardware flags; Stop-voices keeps programmed flags while
clearing running envelopes. Synth Code Stop subsequently restores its author bank.

### Native boundary

Native's current mask protocol permits only voice ADSR registers. Sending a global
NON/PMON/SPUCNT mask would reject the batch. The Native renderer endpoint rejects these operations before submitting a native
hardware batch. Its direct JS client reports the capability error locally;
Native Worker calls remain unsupported and use the existing error path.
Native `build()` / reset `compile()` can still inspect their register conversion;
Native scheduling remains outside the current implementation. No C++/Rust or
Tauri repository was changed in this slice.

### Validation

- `npm run test:spu-synth`: 491 passed.
- API/native/core/type selection: 76 passed; other focused suites overlap.
- Chromium/WebKit, physical mute before startup: flags, clock, manual setter,
  invalid Apply, Stop restoration, Main/Worker + actual Worklet transport passed.
- Real SPU: aligned cores prove muted-source PMON modulation; invalid writes leave
  registers/RAM/gates unchanged. Raw flags allocate no samples or helper voices.
- Fresh Files include `hardware-noise.js` and `hardware-pmon.js` under examples/.
  Existing saved Cassettes are retained; New Cassette seeds the examples.

## Completion

- All eight raw/verification calibration reports passed with complete coverage,
  physical mute and continuous pilot PCM; source fingerprints were not waived.
- Distribution/calibration/ZIP tests: 156 passed.
- SPU readable ZIP and full / `_for_run` Playground ZIP passed. Browser entry count
  remains 1000. Chromium/WebKit also passed against the final SPU packaged tree.
- [Verification and report links](verification_spu_noise_pmon_api_20261120.md).
- No npm publication, commit/push/tag, Native/Tauri repository changes or remote CI.
