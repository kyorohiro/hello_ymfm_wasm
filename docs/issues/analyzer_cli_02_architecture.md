# 01: Shared playback architecture

## 調査結果と変更

従来、`docs/vgm_analyzer/vgm_analyzer.js`の`ensurePlaybackReady`が構成判定、
WASM取得、engine生成、追加PCM engineの接続、ROM投入、モニター接続、WebAudio接続を担当していた。
`cli/render.js`には別の音源選択表とengine生成用オプションの組み立てがあり、
Browserで対応してもCLIへの接続が漏れる構造だった。
PCM生成はすでに既存engineと`VgmPlayer.process`、WAV符号化は`vgm_wav.js`で共有されていた。
このため、新たなPCMエミュレーターや汎用plugin基盤は追加していない。

現在は`docs/vgm_analyzer/playback_core.js`に構成判定・生成recipe・ROM投入・
OKIM6258の追加ミックスを集約した。Browser / CLIとも`createPlaybackEngine`を呼ぶ。
Browserに残るchip別分岐はモニター・UIへの接続であり、engineの生成処理ではない。

```text
adapter: VGM/VGZ取得・decode
  → Ym2612VGM
  → selectPlaybackConfiguration
  → createPlaybackEngine ← getFactory(name), roms
  → VgmPlayer（register/PCM転送、時刻管理、PCM生成）
  → process(left, right, frames)
      ├─ Browser: WebAudioへの出力
      └─ Browser / CLI: renderVgmToWav → WAV bytes → 保存adapter
```

## Interfaceと責務

- `selectPlaybackConfiguration(parser)`は`kind`, 正規化した`header`, `chips`,
  `ignoredClocks`, `requiredRoms`を返す。元のparser/headerは変更しない。
- `createPlaybackEngine(parser, {getFactory, masterVolume, roms})`は既存engineを返す。
  `getFactory(name)`は同期または非同期でEmscripten factoryを提供する。
  BrowserのURL/importやNodeのファイルパス・`wasmBinary`設定はadapterが担当する。
- ROMキーは`ym2608AdpcmA`, `ymf278bWave`。値はバイト列。
  必要性はparserの既存判定を使う。CoreはROMをダウンロードしない。
- `PlaybackError.code`は`UNSUPPORTED_CONFIGURATION`と`MISSING_RESOURCE`を区別する。
  `details`に構成または不足資源を含む。取得時のI/O例外は元の例外を保持する。
  Coreはconsole/stdout/stderrへ出力しない。
- `createPlaybackPlayer(engine, decodedSource, {onWarning, loop})`は初期化済みで停止中の
  既存`VgmPlayer`を返す。`play()`後に`process(left, right, frames)`でPCMを取得する。
  Browserも同じVgmPlayerを使い、UIによる再ロード・prefetch設定を引き続き管理する。
- PCMは左右のFloat32Array、サンプルレートは`player.sampleRate()`。
  同期processのバッファ所有者は呼び出し側。WAV変換は既存の16-bit stereo符号化を使う。
  自然終了では最終ブロックに無音paddingが入る。WAV時間上限は既存のまま。
- engineの所有者は呼び出し側で、最後に`dispose()`する。共有生成処理がengine取得後に失敗した場合は
  Coreが解放する。各engine内部で生成途中に失敗した場合の解放は、そのengineの責務。
  `player.stop()`からの再生・resetは既存Playerのレジスタ/埋め込みPCM再ロードを使う。

Coreの公開入口は`tetorica-vgm/core`。Node APIからも再exportする。
WASM binaryはCoreの静的依存にせず、Nodeの提供するfactoryだけを配布する。
全Browser音源の生成recipeがあることは、全音源のNode用WASMを検証済みという意味ではない。

## 対応表

以下は共有生成経路の構成。OKIM6258追加は既存Browserのattach方式を共有する。
CLI列は現時点のfactory提供範囲であり、02以降の発音検証・製品としての対応完了とは区別する。

| 構成 / engine kind | Browser生成経路 | Node factoryの状態 / 後続作業 |
| --- | --- | --- |
| YM2612、Sega PSG単体、YM2612 + PSG | Genesis | 提供済み |
| Genesis + RF5C164 / PWM | Genesis内PCM / PWM | 提供済み。PWM直接 / stream・FM / PSG / RF5C164混合・tarball検証済み |
| YM2151 + 任意のPSG / Sega PCM | YM2151 | 提供済み。Sega PCM / PSG併用も実PCM・tarball検証済み |
| YM2413 / YM3526 / YM3812 / YMF262 + 任意のPSG | 各既存engine | 提供済み |
| AY単体、AY + YM2413 | AY / MSX | 提供済み。AY + OPLLの実PCM・tarball検証済み |
| AY / YM2413 / Y8950 / K051649のMSX構成 | MSX | 全factory提供済み。各1台の全15構成で実PCM検証、4音源混合のtarball検証済み |
| Y8950 + 任意のPSG | Y8950 | 提供済み。FM / ADPCM / PSGとtarball検証済み |
| YMF278B + 任意のPSG | YMF278B | 提供済み。必要時は2 MiB wave ROM入力。FM / PCM / PSG検証済み |
| Sega PCM + 任意のPSG | Sega PCM | 提供済み。埋め込みROM・バンク・PSG・tarball検証済み |
| Game Boy DMG | Game Boy | 提供済み |
| YM2203 | YM2203（FM / SSG） | 提供済み。単体のFM / SSG・tarball検証済み |
| YM2608 | YM2608 | 提供済み。リズムkey-on時は外部8192-byte ROM指定 |
| YM2610 / YM2610B | YM2610B engineのvariant指定 | 提供済み。両variantのFM / SSG / ADPCMとtarball検証済み |
| OKIM6258単体 / 他engineへの追加 | OKIM6258 / attach | 提供済み。4-bit ADPCMのみ。単体 / YM2151 mixを検証済み |

dualは拒否。variantは現在YM2610のbit31のみ受け付け、他は拒否する。
Browserの以前の分岐に検査漏れがあった構成も、黙って一部だけ鳴らさず拒否する。
特にOPN同士の混在、OPN + 未処理PSG等は対応表にない限り成功扱いしない。
古いVGMのGame Boy / Sega PCM clock欄のゴミ値は、対応write命令がない場合に無視し、
`ignoredClocks`へ記録する。これは元のBrowserの互換性対策を共通化したもの。

## 後続音源の追加方法

02〜04ではCLIのengine switchを増やさない。Node用WASMの動作を確認し、
`getNodePlaybackFactory`の提供一覧と配布物を追加する。ROM入力はCLIからbytesへ変換して渡す。
YM2203 / YM2608 / YM2610Bのクロック・variant・ROM投入は共有recipeが担当する。
将来新しいchipをBrowserへ追加する場合も、構成ルールとrecipeをCoreへ追加し、
各adapterにはfactory取得方法と必要なUIだけを追加する。

## 検証と残る制約

- 自作fixtureによるFM / PSG / RF5C164の実発音を検証。
- 実際のBrowser初期化関数をVMで実行し、UIとWebAudioだけをstub化。
  同じfactory、ROMなし、volume=1、loopなしで、従来Genesis生成方法と
  1024フレーム×8ブロックの左右PCMが完全一致。0.1秒のWAVもCLIとバイト一致。
- 構成・variant・ROM不足・factory不足・追加PCM初期化失敗時の解放をテスト。
- YM2203 / YM2608 / YM2610Bの生成引数とROM受け渡しは契約テスト。
  これらの実発音テストは02以降に残す。
- 実ブラウザは接続可能なinstanceがなく、画面上の再生・モニター・ダウンロードは未確認。
  VM検証はWebAudioデバイスやAudioWorkletを検証するものではない。
- 最低対応Node 22での確認は12に残す。今回の実行環境はNode 25。

検証結果: `npm test` 32件成功。`npm run test:analyzer` は584件中583成功・0失敗・1skip（外部 mml2mdr が必要な任意テスト）。
旧UIモック・音源対応の期待値・DAC開始時刻の期待値を現行仕様へ更新し、以前の11失敗を解消。
新規の回帰失敗なし。npm tarballの別ディレクトリへのインストールと実行をテスト内で確認。
itchパッケージ生成・生成物のCore importも成功。更新distでJungle (Battle)の先頭1秒をWAV変換した。

02: YM2203はNodeのfactory一覧とWASMローダーの対象環境のみ追加。共有recipe・PCM処理の変更は不要だった。

03: YM2608も既存recipeを利用。CLIのROMパスをNode adapterで読み、roms.ym2608AdpcmAとして渡す。Nodeでは完全な8192-byte ROMを検証し、Browserの低レベル部分ロード仕様は維持する。


06e時点で共有recipeが要求する18 factoryはNodeにすべて提供済み。
PWMは内蔵JSの近似処理を共有し、単体・Genesis混合を検証した。
FIFO / timer未再現、PWM単体でもYM2612のidle DCが加算される点を維持する。
factory提供済みと任意の複合構成の実発音検証済みは別であり、特にOKIM6258の
全engineへの追加組み合わせは未検証（単体 / YM2151併用は検証済み）。
