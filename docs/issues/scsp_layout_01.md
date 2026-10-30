# SCSPタブのFiles領域への侵入修正 — 2026-10-30

ユーザーの画面報告で、SCSPパネルだけWorkbenchの右側panel stackへ移す登録が
欠けており、元のroot直下に残ることを確認。主な修正は`playground_workbench.js`の
primary panel／floating Keyboard対象へSCSPを追加する2箇所。
ページentryとWorkbench importのcache tokenも更新した。

Workbench unit 32 tests成功。実Chromium／WebKit × Main／Workerの4経路で、
幅1440px／686pxの親DOM・Filesとの非重複・tabの所属を検証。
Prepare／Hold／slot 32のPC Keyboard／初期コード／PCM例／独立instance／Stopも成功。
[ブラウザ結果](scsp_layout_browser_01.json)。物理出力は全てミュート。今回のpage例外・layout通知は0。

表示だけの変更で既存校正reportを再測定／書き換えないよう、3つのUIファイルについて
[変更前後の完全hash](scsp_layout_ui_revision_01.json)を固定した。
監査testで「登録2箇所とcache token2箇所」を逆適用すると、測定時の元bytesへ完全復元することを確認。
`mixer_calibration_sources.mjs`はこの厳密な前後ペアだけを受理し、追加の1-byte変更や異なる元hashを拒否する。
校正生成／freshness／UI監査27 tests、Playground／npm Mixer生成check成功。

未commit／未公開。以前生成したSCSP dev ZIPは履歴であり、今回の修正後には再生成していない。
