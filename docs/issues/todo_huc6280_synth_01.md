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
- [ ] VGMのDDA／DAC stream抽出、CD-ROM² ADPCM／CD-DAは別工程として検討する。
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


## VGM DACストリームPCM読み込み（2026-11-06 開始）

- [ ] VGM仕様と既存playerを照合し、HuC6280向けDAC stream（0x90–0x95）の対象・data block・rate・start/stop・Loopの扱いを確定する。直接DACへ逐次writeする形式は今回の対象外。
- [ ] 完全な未圧縮data bankと既知のDDA channel設定から、PCM値・再生rate・使用位置を抽出する。step／base・offset／長さ／block指定・reverse等は正しく復元できる範囲のみ対応し、不明・不正・競合・未対応形式は理由を表示する。
- [ ] 途中で停止／設定変更されたものを完全な音として偽装せず、同じPCM／rate／Loop／level／panをまとめる。入力・展開・sample数・結果数を制限し、長い処理をyieldしてCancelを受け付ける。
- [ ] プリセットDDAと接続し、元の再生rateを保持する。必要なら低rate用に共通validatorとUIのlive DAC rate範囲を拡張し、音声変換rateの制限は維持する。
- [ ] Sounds from VGMへPCMフィルターとrate／時間の表示を追加する。選択前・失敗・Cancelは現在の音を保持し、選択後は既存DDA preview／試奏／編集／JSON保存へ接続する。
- [ ] 自作VGM／VGZでdata bank・start mode・長さ・rate／Loop・省略理由・異常入力・中止・旧Wave／Noise／LFO互換をunit検証する。
- [ ] ソース版と独立配布ZIPをChromium／WebKitで検証し、可読ソース・README・TODO・検証記録を更新する。実ゲーム比較・実聴・commit／push／公開は別工程。
