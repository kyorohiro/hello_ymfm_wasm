# SPU Synth: Software morph — 2026-10-29

ユーザーの依頼でPCM波形A／Bの手動モーフィングを実装した。
「ソフト側の機能」と分かるよう、PCMタブの見出し・有効化操作を **Software morph** とし、
TetoricaがPCMを混ぜてSPUメモリへ書き込み、SPUはそのADPCMを再生することをUI本文にも明記した。
PS1 SPU固有のeffectとして扱わない。SDKコア・WASM・共有Playground panelは変更していない。

## 操作と保存

- Wave A／BでSine／Triangle／Saw／Squareを選ぶ。
  Use current PCM as A／Bで、既存PCMエディターの手描き波形も取り込める。
  録音の任意範囲を切り出す機能ではなく、112sampleの短周期PCMが対象。
- OffのままA／Bを準備でき、現在の音色は変更しない。
  Enable software morphで選択したA／Bのblendを共通音色へ適用する。
  録音sampleを再生していた場合も、短周期PCMへ切り替える。
- Morph · A → Bは0でA、1でB。ドラッグ中の`input`で保持音へ反映する。
  ソフト側の線形補間なので、中間の音量・倍音はA／Bの位相や形に依存する。
  ADPCM量子化も通るため、音質・変化の完全な無段階性やクリック除去は保証しない。
- Morph操作ではApply editsの再発音設定に関係なく再KONしない。
  音の所有権・ADSR・Pitch bendを保ち、既存24個のprivate waveform slotを上書きする。
  操作回数によってsample数やRAM使用量は増えない。
- Offにすると最後のblendをそのまま保持する。手動のPCM編集やAudio取込はMorphをOffにする。
  PMONと併用できる。NoiseではMorph欄を隠し、設定・PCMを保持する。
- preset version 1のoptionalな `morph: {enabled, amount, a, b}` にA／BのPCMも保存。
  Morph有効時は保存されたPCMとblendの一致を読込前に検証する。
  旧presetはMorph Off。Resetでは初期のA=Sine／B=Saw、amount=0、Offへ戻る。

## 実装

`spu_synth_morph.js`：112sample端点・設定の検証、線形blend、形状生成。
`spu_synth_audio.js`：main threadでblendとADPCM encodeを各操作につき1回実行。
Workletへ1回のRPCで送り、既存waveform更新処理を24slotへ適用する。
設定とPCMは同じhandlerで更新し、worklet renderにencoder・polling・LFOは追加しない。

UIはstandalone `spu_synth_panel.js`に追加。preset schema・load/save/resetも接続した。
LFOによる自動モーフィングと、任意バイト・時刻指定のRAM書換えUIは今回含めていない。

## 検証・配布物

- `npm run test:spu-synth`：**50 tests成功**。
  端点の完全一致、中間blend、custom PCM、不正設定・PCM不一致の原子性、保存互換を確認。
  実WASMで保持音のPCM変化、再KONなし、所有権・RAM・sample数の保持、
  PMON／Noiseとの分離、Stop／Off、手動PCM更新での解除を検証。
- [最終ソース版Chromium／WebKit検証](spu_synth_morph_browser_02.json)：両方成功。
- [新規展開ZIPのChromium／WebKit検証](spu_synth_morph_zip_browser_01.json)：両方成功。
  公開UIでnative sliderをドラッグし、マウスを離す前の設定・実PCM変化を確認。
  A／B選択、現PCM取り込み、preset保存・復元・旧形式、PMON併用、Noise時の非表示、
  既存演奏／ADSR／Reverb／monitor／Audio recoveryも確認する。
- 1440px／390pxのPNGを目視確認。欄内・ページの横overflowなし。
- 物理出力はmute、実聴は行っていない。

初回のソース検証 [browser_01](spu_synth_morph_browser_01.json) も両ブラウザで成功。
その後、任意PCMの端点が小さい値でも完全一致するよう端点処理を明示し、最終版を再検証した。

試用ZIP：`release/tetorica_spu_synth_morph-dev_itch.zip`。
45 files／3 bundles、5,477,897 bytes、SHA256:
`9821eda7f3616b3617192c1daf09f03c0a38f88e58261d0d299084881b02e6bc`。
既存ZIPは上書きしていない。未commit・未公開。

## 後続UI：3波形プレビューとA／B編集切替

ユーザー指定で、Morph On時はWave A・Wave B・Resultの3波形を同時表示する。
A／Bのボタンを選ぶと、選択中のendpoint用の設定欄とPCMエディターへ切り替わる。
選択操作自体は音声コマンドを送らず、音・sample・note所有権を変更しない。

- PCMタブ内のSoftware morphを描画エディターより前へ配置。
- Wave A／Bの選択中のボタンを強調し、見出し・canvasの読み上げ名・説明も対象に合わせる。
- Morph Onでの波形ボタン、自由描画、PCM sample index／valueは選択中のAまたはBへ適用する。
  一方の編集で他方のPCMは変えない。MorphはOnを維持し、blendを再生成して保持音へ反映する。
- 描画は既存エディター同様、stroke完了時に適用。切替・取消時の未完了strokeは適用しない。
- ResultはADPCMエンコード前のblended PCMと明記し、source2波形と異なる色で表示する。
- Offでは通常のPCM編集へ戻り、3波形表示を隠す。NoiseでもMorph UIを隠す。
- 共有Playground panelと音声コアは変更せず、standalone adapterで表示用のPCMと
  編集コマンドの対象を切り替える。音声側の実stateと保存payloadは従来どおりblendを保持する。

上記の「手動PCM編集でMorphがOff」は初回版の履歴。
新UIではMorph On中のPCM編集をA／B編集として扱い、Audio取込は従来どおりOffにする。
Software featureの見出し・本文による区別と、既存presetの保存形式は維持した。

50 Node tests成功。検証記録：
[ソース版](spu_synth_morph_editor_browser_01.json)、[新規展開ZIP](spu_synth_morph_editor_zip_browser_01.json)。どちらもChromium／WebKitで成功。
公開UIでA／B双方のnative pointer描画と数値編集、他方のPCM保持、選択時RPCなし、
3枚のcanvasの実画素変化、保持音・RAM再利用、custom A／Bの保存・復元を確認する。
1440px／390pxの表示も確認。物理出力mute、実聴なし。

更新試用ZIP：`release/tetorica_spu_synth_morph-editor-dev_itch.zip`。
45 files／3 bundles、5,480,344 bytes、SHA256:
`caf91bc6bd4e14fb932fa71434a78af3cab7aa485ecc6bbfe53284468dd16a29`。
以前のZIPは上書きしていない。commit・push・公開操作は行っていない。

## 最終UI修正：表示・編集を1つのcanvasへ統合

ユーザーから「4つに分けない、1つにまとめる」と指定を受け、上の3枚プレビュー＋別エディターを廃止した。
Morph OnでもPCM canvasは**1つだけ**。A（青）・B（ピンク）・Result（金の破線）を重ねる。
編集対象のA／Bボタンを切り替え、同じcanvas上で選択した波形を直接描画する。
選択したsourceを最後に太く描き、Resultが端点と一致しても編集対象が分かるようにした。
Resultはエンコード前のblendの表示で、読み取り専用。

既存PCM canvasと波形ボタン・数値欄をMorph枠内へ移し、Offでは元の場所へ戻す。
canvas要素を増やさず、共有Playground panelは変更していない。
Morph Onではstandalone側でpointer strokeを扱い、A／Bとblendを同じcanvasへ描画する。
完成したstrokeだけを音声側へ送り、cancel／タブ切替／編集対象切替／非表示では未完了strokeを破棄する。
A／Bの選択だけでは音声コマンドを送らない。再発音なし・RAM再利用・preset互換は維持。

- 50 Node tests成功。
- [単一canvasソース版のChromium／WebKit検証](spu_synth_morph_canvas_browser_01.json)：両方成功。
  その後、document visibility切替でも全overlayを再描画する補強を加えた。
- [最終ZIP版のChromium／WebKit検証](spu_synth_morph_canvas_zip_browser_01.json)：両方成功。
  ZIPと同一内容の配布ディレクトリを対象に検証し、新規展開ZIPとの全45file一致も確認。
- Morph内・PCMタブ内の可視canvasが1つであること、A／Bのpointer描画・数値編集、
  3色のcanvas実画素、未完了strokeの取消、PCMタブへ戻ったときの重ね表示、保持音・保存復元を検証。
- 1440px／390pxのPNGも目視確認。物理出力mute、実聴なし。

最新試用ZIP：`release/tetorica_spu_synth_morph-canvas-dev_itch.zip`。
45 files／3 bundles、5,481,957 bytes、SHA256:
`62dca1f8351efa2fc0048d139f0d134180b482c6234f8408c50d53228ca95a8a`。
以前のZIP・検証記録は各時点の履歴。commit・push・公開操作は行っていない。
