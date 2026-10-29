# Tetorica SPU Synth: Pitch Modulation — 2026-10-29

Standalone SynthのFXタブに、Reverbと独立したPitch Modulation枠を追加した。
共有Playground panelとSDKコアは変更していない。既存のPMONレジスターを利用する。
commit／push／公開操作は行っていない。

## 操作

- Enable PMON：Off時は従来の24声round robin、On時は12音／24声。
  On／Offを切り替えると発音中の音を停止し、Keyboard所有権も破棄する。
- Ratio：0.01〜16倍の周波数比。0.5／1／2／3倍のボタン付き。
  変調源は演奏音のnote＋Pitch bendに追従し、carrier sampleのroot noteとは独立。
  SPUのpitch範囲を超える変調周波数は上限／下限で制限する。
- Depth：0〜100%。固定Sineの振幅を調整。Ratio／Depthは保持音にも反映し、carrierを再KONしない。
- Decay：0でHold、それ以外は変調源だけの減衰時間。既存コアの線形Sustain rate tableから
  最も近い時間を選ぶため表示は「≈ ms」。新しいNote Onから適用する。
  carrierのADSRは従来どおり独立。

## 音声側

- 物理CH1→CH2、CH3→CH4、…、CH23→CH24をsource／carrierの組にする。
  PMON maskは `0x190=0xaaaa`／`0x192=0x00aa`。
- sourceの左右音量は常に0、OUTXだけをcarrierのpitchへ渡す。
  sourceは固定112sample Sineを使い、全sourceで1つの64byte ADPCM sampleを共有する。
  最初の有効化時だけ専用sampleを確保し、以後はDepth変更時に同じRAMを更新する。
  Ratio／Decay変更はsample uploadを発生させない。
- 変調SineのPCM生成・ADPCM encodeはmain threadで実行。Worklet renderには追加のencode、
  polling、UI通知、per-blockのPMON処理を入れていない。変調そのものは既存SPUコアで実行。
- carrierの共通音色は全24slotに保持し、sourceの実レジスター設定と分離。
  PCM／ADSR／Audio編集やpreset保存で変調Sineが演奏音色へ混入しない。
- allocatorは12組を巡回し、満杯なら最古の音を置換。古い離鍵は置換後の組を止めない。
  Note Offはsource／carrier双方へreleaseを適用。Stopは両者とresampler／reverb tailsを消去し、
  PMON設定を保持して次の演奏へ戻れる。
- On／Offの制御では、送信前にKeyboard epochを更新し、待機中の古いNote Onも破棄する。
  設定・packet・空きRAMの検証は音声側の割当変更前に行う。

## 保存と互換

version 1 instrumentにoptionalな `pmon` を追加。
`{enabled, ratio, depth, decayMs}` を保存し、変調用sample自体は保存しない。
従来の `pmon` なしファイルはOffとして読み込む。Reset instrumentもOffへ戻す。
Audio recovery時は従来どおりSineへ初期化し、保存presetから復元できる。

## 検証と試用

- `npm run test:spu-synth`：**41 tests成功**。実WASMでPMONによるPCM変化、全12組、
  sourceの直接出力0、独立Decay、保持音／release tailsのbend、古い離鍵、Stop後の再演奏、
  RAM再利用、Ratio／Decayでuploadなし、carrier編集の分離、不正設定の原子性、保存互換を検証。
- [Chromium／WebKitの最終UI・音声検証](spu_synth_pmon_browser_02.json)。
  FX操作、保持音のRatio／Depth、12組を使い切った後のsteal、preset保存・復元、旧形式読込、
  既存のPCM／ADSR／Audio／Reverb／Keyboard／monitor／recoverを実AudioWorkletで確認。
- 1440px／390pxのPMON表示をPNGで確認。枠内の横overflowなし。
- [配布ZIPの新規展開検証](spu_synth_pmon_zip_browser_01.json) もChromium／WebKitで実行。
  物理出力はmute。実聴は行っていない。

試用ZIP：`release/tetorica_spu_synth_pmon-dev_itch.zip`。
45 files、5,468,884 bytes、SHA256
`f55c7250c2b7c790c6fbd4fb56f0e65854517735d7661f560211c685a4eb9260`。
公開済みv0.0.1と前作業のGaussian試用ZIPは上書きしていない。

主な実装は `docs/synth-spu/spu_synth_pmon.js`、`spu_synth_worklet.js`、
`spu_synth_audio.js`、`spu_synth_panel.js`、`spu_synth_instrument.js` と `synth.js`。

## 後続UI調整：Reverbを優先

ユーザー指示でFX内のSPU reverbをPitch Modulationより前へ移動。
Reverb見出しを大きくし、青いアクセントで強調。PMONは下段の控えめな枠へ変更した。
音声処理・設定・保存形式は変更していない。

更新後の試用ZIPは同じ `release/tetorica_spu_synth_pmon-dev_itch.zip`。
45 files、5,468,992 bytes、SHA256
`cab51288d3d528a3dc934f74da0aff5e82ae37f19a8b7b052068672a5e5a11a6`。
[更新ZIPのChromium／WebKit検証](spu_synth_reverb_priority_browser_01.json)。
上の旧ZIP hashとBrowser reportはPMON追加直後の履歴。

## 後続操作調整：preset選択でReverbを自動On／Off

Shared reverb presetでRoom／Hall等を選ぶと全carrierのEnable reverbを自動On、
Offを選ぶと自動Offにする。手動でチェックを外す操作ではpresetとreturn levelsを保持し、
再チェックで同じ設定を使える。presetファイルの読込は保存されたbypass設定を尊重する。
変更はstandalone adapterとWorklet内に限定し、共有Playground panel／SPU APIは変更していない。
専用の1回のRPCでpresetと全sendを更新し、中間状態をrender／UIへ公開しない。

42 Node tests成功。
[新規展開ZIPでのChromium／WebKit検証](spu_synth_reverb_auto_browser_01.json)では、
Room選択によるcheckbox連動、手動bypass時のpreset／return保持、Off選択時の無効化、
従来の演奏・PMON・保存／復元も確認した。

最新試用ZIPは同じ `release/tetorica_spu_synth_pmon-dev_itch.zip`。
45 files、5,469,331 bytes、SHA256
`ec6cffc58ee7f131840b9025b2fae1f9e8ce36c3c29481b0afafad6b25d84bcd`。
上のZIP hashとBrowser reportは各作業時点の履歴。未commit・未公開。

## 後続修正：UIフォーカスと演奏Keyboard

selectを文字入力欄と同じ編集判定に含めていたため、preset選択後にフォーカスが残ると
演奏キーが無視されていた。selectは演奏可能とし、documentのcapture段階で
演奏キーのdefault動作を止め、native selectのtype-aheadより先にNote Onを処理する。
repeatもdefaultを止めるが再発音しない。矢印・Space・Tabは通常の操作へ渡す。
文字・数値・textarea・contenteditable・dialog内の入力は演奏より優先し、IME変換中も発音しない。
文字／数値inputはEnterで確定してフォーカスを外し、演奏へ戻れる。

[新規展開ZIPのChromium／WebKit検証](spu_synth_keyboard_focus_browser_01.json)成功。
selectにフォーカスを残したまま実キーを押し、発音・Key Up・repeat時の単一割当、
presetがtype-aheadで変更されないこと、Tab移動、数値／音色名の編集中は発音せず
Enter後に再び発音できることを実AudioWorkletで確認した。既存PMON等の回帰も成功。

最新ZIP：`release/tetorica_spu_synth_pmon-dev_itch.zip`、45 files、5,469,566 bytes、
SHA256 `9ed792808a98a4b9cb612c304babcf511dfe3b508b280604efea5affef0f77dc`。
以前のhash／reportは各時点の履歴。未commit・未公開。
