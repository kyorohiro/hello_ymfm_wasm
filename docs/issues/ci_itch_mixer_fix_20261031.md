# GitHub Actions itch-web失敗の修正 — 2026-10-31

対象HEAD：`a400e1ae1d9da5fdaa6a4813ed7730f442c1a754`。
[最新の失敗run](https://github.com/kyorohiro/hello_ymfm_wasm/actions/runs/41152903705)。
VGM parser/player、SBI、WASM SDK build/parity、Pagesは同HEADで成功。
itch web release ZIPsだけがMixer検証stepで失敗していた。前の失敗runも同step。

## 原因と変更

- 旧校正receiptのテストが、現在のPlayground HTMLをcache-token変更だけと扱っていた。
  現在はUI本体も更新済みなので、JS／HTMLの両方を旧receiptでは拒否する期待に修正。
  productionのfreshness判定や許可条件は緩めていない。元の履歴／receipt／hashは変更なし。
- PS1の校正テストが、独立したfilter-0基準だけでなく、cyclic encoderで作った初期音色まで
  filter-0を要求していた。基準のheader検証は維持し、初期音色はpanel Sineからの再生成一致で検証する。
- npm Mixer exportのテストがSCSP追加前の25種を期待していた。26種へ更新し、SCSPの期待gainを検証済み校正reportから導出。
- workflowのブラウザ音量検証が旧deferred-release reportを指していた。
  PS1／WonderSwan／POKEYを現在の配布policyと同じ`*_scsp_fm_chip_levels_01.json`に変更。
- 再発防止：workflowが参照するreportの現在source hashとprimary／extraの実factory gainを照合する3テストを追加。

## 検証

- ローカルで元の7失敗を再現。
- 失敗stepと同じNode suite＋追加3テスト：**347成功、0失敗**。
- PS1／WonderSwan／POKEY：実Chromium、48kHz、Main、440Hz、primary／extraの代表経路で
  CIと同じ`--verify --baseline`処理を確認。各2経路とFM anchor、POKEYはPSG anchorも成功。
  今回は全matrixの再校正ではなく`completeCoverage:false`の代表経路検証。dual組合せは再検証していない。
- 音源処理、生成gain、過去の計測report、SDK／WASMは変更なし。
- [集約・検証source hash](ci_itch_mixer_fix_20261031.json)。

修正は未commit／未push。GitHub上で修正後の全workflowが成功したとはまだ扱わない。
commit／push後に同workflowを確認し、それから他機能のリリース対象と版数を決める。
SSの追加開発は[再開用TODO](todo_scsp_resume_20261031.md)から再開する。
