# Native SNESのcallback stack消費を削減

2026-10-22。TauriのSNES Nativeで連続再現する終了レポートを受けて調査・修正した。

## レポートと確認した問題

レポートの終了理由は`EXC_CRASH (SIGILL)`。main threadはイベント待機中だった。
音声threadは`SNES Shared::publish`の64 KiB RAM配列を`zip(ram)`へ渡す処理にいた。
このレポートだけでSIGILLの送出元やスタック不足を断定はできない。

修正前の実際のARM64 debugバイナリーを逆アセンブルしたところ、
`Shared::publish`だけで328,976 bytes（約321 KiB）をstack上に確保していた。
呼出し先の`zip`は65,680 bytes、配列の`IntoIterator`は131,168 bytesをさらに使う。
RAMのコピーを実行しない分岐でも、関数の入口で大きなframeを確保していた。
修正後の同じdebugビルドでは、この関数のstack確保は672 bytesまで減った。

修正前のRustモジュールと同じC++コアを使うoffline subprocessで、
64 KiB／128 KiBのthread stackは両方stack overflowで終了した。
同じドライバーを修正版へ差し替えると、両方とも成功する。
この比較は音声デバイスを開かず、デバッグ実行でのstack不足を直接確認する。
実際のCoreAudio threadのstack容量は測定していない。

## 修正

- callback内の`[u8; 65536]`ローカル配列と、配列の値渡しを削除。
- C ABIに固定RAMの読取り専用pointer取得を追加。C++コアの既存heap領域を参照する。
- Rust側では`&Renderer`の寿命に結び付いたsliceを使う。RAMを借りている間は、同じcallbackがコアを変更しない。
- register配列も借用して反復する。callback内での新しいメモリー確保、ロック、共有可変scratchは追加しない。
- 適用済み状態のrevisionによる整合性と、RAM snapshotの更新条件は維持する。
- SNESの演算、resampler、API、発音・Stop・timelineの意味は変更しない。

変更先はTauriリポジトリーの`src-tauri/src/native_genesis_snes.{rs,cpp,h}`。
同梱するLGPLソースのコピーとhashも更新する。

## 検証

- 同じoffline probeで、修正前は64／128 KiB stackで失敗、修正後は成功。
- Rustの回帰テストは子プロセス内の64／128 KiB threadで、publish・reset・64 KiB load・echo・timeline・Stopを実行する。
- 各段階で適用済みsnapshotの65,536 bytesすべてが実コアRAMと一致することをcontrol threadから確認する。
- Native／Browser WASMのPCM比較は42ケース、442,368 stereo frames、最大差0。
- C++の対象処理でallocation／free 0。同梱ソース31ファイルの検証と単独再ビルドも成功。
- Rust全体152件成功、失敗0、実機デバイス等の4件ignored。Tauriのoffline・locked debugビルドも成功。

```sh
# Tauriリポジトリー
cargo test --offline --locked native_genesis::snes::tests
cargo test --offline --locked
cargo build --offline --locked
python3 scripts/sync_native_snes.py --check --source ../..

# 親リポジトリー
node scripts/check_native_snes.mjs --out /private/tmp/native-snes-stack-fix-parity.json
```

実際のTauriでの連続再生は修正ビルドで再確認する。SIGILLとの因果関係と、
再現条件の解消確認は、小さいstackでのoffline回帰テストと区別する。
