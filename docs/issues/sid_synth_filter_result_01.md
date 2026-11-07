# SID Synth: LP／BP／HPの組み合わせ（2026-11-08）

SID Synthの共有Filterを、LP／BP／HPの独立したOn／Offボタンへ変更した。
各出力は同じCutoffとResonanceを共有し、組み合わせた出力を加算する。
LP＋HPは従来のNotchと同じ設定で、旧v1 Presetはそのまま読み込める。
既存のchip coreとWASMは変更していない。

## 操作とAPI

- ボタンで出力を有効にするとFilterもOnになる。発音中の組み合わせ変更は、保持中のvoiceとGateを維持する。
- 最後の出力をOffにすると、このSynthではdryへbypassする。Enable filterをOffにしてもdryへ戻る。
- Enable filterを再びOnにすると保存された出力選択へ戻り、選択がない場合はLPから始める。
- Preset・Copy JavaScript・高級API／型・Main／Workerへ全8maskを通した。modeは`off`、`lowpass`、`bandpass`、`lowpass+bandpass`、`highpass`、`notch`、`bandpass+highpass`、`lowpass+bandpass+highpass`。
- v1形式の構造は維持し、modeの列挙値を追加した。旧アプリは新しい組み合わせのPresetを拒否するため、新Presetを利用する側も更新が必要。読み込んだ`mode:'off'`は、booleanを検証してから`enabled:false`へ正規化し、入力objectは変更しない。
- 低levelのSID動作は維持した。`mode:'off'`でもvoiceをFilterへrouteすると、そのvoiceは無音になる。Synthの全Off bypassはUI／instrument側の方針であり、chipの動作変更ではない。

## 検証

- `npm run test:sid-synth`: 46件成功。Preset round-trip、旧Notch、編集、コード出力、instrument／processorと可読ZIPを含む。
- SID runtime／Main／Worker／audioの既存テスト: 20件成功。全maskのAPIと直接register書込みで実WASMのPCM一致、Main→Workletの44.1／48／96kHz、logic Worker経由を確認した。
- `node scripts/check_playground_mode_types.mjs`: 成功。別定義のMonaco globalsも更新し、C64例のcheckJsと新しい組み合わせの型を確認した。
- [ソース版browser](sid_synth_filter_browser_01.json)と[実ZIP browser](sid_synth_filter_zip_browser_01.json): 各Chromium／WebKit13項目、計52項目成功。全maskの実出力、live editのowner保持、全Off bypass、既存Notch読込、組み合わせPresetの保存／復元、Copy JavaScript、演奏keyboardとfocusを確認した。
- `node scripts/sid_artifacts.mjs --check`と固定runtime検証: source mirror一致、33 SDK builds／68outputs／75mirrorsを維持。

Browser検証は物理出力をgain0にした測定で、人の実聴ではない。実機SIDと完全一致する精度の検証でもない。

## 配布候補

`sh scripts/package_itch_sid_synth.sh 20261108-filter-combinations`で生成した。

- ZIP: `release/tetorica_sid_synth_20261108-filter-combinations_itch.zip`
- 57files／1,303,832bytes
- SHA-256: `53d63fd27c8a426a0a1ccee38be9681fac20ebed101dba77ce939048666a0b83`
- 可読JS／CSS、matching sources、licenseとbuild input receiptを同梱。ZIPを実際に展開してbrowser検証した。

公開・commit／push・tagは行っていない。
8580の代表実曲検証→通常Playerのmodel選択→Synthのmodel対応は、[TODO](todo_sid_01.md)に続けて残した。
