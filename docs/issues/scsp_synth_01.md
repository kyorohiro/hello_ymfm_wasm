# SCSP Synth — TODO（2026-10-30）

Playgroundで確認済みのScspSynth／PCM変換を使い、専用Browser Synthを作る。
ユーザー了承：先にTODOを記録してから実装する。

- [x] 専用ページに音声開始／停止、音量、音色選択、鍵盤を配置する。
- [x] PC Keyboardと画面鍵盤のpolyphony、離鍵、blur時の全解放を接続する。
- [x] 波形表示と描画を単一canvasにまとめ、自作Sine／Triangle／Saw／Squareを選べるようにする。
- [x] WAV／browser codecの読み込み、区間・source rate・基準音・PCM8/16変換を接続する。
  長い音声はhost側に保持し、選択区間だけをSCSP RAMへ送る。ソフト側の変換と明示する。
- [x] EG、forward loop、pitch、TL／panを編集できるようにする。
  PCM／EGは次の発音、pitch／mixは発音中にも適用する。
- [x] PCMを含むversion付きpreset JSONの保存／再読込と、不正入力の診断を追加する。
- [x] 編集時のRAM再利用、held／release保護、Stop後の再開を確認する。
- [x] 操作後にKeyboard入力が吸われないことを確認する。
- [x] 実WASMの発音、複数音、preset round-trip、実ブラウザの基本操作を検証する。
- [x] 入口リンクと操作説明を更新する。
- [ ] 専用配布ZIPと展開後の依存closure／ブラウザ検証を追加する。

初期範囲はBrowser PCM Synth。Native実デバイス確認、LFO、slot間FM、DSP、SSFは別段階。
既存Playgroundとその校正済み音声処理は変更せず、専用ページの音量は独立して検証する。

## 最初のBrowser版の実装・検証

`docs/synth-scsp/index.html`を追加。Start audio、Volume、±24半音のPitch、
13鍵の画面／PC Keyboard、31音のpolyphony（Slot 1は編集用）、最古voiceのsteal、blur release、Stopを接続。
Playgroundの単一canvas editor、音声import／区間変換、PCM8/16、EG／loop／live mixをそのまま利用する。
音声処理・WASM・既存Playground source／校正policyは変更していない。
専用post gainは0.125×Volume。raw内部の加算飽和は維持され、初期Sineのドミソは飽和しない。

preset JSONはformat／version付き、最大2 MiB。PCM整数範囲・点数・loop／pitch／EG／mixを
音源側のvalidatorで事前検証する。保存対象は適用済みvoice（未Applyの描画draftは含まない）。
PCM編集は既存の保護poolを使う。release後も元PCM参照を保持し、Stopで参照を解放する。
鍵盤用slotのpending PCMもStopで外すため、共有参照による無制限なpage固定を避ける。

- `npm run test:scsp-synth`：実WASM **2 tests成功**。preset往復PCM一致、不正入力、初期3和音、Stop後無音／bank保持。
- `npm run test:scsp-synth:browser`：実AudioWorklet／WASMのChromium／WebKit両方成功。
  3和音、live Pitch、held中Applyの旧PCM保護、preset往復、WAV読込、focus、blur release、Stop、
  単一canvas、390px幅の横はみ出し0を確認。[結果](scsp_synth_browser_01.json)。
  物理出力はmute。人の試聴は未実施。

ローカルHTTPサーバーで `/synth-scsp/index.html` を開く。Start audio → A/D/Gでドミソ。
既存release／Tauri frontend／npm packageは再生成していない。専用ZIPは次の作業。
commit／公開は未実施。
