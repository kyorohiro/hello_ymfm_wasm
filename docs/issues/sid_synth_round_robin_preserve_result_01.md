# SID Synth: Round robin選択時にCH設定を保持する（2026-11-08）

ユーザー指摘: Round robinへ切り替えるだけでは個別設定を揃えず、値を編集して初めて全CHへ反映したい。

## 現在の操作

- **Round robin選択**は発音先modeだけを変更する。CHごとの波形・ADSR・modulation・名前を保持し、それぞれの音色で順次発音する。
- **Round robinでの編集**は変更した項目だけを全CHへ反映する。例えばAttackを変更しても、各CHの波形・Pulse width・Releaseはそのまま残る。
- 値が異なる間は短いnoticeを表示する。編集の基準表示はCH 1、Auto観察中は曲の観察CHを表示する。
- **voice Preset読み込み**は明示的な音色置換として、Round robinでは音色全体を3CHへ反映する。
- 異なる音色のままRound robinのsetupを保存・復元できる。Filterとmodelの共有、離鍵・Pitch・Stopの所有権を維持する。

Sync／Ringが含まれる場合は、先頭の該当CHをcarrier、その物理的な前段CHをsilent sourceとして使う1pair・1音の制限とする。
他のCHの保存音色は変更しない。通常の変調なしRound robinは3声。Copy JavaScriptも同じ発音計画と保存音色を反映する。

## 自動反映と更新

自動採用の判定を再生位置や選択modeではなく、実際の互換音色の値で行う。
Round robinを選んだときのPause frameや、位置だけ進んだ同じ設定の再観察では、一括上書きしない。
設定そのものが変わった場合、またはAutoを明示的に有効にした場合は従来どおり反映する。

UI→audio→processor→instrument→channel helperを`sid-channels=2`で対応付け、
旧helperの同一音色制約が新しいUIへ混在しないようにした。Native DSP／WASMは変更していない。

## 検証と配布

- unit162件成功。両実WASMの異なる3音色、選択直後の全値一致、編集項目だけの反映、保存復元、Pitch、Sync／Ring、Stop、model変更を含む。
- sourceのChromium／WebKit各43項目・計86項目成功。実3CHのwaveform mask・Attack、mixed setupの保存復元、Attackだけの編集、Pause／Auto中の選択保持、時間だけ進んだ同じ設定の保持を確認した。
- 最終ZIPもChromium／WebKit各43項目・計86項目成功。旧module混在・起動時拒否と再試行の更新互換も各5項目・計10項目成功。今回のbrowser合計は182項目。
- 最初のZIP実行はSave操作後のdownload event待機でタイムアウトした。アプリ側は保存完了を表示し、例外はなかった。検証helperの実export間に150msの間隔を入れ、再試行やdownload mockは使わず、全保存で実download・完了・内容を確認した。ブラウザー側制限が原因だったとは断定しない。失敗記録も`sid-round-robin-preserve-zip-browser.json`に保持する。
- 自動検証の物理出力はgain 0で、実聴の合格とは区別する。

最終配布候補: `release/tetorica_sid_synth_20261108-rr-preserve.1_itch.zip`。
263 files、2,960,721 bytes、SHA-256 `20ee1d6d6d10ffb7f581a6adc978638667cc526d30d63ad5cbb61b84012562ae`。
可読moduleとmatching source／receipt／licenseを維持する。commit／push／公開は未実行。
196原入力のbyte数・hashが現在の正本と一致し、指定の`release/itch_sid_synth_dev-wVDGAN`も最終stageと全263ファイルがbyte一致するよう更新した。

実行記録: `build/validation/sid-round-robin-preserve-*.json`。
