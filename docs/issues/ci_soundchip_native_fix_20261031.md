# tetorica-soundchip-native Actions確認・Windows修正 — 2026-10-31

最新SDK HEAD：`5e0df7acfddc17fe23874e39bbe329cab180505c`。
[最新run](https://github.com/kyorohiro/tetorica-soundchip-native/actions/runs/41129812375)は全体cancelledだが、
[Windowsジョブ](https://github.com/kyorohiro/tetorica-soundchip-native/actions/runs/41129812375/job/124317558345)はビルド失敗。
macOS arm64はcancelled、他のNative3ジョブとWASM7ジョブはsuccess。
前回の[run](https://github.com/kyorohiro/tetorica-soundchip-native/actions/runs/40994309280)もWindowsだけが同じ理由で失敗していた。

## 修正

`vendor/mame-ps1-spu/spu.cpp`が`std::out_of_range`を使うのに`<stdexcept>`を明示的にincludeしていなかった。
MSVCでは他ヘッダーから間接的に宣言されず、C2039／C3861でコンパイル停止。
作業用SDK `w/tetorica-soundchip-native` の同ファイルにincludeを追加し、
`catalog/source_inventory.json`のadapted source SHA256とamendment noteを更新した。
original／previous SDK hashとpristine upstreamは保持。音源処理やABIは変更していない。

## 検証

- `python3 scripts/check_sdk.py`：24 chips／29 chip WASM recipes／2 application-audio／2 instruments／339 snapshot records成功。
- Python release audit tests：**107件成功**。
- 修正ソースをZIP化し、新しい隔離directoryへ展開してNative全体を再ビルド成功（ローカルmacOS arm64）。
- 展開ソースのCTest：**31件成功、0失敗**。WAV examplesとJavaScript smokeもstandalone検証内で成功。
- [集約・source hash・配布候補hash](ci_soundchip_native_fix_20261031.json)。

**修正は別GitのSDK側で未commit／未push**。親アプリだけをcommitしてもSDKへは反映されない。
Windows/MSVCとキャンセルされたmacOS arm64のremote再実行は、SDK差分の反映後に確認する。
親アプリの固定`third_party/tetorica-soundchip-native` snapshot／WASMを直接書き換えず、SDK公開・タグ作成もしていない。
