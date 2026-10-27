# Tetorica：PC Engine CD-ROM² 音響対応とCD-DA再生

## 目的

TetoricaでPC Engine CD-ROM² / Super CD-ROM²の音響システムを扱えるようにしてください。

既存のHuC6280 PSGとMSM5205 ADPCMに加えて、CD-DAを再生・混合できる環境を整備します。

**主目的はPC Engine CD-ROM²の音響対応です。CD-DA再生機能は、その実現に必要な共通機能として追加してください。**

既存のTetoricaの設計・API・固定SDK構造を尊重し、調査から実装、テスト、ドキュメント更新まで進めてください。

## 1. 既存実装の調査

最初に関連リポジトリの現在の実装を確認してください。

- HuC6280 PSG
- MSM5205 ADPCM
- VGM Analyzer / VGM Player
- PlaygroundのPCM再生機能
- Native / WASM Audio Engine
- Mixer
- Virtual Files
- Import / Export
- npm配布構成

既存機能を再利用し、同等の仕組みを重複して作らないでください。

## 2. PC Engine CD-ROM²の音響構成

以下の3系統を扱えるようにします。

- HuC6280：6ch PSG
- MSM5205：ADPCM再生
- CD-DA：44.1kHz / 16bit / Stereo

これらを同時に再生し、TetoricaのMixerで音量・Muteなどを制御できるようにしてください。

既存のPSG・ADPCMの音量、タイミング、公開APIは維持してください。

PC Engine CD-ROM²の音響に必要な範囲を対象とし、ゲーム機全体のエミュレーションは行いません。

## 3. CD-DA再生

CD-DAをSoundChipではなく、PCMを供給する音声デバイスとして実装してください。

必要な機能：

- Play / Stop / Pause / Resume
- Seek
- トラック指定
- 再生位置・再生状態の取得
- 音量・Mute
- PSG・ADPCMとの混合
- Native / WASM対応
- Browser / Desktop対応
- WAV Exportなど既存のオフライン出力との連携

CD-DAの基本形式は44.1kHz / 16bit / Stereoです。

実際の出力サンプルレートが異なる場合は、適切にリサンプリングしてください。

既存のPCM再生機能で対応できるものは再利用してください。

## 4. Virtual Filesとの統合

TetoricaではVirtual Filesにファイルデータを保持する構成です。

そのため、物理CDドライブからの逐次読み込みを前提にする必要はありません。

ファイル全体をVirtual Filesに保持することと、再生時に全PCMをデコードすることは分けて考えてください。

対応する入力形式は既存のデコーダーを調査して決定してください。

最初からすべてのCDイメージ形式を網羅する必要はありません。

ただし、CD-ROM²の音響再現に必要なトラック情報と音声データの関係は整理してください。

メモリ使用量、シーク性能、リアルタイム音声処理への影響を考慮してください。

## 5. VGMとの関係

既存のHuC6280＋MSM5205のVGM再生を維持してください。

CD-DAの音声データや再生指示がVGMに含まれていない場合、VGMだけでCD-DAを復元できるものとして扱わないでください。

必要に応じて、外部音声ファイルと再生タイムラインを組み合わせる方式を検討してください。

VGM仕様に存在しない独自コマンドを、標準VGMコマンドとして追加しないでください。

既存VGMとの互換性を維持してください。

## 6. Playgroundとの統合

既存のPlayground API設計に合わせて、CD-DAの読み込みと再生を可能にしてください。

新しいAPIを追加する場合も、既存の命名規則、時間指定、Mixer、ライフサイクル管理に従ってください。

CD-DAのためだけに大規模なAPI体系を新設する必要はありません。

Playgroundから、HuC6280・MSM5205・CD-DAを組み合わせた演奏Exampleを用意してください。

## 7. 検証

少なくとも以下を確認してください。

- CD-DA単独再生
- 44.1kHz Stereoの再生
- 異なる出力サンプルレートでの再生
- Play / Pause / Resume / Stop / Seek
- トラック切り替え
- 再生終了と再演奏
- HuC6280＋MSM5205＋CD-DAの同時再生
- Mixerの音量・Mute
- Native / WASMでの動作
- Browser / Desktopでの動作
- オフラインWAV出力
- 既存VGM再生の回帰確認

テストは変更の影響範囲に応じて選択してください。

全件テストが必要な場合は、部分テストでは確認できない具体的な理由を示してください。

## 8. 実装方針

- 既存コードとSDKを優先して利用する。
- 必要な機能は自律的に調査・実装する。
- 公開APIの互換性を維持する。
- 不必要なリファクタリングを行わない。
- CD-DAを特定のSoundChipに依存させない。
- PC Engine以外のMega-CD、PlayStation、Saturnでも将来再利用できる構造にする。
- 第三者コードを採用する場合はライセンスと出典を確認する。
- テスト用の音声素材は権利上問題のないものを使用する。

## 9. 完了条件

1. PC Engine CD-ROM²のPSG・ADPCM・CD-DAを混合再生できる。
2. CD-DAをNative / WASMの共通音声機能として利用できる。
3. Playgroundで再生・操作できる。
4. 既存のVGM再生と公開APIを維持している。
5. 使用方法、実装範囲、未対応事項、検証結果が記録されている。

実装に必要な設計判断は、既存構造を調査したうえで自律的に行ってください。

**まず実際に再生できる状態まで完成させ、全体的な設計整理や追加フォーマット対応は、その後の課題として扱ってください。**

## 10. 初回実装の範囲と順序（2026-10-27）

初回調査時点では、HuC6280はBrowser／Nativeへ接続済みでしたが、MSM5205はAnalyzer向けのJS rendererでした。
MSM5205のPlayground接続とNative／WASM移植は、CD-DA単独対応とは別の作業として進めます。

1. 共通PCM16 renderer、WAV＋track manifest、Play／Pause／Resume／Stop／Seek、再生位置、Mixerを実装する。
2. Browser／Nativeの同じ音声フレーム時計へ接続し、HuC6280との混合とオフラインWAV出力を確認する。
3. MSM5205をPlayground／Nativeへ接続し、PSG＋ADPCM＋CD-DAの3系統で完了条件を検証する。

最初の入力形式は44.1kHz・stereo・PCM16 RIFF WAVとJSON track manifestに限定します。
CUE／BIN、圧縮音声、物理CD、BIOS／SCSI／ゲームCPUの実行は初回対象に含めません。
トラック番号と半開区間`startFrame`／`endFrame`（44,100Hzのsource frame）を明示し、pregapを推測しません。

既存sample bankの64MiB枠や全曲Float32展開には依存せず、元のPCM16を保持し、必要なサンプルだけを変換します。
初回は選択トラック最大256MiB、1系統のCD-DAを対象とします。Nativeの置換準備中は旧source＋stagingも同じ予算に含めます。
BrowserのWASM作業領域は固定サイズとし、render中のメモリ確保・拡張・ファイル読込を行いません。
UIの応答でPCMを補給する方式やUI timerを演奏時計に使う方式にはしません。
長時間音源のディスク全体の保持や圧縮音声のページデコードは、後続段階として別に扱います。

Pause／Seekなどは音声側で適用し、UIは明示的な状態取得結果を表示します。
即時Stop、Run置換、session終了は準備中の読込・uploadと将来の発音を取り消します。
この第1段階の完了を、上記9章の3系統対応全体の完了として扱いません。

## 11. 音声範囲の実装完了（2026-10-28）

上記1〜3段階を完了。Playgroundへ **PC Engine CD-ROM²** modeを追加し、
HuC6280 PSG・MSM5205 ADPCM・CD-DAをBrowser／Native、Main／Workerで混合できる。
64KiB ADPCM RAM、16段階rate、音声変換、独立Mixer、停止・取消、3系統の初期Example、
offline WAV出力を実装。既存AnalyzerのMSM5205 JS／VGM API／chip gainは維持した。

実coreのNative／WASM一致、Browser全8構成、Web関連4636件、全Cargo780件、
Tauri28＋31件、隔離npm配布物、standalone source ZIPを検証。物理出力は捕捉後mute。
人による実聴と実機比較、Tauri GUI操作は未実施。npm／GitHub／itch.io公開も行っていない。

使用法：[../msm5205.md](../msm5205.md)、[../cdda.md](../cdda.md)。
範囲・制限・検証と再開情報：[msm5205_pcm_01.md](msm5205_pcm_01.md)と同名JSON。
CUE／BIN・物理CD・圧縮disc音声・BIOS／CPU／SCSI／DMA／IRQは初回対象外のまま。
既存SDK pinを維持し、追加coreはapp-owned sourceとして全ソースとライセンスを同梱した。
