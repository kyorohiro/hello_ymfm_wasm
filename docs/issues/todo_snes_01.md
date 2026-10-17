以下をそのままCodexに渡せる形にまとめました。既存のTetoricaの構成を調査させたうえで、**SPC再生 → BRR抽出 → DSP解析 → Playground統合**の順に進める指示です。

---

# Tetorica FM2612 Playground — SNES/SPC対応

## 目的

Tetorica FM2612 Playgroundに、SNES（スーパーファミコン）の音源を追加する。

SNESはゲームごとにサウンドドライバーやシーケンス形式が異なるため、ゲーム固有の実装を個別に解析する方式は採用しない。

**SPC700とS-DSPを共通の実行基盤として利用し、ゲーム固有のサウンドドライバーをそのまま実行することで汎用化する。**

既存のVGM AnalyzerとPlaygroundの音源管理機構をできるだけ再利用する。

## 1. 既存実装の調査

最初にリポジトリを調査すること。

- `useSoundChip()` の音源追加方法
- AudioWorkletとWASMの構成
- VGM Analyzerの音源解析・再生処理
- PCMサンプルの読み込み・再生API
- TFI/VGIなどの音色Import機構
- 音源の停止・再起動・リソース解放処理
- Worker lookaheadと音声バッファリング

既存の抽象化を優先し、SNES専用の並行した仕組みを増やさない。

調査結果を簡潔にまとめ、実装方針を決定すること。

## 2. SPC再生エンジン

既存のSPC700/S-DSPエミュレーターを調査する。

候補：

- https://github.com/blarggs-audio-libraries/snes_spc
- https://github.com/digital-sound-antiques/spc700-js

ライセンス、再現精度、AudioWorkletとの相性、CPU負荷、メンテナンス状況を比較する。

ライセンス上の問題があるコードを無断でコピーしないこと。

必要であれば、既存実装をWASM化する。

### 要件

- `.spc` ファイルを読み込める
- SPC700 CPUを実行できる
- S-DSPによる8ボイスの音声生成
- BRRデコード
- ADSR / GAIN
- Pitch Modulation
- Noise
- Echo / FIR
- 再生・停止・再起動
- 音量調整
- AudioWorkletでの安定再生

SPCファイルに保存されたCPU状態、RAM、DSPレジスタを正しく復元する。

SPC700とS-DSPのクロック・タイミングを適切に扱うこと。

## 3. BRRサンプル抽出

SPC RAMからBRRサンプルを抽出する機能を追加する。

### 要件

- S-DSPのサンプルディレクトリを解析する
- BRRサンプルの開始位置・ループ位置を取得する
- BRRデータをPCMへデコードする
- ループ情報を保持する
- WAV形式でExportできる
- Playgroundで再利用できる

単純にRAMを走査してBRRらしいデータを抽出するだけでなく、DSPのサンプルディレクトリ情報を優先すること。

サンプル番号、開始アドレス、ループアドレスなどのメタデータを保持する。

## 4. S-DSPイベント解析

SPC700の実行中に発生するS-DSPレジスタ操作を記録する。

ゲーム固有のMMLやシーケンス形式を解析するのではなく、**S-DSPへの書き込みを共通イベントとして取得する。**

### 取得対象

- 時刻
- DSPレジスタアドレス
- 書き込み値
- 対象ボイス
- Pitch
- Volume L/R
- ADSR / GAIN
- SRCN
- KON / KOFF
- Noise
- Pitch Modulation
- Echo関連設定

イベント時刻は、SPC700の実行サイクルまたはサンプル時刻に基づいて記録する。

既存のVGM Analyzerのイベントモデルを再利用できるか検討する。

また、SPC RAMの内容が再生中に変更される場合に備え、BRRサンプルの変更を追跡できる構造を検討する。

## 5. Analyzerへの統合

既存のVGM AnalyzerにSPC対応を追加する。

### Phase 1

- SPCファイルのDrag & Drop
- GD3相当のSPCメタデータ表示
- SPC再生
- 8ボイスのON/OFF
- 再生時間表示

### Phase 2

- BRRサンプル一覧
- サンプルの個別試聴
- 波形表示
- ループ位置表示
- WAV Export

### Phase 3

- DSPレジスタ履歴
- ボイスごとのPitch/Volume変化
- ADSR/GAIN表示
- KON/KOFFイベント表示

既存UIコンポーネントを優先して利用する。

## 6. Playgroundへの統合

SPC再生と、BRR音色を使った演奏を分離する。

### SPC Player

SPCファイルに含まれる楽曲を再生する。

### SNES SoundChip

BRRサンプルとS-DSPを利用して、Playgroundから演奏する。

APIは既存の`useSoundChip()`との整合性を優先する。

以下は概念例であり、既存APIを調査したうえで設計すること。

```typescript
const snes = await useSoundChip("snes");

await snes.loadBRR("instrument.brr");

snes.noteOn(60, 100);
snes.noteOff(60);
```

既存の`play()`、`beat()`、`liveLoop()`などとの連携を検討する。

## 7. 動作検証

以下を確認する。

- 複数のゲーム由来のSPCを再生できる
- ゲーム固有のドライバーを追加実装せずに再生できる
- BRRのデコード結果が既存の実装と一致する
- ループ再生が正しく動作する
- 8ボイスのミュートが機能する
- Echo/FIRの再現
- 停止・再起動時にエラーが発生しない
- 長時間再生で音切れやメモリリークが発生しない

可能であれば既存のSPCプレイヤーとのPCM出力比較を実施する。

比較条件はサンプルレート、ゲイン、補間方式、初期状態を統一すること。

## 8. 実装上の注意

**最優先は、ゲーム固有対応を増やさないこと。**

SPC700のプログラムをそのまま実行し、S-DSPの共通インターフェースで解析する。

また、次の点に注意する。

- SPCだけではゲーム本体からの追加データ転送を再現できない場合がある。
- SPC700のRAMは64KBなので、サンプルディレクトリやBRRデータの参照範囲を検証する。
- DSPレジスタ操作だけでは、すべての音色変化を復元できるとは限らない。
- DSP内部状態やBRRデコード状態が必要になる場合は、エミュレーター側から取得する。
- 既存のYM2612/OPNA/OPMなどの動作を壊さない。
- SNES固有の処理を既存音源の共通APIへ無理に押し込まない。
- 不明な仕様は推測で実装せず、既存実装や仕様資料を調査する。

## 9. 実装順序

以下の順序で進める。

1. 既存構成の調査と採用エンジンの選定
2. SPC読み込み・再生
3. BRRサンプル抽出・試聴
4. Analyzerへの統合
5. S-DSPイベント解析
6. Playgroundの`useSoundChip()`対応
7. テスト・最適化・ドキュメント更新

各段階で動作確認し、問題があれば修正してから次へ進むこと。

---

### 最終目標

**SNESのゲーム固有のサウンドドライバーを解析せずに、SPCファイルから音楽と音色を再生・解析・再利用できる環境を実現する。**

Tetoricaの既存のSoundChipアーキテクチャを維持しながら、SNESのPCM音源をPlaygroundへ統合する。

まずはSPC再生とBRR抽出を確実に動作させ、その後、演奏中の音色変化を解析できるようにする。s