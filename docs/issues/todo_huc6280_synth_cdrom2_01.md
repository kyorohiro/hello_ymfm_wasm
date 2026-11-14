# HuC6280 Synth: PC Engine CD-ROM²の入口

開始: 2026-11-14。Tauri反映より先に、既存PlaygroundのHuC6280／MSM5205／CD-DAを
Synthでも使えるようにする。FM2612 Synthと同じタブ構成を参考にする。

- [x] 既存PC Engine CD-ROM² runtime、MSM5205/CD-DA API、VGM対応version／command、
      音量補正とミキサー、配布source/WASMを確認して再利用する。
- [x] モニター上へHuC6280／MSM5205／CD-DA／Mixerのタブを追加する。
      HuC6280の既存画面を保ち、MSM5205／CD-DAの音作りUIはまず工事中と表示する。
      タブ変更だけで演奏を止めない。
- [x] CodeでuseSoundChip("huc6280"／"msm5205"／"cdda")を選べるようにし、
      既存API・型補完・実装表示・Files読込・liveLoop／liveFx／Stopの所有権を揃える。
      CD-DAは実ディスク読込ではなく、既存の音声トラック再生機能として扱う。
- [x] VGMのHuC6280＋MSM5205再生を既存parser/coreで対応する。
      VGMが含まないCD-DAを再現できると表示しない。非対応chip／versionは説明する。
      Pause／Seek／cache／手動CH操作を壊さず、復元不能な構成は安全な再構築へ戻す。
- [x] Mixerで3音源の音量／On・Offを標準補正に沿って操作できるようにする。
      MasterとWaveform／Spectrumは最終mixを表示し、speaker接続を増やさない。
- [x] Code用の短い使用例、README／ヘルプ、配布ZIPのsource/WASMとCIを更新する。
      実WASM／Worklet、Chromium／WebKitを物理出力なしで確認し、検証記録を残す。

MSM5205／CD-DAの専用シンセ編集UI、実CD-ROM／BIOS／ゲーム実行、VGMへのCD-DA埋込、
Tauri取り込み・公開・npm publish・commit／stage／push／tagは今回行わない。

## 実装記録（2026-11-14）

VGM側は既存parser・HuC6280 native coreと共有MSM5205 decoderを再利用する。
VGM 1.72のMSM5205 clock `0xF0`、flags `0xD7`、packed command `0x32`を扱う。
HuC6280＋MSM5205のほかMSM5205単独を受理し、dual chip／MSM6585、予約flags、
20MHzを超えるclock、未対応chipは理由付きで拒否する。CD-DA命令を独自追加しない。
既存のHuC6280音色抽出は変更しない。

MSM5205を含む曲は正式な両音源のpaired snapshotがないためcacheを無効化し、
Seekを先頭からの再構築へ戻す。理由を画面へ渡し、単一HuC6280の正確なcacheは維持する。
HuC6280／MSM5205の出力gainは独立に適用し、ミュート中も音源と時刻は進める。
音量／On・Off変更時はその先の出力へ反映し、古いVGM cacheを破棄する。
CD-DAだけのMixer変更ではVGM cacheを破棄しない。

UIはHuC6280／MSM5205／CD-DA／Mixerタブ。MSM5205／CD-DAの専用editorは工事中。
Mixerの初期値は共有補正と同じHuC6280 44%、MSM5205 100%、CD-DA 100%。
既存の単一音源をunit gainで鳴らしていたSynthよりHuC6280の初期出力は小さくなる。
同じAudioContext・Code FX・Master・speaker経路を使う。

Codeは`useSoundChip("huc6280")`、`useSoundChip("msm5205")`、`useSoundChip("cdda")`。
Filesの音声データからMSM5205 `loadSample()`／`play()`、CD-DA `load()`／`play()`を使える。
MSM5205はADPCM、CD-DAは44.1kHz stereo PCM16 WAVを別トラックとして再生する。
実CD-ROMアクセスやゲーム全体の実行ではない。短い使用例と制限はSynth READMEへ記載した。

## 検証状況

- Node統合501件と、実装参照／既存校正証跡の保護6件が成功（いずれも0skip）。
- 実際の配布ZIPで新CD-ROM²＋既存10 suite、Chromium／WebKitの計22 run／208項目が成功。スピーカーは全経路でミュート。
- [検証記録](verification_huc6280_synth_cdrom2_20261114.json)。SDKは既存0.1.8-huc-state、JS/CSSは未minifyのまま、3音源のWASM・native source・再ビルド手順を同梱。
- 実聴・実ゲーム比較・長時間試奏は未実行。

## 別件として残る項目

- [ ] 通常Playground配布の校正guard: `docs/synth/synth_controls.js` が古い測定sourceと不一致。今回着手前のHEAD `449060fc` と同じファイル。今回のHuC Synth配布には影響せず、原測定やguardを緩めずに次の別作業で対応する。
