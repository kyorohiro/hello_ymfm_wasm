# SNES S-DSP Synth TODO

## 方針（2026-11-06）

ユーザー選択: C64のフィルター体験も将来候補に残し、先にSNESを作る。
仮称 **Tetorica S-DSP Synth**、product id `tetorica-sdsp-synth`、Web入口
`docs/synth-snes/index.html`。既存SPU／DMG／2A03／HuC6280 Synthと同じ流れで、
触る→機能を理解する→可読コードを改造・再利用する体験を作る。

## 初版: 8声・BRR・ADSR/GAIN

- [x] 既存のaccurate SnesDspCore／SnesSynth、BRR encoder／decoder、32kHz resamplerを再利用し、共有runtime／WASMを変更せず独立Synthへ接続する。
- [x] 8つの実voiceをラウンドロビンで割り当て、voice steal・古い離鍵・KON/KOFF・hardware release・Stop・サンプル置換の所有権と無音化を検証する。初期音量は8音のDSP内飽和を避けるheadroomを取る。
- [x] 128点の1周期波形をSine／Triangle／Saw／Squareと同一canvas描画で編集し、BRRへ変換して実S-DSPで試奏する。描画はソフト機能、BRR／Gaussian／ADSR／GAINは音源側と区別する。
- [x] Raw BRRとWAV等を読み込み、サンプル名・decoded波形・長さ・Root note／base PITCH・Loop位置を表示／編集する。音声はmono／resample後にBRRへ変換し、64KiB RAMのdirectory予約を除いた64,512-byte上限を尊重する。失敗／Cancelは元の音を保ち、長い音を黙って切らない。
- [x] Hardware ADSRのAttack0..15／Decay0..7／Sustain level0..7／Rate0..31と、GAINのDirect／Linear decrease／Exponential decrease／Linear increase／Bent increaseを操作する。GAIN rateとdirect levelを混同せず、KOFFの固定releaseを説明する。
- [x] 既存と同じKeyboard／Octave、2箇所のPitch、Master0..380%／100%超orange、Waveform／Spectrum、折りたたみ、演奏キーと衝突しない選択UIを用意する。
- [x] BRRとtuning・Envelope・音量を含むportable preset保存／読込と、再利用可能なJavaScript出力を作る。BRRに元音階／rateが入っていると誤解させない。
- [x] 自作fixture／実WASMでunit・Chromium／WebKit・独立ZIPを検証する。可読JS／CSS、対応C++・再ビルド手順・LGPL等のlicenseを含め、README・ホーム・検証記録を更新する。


## アイコン・配色（2026-11-06）

- [x] 日本版Super Famicomを参考に、明るいグレー＋赤・青・黄・緑のTetorica S-DSP Synthアイコンを生成し、既存シリーズと同じ1254×1254 WebPで保存する。生成promptも残す。
- [x] 仮の紫系UIをグレー＋4色へ合わせ、header／favicon／英日ホームへアイコンを追加する。Master boostのorangeとキーボード操作を維持する。
- [x] ZIP内にもアイコンと生成promptを含め、HTMLの相対参照がofflineで解決することを確認する。
- [x] 配布チェックとChromium／WebKitでdesktop／mobileの見た目・操作を確認する。

初回の黒い外枠画像は1254×1254、352,896 bytesで、現在は `docs/tetorica_sdsp_synth_dark_frame.webp` に保持している。built-in image_genで生成し、ImageMagick quality90で変換した。[生成prompt](sdsp_synth_icon_prompt.txt)を保存した。グレーのpanel、blueの主操作、greenの描画trace、4色のbadge stripへ合わせた。現在参照する画像は、下記Revision 2の白い外枠版へ更新した。

`node --test scripts/package_itch_snes_synth.test.mjs` は2件成功。生成したZIPを別フォルダーへ展開してChromium／WebKitで8声・音声import・描画・保存・Master boost・2箇所Pitch・focus・390px幅overflow0等を再確認し、外部通信／404／page errorは0。[今回のZIP記録](snes_synth_icon_browser_01.json)。1180px／390pxのWebKit画像も確認した。

今回のアイコン付きZIPは `release/sdsp-icon-preview/tetorica_sdsp_synth_0.0.1_itch.zip`（60 files、1,047,733 bytes、SHA-256 `4fdb138e995d83d2948d7b45a90f697c583cb01ed904fce168523d06ba6191eb`）。下記の初回ZIPは比較用に保持し、上書きしていない。画像をoffline同梱し、元画像／生成promptはbrowser source archiveにも収録する。公開は未実施。

## アイコン外枠の白色化・Revision 2（2026-11-06）

- [x] アイコンの太い外周フレームだけを、中央のfaceplateより明るいcool off-white／薄いグレーへ変更する。文字・中央panel・波形・8 voice LED・赤青黄緑・構図を保持する。正確な編集promptを上記の生成記録へ追記する。
- [x] 元の黒い外枠版を `docs/tetorica_sdsp_synth_dark_frame.webp` へ保持し、編集画像を目視確認して1254×1254 WebPの `docs/tetorica_sdsp_synth.webp` へ保存する。実画像と保存結果を確認してから完了にする。

白い外枠版は `docs/tetorica_sdsp_synth.webp`（1254×1254、267,544 bytes）。built-in image_genの編集出力を目視確認し、中央panelより明るい外周、正確な文字・赤青黄緑・波形・8 voice LED・下部のdark plaqueの維持を確認した。ImageMagick quality90で保存し、元の黒い外枠版（1254×1254、352,896 bytes）も上記backupへ保持した。

今回の変更対象はアイコン外枠のみで、Synth UI・音源・操作は変更していない。既存の参照先が白い外枠画像を使う。上記のアイコン付きZIPとbrowser記録は初回の黒い外枠版の検証結果として保持し、新しい画像の確認結果とは区別する。既存ZIPは変更せず、白い外枠版を含むZIPの再作成とテスト再実行は行っていない。`git diff --check` は正常。

## アイコン正式採用（2026-11-06）

- [x] ユーザーがRevision 2（白い外枠）を採用。`docs/tetorica_sdsp_synth.webp` を正式な参照先とし、黒い外枠版は比較用としてのみ保持する。header／favicon／英日ホームは採用版を参照する。
- [x] 採用版画像を含むZIPを `release/sdsp-adopted/tetorica_sdsp_synth_0.0.1_itch.zip` へ作成し、画像・source receipt・HTML相対参照を確認する。

採用版ZIPは60 files、877,883 bytes、SHA-256 `0f7182321643dbc36ea14fa9786564355149f35f6f4a2b70d947ade7ff9cc56a`。実ZIPのCRC、白い外枠WebPの元ファイルとのbyte一致、root／nested HTMLのfavicon・touch icon・headerの相対参照、source archiveの全入力hashと採用promptを確認した。黒い外枠画像は同梱しない。既存の初回／黒い外枠preview ZIPは比較用に保持する。画像のみの変更のため音源／browserの全面再テストは繰り返していない。公開は未実施。

## 初版の実装・検証結果（2026-11-06）

- `docs/synth-snes/index.html` に初版を実装した。仮称Tetorica S-DSP Synth、product id `tetorica-sdsp-synth`。既存keyboard／2箇所Pitch／Master380%／出力monitorを再利用し、同一canvasの128点描画／decoded BRR previewを用意した。初期の仮配色は、その後に上記のグレー＋4色アイコンとUIへ更新した。
- 既存accurate SnesDspCore／SnesSynthとSpcResamplerを使い、実S-DSPの8voiceを割り当てる。初期LR16で8音のheadroomを確保した。held ownerとhardware releaseのtailを分け、古い離鍵・steal・同時KON/KOFF・Stopを検証した。サンプル置換は1bankへ再uploadし、反復編集でRAMを使い尽くさない。generation変更でresamplerをresetし、古いbufferを残さない。
- Hardware ADSRのコードと5種のGAINをpacked registerへ反映する。新しい発音でdecrease GAINがゼロから増えない実機挙動を補正せず、説明を表示した。volume／Envelope／tuning／Pitchの変更は保持中のowner・phaseを保つ。
- AudioはOfflineAudioContextでdecode、mono化・8k／16k／32k resample、最終monoだけを[-1,1]へclampしてBRRへ変換する。gain normalizeや入力channel別clippingはしない。browserは可読module Workerでencodeし、Cancelでterminateする。raw BRRにroot／rate／loop addressがないことを表示し、raw Loopの初期0は明示的な編集値として扱う。
- 32MiB入力／30分decoded／64,512 BRR bytes／114,688frames、16-frame loop境界、raw END／余分な末尾、不正base64、有限PCM等を検証した。長い音声は黙って切らず拒否する。import失敗／Cancel／古い結果は現在の音を保持し、commit前にCancelを閉じてApplyingへ切り替える。
- Portable preset v1へwave／BRR／tuning／loop／signedLR／Envelopeを保存する。JSONは256KiB上限。Copy JavaScriptは既存Playground SNES APIとencoderを使う実行用の可読コードを出す。受理済みBRRはmetadata編集／replyで省略し、UI側で参照を復元する。
- `npm run test:snes-synth`: **41件成功**。core／preset15件、sample／import13件、Audio8件、processor3件、配布2件。実WASMとraw SnesSynth出力のbyte一致、17-frame分割一致、8音peak<0.95、hardware GAIN、atomic拒否、反復RAM再利用、codec／実encoder／Worker中止、resampler resetとBRR省略protocolを検証した。
- ソース版と別フォルダーへ展開した配布ZIPをChromium／WebKitで検証した。[ソース記録](snes_synth_browser_01.json)・[ZIP記録](snes_synth_zip_browser_01.json)。実AudioWorkletの8音／stale release、ADSR／5GAIN register、保持中level／Pitch／tuning、描画とstroke Cancel、raw BRRのdeviceなし準備、5秒stereo WAV→80,000frames／45,000 BRR bytes、JSON保存／復元、異常file／Cancel時の保持音、遅延commit中のApplying、Master380%、2箇所Pitch、Octave、focus、390px幅overflow0を確認した。外部通信・404・page errorは0。desktop／mobile画像も確認した。
- 配布ZIP: `release/tetorica_sdsp_synth_0.0.1_itch.zip`（59 files、339,177 bytes）。SHA-256 `f0a83614c830081f0299fdb9d002c3f4b98e7bc94d39684f5420d13fcce98ebe`。元JS／CSS・相対import、元WASM、完全なLGPL snes_spcとwrapper・standalone再ビルド手順・hash receiptを含む。ゲーム素材やIPL ROMは同梱しない。
- README en／ja／AI、英日ホーム、SynthガイドとCIを追加した。`npm run check:runtime-artifacts` で33 SDK builds／66 outputs／73 mirrorsの一致を確認。共有runtime／WASM・npm公開APIは未変更で、commit／push／公開は行っていない。

初版のAI側確認は完了。実聴、実ゲーム由来BRR、長時間確認は未実施で、browser検証のspeakerはmuteしている。次は手元での試奏と必要な調整。その後SPC音色取り込み／Echo・FIRへ進む。

## 接続仕様（初版）

- `preset.js`: createDefaultPreset／readPreset／waveShape／envelopeRegisters／presetToCode。preset v1 `format:'tetorica-sdsp-voice',version:1,name,source:'wave'|'brr',wave:[128 normalized floats],brr:{name,data:base64,rootNote:0..127,basePitch:1..16383,loopStartSamples:null|16-aligned index},volume:{left:-128..127,right:-128..127},envelope:{mode:'adsr'|'gain',attack:0..15,decay:0..7,sustainLevel:0..7,sustainRate:0..31,gainMode:'direct'|'linear-decrease'|'exponential-decrease'|'linear-increase'|'bent-increase',gainLevel:0..127,gainRate:0..31}`。
- Waveは128点・loop0。既知の1周期波形として32000/128Hzを基準に音程を計算する。BRRは明示したrootNote／basePitchから移調する。raw BRRはrate／root／loop addressを持たず、ファイルのみから推測しない。
- `instrument.js`: SnesInstrument(core)、read／setPreset／loadPreset／noteOn(id,midi)→{channel,stolenId}／noteOff(id)／setPitch(semitones)／stop／renderInto(native32k frames)／dispose。サンプル変更はRAMを使い回して全voiceを止める。level／Envelope／tuning／Pitch変更は保持中へ反映する。
- `sample.js`／`audio_import.js`: BRRのbounded base64・検証／decode・音声→BRR準備。UIでdecode／encodeし、deviceを起動しない。Loopは16-frame block境界に揃える。
- `editor.js`: createEditor({root,onChange,onError,onLoadAudio,onLoadBrr})→update(preset)／dispose。file chooserとCancelを所有する。数値はステッパー＋drag、選択はbutton。複数の編集canvasを同時表示しない。
- `audio.js`／`processor.js`: 初回演奏時のみAudioContextを作り、実coreとInstrumentはAudioWorkletが所有する。SpcResamplerでnative32k→device rateへ変換し、Stop／サンプル置換で残りbufferを捨てる。

## 後続

- [ ] SPC snapshotからBRR／voice設定候補を選んで取り込む。元の音階やdriver更新を完全復元したとは扱わない。
- [ ] Echo RAMを安全に予約し、Echo／FIRの高水準API・型・Main／Worker／Native・UIを順に整備する。FIRはEcho経路の音色整形で、cutoff／resonance型フィルターと同一視しない。
- [ ] Noise／pitch modulationを公開し、共有noise clock・隣接voice routing・同時発音枠への影響を示す。
- [ ] Web確認後にTauri版・Native活用例へ進む。
- [ ] C64 SID Synthはフィルター中心の別題材として検討する。

実聴・実ゲーム由来素材・長時間運転・commit／push／公開は、それぞれ検証結果と区別して記録する。
