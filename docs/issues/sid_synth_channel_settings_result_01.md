# SID Synth: CH設定・発音先とRound robin（2026-11-08）

後続修正: Round robinの選択だけでは個別設定を揃えず、編集した項目だけ全CHへ反映する。[修正記録](sid_synth_round_robin_preserve_result_01.md)が現在の仕様。この記録は最初の実装・検証を残す。

## 決めた操作

ユーザー確認: CH 1／2／3は、設定の編集対象・鍵盤・物理的な発音先を同じCHへ揃える。
Round robinは現在の設定を3CHすべてへ反映し、鍵盤を3CHへ割り当てる。
以前のLive専用CH選択と、そのOff時のCH無効化案はこの仕様へ置き換えた。

- **CH 1／2／3**: 別々の波形・ADSR・modulation設定を保持する。選択を戻すとそのCHの設定へ戻る。鍵盤は選択CHの単音発音となる。
- **Round robin**: 選択時の音色を3CHへコピーし、その後の設定も3CHへ反映する。通常は3声で割り当て、古い離鍵が置き換えた音を止めない。
- **Filter／model**: チップ全体で共有する。CHごとに独立したFilterがあるようには表示・保存しない。
- **Sync／Ring**: 固定CHでは物理的な前段CH（3→1、1→2、2→3）をsilent Triangle sourceとして使う。sourceの保存音色は保持する。Round robinは従来の3→1・1音の制限を維持する。
- target変更・load・model／topology変更は発音とPitchをresetする。通常のパラメーター変更は発音中の状態を保持する。

## 自動反映

チェックを **Auto update from song** とした。CHボタンは常時操作可能で、同じ枠の **Edit & play** から設定対象を選ぶ。

Onでは選択したSID曲のCHを同じ操作部で追従表示し、取り込み可能な設定をそのCHの鍵盤音色にも残す。
Offでは直前に取り込めた設定を編集・試奏できる。Round robinの観察元は直前に明示選択した曲のCHで、勝手に観察CHを巡回しない。
未対応の合成波形・TEST・複雑な変調等は理由付きで生の値を観察し、最後の再生可能な音色を上書きしない。

古い曲の残存表示・初回read待ち・file chooser／loading・transport遷移は音色へ採用しない。
Pause ACKの確定済み状態は即座に反映する。明示的なPreset／setup読み込みとResetはAutoをOffにし、
自動観察のrevisionで遅いファイル読み込みが破棄されないよう手動編集の世代を分けた。
曲自体への書き込み、曲と鍵盤の同時演奏、WASM／Native DSPの変更は追加していない。

## 保存と可読コード

- **Save voice preset…**: 従来の`tetorica-sid-voice` v2。選択CHの現在の音色を保存し、既存v1も読める。
- **Save channel setup…**: `tetorica-sid-channels` v1。3つのv2音色とtarget（0／1／2／`round-robin`）を保存する。model／Filterの共有とRound robin時の同一音色を検証する。
- **Load preset / setup…**: どちらも受理する。JSONは64 KiBまで、未知の項目・accessor・不整合は変更前に拒否する。曲・ROM・PCMは含めない。
- **Copy JavaScript**: 固定CHと前段source・routingを同じ物理接続で出力する。Round robinの出力は従来の単一音色snippetを維持する。

UI、audio、processor、instrument、import panelは`sid-channels=1`で新しい入口を対応付けた。
既存の`sid-transport=2`とPause／Resumeの起動確認を維持し、JSは可読moduleのまま同梱する。

## 検証と配布

- unit **154件成功**。両modelの実WASM、3つの固定CH、独立設定、共有Filter、Sync／Ring、Pitch／離鍵／Stop、model変更、遅い読み込みと自動反映の競合を含む。
- sourceのChromium／WebKitで **43項目ずつ・計86項目成功**。実発音先、bank保存復元、自動反映・Pause ACK・同じeditor、250ms押下中のLive更新、desktop／mobile配置を確認した。
- sourceの更新不整合検証 **5項目ずつ・計10項目成功**。旧facade残存・旧Worklet拒否・再試行とPause／Resumeを保持する。
- ZIP単体のimport／自動反映／Pauseも43×2＝86項目、更新互換5×2＝10項目成功。既存の鍵盤・Pitch・モデル切替等も16×2＝32項目成功し、browser合計は224項目。物理出力はgain 0で、実聴の確認とは区別する。

配布候補: `release/tetorica_sid_synth_20261108-channels_itch.zip`。
263 files、2,958,267 bytes、SHA-256 `8998db855cf4a409a568dda9a658e06ab5baee14daba7b14a7b68445f183a54b`。
matching source／license／receiptを同梱する。commit／push／公開は実行していない。
35可読module／196原入力の現在のbyte数・SHA-256がreceiptと一致した。
指定の`release/itch_sid_synth_dev-wVDGAN`も新stageと全263ファイルがbyte一致するよう更新した。
既存のSafariタブの設定・再生状態をリロードで消さずに残しているため、同じURLを再読み込みして新UIへ切り替える。

実行記録は `build/validation/sid-channel-settings-*.json`、画面は同`sid-channel-settings-images/`。
