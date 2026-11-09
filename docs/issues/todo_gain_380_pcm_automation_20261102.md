# Gain 380%とPCM編集とDAW automation（2026-11-02）

## 追加: FM2612 SynthのVol配置（2026-11-09）

- [x] 既存Vol barを表示コンテナの右上へ移し、Format infoと同じ行に配置する。狭い画面では重ならず右寄せで折り返す。
- [x] 実ブラウザでFiles表示の有無・狭い画面・表示切り替え・380%の表示を確認する。

Chromium／WebKit × 1240／390／320px × Files表示On／Off × Envelope／Waveform／Spectrumの36ケースが成功。
Volと表示カードの右端、desktopでのFormat infoとの同一行、380%表示、既存control IDが1個だけであることを確認し、desktop／mobileのスクリーンショットも目視した。
音声処理は変更せず、検証中の音声初期化・発音も行っていない。実装は`docs/synth/index.html`の配置とCSSのみ。

以下は既存のGain／PCM／automationの実装記録。

ユーザーの指示で実装前にTODOを記録する。開始親repo `09c15144`、Plugin `9a82e5b`。

- [x] FM2612 Synth / SPU Synth / SPU Pluginの最大音量を380%（線形3.8倍）へ揃える。既定FM100% / Web SPU70% / Plugin100%と、100%超orangeの区別を維持する。
- [x] WebのUI /実行時API上限 /cache key /配布packageとテストを揃え、Chromium /WebKitで実出力倍率・色・旧設定を確認する。
- [x] Pluginの既存Gain ID0の0〜100%とnormalized mappingを維持する。末尾にBoost倍率paramを追加し、画面は合計0〜380%の操作とする。旧schema1〜10はBoost1で移行し、新schema11で正確なbase /Boost tupleを保存する。
- [x] PluginのGain /Boostから、Morph Amount /Reverb returnまで連続parameterのautomation pointを指定offsetで反映する。固定容量queue、同offset /block分割 /AU schedule /MIDIとの順序 /resetを実hostで検証する。
- [x] Native PCMはAuto apply checkboxを既定Onとし、shape変更・描画終了時にworkerへ適用する。Offなら手動Applyと未反映表示を明示する。即反映も音源交換で保持音・残響が止まることを表示する。Web SPU PCMは既に即反映のため変更不要。
- [x] 速い連続編集 /重複適用 /A→B→A /restore /closeで古いdraftを採用せず、editorを開いただけではVAB等を置き換えない。
- [x] 旧state /preset /保存互換、unit /実AU /VST3 /Standalone /CIを検証して記録する。公開済みtag /assets・installed AUはこの作業で更新しない。

Webは親repo、Nativeは`w/tetorica-spu-plugin`で作業する。Plugin側の詳細TODOは同repoの`docs/issues/TODO.md`。

Webの[検証記録](synth_master_volume_380_20261102.md)。Plugin sourceは`850a79f`をpush済みで、最終AU22 PASS /VST3 63 PASS /validator47成功・0失敗、Offline /macOS /ASan各32件、Python114件が成功した。Standaloneで380% orange、Auto apply Onのshape選択 /stroke反映、Offの未反映案内・手動Applyを確認した。[通常CI全2 jobs](https://github.com/kyorohiro/tetorica-spu-plugin/actions/runs/41396824927)と[配布CI全3 jobs](https://github.com/kyorohiro/tetorica-spu-plugin/actions/runs/41396824926)も成功。Mac ARM /Intelの同じ配布ZIPとWindows VST3を検査した。

Web sourceは親repoの`04316186`へローカルcommit済み。originへのSSH pushは`Permission denied (publickey)`で失敗した。Web公開先の更新と公開済みReleaseの差し替えは行っていない。Pluginの実装と記録は独立repoへpushする。残る確認は実DAWのUI /automation録音、実聴と長時間動作。
