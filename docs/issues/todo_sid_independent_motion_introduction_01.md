# 保留：JavaScriptで音符と音色を別々の速さで動かす（2026-11-12）

## 方針変更

ユーザーから「SIDの説明から離れている」と指摘があり、作業を停止した。これはSIDそのものの入門ではなく、TetoricaのJavaScript演奏APIを学ぶ別教材の候補として保留する。SID入門の第2章にはしない。

生成ソース・単体テスト・実runtime／実SID検証の下書き3ファイルは、`build/drafts/sid-motion-20261112/`へ退避した（Git管理対象外）。単体3件・実runtime4件を検証済み。ページ・UI・CSS・ブラウザー検証は未作成／未実施。第1章・公開ページ・ナビゲーション・共有runtime・WASMは変更していない。

SID入門を続ける場合は、まず波形・Pulse widthと音の違いを扱い、同じFilter設定で聴き比べるなど、SIDの操作と聞こえ方の関係を中心にする。独立loopやApplyの説明は主題にしない。

## 保留した作業案

- [ ] 既存の`liveLoop`／`beat`／`tween`／`livePrepare`／Apply／Stopの実装を確認し、教材の時間・所有者・更新境界を決める。
- [ ] 同じSIDで、拍に従う短いメロディと秒数に従うCutoff往復を別のnamed loopとして実行する。独自の疑似schedulerではなく既存の共有Code runtimeを使う。
- [ ] BPMとFilter周期を別々に操作し、再初期化／不要な再発音なしに片方を変えられる実験UI・現在の音名／Cutoff表示・Spectrumと持ち出しコードを用意する。
- [ ] 日英の本文を既存Introductionに追加する。拍と秒、非同期loop、`await`、準備を一度行う`livePrepare`、Applyの次loop境界、ソフトウェア制御とchip機能を区別する。
- [ ] 実WASMと実際の共有runtimeで周期・テンポ変更・Filter周期の独立性・Apply時の保持・Stopと遅延応答を無音検証する。Chromium／WebKitで日英・狭幅・コード／リンク・起動取消を確認する。
- [ ] 第1章／入門一覧・README・必要な配布依存／CIと検証記録を更新する。

前提: [第1章](todo_sid_filter_introduction_01.md)。一つの6581 PAL近似・Saw・CH1・LPを使い、モデル比較／Sync／Ring／新規Synth機能は追加しない。最初は0.5拍の音型と4秒のFilter往復など、数えられる組合せを使う。UIが共有runtimeで実行するソースと、Playgroundへコピーするソースを一致させる。

JavaScriptによる発音・Cutoff更新はソフトウェア制御。Main-threadの予定処理であり、任意のサンプル精度・background動作・無遅延を保証しない。Filter周期の変更は現在のtweenを途中で作り直さず、次のloop境界で反映する方式を第一候補とする。

通常browser／native app・音声デバイス・OS音量は操作しない。headlessは全destinationをアプリ起動前にgain 0へ通し、Chromiumはmute指定。ゲーム音源は使わず自作例だけを使う。commit／push／npm公開／itch公開は行わない。shared runtime／WASMを変更せず、既存APIで成立する範囲から進める。
