# Tetorica HuC6280 Synth

開始: 2026-11-05。PC EngineのHuC6280を、SPU／DMG Synthと同じ流れで触れる独立Web Synthにする。正本は `docs/synth-huc6280/`、製品アイコンは `docs/tetorica_huc6280_synth.webp`。

## 今回の実装

- [x] 既存のHuC6280 WASM／高級APIを使い、AudioWorkletから実音源を鳴らす。
- [x] Waveは6ch、Noiseは実機のCH5／CH6を使う2chラウンドロビン。古いnoteOffが盗まれた声を止めないよう所有権を管理する。
- [x] 32サンプル・5bit波形を1つのcanvasで描く。Sine／Triangle／Saw／Squareと、Main／LFOの編集対象切替を用意する。
- [x] Hardware LFOはCH2→CH1の専用配線として表示し、有効時はCH1の単音へ切替。CH2の変調波形は出力をミュートする。
- [x] ソフトウェアEnvelopeは実機機能と区別して表示し、鍵盤からAttack／Decay／Sustain／Releaseを体験できるようにする。
- [x] SPU系の共通操作: Enable audio、Stop、Master 0–380%（100%超はオレンジ）、Waveform／Spectrum、2箇所のPitch、Octave、コンパクトな演奏鍵盤。
- [x] 数値は「− 値 ＋」、選択はボタンにし、演奏キーを奪わない。狭い画面と折りたたみも確認する。
- [x] プリセットJSON保存／読込、初期化、Playground向けJavaScript出力。
- [x] 改造できる元のJSモジュール、WASM、音源の対応ソースとライセンスを含むitch.io ZIP。
- [x] ホーム／README／配布コマンドへ入口を追加し、実WASMのunit・Chromium／WebKit・独立ZIPを検証する。

## 実装・検証記録（2026-11-05）

`docs/synth-huc6280/index.html` に初版を実装した。画面はSPU系の共通CSS／鍵盤／モニターを利用し、白＋オレンジの指定アイコンを使用する。音源は既存の `Huc6280Synth` と `Huc6280AudioEngine` をAudioWorklet上で接続した。共有runtime／WASMは変更していない。

- `npm run test:huc6280-synth`: **23件成功**。実WASMで6／2／1声、voice stealingと遅い離鍵、ピッチ、Noise／LFO、ADSRのリリースと無音、任意のrender分割でのPCM一致、atomicなプリセット検証、音声初期化・破棄、配布ソースの整合を確認した。
- 既存HuC6280 API／PCM engineの回帰テスト **9件成功**。`npm run check:runtime-artifacts` も成功（33 SDK builds／66 outputs／73 mirrors）。
- ソース版はChromium／WebKitとも成功。[検証記録](huc6280_synth_browser_01.json)。実音源の出力をMaster後で計測し、検証中のスピーカー出力はミュートした。発音中のNoise clock／LFO rate／Pitch、2箇所のwheel、操作後の演奏、描画・キャンセル・折りたたみ、preset保存／不正入力拒否／復元、390px幅でoverflow 0を確認した。
- 独立ZIPを別ディレクトリーへ展開して同じ両ブラウザー検証が成功。[ZIP検証記録](huc6280_synth_zip_browser_01.json)。外部ネットワーク依存・404・page errorは0。
- ZIP: `release/tetorica_huc6280_synth_0.0.1_itch.zip`（41 files、1,021,906 bytes）。SHA-256: `428d4a296ad61a4eef25feca125c864459fbadda69e470ead3fb9073e76f5b83`。元のJS／CSSの分割・コメント・識別子・相対importを保持し、WASMと対応する固定SDKソース・再ビルド手順・ライセンスを含む。
- 数値はステッパーと横ドラッグ、source／depthは選択ボタン。Main／LFOは1つのcanvasで切替。描画・shape・source・LFO切替・Envelope On/Offは保持音を止める。level／pan／Noise clock／LFO rate・depth／Pitchは保持音へ反映する。
- Software Envelopeは実機のchannel volumeへ16出力frameごとに書き込み、実機の1.5dB単位へ量子化する。時間設定は新しいノートに適用。初期値はA5ms／D0／S100%／R25ms。Hardware LFOのrateは0–255のdivider codeで、大きいほど遅く、鍵盤のピッチにも連動する。
- Copy JavaScriptはPlaygroundの初期化済み `pce` に対するハードウェア設定・試奏用。ホスト側のSoftware Envelopeはコメントに値を残し、スケジューリングを再現するコードとしては扱わない。

実聴、長時間／実ゲーム由来の比較、commit／push／公開はこの検証には含めていない。次はユーザー試奏と必要な調整。その後の候補は下記のVGM音色抽出。

## 接続仕様（並行実装用）

- `preset.js`: `createDefaultPreset()`、`readPreset(value)`、`waveShape(name)`、`presetToCode(value)`。
- 初版プリセット v1: `{format:'tetorica-huc6280-voice',version:1,name,source:'wave'|'noise',wave:[32個の0..31],volume:0..31,pan:{left:0..15,right:0..15},noise:{frequency:0..31},lfo:{enabled:boolean,frequency:0..255,depth:1|2|3,wave:[32個の0..31]},envelope:{enabled:boolean,attack:秒,decay:秒,sustain:0..1,release:秒}}`。現在の正本は下記のv3で、v1／v2は読み込み時に移行する。
- `instrument.js`: `Huc6280Instrument(core)`、`read()`→`{preset,voices:[{id,midi,channel}],capacity,pitch}`、`setPreset`、`loadPreset`、`noteOn`→`{channel,stolenId}`、`noteOff`、`setPitch`、`stop`、`generateStereo`、`dispose`。
- `audio.js`: `createAudio({volume,onError})`→`{context,outputNode,command,read,setVolume,resume,dispose}`。`processor.js`が実WASMとInstrumentを所有する。
- `editor.js`: `createEditor({root,onChange,onError})`→`{update(preset),dispose()}`。変更は妥当な完全プリセットを返す。描画はpointer releaseで反映する。
- 既存の共有runtime／WASMの正本を変更しない。`docs/js`・`docs/generated`を利用する。

## 後続候補

- [x] VGM／VGZから通常Wave／Noiseを抽出する。LFO／DDA区間と不完全なRAMは、無理に通常Waveへ置き換えず、理由を表示して省略する。
- [x] LFO音色抽出。carrierとmodulatorの独立periodを保つプリセットv2で、CH1／CH2ペアを取り込む。
- [x] 音声ファイルからDDA PCMを準備して試奏する（下記v3）。単一DAC値の書込ではなく、出力frameに合わせてPCMを供給する。
- [x] VGMの固定チャンネルDAC streamからPCMを抽出する（下記）。
- [x] 一定間隔で境界が明確な直接DAC write列のPCMを抽出する（下記）。
- [ ] 間隔が変わる直接DAC列、圧縮bank、CD-ROM² ADPCM／CD-DAは別工程として検討する。
- [ ] 必要ならSoftware morphや外部ソフトウェアFXを追加する。SPUのハードウェアReverbと混同しない。
- [ ] Web版確認後、Tauri／Native版へ進む。

## VGM音色読み込み（2026-11-05 完了）

- [x] `vgm_import.js` にDOM／音声deviceなしのWave／Noise抽出を実装する。VGM／VGZ・64MiB上限・キャンセル・長い解析中のyield・不正データ拒否を含む。
- [x] 波形RAMの書込pointerを追跡する。実機のDDA 1→0でpointerを0に戻し、停止中の32点uploadを復元する。未記録／再生位置不明の値を初期Sineやゼロで補って音色にしない。
- [x] 同じ時刻の設定writeをまとめ、実際に時間が進む時点の発音中の設定を採取する。周波数だけの変化は同じ音色にまとめ、音量・panは書込済みの値を保持する。global balanceは近似の説明を付ける。
- [x] NoiseはCH5／CH6からclock・level・panを取得する。LFO区間、DDA／DAC stream、未知の必要設定は理由を表示して省略する。音声の再生・ゲーム側の逐次Envelope等は再現しない。
- [x] 折りたためる「Sounds from VGM」へLoad VGM / VGZ、Wave／Noiseフィルター、一覧・ページ送り・Cancel／Closeを追加する。
- [x] ファイルを開くだけでは現在の音色／保持音を変更しない。音色を明示的に選ぶ時だけ反映し、編集したら一覧の選択表示を解除する。失敗／キャンセル／遅れて完了した別ファイルは現在の音を保つ。
- [x] 選んだ波形は既存の同一canvasで編集し、既存JSON／JavaScript保存に接続する。原音比較のため取り込んだ音色はSoftware EnvelopeをOffにし、その旨を表示する。
- [x] 自作VGM／VGZで波形復元・未知pointer・Noise／LFO／DDA・重複排除・不正データ・キャンセルをunit検証し、ソースと独立ZIPをChromium／WebKitで検証する。
- [x] README・ホーム・配布の検証記録を更新する。共有runtime／WASM・プリセットv1は変更しない。

検証結果:

- `npm run test:huc6280-synth`: **38件成功**（抽出の新規15件を含む）。実WASMで、既知の記録設定と取り込んだWaveが同じ鍵盤ピッチでbyte単位の同一PCMになることを確認した。4,000,000 commands／4,096 definitions／100,000 observations、圧縮前後64MiBの上限とキャンセルも検証した。
- 不明なselector／LFO／carrier controlとDAC streamsを含む場合、影響したRAM・設定を未知として扱い、後のdirect writeで修復されるまで誤った音色を採取しない。完全に未記録の任意flagsは、LFO Off／Noise Off等の仮定を明示する。省略だけになったファイルでもエラーに理由が残る。
- Chromium／WebKitのソース版が成功。[記録](huc6280_synth_vgm_import_browser_01.json)。未起動の音声を解析だけで開始しないこと、Wave／Noise選択、元波形の32値、選択後の発音・編集・JSON往復、VGZ、失敗／キャンセル／遅い旧File readの排除、24件ページ、390px幅overflow 0を確認した。
- 独立ZIPを別フォルダーへ展開した両ブラウザー検証も成功。[記録](huc6280_synth_vgm_import_zip_browser_01.json)。外部通信・404・page errorは0。テスト中のスピーカー出力はミュートしている。
- 新ZIP: `release/tetorica_huc6280_synth_0.0.2_itch.zip`（46 files、1,094,546 bytes）、SHA-256 `66dbdd256e20001552d138d9dea3dbd406404f3c330c064dcbb682e343cb574e`。0.0.1 ZIPは保持した。読める元JSと相対import、元WASM、対応C++・ライセンス・ソースreceiptを同梱する。
- `npm run check:runtime-artifacts`、`git diff --check`も成功。共有runtime／WASM／プリセットv1は未変更。

実ゲーム由来のVGM比較・実聴・commit／push／公開は未実行。次は手元のVGMで試奏し、必要な対応を整理する。

後続: LFO音色の抽出では元のCH1／CH2のperiod比、LFO rate／depth／reset状態、別のCH2音声の扱いを設計する。現在のSynthの「modulator periodをcarrierへ追従」は、任意の元曲のLFO設定と同一とは限らない。

## 再開時

まず `git status --short` とこのTODOを確認する。各モジュールの実装・検証結果を下に記録し、未実行の実聴・公開を完了扱いにしない。

## VGM LFO音色読み込み（2026-11-05 開始、2026-11-06 完了）

- [x] プリセットv2へ拡張し、v1は旧動作のまま移行する。LFOに `mode:'follow'|'recorded'`、`carrierPeriod:1..4096`、`modulatorPeriod:1..4096`、`reset:boolean`、`output:{enabled:boolean,volume:0..31,pan:{left:0..15,right:0..15}}` を追加する。
- [x] Followは従来どおりCH2のperiodを鍵盤へ追従させる。RecordedはC4で記録時のCH1 periodを再生し、他の鍵盤／PitchはCH1だけを半音単位で移調する。CH2 periodは記録値を保持する。画面にこの基準を明示する。
- [x] LFO有効時のCH1波形とCH2変調波形、両period、rate／depth／reset、CH2の音量・pan・有効状態をセットで抽出する。period registerの0は4096へ正規化する。未知の必須設定・DDAの直接音声・不完全なRAMを推測で埋めない。
- [x] 元のCH2出力が有効なら保存・再生する。単音の所有権はCH1／CH2ペアで管理し、離鍵・release・voice steal・StopでCH2が鳴り残らないようにする。
- [x] 一覧へLFOフィルターと説明を追加する。Main／LFOは既存の同じcanvas、period等はステッパー／ボタンで編集し、プリセット／JavaScript出力へ接続する。
- [x] 原記録の経過位相やゲーム側の自動制御は再現しないことを明示する。既知の初期状態に対する実WASM比較、reset bit、0／4096、未知データ、v1互換、保持中の変更、両音声の停止を検証する。
- [x] ソース／独立ZIPをChromium・WebKitで検証し、README／ホーム／TODOを更新する。共有runtime／WASMは変更しない。

検証結果（2026-11-06）:

- `npm run test:huc6280-synth`: **51件成功**。core／preset 18件、抽出21件を含む。既知の初期状態からのraw register再生・コピーしたJavaScript・paired instrumentが実WASMでbyte単位の同一PCMになることを確認した。Reset保持、period4096、CH1 level0＋可聴CH2、独立pan／level、period変更、ADSR release／steal／Stop、旧v1のFollow動作も検証した。
- 不明な両periodの各byte／rate8は補わず、DAC streamの影響も未知として扱う。通常のWave／Noiseと異なり、LFOは元のperiod変更も別の設定として一覧化する。定数modulator tableは有効な固定offsetとして保存する。
- 取り込み時にglobal balanceをfullへ正規化する既存方針に合わせ、元のglobal減衰で一時的に無音のCH2 DDAも、試奏時に鳴り得るなら除外する。実際に振動する成分がないDCだけの組も理由付きで除外する。
- Chromium／WebKitのソース版が成功。[記録](huc6280_synth_vgm_lfo_browser_01.json)。LFOフィルター、両RAM値・period700／913・rate7・depth2・CH2 output、C4原周期、Pitch時のCH2固定、保持中period／level／Reset、離鍵後の両keyOff、同じcanvasでの編集、v2保存／復元・v1移行、390px幅overflow 0を確認した。
- 独立ZIPを別ディレクトリーへ展開した両ブラウザー検証も成功。[記録](huc6280_synth_vgm_lfo_zip_browser_01.json)。外部通信・404・page errorは0。検証中のスピーカー出力はミュートした。経過phase・counter・ゲーム側の自動制御の復元や実聴を完了扱いにしない。
- 新ZIP: `release/tetorica_huc6280_synth_0.0.3_itch.zip`（46 files、1,102,555 bytes）。SHA-256 `8a41eb04ec53a9f3579656123d87ef3f37c933f33c6312108ac5579f4a26fd2d`。以前のZIPは保持し、今回も元JS／CSS・相対import・元WASM・対応C++・ライセンスを同梱する。
- `npm run check:runtime-artifacts` と `git diff --check` も成功。共有runtime／WASMは未変更。README en／ja／AI、英日ホーム、Synthガイドも更新した。commit／push／公開は未実行。

次は手元の実ゲーム由来VGMでの試奏と必要な調整。DDA PCMの実装記録は次節。VGMのDDA抽出／CD-ROM²は別の後続候補。

## DDA PCM再生（2026-11-06 完了）

- [x] ソースへDDA PCMを追加する。5bit DAC自体は実機機能、PCM供給・rate／移調・Loop・Envelopeはソフトウェア制御と表示する。VGMのDAC stream抽出は別工程。
- [x] WAV等の音声ファイルをdeviceを起動せずdecodeし、monoへまとめ、選んだrateへresampleして0..31の整数へ量子化する。無音のDAC中心は16。32MiB入力／30分decoded／16,777,216 DAC samplesをソフト側の上限として検証する。
- [x] プリセットv3に `dda:{name,data:base64,sampleRate:8000..44100,rootNote:0..127,loop:boolean,speed:0.125..4}` を追加する。dataは1byteにつき1個の0..31値、空dataは未読込。v1／v2は空のDDA設定を補って互換を保つ。JSONは32MiBまで。
- [x] 6つの実チャンネルへラウンドロビンでDDAを書き込む。ホストの出力frameに合わせたsample-and-holdとし、最大1 write/channel/output frame。高い再生速度では中間値をskipし、変更していないDAC値のwriteを省く。chip periodはPCMピッチへ使わない。
- [x] Root noteで元速度、鍵盤／Pitch／speedで読み出し速度を変える。rate／speed／Loopは保持中にも反映する。非Loopの終端はDAC16＋keyOffで無音にし、保持キー所有権は離鍵まで保つ。離鍵・voice steal・Stop・ソース変更も無音にする。
- [x] Software EnvelopeはDDAにも適用し、無効時はraw gate、非Loop終端のreleaseは残り時間に合わせて音量を下げる。Loop境界の波形の段差は変更しない。
- [x] 大きいPCMをノートやつまみの操作ごとにworkletへ再送しない。Audio層とprocessorで既に受理済みのdataを省略して参照し、replyもdataを省略してAudio層で復元する。失敗時は受理済みcacheを変えない。
- [x] DDAの読み込み・変換中のキャンセル／古い結果を除外し、失敗時は元の音色を保つ。折りたためるPCMカード、名前／rate／時間／波形プレビュー、Root／Loop／speed、変換rateのボタンを用意する。
- [x] JSONへPCM本体を保存／復元する。Copy JavaScriptはDDAではデータと同期Instrumentへの接続例を出し、通常のPlaygroundへ単一DAC値を書くだけでPCMが再生できるとは表示しない。
- [x] 実WASMで実DAC writeとのPCM比較、render分割一致、polyphony／steal、rate／Loop／Pitch変更、終端／release／Stop、旧preset移行、bounded入力、data再送抑制を検証する。
- [x] ソース／独立ZIPをChromium・WebKitで検証し、README・ホーム・TODOを更新する。共有runtime／WASMと既存の変更を維持する。

並行実装の接続: `dda_pcm.js` は定数・base64 encode/decode・量子化/resampleの共通module。`audio_import.js` は `prepareDdaAudio(file,{sampleRate,signal})` → `{name,data,sampleRate,rootNote:60,loop:false,speed:1}`。editorの `createEditor` に `onLoadAudio(file,{sampleRate,signal,onCommit})`（status文字列を返すPromise）を追加し、file chooserとCancelはeditorが所有する。converterは20ms程度ごとにyieldして中止を確認する。audio／processorのdata省略protocolは下記の実装記録に残す。


検証結果（2026-11-06）:

- `npm run test:huc6280-synth`: **76件成功**。実WASMの直接DAC writeを比較基準に、render分割一致、6音／steal、保持中のrate／Root／speed／Loop／Pitch変更、終端・離鍵・Stop・source切替を検証した。終端fade中に離鍵してもlevelが再上昇しない回帰検証を含む。
- deviceなしのWAV decode、mono化・resample・無音16への量子化、上限、異常値・非canonical base64・旧v1／v2移行を検証した。AudioWorklet相当の環境でDOM／Node専用base64 APIに依存せずPCMを読める。
- 受理済みPCMはdataを省略して再利用する。失敗した変更でcacheを更新せず、同時のpreset変更は各dataを送りFIFOを保つ。replyのdataも省略し、UI側で復元する。通常のnote／つまみ操作で大きなPCMを毎回転送しない。
- ソース版と別ディレクトリーへ展開した配布ZIPを、Chromium／WebKitの実AudioWorkletで検証した。[ソース記録](huc6280_synth_dda_browser_01.json)・[ZIP記録](huc6280_synth_dda_zip_browser_01.json)。自作5秒stereo WAV→55,125 samples、6音、保持中の変更、1-shot終端、PCMを含む64KiB超のJSON保存／復元、Copy DDA preset JS、390px幅overflow 0を確認した。外部通信・404・page errorは0。desktop／mobile画像も確認した。
- 読込・変換中のCancel／不正音声／古い結果は現在のPCMと保持音を保つ。変換後のcommit開始時はCancelを閉じてApplying表示へ移る。Worklet応答を意図的に遅延させても、その段階で誤って「キャンセル済み・元の音を保持」と表示しない。
- ローカルNodeで6音・48kHzの2秒分を約146msでoffline renderできた（realtime factor約0.073）。これはこの環境の参考値で、ブラウザーの長時間安定性や全端末の性能保証ではない。
- ZIP: `release/tetorica_huc6280_synth_0.0.4_itch.zip`（48 files、1,126,727 bytes）。SHA-256: `d9baec3739b31f4a93a6600c11d5b4b74d274c70d6aff8161b8e8fe034ee80de`。既存ZIPは保持。今回も可読JS／CSS・相対import・元WASM・対応C++・ライセンスを同梱する。
- `npm run check:runtime-artifacts`: 33 SDK builds／66 outputs／73 mirrorsの一致を確認。README en／ja／AI、英日ホーム、Synthガイドを更新した。共有runtime／WASMは未変更で、gitのstage操作・commit・push・公開は行っていない。

残る確認は手元音声での実聴・長時間試奏。ブラウザー検証中のスピーカー出力はミュートしており、聴感確認を完了扱いにしない。VGM由来のDDA／DAC stream抽出、CD-ROM²、Tauri／Native対応はこの工程に含めていない。


## VGM DACストリームPCM読み込み（2026-11-06 完了）

- [x] VGM仕様と既存playerを照合し、HuC6280向けDAC stream（0x90–0x95）の対象・data block・rate・start/stop・Loopの扱いを確定する。直接DACへ逐次writeする形式は今回の対象外。
- [x] 完全な未圧縮data bankと既知のDDA channel設定から、PCM値・再生rate・使用位置を抽出する。step／base・offset／長さ／block指定・reverse等は正しく復元できる範囲のみ対応し、不明・不正・競合・未対応形式は理由を表示する。
- [x] 途中で停止／設定変更されたものを完全な音として偽装せず、同じPCM／rate／Loop／level／panをまとめる。入力・展開・sample数・結果数を制限し、長い処理をyieldしてCancelを受け付ける。
- [x] プリセットDDAと接続し、元の再生rateを保持する。必要なら低rate用に共通validatorとUIのlive DAC rate範囲を拡張し、音声変換rateの制限は維持する。
- [x] Sounds from VGMへPCMフィルターとrate／時間の表示を追加する。選択前・失敗・Cancelは現在の音を保持し、選択後は既存DDA preview／試奏／編集／JSON保存へ接続する。
- [x] 自作VGM／VGZでdata bank・start mode・長さ・rate／Loop・省略理由・異常入力・中止・旧Wave／Noise／LFO互換をunit検証する。
- [x] ソース版と独立配布ZIPをChromium／WebKitで検証し、可読ソース・README・TODO・検証記録を更新する。実ゲーム比較・実聴・commit／push／公開は別工程。


実装・検証結果（2026-11-06）:

- `vgm_dac.js` に独立した受動解析passを追加し、既存のWave／Noise／LFO結果へ時刻・channel順で統合する。VGM／VGZを開くだけでは現在の音やdevice状態を変えない。PCMを選んだ時だけDDAへ反映する。
- 固定CH1–CH6・register6・完全な未圧縮bankを対象にする。step／base、前回offset／count、明示count／milliseconds／bank末尾、fast block ID、Reverse／Loopに対応。dataは実機と同じ `value & 31` で保持し、C4／root60・speed1で元のrateを再生する。level／panを保存し、Software EnvelopeはOff。global balanceの正規化は既存の取り込み方針と同じ説明を付ける。
- 正のwaitを経て最後のN番目のDAC writeまで観測できたsequenceのみ採用する。途中停止・再設定・rate変更・同じDACへの競合writeは、その時点までに完全なsequenceを観測できていなければ省略する。最後のDAC値が曲中で保持される時間は復元せず、Synth側の通常one-shot／releaseで無音にする。
- current-selected-channel（port255）、非標準destination、圧縮bank、未記録設定、LFO／Noiseによる干渉、不正範囲は理由を表示する。未対応streamを勝手に終了扱いにせず、別streamへの影響を不明状態として追跡する。圧縮blockを飛ばして後続bank offset／block IDを詰め直すことはしない。
- 64MiB入力／展開、4,000,000 commands、100,000 starts、65,536 bank blocks、4,096 assets、合計16,777,216 DAC samplesの上限を確認した。chunk先頭は二分探索し、大量の空block・小さいasset群・長いPCM変換の途中でもyieldしてCancelを処理する。
- v3のlive DAC rate範囲を整数1–192,000 Hzへ拡張した。WAV等の変換rateは8,000–44,100 Hzのまま。旧v1／v2と既存v3の保存値はそのまま読める。PCMフィルター、rate／時間／Loop／C4の一覧、DDA preview／live編集／JSON保存へ接続した。VGM／JSONでPCMを変えた時は古い音声ファイルのLoaded表示も更新する。
- `npm run test:huc6280-synth`: **97件成功**。抽出19件を含む。自作VGM／VGZ、24通りのflat-byte比較基準、block跨ぎ・empty block・step／base／reverse・全対応start mode、停止境界・競合・圧縮後の未知状態・中止・各上限を検証した。7,000 Hzの抽出PCMをC4で試奏した結果が、実WASMへ直接DACを書き込む比較基準とbyte単位で一致する。
- ソース版・別フォルダーへ展開した独立ZIPの両方をChromium／WebKitで確認した。[ソース記録](huc6280_synth_vgm_pcm_browser_01.json)・[ZIP記録](huc6280_synth_vgm_pcm_zip_browser_01.json)。7,000 Hz／3,500 samples／Loop／level22／pan11,13の復元、試奏、保持中rate変更、JSONのPCM値一致、未対応file時の保持音、390px幅overflow 0を確認した。既存Wave／Noise／LFO／音声変換も通り、外部通信・404・page errorは0。desktop／mobile画像も確認した。
- 配布ZIP: `release/tetorica_huc6280_synth_0.0.5_itch.zip`（49 files、1,141,717 bytes）。SHA-256 `fb052afe8cfb317ecaa41ef827e86de18d23452dd8e647f0ad53c8d33cedf6c3`。元JS／CSS・相対import・元WASM・対応C++・ライセンスを維持し、過去ZIPは保持した。
- `npm run check:runtime-artifacts` で33 SDK builds／66 outputs／73 mirrorsの一致を確認した。README en／ja／AI、英日ホーム、Synthガイドを更新。共有runtime／WASMは未変更。こちらからcommit／push／公開操作は行っていない。

仕様照合: [VGM v1.71 specification](https://github.com/vgmrips/vgmplay-legacy/blob/master/VGMPlay/vgmspec171.txt)、[libvgm DAC control](https://github.com/ValleyBell/libvgm/blob/master/emu/dac_control.c)、既存の `ym2612vgm.js` と `huc6280audioengine.js`。milliseconds換算はVGM仕様と既存JSへ合わせ、他実装の式を無条件には移植しない。

残る確認は実ゲーム由来VGM／VGZと実聴・長時間試奏。検証中のスピーカー出力はミュートしている。直接DAC write列・圧縮bank・port255・曲の自動制御は今回の対象外で、次の実装候補として残す。


## VGM直接DAC write列のPCM読み込み（2026-11-06 完了）

- [x] 0xb9のregister6へ直接書くDDA値とVGM時刻を追跡し、既知のDDA key-onからkey-off／DDA解除までの明確な区間を抽出する。単なる長いwaitを新しいサンプルの境界と推測しない。
- [x] 同時刻writeをまとめ、一定間隔の複数DAC writeと最後の保持時間が明確な区間だけを採用する。間隔変化・不明な終端・可聴設定変更・LFO／Noise干渉・DAC stream競合は理由付きで省略する。
- [x] 元の5bit値と再生タイミングを保持する。44,100/time-intervalで非整数になるrateも、丸めて音程を変えない形で既存DDAへ接続する。Loopや元の音階は推測せず、C4を記録速度、Software Envelope Offとする。
- [x] DAC stream／直接writeのPCMを既存PCM一覧へ統合し、重複・rate／時間・由来表示・選択後のDDA preview／試奏／JSON保存へ接続する。共有sample／件数上限・yield／Cancel・失敗時の現在音保持を維持する。
- [x] 自作VGM／VGZ・実WASMでタイミング復元、同時刻write、停止境界、重複、非整数rate、未知設定・競合・変動間隔・異常入力・上限・中止を検証する。既存Wave／Noise／LFO／DAC streamを回帰確認する。
- [x] ソース版／独立配布ZIPをChromium／WebKitで検証し、README・TODO・検証記録を更新する。実ゲーム比較・実聴・長時間試奏・公開は別工程。


実装・検証結果（2026-11-06）:

- `vgm_direct_pcm.js` に受動解析passを追加した。直接記録されたDDA有効化と同時刻に最初のDAC writeがあり、3点以上の正の時間を持つ値が一定間隔で続き、最後の値から同じ1周期後にkey-off／DDA解除される区間を採用する。値は `& 31` で保持する。
- 同時刻のwriteは実際の命令順で処理し、時間が進む時の最後の可聴DAC値を使う。終端と同時刻の0時間DAC writeは追加しない。DDA解除後のWave RAM writeも混ぜない。長いwaitで区間を勝手に分割せず、未知の開始／終端・EOF・変動間隔・mix変更・LFO／Noise・DAC stream干渉は理由付きで省略する。
- `sampleRate=44100/spacing` を有限の小数のままv3へ保存する。live rateは1–192,000 Hz、音声ファイル変換は従来の整数8,000–44,100 Hzのまま。表示だけ丸めたrateには≈を付け、内部値やJSONを書き換えない。rateの＋／−とドラッグも小数部分を保つ。
- PCM一覧へDirect DAC／DAC streamの由来を表示する。同じdata／rate／Loop／volume／panは由来を両方保持し、使用回数を合計し、最も早い時刻と対応するchannelで統合する。DDA preview・6音試奏・Pitch／rate／Loop編集・JSON保存へ接続した。直接DACのLoopや元の音階は推測せず、root60／speed1／Loop Off／Software Envelope Offで取り込む。
- region100,000、4,096 assets、4,000,000 commands、合計16,777,216 DAC samplesの上限を維持した。DAC streamと直接writeを合わせたPCM件数・使用回数・sample数も検証する。解析／encodeはyieldしてCancelを受け付け、失敗時は現在の音と既存一覧を保持する。
- 検証中に、既存DDA再生が `position += step` の累積誤差でサンプル境界を1フレーム遅らせる問題を確認した。加算誤差の補償と、出力frameの1/4未満に制限した整数境界補正で修正した。Loop、終端、保持中rate／Pitch変更とrender分割の独立性を保つ。
- `npm run test:huc6280-synth`: **115件成功**。直接抽出14件、DDA engine10件を含む。直接writeの同時刻順序・開始／終端・非整数rate・未知状態・競合・異常入力・件数上限・中止を確認した。6／8 tickの直接PCMと、6／7／8／13 tick・44.1／48kHz・Loop／one-shot・5,000 frame・17 frame分割、192kHz高速度、保持中rate／Pitch変更を実WASMへの時刻ベース直接writeと比較した。旧DAC streamの比較基準も累積加算ではなくframe時刻から求める形へ直した。
- ソース版と独立展開した配布ZIPの両方をChromium／WebKitで検証した。[ソース記録](huc6280_synth_direct_pcm_browser_01.json)・[ZIP記録](huc6280_synth_direct_pcm_zip_browser_01.json)。2,205 samples／5,512.5 Hz／0.4秒／level23／pan12,11、one-shot終端、保持中rate＋1／−1、JSONのPCM値と小数rateの完全一致、変動間隔file失敗時の保持音、390px幅overflow 0を確認した。既存Wave／Noise／LFO／DAC stream／WAV変換も成功。外部通信・404・page errorは0。desktop／mobile画像も確認した。
- 配布ZIP: `release/tetorica_huc6280_synth_0.0.6_itch.zip`（50 files、1,154,455 bytes）。SHA-256: `3b989f6833ab2afe7bab97b166e35f012bf3549c1bae67232ffe2740fdb48efa`。可読JS／CSS・相対import・元WASM・対応C++・ライセンスを同梱し、過去ZIPは保持した。
- `npm run check:runtime-artifacts` で33 SDK builds／66 outputs／73 mirrorsの一致を確認した。README en／ja／AI、英日ホーム、Synthガイドを更新した。共有runtime／WASMは未変更。こちらからstage／commit／push／公開操作は行っていない。

残る確認は実ゲーム由来VGM／VGZの試奏・実聴・長時間確認。ブラウザー検証中のスピーカー出力はミュートしている。変動間隔／不明な境界の直接DAC列、圧縮bank、port255のDAC stream、曲の自動制御、CD-ROM²は今回の対象外。


## VGM PCMの音量違いをまとめるオプション（2026-11-06 完了）

- [x] Sounds from VGMに「PCM: keep loudest volume variant」チェックを追加する。初期Offで既存一覧を保持し、読込後にも切り替え可能にする。切り替えだけでは現在の音・保持キーを変更しない。
- [x] PCM本体と音量以外の演奏設定が完全一致する場合だけ、channel volume最大の音を一覧の代表にする。pan／rate／Loop等の異なる音、Wave／Noise／LFOはまとめない。元データは保持し、Offで全件に戻せる。
- [x] 代表のpreset／id／channel等を保持し、使用回数・由来・警告を統合する。隠れた音を選択済みなら代表へ勝手に選択を移さず表示だけ解除する。件数・ページ・選択・フォーカスを整合させる。
- [x] unitとChromium／WebKitで最大音量の採用、同率、異なるpan／rate／data／Loopの保持、On/Off復元、保持音と保存結果、狭い画面を検証し、README／TODOを更新する。


実装・検証結果（2026-11-06）:

- Sounds from VGMへ `PCM: keep loudest volume variant` を追加した。初期Offで、読込前・読込後のどちらでも指定できる。同じページで次のfileを開く時も現在の指定を使う。
- `vgm_pcm_variants.js` の純粋関数で、PCM本体とすべてのpreset設定を比較する。比較から除くのはchannel volume、instrument name、DDA nameのみ。pan／rate／root／speed／Loop／envelope等が異なる音とWave／Noise／LFOは保持する。最大volumeを採用し、同率は入力順の先を保つ。波形値をnormalize／変更しない。
- 代表のid／channel／firstTime／presetを保ち、occurrences・origins・warningsを合計／統合する。一覧は最初のgroup位置を使う。元のvoices／presetは不変で、Offで全件を復元する。groupingはlibraryごとに初回だけ計算してcacheし、PCMをdecodeせず比較する。
- 切り替えは音源への命令を送らず、保持音・現在の音色を保つ。非表示になったquiet entryの選択表示だけを解除し、代表へ勝手に読み替えない。代表を明示選択した後は、On／Offしても同じidの選択を保つ。非同期の古い選択完了はtokenで無効化する。checkbox操作後はfocusを戻して鍵盤入力を継続できる。
- `npm run test:huc6280-synth`: **119件成功**。新規unit4件で最大値・同率・逆順・統合metadata・元data不変・異なる14種類の設定・非PCM保持を検証した。
- ソース版と独立ZIPをChromium／WebKitで確認した。[ソース記録](huc6280_synth_pcm_volume_browser_01.json)・[ZIP記録](huc6280_synth_pcm_volume_zip_browser_01.json)。自作VGM／VGZのPCM5件＋Wave1件が、volume12／20／27を27へまとめてPCM3件＋Wave1件になること、異なるpan／rateは残ること、Offで全件へ戻ることを確認した。保持音のowner／音色・追加の演奏キー・選択表示・最大音量27のJSON保存・次fileへの設定引継ぎ・390px幅overflow 0も確認した。外部通信・404・page errorは0。desktop／mobile画像も確認した。
- 配布ZIP: `release/tetorica_huc6280_synth_0.0.7_itch.zip`（51 files、1,158,002 bytes）。SHA-256 `e709aacfa044b211a139fc143ef6cdb59748afa4e70b31595a2856d883ae7a3c`。可読JS／CSS・相対import・対応WASM／C++・ライセンスを維持し、過去ZIPは保持した。
- Synthガイドを更新し、共有runtime／WASM・抽出ロジック・preset formatは変更していない。こちらからstage／commit／push／公開操作は行っていない。


## 音量違いのまとめをWaveにも適用（2026-11-06 完了）

- [x] ユーザー確認済み: WAVはVGM一覧のWaveを指す。既存optionがPCM限定でWaveを保持していたため、Wave／PCMを対象へ変更し、UIのlabel／説明を一致させる。Noise／LFOは現状を維持する。
- [x] WaveのChannel levelが1だけ異なる場合も、波形・pan等の他設定が同じなら最大volumeを残す。既存PCM動作、元データ・保持音・選択表示・Offでの全件復元を保つ。
- [x] Wave23／24と異なる波形／panを含む自作VGM、unit、Chromium／WebKitで再現・回帰確認し、配布ZIP／README／TODOを更新する。


実装・検証結果（2026-11-06）:

- 原因は既存関数が `kind === pcm` だけを対象としていたこと。ユーザーのWAVはWave音色を指しており、PCM抽出の比較誤差ではなかった。自作VGMでWave23／24は2件、PCM23／24は24の1件になることを再現してから修正した。
- UIを `Wave / PCM: keep loudest volume variant` へ変更し、`mergeVgmVolumeVariants()` でWave／PCMを扱う。種類も比較キーへ含め、波形・pan等の他設定が違う音はまとめない。Noise／LFOは現状維持。既存 `mergePcmVolumeVariants()` はPCM限定の互換exportとして維持した。
- Waveの一覧にもlevelと統合件数を表示する。元の抽出結果、保持音、選択済み音、On／Offでの復元と非同期選択の扱いは維持する。最大音量の音を実際にロードするのは、一覧で明示選択した時だけ。
- `npm run test:huc6280-synth`: **122件成功**。grouping unitは7件で、Waveのlevel23／24→24、同率、異なる波形／pan、metadata／元data不変、種類を跨がないこと、既存PCM限定API互換を確認した。
- ソース版・独立ZIPのChromium／WebKitを検証した。[ソース記録](huc6280_synth_wave_volume_browser_01.json)・[ZIP記録](huc6280_synth_wave_volume_zip_browser_01.json)。自作VGM／VGZのWave4件を、23／24だけ統合して3件へまとめ、異なる波形／panは保持する。quiet23保持中の切替でowner／音色が変わらず、代表24の選択・JSON保存・Offで全件復元・次fileへのoption引継ぎが通った。既存PCM5→3の検証も維持した。390px幅overflow 0、外部通信・404・page error 0を確認し、desktop／mobile画像も確認した。
- 配布ZIP: `release/tetorica_huc6280_synth_0.0.8_itch.zip`（51 files、1,158,432 bytes）。SHA-256 `b4653287847003db346a77e6a99986312f98224e36bc3019e510b43d994c0c28`。可読ソース・対応WASM／C++・ライセンスを維持し、過去ZIPは保持した。
- Synthガイド／AI向けREADMEを更新した。共有runtime／WASM・音源処理・抽出ロジック・preset formatは未変更。こちらからstage／commit／push／公開操作は行っていない。
