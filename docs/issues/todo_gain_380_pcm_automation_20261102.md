# Gain 380%とPCM編集とDAW automation（2026-11-02）

ユーザーの指示で実装前にTODOを記録する。開始親repo `09c15144`、Plugin `9a82e5b`。

- [ ] FM2612 Synth / SPU Synth / SPU Pluginの最大音量を380%（線形3.8倍）へ揃える。既定FM100% / Web SPU70% / Plugin100%と、100%超orangeの区別を維持する。
- [ ] WebのUI /実行時API上限 /cache key /配布packageとテストを揃え、Chromium /WebKitで実出力倍率・色・旧設定を確認する。
- [ ] Pluginの既存Gain ID0の0〜100%とnormalized mappingを維持する。末尾にBoost倍率paramを追加し、画面は合計0〜380%の操作とする。旧schema1〜10はBoost1で移行し、新schema11で正確なbase /Boost tupleを保存する。
- [ ] PluginのGain /Boostから、Morph Amount /Reverb returnまで連続parameterのautomation pointを指定offsetで反映する。固定容量queue、同offset /block分割 /AU schedule /MIDIとの順序 /resetを実hostで検証する。
- [ ] Native PCMはAuto apply checkboxを既定Onとし、shape変更・描画終了時にworkerへ適用する。Offなら手動Applyと未反映表示を明示する。即反映も音源交換で保持音・残響が止まることを表示する。Web SPU PCMは既に即反映のため変更不要。
- [ ] 速い連続編集 /重複適用 /A→B→A /restore /closeで古いdraftを採用せず、editorを開いただけではVAB等を置き換えない。
- [ ] 旧state /preset /保存互換、unit /実AU /VST3 /Standalone /CIを検証して記録する。公開済みtag /assets・installed AUはこの作業で更新しない。

Webは親repo、Nativeは`w/tetorica-spu-plugin`で作業する。Plugin側の詳細TODOは同repoの`docs/issues/TODO.md`。
