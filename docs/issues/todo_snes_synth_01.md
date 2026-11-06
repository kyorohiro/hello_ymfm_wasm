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


実装・検証結果（2026-11-06）:

- `docs/synth-snes/index.html` に初版を実装した。仮称Tetorica S-DSP Synth、product id `tetorica-sdsp-synth`。既存keyboard／2箇所Pitch／Master380%／出力monitorを再利用し、紫・グレーのUIと同一canvasの128点描画／decoded BRR previewを用意した。icon画像はまだ指定されておらず、テキストとS-DSP badgeで表示する。
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
