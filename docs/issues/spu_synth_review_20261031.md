# SPU Synth 安定性の見直し — 2026-10-31

Playgroundのリリース作業中に、Standalone SPU Synthを点検。
Playground、共有音源、SDK pin、WASM、校正gainは変更していない。

## 修正

- PMON／Noiseの有効・無効切り替えでは、Workletが成功を返した後に鍵盤の所有情報をクリアする。
  変更待ちの新規発音は抑止。拒否された場合は押下中のキーを保持し、通常のkey-upで離鍵できる。
  以前はSPU RAM不足でPMONが拒否されてもUIだけ所有情報を失い、音が残る場合があった。
- AudioWorkletコマンドに15秒の応答期限を設け、応答なし／messageerror時は保留Promiseと
  タイマーを破棄し、エラーを表示して明示的なEnable audioで再開できるようにした。
  成功、通常の操作拒否、postMessage例外は個別タイマーを解除する。
- HTML／audio hostのcache queryを更新。Standalone ZIPのroot入口もqueryを保持してassetを参照する。

音声生成式・既定音量・PCM／ADPCMは変更していない。再起動は既存仕様どおり新規Sineから始まる。

## 検証

- 修正前controllerを隔離コピーしてChromiumで再現：RAMを使い切り、押鍵中にPMONをOnにすると
  `A rejected topology change preserves the held key owner`が0対1で失敗。音声側には押下情報が残っていた。
- 同じ公開UI操作を修正後のChromium／WebKitで実行し、拒否後のチェック復元・鍵盤表示・key-up・無音を確認。
  テストはpreset読み込みでRAMを使い切る。内部APIでの音源操作や偽rendererは使用しない。
- `npm run test:spu-synth`相当：Node **70件成功**。
  新規3件はaudio hostの期限管理、保留コマンド一括拒否、messageerrorの後始末を検証する。
- 実ZIPを新規展開し、root `/index.html`でChromium 153／WebKit 26.6の全回帰成功。
  [raw report](spu_synth_review_browser_20261031.json)。Sine単音・和音headroom、鍵盤focus、
  PMON／Noise／Morph、20 MiB WAV、VAB／PSF、preset保存復元、音声context終了後の再起動、
  RAM不足での変更拒否を検査。外部M4A／ゲームPSF fixtureは今回指定していない。
  Chromiumは91 captures／1,085,440 frames、WebKitは92 captures／1,089,536 frames。
  PCM／clock連続、processor例外0、missing asset0。配信8ファイルとcheckerの試験中hash不変も検査。
- 1440px／390pxの14状態ずつで横溢れなし。Chromiumのdesktop PCM／mobile FX screenshotを目視確認。

## 配布候補

`release/tetorica_spu_synth_review-dev-20261031_itch.zip`

- 46 files／5,535,255 bytes、root `index.html`。
- SHA-256：`f954c67282a284341e9b9bb0f8cf517e44e42e4cdbff55f7eefe7d3d28c16f9b`。
- runtime 3 bundles、対応ソース、固定SDK原本、licenseを同梱。CRC・source認証・local asset参照は成功。
- 新しい名前で生成。過去ZIPは上書きしていない。未公開、未commit、未push。

公開ページや物理出力の実聴は今回の確認対象外。ブラウザ測定は物理出力をmuteして実AudioWorkletのPCMを検査する。

## 後続：鍵盤をFM2612 Synthに近い密度へ

ユーザー指定で`/synth/index.html`に合わせてSPU Synthの鍵盤をコンパクト化。
Fret／Stringを同じ行へまとめ、その下の楽器・フレット位置・弦選択も横並びにして折り返す。
鍵盤の固定最小高さを外し、余白と操作ボタンを縮小。SPUの色・押下表示は維持。
Octave／Sustain／Release notesは残した。

Octaveはチップ固有の命令ではなく、`synth.js`が発音MIDI noteに`octave * 12`を加える演奏UI機能。
今回FM2612側への追加は行っていない。共有keyboardやPlaygroundの変更もない。

- Node70件成功。Chromium／WebKit × 1440／390pxでオクターブ往復、楽器・フレット切り替え、
  横溢れなしを確認。[変更前後の寸法](spu_synth_compact_keyboard_layout_20261031.json)。
- 鍵盤section全体はPC約635→459px、スマホ約697→475px。両幅のChromium screenshotを目視確認。
- 新ZIPで`--review-only`を実行し、両browserで初期化・タブ操作・発音・RAM不足PMON拒否後の離鍵に成功。
  [新ZIPの限定回帰report](spu_synth_compact_keyboard_browser_20261031.json)。
  この後続変更で全browser suiteを再実行したとは扱わない。全回帰は上記レビュー版の記録。

最新の配布候補は`release/tetorica_spu_synth_compact-keyboard-dev-20261031_itch.zip`。
46 files／5,535,698 bytes、SHA-256
`f903c0a70cc08ada52aa6a7a174399480e713565bb6b518e834bd3b084ea7486`。
以前のレビューZIPは保持。今回も未公開・未commit・未push。

## 後続：Software morphを既定でOn

ユーザー指定で、起動前UI・新規音声セッション・Reset instrumentのMorphをOnに変更。
A=Sine／B=Saw／amount=0%で始め、初期SineのPCMは維持する。
`readMorph()`の汎用デフォルトは変更せず、Morph情報のない旧presetは従来どおりOff。
音声・VABの読み込み時のOffと、保存presetの明示設定も保持する。

Node70件成功（実WASMの初期PCM一致を含む）。
[両browserの限定検証](spu_synth_default_morph_browser_20261031.json)で、
起動前後のOn／amount=0、初期Sineの実PCM、離鍵、Reset後のOn、RAM不足PMON拒否後の離鍵を確認。
配布ZIPは再作成していないため、上記の既存ZIPにはこの既定値変更は含まれない。

## 後続：select選択後の演奏フォーカス

ユーザー報告に対応し、SPU Synth内のselectをpointerで操作した場合、changeの確定時にblurする。
documentの演奏キー捕捉だけではOS標準popup側で処理されるキーを回収できないため、
選択確定後は演奏へ戻す。矢印・Tab等で操作する場合はpointer扱いを解除し、select focusを保持する。
text／number入力の編集と既存のEnter確定は維持。FM2612／Playgroundは変更していない。

Node70件成功。[両browser限定検証](spu_synth_select_focus_browser_20261031.json)で、
Sound source Noise／Sample、Morph Wave A、Reverb preset、PMON waveformのメニューをclickで開き、
Playwrightのoption確定後にfocusが外れること、PCキーの実PCM発音・離鍵／Stopを確認。
selectのkeyboard focusを維持した変更と、その後の文字キー発音も確認した。
修正前controllerの隔離コピーでは同じ検証の最初のSound source選択でfocus解放のassertionが失敗。
この限定検証ではVAB等の全selectを個別に操作したとは扱わない。実装はdocumentへの委譲で全selectに適用する。
配布ZIPは再作成していない。
