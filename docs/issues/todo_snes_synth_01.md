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

- [x] SPC snapshotからBRR／voice設定候補を選んで取り込む。詳細は下記。元の音階やdriver更新を完全復元したとは扱わない。
- [x] Echo RAMを安全に予約し、Echo／FIRの高水準API・型・Main／Worker／Native・UIを順に整備する。FIRはEcho経路の音色整形で、cutoff／resonance型フィルターと同一視しない。
- [x] SPCから元のEcho／FIR設定を取り込む選択肢を追加する。手動Echoとの切り替え、候補voiceのEON、曲全体で共有する設定であることを明示する。
- [ ] Noise／pitch modulationを公開し、共有noise clock・隣接voice routing・同時発音枠への影響を示す。
- [ ] Web確認後にTauri版・Native活用例へ進む。
- [ ] C64 SID Synthはフィルター中心の別題材として検討する。

実聴・実ゲーム由来素材・長時間運転・commit／push／公開は、それぞれ検証結果と区別して記録する。

## SPC音色読み込み・作業手順（2026-11-06）

- [x] 既存parseSpcFile／readSnesVoices／extractBrrSamplesを再利用し、snapshotの8voiceから候補を準備する。SPC700／曲再生は起動しない。snapshotのactive表示はENVX／OUTXによる目安と明示する。
- [x] SRCN・BRR・解決済みLoop・PITCH・signed LR・ADSR／GAINをportable presetへ変換する。Root C4は再生基準として宣言し、元の音階を推測したとは扱わない。Noiseは非対応、PMON／Echoやdriverによる時間変化の再現範囲を説明する。
- [x] 折りたたみ可能なSounds from SPCを追加し、ファイルを開くだけでは現在音を変更しない。一覧の音を明示的に選んで試奏・既存editorで編集・保存／再読込できるようにする。選択操作が演奏キーを奪わない。
- [x] bounded file read／抽出、失敗・Cancel・遅い結果の破棄を接続し、現在の音と候補一覧を不意に上書きしない。未解決Loop・不正BRR・容量超過・PITCH0等の候補は理由を表示する。
- [x] 自作SPC fixtureでcodec／preset変換・実S-DSP registerと音・保持音・保存復元を確認し、Chromium／WebKit・独立ZIPで検証する。実ゲーム素材を同梱しない。
- [x] Synthガイド・英日ホーム・README en／ja／AI・検証記録・配布source／CIを更新する。


実装・検証結果:

- `spc_import.js` は既存parser／BRR抽出を使い、同一SRCNでも異なる音量・PITCH・Envelopeを保って8voice候補を返す。inactiveも保持する。BRRは同じbyte、Loopは解決済み16-frame境界、signed LRとADSR1／ADSR2／GAINは元のregister値を保つ。Root60を宣言し、保存PITCHを基準とする。Noise／PITCH0／未解決Loop／不完全・容量超過sampleは理由付きで選択不可、PMON／Echoやdecreasing GAINの再現範囲も表示する。
- `spc_browser.js` とSynthの接続で、折りたたみ可能なSounds from SPC、Load SPC、metadata、8候補、選択後の編集・保存・コード出力を追加した。開くだけでは音を変えずdeviceも起動しない。16MiBを読む前に確認し、エラー／Cancel／古い結果で現在音と候補一覧を保つ。選択確定後はCancelを閉じApplyingをACKまで表示する。他の編集・Reset・JSON読込ではSPC行の選択表示を解除する。
- 短いBRRのpreviewが点列になっていたため、表示幅より短いdecoded波形は接続した線で表示するように修正した。長いsampleのmin/max表示は維持する。32-frame fixtureで描画領域の70%以上の列にtraceがある回帰チェックを加えた。
- `npm run test:snes-synth`: **51件成功**（SPCの10件を追加）。自作SPCで全GAIN、実WASMのsigned LR／PITCH／Envelopeと音出力、loop解決・16-bit wrap、64,512-byte境界、invalid／oversize／所有権を確認した。
- [ソースbrowser記録](snes_synth_spc_browser_01.json)と[最終ZIP browser記録](snes_synth_spc_zip_browser_01.json): Chromium／WebKit各12チェック成功。SPCを開くだけの状態保持、候補選択後の実DSP／音、metadata text安全性、16MiB超のread前拒否、不正file／Cancel／古いread、遅延ACK／JSON復元／選択解除、既存8声・Master380%・Pitch・focus・390px overflow0を確認。最終ZIPでは短いBRRのtraceも確認した。外部通信／404／page errorは0。1180px／390px画像を目視した。speakerはmuteしている。
- 配布ZIP: `release/tetorica_sdsp_synth_0.0.2_itch.zip`（62 files、896,709 bytes、SHA-256 `ee285ba14b3cdeee5cf8943380b589717631568ec841479178fa09fb36207af1`）。採用した白い外枠icon、可読modules／元source receipt、元WASM、完全なLGPL native core・再ビルド手順を含む。今回の2moduleもdependency closureに含める配布検証を追加した。実ゲームのSPC／素材は同梱しない。
- Synthガイド・英日ホーム・README en／ja／AIを更新した。既存SNES CIのunit wildcard／browser／独立ZIP検証で今回の機能も実行する。共有runtime／WASM・npm APIは未変更。commit／push／公開は行っていない。実ゲームSPCでの試聴・長時間動作は未確認。

次の候補はEcho／FIR（RAM予約を先に整備）、続いてNoise／PMON。実ゲームSPCでの人の試聴をAI検証と区別して残す。

## Echo／FIR・作業手順（2026-11-06）

- [x] 正確な既存S-DSPのEcho回路を使い、共有SnesSynthへsetEcho／getEchoとメモリ予約を追加する。Echoは底部$0000..$77ff（最大EDL15の30KiB）、directoryは$7800..$7bff、BRRは$7c00以降へ配置し、初期ESA・Delay変更の内部遅延でもsampleを壊さない。Offの従来layout／64,512-byte BRR上限は維持し、Echo使用時は33,786-byte上限を検証する。
- [x] 高水準API・型定義・Main／Worker／Nativeの接続を揃える。入力不正・容量不足はRAM／音を変更する前に拒否し、reset／Stop／bank再配置でも予約とEcho設定の整合性を保つ。
- [x] Synth preset v2へEcho Enable／Delay0..15／signed Feedback・左右Return／Send／8つのsigned FIR係数を保存し、既存v1はEcho Offとして読み込む。音色・Loop・Echo On/Offは安全にbankを再構成して保持音と残響を止める。その他のEcho調整は保持音へ反映する。
- [x] Echoの基本操作を独立した折りたたみpanelへ追加し、FIR詳細は更に折りたたむ。Delayは16ms単位とcode0の特殊動作、FIRはEcho経路の音色調整であることを示す。選択UIは演奏キーを奪わない。SPCから元Echo設定を読む作業は今回は追加しない。
- [x] 素の実coreとの一致、遅延後のEcho・FIR／左右極性の変化、live設定／Stop、長いsample・容量境界・反復操作でのRAM非破壊、preset移行と保存／JS再利用をテストする。Chromium／WebKitと独立ZIPでも音と操作を確認する。
- [x] runtime mirror／配布source／型／CIの整合性、README en／ja／AI・Synthガイド・検証記録を更新し、配布ZIPを作成する。


Echo実装・検証完了（2026-11-06）:

- 共有`SnesSynth.setEcho`／`getEcho`を追加した。直接Synthは同期、Main／logic Worker／Native clientはPromise resource RPC。初回Enableでbankを再配置し、capacityをnative書き込み前に検証する。Off／resetでは共有APIの予約を保ち、Synth UIは新bankへの再構成でOff時の大きいsample容量を取り戻す。サンプルIDは維持し、移動後addressはgetStateで確認する。
- Preset v2は`echo:{enabled,delay,feedback,volumeLeft,volumeRight,send,fir[8]}`を保存し、正確な旧v1はEcho Offとして読み込む。共有APIのEchoは`sendMask`へ変換する。JS出力は`await snes.setEcho(...)`をBRR uploadより先に出す。原音色のSPC Echo設定は自動で取り込まない。
- `S-DSP Echo`は折りたたみ、FIR詳細は初期閉じ。Enable／Send、Delay／Feedback／左右Return、8係数とIdentityを操作する。On/Off・sample／Loop変更・Stopはheld notes／Echo tailsを止める。残りの設定は所有権とDSP位相を保ってlive反映する。FIRがEchoだけに作用し、code0は4bytes／1stereo frame、1..15は16ms単位であることを表示した。
- `npm run test:snes-synth`: **58件成功**。新しい実WASMテストで遅延Echo、FIR zeroでwetだけ除去、feedback反復、signed Return、raw DSPとbyte一致／17frame分割一致、live編集、Stopと反復On/Off／最大EDLでのBRR・directory非破壊、容量超過の原音保持、v1移行を確認した。
- 共有API関連6suiteは**72件成功**。実WASMとMain／Worker／Native JS接続、初回予約・resource RPC・拒否・Stopを確認した。Native primaryは実WASM経由fixture、extra Nativeは既存JS/RPC fixtureであり、実Native C++アプリで新規起動確認したとは扱わない。`node scripts/check_playground_mode_types.mjs`成功。実行コマンド: `node --test test/runtime/snessynth.test.mjs test/runtime/snes_echo.test.mjs test/runtime/playground_snes.test.mjs test/runtime/playground_snes_worklet.test.mjs test/runtime/native_genesis_snes.test.mjs test/runtime/native_genesis_extra_snes.test.mjs`。
- [ソースbrowser記録](snes_synth_echo_browser_01.json)・[独立ZIP記録](snes_synth_echo_zip_browser_01.json): Chromium／WebKit各13チェック成功。実Echo尾音、live Delay／FIR／signed Return、Send、preset v1/v2／JS出力、容量不足時のcheckbox・保持音維持と、既存SPC／描画／8声／Master／Pitch／focus／390px幅を確認。外部通信／404／page errorは0。speakerはmuteしている。WebKit mobile画像も目視した。
- ZIP `release/tetorica_sdsp_synth_0.0.3_itch.zip`: 62 files、908,758 bytes、SHA-256 `22d8a738cc60d620c0538d3ac37f1b04c3ff52df7a743adf3c0d13388c5030e2`。元の可読JS／CSS、採用icon、WASM、対応LGPL C++／再ビルド手順／source receiptを含む。
- 共有runtimeは公式syncでdocs/jsへ反映した。`npm run check:runtime-artifacts`: 33 SDK builds／66 outputs／73 mirrors一致。`node --test scripts/runtime_staging_paths.test.mjs`: 3件成功。SNES CIへ共有Echo API・型・installed npm型チェックを、itch-web CIへ実Echoテストを追加した。README en／ja／AI・英日ホーム・Synthガイドを更新した。

- `node scripts/check_fm2612_types.mjs`成功。配布runtime345module・JSDoc宣言396件を生成し、実際のinstalled packageをNodeNext／Bundler／browserで検証した。direct Echo APIの同期戻り値、clientのPromise、非any型、不正Enable／FIR／null／任意RAM addressの型拒否を追加して確認した。npm公開は行っていない。
- 共有source変更に伴う音量校正は、既存の153-capture historical baselineを保持したままPS1／WonderSwan／SCSP各48+8、POKEY96+8+8+8の実captureを更新した。両browser／44.1k・48k／Main・Worker／primary・extraを確認し、既存の厳密なsource freshness validatorを維持した。SCSPは新しい48+8のpolicy verificationも実施した。[校正receipt](sdsp_echo_mixer_calibration_01.json)に旧report backup／実行command／hash／coverage／gainとdiagnosticを記録した。
- 校正・generator関連7fileの339件実行では旧SCSP verification reportだけが不一致となったため、公式runnerで再測定して更新し、該当test fileを再実行して10/10成功とした。残り338件は先の実行で成功している。test／validatorを弱める変更はしていない。`generate_playground_mixer_defaults.mjs --check`と`generate_soundchip_mixer_presets.mjs --check`はいずれも成功。
- 通信断の確認を受け、全変更、source／ZIP両browser記録、SCSP verification成功、ZIP実体とSHA-256の残存を再確認した。`git diff --check`正常。commit／push／GitHub・itch・npm公開は行っていない。人の実聴・実Native C++ hostでの新規動作確認・長時間運転は未実施。

次は手元でのEcho／FIRの試聴。実装候補はSPC保存時点のEcho設定取り込み、続いてNoise／PMON。

## SPC Echo／FIR設定取り込み・手順（2026-11-06）

- [x] SPCのEDL／signed EFB・左右EVOL／8つのsigned FIR／EON／FLG書き込み制御を読み取り、元の共有Echo設定を候補とともに保持する。Echo RAMの内容・過去の残響・曲全体のmixは復元しない。
- [x] 各voiceに従来の音色だけのpresetとEcho付きpresetを準備する。選択voiceのEONをSynthのSend all notesへ対応させる。元のEcho書き込みが無効ならEcho Offで設定値を保存し、その理由を示す。
- [x] Sounds from SPCへ「Import Echo / FIR settings」を追加する（初期Off）。変更は次の候補選択に適用し、チェック操作やファイルを開くだけでは現在の音を変えない。適用前後の選択表示を正しく保つ。
- [x] Echo使用時の容量不足は候補に理由を表示して選択不可にする。音色だけへ戻せば選べるようにし、現在の音・保持中voice・候補一覧を変更しない。適用中の選択肢変更やCancel／古い結果も安全に処理する。
- [x] 自作SPCでsigned値／EDL下位bits／FIR／voice別EON／書き込み無効／容量境界・拒否をテストし、実WASM register・保存再読込・コード出力へ接続する。
- [x] Chromium／WebKitと独立ZIPで選択option、現在音保持、Echo実出力、preset往復、keyboard focus、mobile幅を確認する。
- [x] ガイド・README en／ja／AI・英日ホーム・TODO・検証記録を更新し、可読source入りZIPを作成する。共有runtime／WASMは変更しない。


SPC Echo取り込み・検証結果（2026-11-06）:

- `parseSpcVoices`は従来のdry候補を維持し、共有Echo情報と各voiceの`echoVariant:{preset,reason,warnings}`を追加する。EDLは下位4bits、EFB／EVOL／8FIRはsignedとして読む。選択voiceのEONをpreset.echo.sendへ対応させ、元の8bitmaskをラウンドロビンへ直接適用しない。
- FLGのEcho書き込み無効時はEcho Offで値を保持する。EON OffやReturn0はそれぞれSend／Returnの設定として残し、enabled判定や容量回避に使わない。元のESAはmetadataだけに残し、実際のbufferは既存の安全な予約領域に新しく用意する。過去のEcho RAM／残響／他voiceのmixは読み込まない。
- Sounds from SPCの`Import Echo / FIR settings`は初期Off。ファイルを開く・optionを変えるだけでは現在preset／保持音を変えず、次の候補選択で適用する。選択表示はvoiceとmodeの組で管理し、Applying中はoptionを固定する。Echo容量不足の候補だけをそのmodeで無効化し、dryへ戻せば同じ音色を選べる。共通のbuffer説明は一覧上部へまとめ、voice別の理由・警告を保持した。
- `npm run test:snes-synth`: **63件成功**。追加5件でsigned値・EDL上位無視・voice別EON・書き込み無効・zero Return／Send区別・33,786-byte境界と次block拒否・大きいdry sample維持・所有権を確認した。実WASMのregister、空buffer、離鍵後Echo、JSON復元、JavaScript実行のstereo PCM byte一致も確認した。
- [ソース記録](snes_synth_spc_echo_browser_01.json)・[独立ZIP記録](snes_synth_spc_echo_zip_browser_01.json): Chromium／WebKit各16チェック成功。passive option／保持音と選択表示、signed Echo実反映・尾音、ACK中のoption固定、JSON／コード出力、書き込み無効／zero Return、33,795-byte sampleのdry／Echo差と原音保持、既存SPC／Echo／keyboard／Master／Pitch／focus／390px幅を確認した。外部通信／404／page errorは0。mobile画像も確認。speakerはmuteしている。
- 配布ZIP `release/tetorica_sdsp_synth_0.0.4_itch.zip`: 62 files、914,316 bytes、SHA-256 `0c39d36fa1e62fe739dd0dd5a6e41e1a33d58824c4b8b5a66f42daf8ad6adda0`。元の可読JS／CSS、採用icon、WASM、対応LGPL C++／再ビルド手順／source receiptを維持する。
- README en／ja／AI・英日ホーム・Synthガイドを更新した。既存SNES CIのunit wildcard／同じbrowser harness／ZIP検証で今回の機能も実行する。変更はSynthと説明・検証のみで、共有runtime／WASM／npm API・校正値は変更していない。commit／push／公開は未実施。実ゲームSPCの人による試聴・長時間運転は未確認。

次の実装候補はNoise、続いてPMON。実ゲームSPCでEcho有無を比較して試聴する確認は別途残す。
