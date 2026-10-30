# SCSP Native callback土台 — 2026-10-30

後続：[Native transport・画面接続](native_scsp_transport_01.md)。以下は土台完成時点の記録。

Native対応の最初の層として、TauriへSCSPコアとBrowser同等の出力rate変換を組み込んだ。
**Native backendからSCSPを鳴らす接続全体は未完了**。
今回の成果はcallback用の実コアと再現可能なPCM検証であり、primary／extra rack、
時刻付き命令・適用確認・RAM uploadのadmission、manual lease、復旧は次の層。
SCSPのNative mode選択は引き続き無効で、既存Web Audioは変更しない。

## 変更

- 別Gitの`w/tetorica-fm2612-playground-tauri`へ、親repoと同じSDK 0.1.7未公開candidateを正規import。
  476 files、archive SHA256 `efe7daa49a97dad00de9745e92aed9a16820cde2ae89e55a0222523dee7974a1`、
  base commit `f9f76df545e56fa4195cf345a9de507ae3bcb39b`。固定snapshotは直接編集していない。
- Tauri importerへSCSP source／recipe／fixture／licenseの完全性検査を追加。
  各必須fileが欠けるreleaseを拒否し、過去snapshotの検査も維持する。
- `src-tauri/src/native_genesis_scsp_core.rs`：排他的なRust所有、C ABI、masked write、
  caller-owned RAM入出力、reset／Stop、host sample／stereo block render。
  `build.rs`から固定SCSP 3 C++ sourcesを一度だけcompileする。
- 8,000–384,000 Hzのhost出力。44.1 kHzは補間／先読みなし。
  他rateは`Pcm44100Resampler`と同じ2点先読み・整数phase・double補間・Float32への丸め。
  StopはDSP／register／converterをresetしmasterを復元、RAMを保持する。
  音色／sample descriptor／命令／所有権は次のtransport層が管理する。
- 実Rust moduleを直接使うNative fixture、RustとC++のallocation probe、
  `scripts/check_native_scsp.mjs`を追加。音声device／AudioContextは作成しない。

SDK pin更新には、親で既に導入済みのPS1 host PCM／headroom APIも含まれる。
Tauri側で新APIを有効化する変更はしていない。frontend source・生成WASM・音量校正値は変更なし。

## 実測

[完全report／入力hash](native_scsp_core_01.json)は全入力を実行前後で検証する。
実Rust callback module＋固定Native coreと、実Browser `ScspSynth`／WASM／resamplerを比較。

- **96 cases、5,589,524 stereo frames、PCM差分0**。
- 8／44.1／48／96／384 kHz × regular／irregular partitions。
- PCM8／16、one-shot／forward loop、全32slots／clip、pitch／pan／EG、個別retrigger、
  RAM変更／masked write、Stop後再発音、RAM clear、44.1／48／96 kHzで10秒処理。
- 全slot registers・master／monitor・512 KiB RAM・native／host frame数も完全一致。
  partition変更でPCM hash不変。Stopとone-shotの末尾は明示的に無音を要求。
- 処理中のRust alloc/dealloc・C++ new/deleteは全caseで0。
  direct C malloc/freeはprobe対象外。実callbackのdeadline／負荷保証や実機忠実度の検証ではない。
- Rust unit 2：範囲外操作の原子性、instance独立、invalid rate、clock count、Stop保持／reset clear。
- SDK importer Python 14 tests成功（SCSP closureの全member欠落検査を含む）。
  Native source関連Python 10 tests成功。24 source snapshotsのoffline検査成功。
- Tauri全Cargo：**802 passed／0 failed／既存4 ignored**。
  最初はsandboxによるlocal port禁止でMCP通信2 testsが失敗したが、制限外の全再実行で成功。
  SCSP処理がaudio deviceを開く検査ではない。
- 対応するNative application source ZIPを再生成し、2,112 filesの全内容をcheckoutと照合した。
  Nativeアプリbinaryの配布・実device試聴・remote CIは未実施。

## 再実行・次の作業

```sh
node scripts/check_native_scsp.mjs --out docs/issues/native_scsp_core_01.json
```

Tauri側の詳しい契約は[Native coreガイド](../../w/tetorica-fm2612-playground-tauri/docs/native_scsp_core.md)。
次は既存PS1のprimary／extra共有transportを参考に、SCSP用command preparation／admission／
callback適用・statusを接続する。KEYONEXは全slotをscanするため、手動leaseの所有権を保護しながら
対象slotだけretriggerする。RAM編集は実発音／release参照を保護し、所有者取消とStopで予約を解放する。
その後JS Native endpoint・Main／Worker・Keyboard／Inspector・復旧・UI mode公開を接続する。

親repoとTauri repoの変更は別々に保存が必要。commit／push／公開は実施していない。
