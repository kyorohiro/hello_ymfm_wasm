# SCSP Native transport・画面接続 — 2026-10-30

SCSPをTauriのNative backendへ接続した。Saturn Modeのprimaryと独立した追加instanceを、
Main／Workerの既存API、32-slot Inspector、Hold／PC Keyboard、PCM／EG編集から操作できる。
Native mode選択も有効化。Native binaryの再ビルドと新frontendの取り込みが必要。
専用SCSP Synth、SSF／68000、DSP／slot FM／LFOの操作公開はこの変更に含めない。

## 音声と所有権

`w/tetorica-fm2612-playground-tauri`は別Git管理。
`native_genesis_extra_scsp.rs`がprimary／extraで共通のcommand preparation・callback処理・
status／capture・retirementを持ち、`native_genesis_scsp.rs`がprimaryのstatus envelopeを提供する。
既存のrack、16-instance／64 MiBのadmission、時刻・Worker owner・Main group・取消へ接続した。
Rust callbackは前段の`native_genesis_scsp_core.rs`と同じ固定SDK C ABIを使用する。
SDK pin・SCSP C++・生成WASMは今回変更していない。

slotごとにmanual lease／発音元RAM範囲を持つ。KEYONEXの全slot scanを維持しつつ、
別slotを含むbatchや不正なkey action／maskを拒否する。On batchのPCM範囲・loop／pitchを
変更前に検査し、不正なsourceでcallbackをpanicさせない。古いmanual Offは新しいvoiceを解放しない。
離鍵してもRAM参照を保持し、実際のplaying addressesをstatusへ別途公開する。
uploadはその範囲と重なると拒否し、retrigger／Stop／resetで参照を更新する。
periodic statusは小さなregister／metadataのみ。512 KiB RAM captureは明示barrier時だけ。
prepared payloadの最後の解放をcallbackに持ち込まない既存retirement経路を利用する。

Stopはconverterの先読みも破棄しRAMを保持する。clear resetはRAMと旧handleを無効化する。
resetはtimed Worker命令内でも即時適用し、古い予約を取り消す。新uploadはresetの後に並ぶ。
close／再開では古い継続・instance・handleが新しい音源を操作できない。

## JS・画面

`web/native_genesis_scsp.js`と`native_genesis_extra_scsp.js`が音色metadata・PCMコピーを持つ。
音声DSPはJS／WASM／AudioContextを経由しない。通常の鍵盤操作では512 KiB RAMをコピーせず、
RAMのstagingが必要な編集／uploadだけでコピーする。内部`_copyTransportState`で編集poolも分離する。
WorkerのPCM uploadは同じresponse portでresource metadataを先に採用し、通知の到着順に依存しない。
editor deltaはMain／Worker双方へ反映する。

primary／extraとも初期Sineを持つ。PCMファイルのhost decode／区間選択は既存UIを共用する。
Apply中のRAMはstagingし、Nativeでの確認後にhandleを採用する。予約中・実行中のApplyを拒否する。
編集pageは実発音／releaseで保護し、Stop後に再利用できる。通常loadPCMはappend-only。

Nativeではimmutableなregister batchを予約するため、**予約済みのnoteは送信時のpresetを保持**する。
後から行うeditで既存予約のpayloadを書き換えない。表示gateは発音要求でありEG meterではない。
実発音元RAMの参照はcallbackのstatusから別に確認する。

## 検証・配布

[core PCM proof](native_scsp_transport_core_parity_01.json)：実Rust core＋固定Native C ABIと
実Browser Synth／WASM／resamplerで96 cases／5,589,524 stereo framesが完全一致。
全RAM・register・clock数、regular／irregular partitions、8〜384 kHz、10秒処理を含む。
Rust alloc/dealloc・C++ new/deleteは測定区間で0。probeはdirect C malloc/freeを計測しない。
新しい2 MiB raw-core chargeはC++ sizeof assertion、共通64 KiB構造体枠はRust testでも確認する。

Tauri全Cargoは**812 passed／0 failed／既存4 ignored**。関連Nodeは**1,183 tests成功**、
Playground全mode型とSDK importer Python 14 testsも成功（これらは重複を含むため合算しない）。
Native transportのRust 10 testsは、32 slots、追加rack、manual保護、release RAM、stale Off、
cross-slot原子性、Worker／Main取消、coherent RAM capture、duplicate ID、timestamp／block分割、
resetの予約取消とmaster復元を扱う。JS testsは実WASMをRPC先に使い、primary／extra、PCM、
editor、同一portのWorker metadata、close／再開、timed resetを確認する。
共通のcreation lifecycle matrixもPS1／SCSPを含む26種類に拡張した。

画面検証はChromium／WebKit × Main／Worker。Native RPCだけをmockし、実画面と本番clientで
mode選択、slot 32、PCM編集、Hold／PC Keyboard、追加instance、Stopを検査する。
AudioContext／AudioWorkletNodeの生成を禁止してNative分岐を確認する。
これは物理device出力、実機精度、callback deadlineの検証ではない。

共有runtimeのcacheは`scsp-native-1`へ更新した。最終配布前に相対WASM pathを正規化し、
PS1／WonderSwan／POKEY／SCSPの新しい`*_scsp_native_chip_levels_01.json`で再測定する。
旧測定・旧releaseは保持。途中のpath修正前の測定は`/private/tmp/scsp-native-pre-path-fix-*`へ隔離。
SCSP policyの全48経路も新しいverify reportで再検証する。
配布の最終結果・hashは[集約report](native_scsp_transport_01.json)へ記録する。

```sh
node scripts/check_native_scsp.mjs --out docs/issues/native_scsp_transport_core_parity_01.json
node --test web/native_genesis_scsp.test.mjs
node scripts/check_playground_native_scsp_browser.cjs
```

未commit／未公開。親repoとTauri repoの両方を保存する必要がある。

## 最終配布結果

専用dev ZIPを作成し、完全source版ZIPの1,119 filesをTauri importerで導入・照合した。
その**実dist**でChromium／WebKitのNative Main／Worker・PCM編集・PC Keyboard・Stopを再確認。
Node packageは345 modules／396 declarations、実installed consumer・型・全WASM asset検査成功。
Run ZIPは967 entries（directory entriesなし）。Native source ZIPは2,169 filesを全hash照合済み。
Nativeの`cargo build`も成功。これらの数とSHA256は集約reportに記録した。
固定SDKのSCSPソース／生成WASM／raw render mathの変更はなく、再測定の丸め差を含む新しい生成Mixer policyを同梱する。
明示的・保存済みMixer設定は引き続き絶対値のまま。
