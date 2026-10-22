# Native安定化・継続検証

2026-10-23。標準21 Modeと旧Genesis NukedのNative対応後、各OSでのビルド、
Mode／Run／Stopの反復、継続したPCM生成とWeb版との比較を検証する。
新しい音源・APIの追加ではなく、既存の音声経路と寿命管理を確認する作業。

## 方針

- 実コアのオフライン検証と、Native IPCを模擬した実ブラウザーの操作検証を分ける。
- 物理音声デバイスを開かず、CPU負荷や連続PCMの結果から聴感上のノイズ解消を断定しない。
- 共有CI環境の処理時間には固定の合格閾値を置かず、同じ条件での比較用JSONを残す。
- 新しい確認用ポーリングを通常再生へ追加しない。診断用の状態読取りで演奏時計を再設定しない。

## 実装

Nativeの反復テストでは22 Modeの実コアを生成・破棄し、固定長／可変長callbackでのPCM一致、
発音、所有者取消し、未来命令の除去、Stop後の無音、再開、予約・アップロード・PCM bankの
保持参照の回収を確認する。短時間版をCIへ、任意の長時間版を負荷比較用に用意する。

ブラウザーではModeを一巡して戻り、Main／Workerの再利用・終了、Run／Stop、Keyboard、
Web Audio／Native切替、開始失敗からの復旧、遅延した命令とStopの競合を繰り返す。
Worker・MessagePortの生存数と未完了IPCを記録する。GC全体のメモリー漏れを証明するものではない。

Audio diagnosticsのNative JSONには、録音の開始・終了近くに1回ずつ取得する状態を追加する。
queue数、遅延命令、overflow、liveFxのunder／overrunと同一session内での差分を保存する。
状態読取りは1秒で打ち切り、読取りに失敗しても正常な録音WAVを破棄しない。
取消し時にはタイマーと待機を解除する。タイムアウトでNative IPC自体は取消せないため、
同一sessionの未完了読取りはRun／Stopをまたいでも1件を共有し、古いRunの結果を破棄する。
これらのカウンターはデバイスのdropout数ではない。音源DSPと通常再生の計算処理は変更していない。

CIは既存のmacOS ARM64／x86_64、Windows x86_64、Linux x86_64／ARM64を維持する。
Native原典21種類の照合と、同梱ソースZIP・現在のcheckout・内部manifestの照合を加える。
親のhello_ymfm checkoutなしで検証できるよう、FX／noise／liveFxの原典も同梱する。
Windowsのautocrlfで原典・照合対象のC++が変わらないよう、属性を明示する。

## 検証結果

- Rust全体：305成功、既存4件はignoreのまま。実音声デバイスは開いていない。
- JS全体：4,058成功、既存1件skip。最後の診断要求の共有化後、Native関連447件と診断25件を再確認した。
- 短時間版：22 Mode、88回のRun／Stopと所有者取消し。未来命令1,456件をStopで除去し、
  実命令の保持参照7,168件、PCM bank 88件の回収を確認した。
- 長時間版：各Run 30秒、2 Runを3周。22 Mode合計190,194,048フレーム、
  約66分ぶんのPCMを生成。132回のRun／Stop、未来命令2,184件の除去、
  命令の保持参照10,752件とPCM bank 132件の回収を確認した。
  固定／可変callbackのPCMは完全一致し、Stop後の出力・待機命令・メタデータはゼロ。
- Genesis Web／Native比較：FM単独／FM＋PSGを各60秒、44.1／48／96 kHzで連続生成。
  途中のresetなし、計22,572,000フレームの最大差は約`3.73e-9`。
- Chromium／WebKit：それぞれ標準21 Modeを2周、168回のMain／Worker Run／Stop、
  42回のKeyboard試聴、開始失敗からの復旧と遅延命令の取消しを確認。
  作成したWorker 44個を終了し、最終的な追跡対象のport・listener・未完了IPC・voice leaseはゼロ。
  Native IPCは模擬し、物理出力は使っていない。
- 最終ソースの既存ブラウザー回帰も両エンジンで成功。Tauriへ取り込んだ最終distでも
  Genesis Main／Workerと32X NukedのWAV・診断JSON保存を確認した。
- Tauriのnpm検証：Python 14件、Node 31件成功。1,304ファイルの配布ソースZIPを展開し、
  原典21種類・manifest・845フロントエンドファイルを照合したうえで、22 Modeを再ビルド・再検証した。

集計と配布物のハッシュは`native_stability_validation.json`へ保存する。

## 各OSのビルド

現行の確定済みNukedコミット`21fea61d0a2e92b0d208d0f0f645e379c39e3c82`について、
[GitHub Actionsの5環境ビルド](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/39842524904)を実行した。
このrunには安定化用の追加チェックは含まれない。リリースは公開しない。

その後Linux x86_64も完了し、5環境すべて成功した。
最終ローカルソースのmacOSアプリビルドも成功した。

追加チェックを含む確定済みコミット`c7cbd2845e1008b68567ba7b884ae6bf5293669f`では、
[新しい5環境CI](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/39848306605)を手動実行した。
Main／Workerの主音源API修正はこのコミットより後の変更なので、このrunには含まれない。
ローカルでは配布ソースZIPを展開した親checkoutのない状態でも原典と短時間版を確認済み。

## 再実行

Tauriリポジトリで実行する。音声デバイスは開かない。

```sh
python3 scripts/prepare_native_sources.py
python3 scripts/check_native_sources.py --bundle --out=native-validation/sources.json
node scripts/check_native_stability.mjs --out=native-validation/stability.json
node scripts/check_native_stability.mjs --long --out=native-validation/long.json
node scripts/check_native_genesis_core.mjs ../.. --seconds=60 --out=native-validation/web-native.json
```

親のBrowser/WASM checkoutを使うのは最後の比較だけ。原典・ソースZIP・短時間／長時間版は単独で検証できる。
短時間版と原典の照合はGitHub Actionsにも追加済み。長時間版は固定の速度閾値を設けず、
`--compare=前回.json`で同条件のModeごとの生成時間を比較できる。

実機での長時間試聴とOS／音声ドライバーのdropout確認は、オフライン検証とは別に行う。
