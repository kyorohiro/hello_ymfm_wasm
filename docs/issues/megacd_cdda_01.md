# Mega-CD: four sound sources and CD-DA inspector

Date: 2026-10-28

Mega CD modeへCD-DAタブと、YM2612 FM・Sega PSG・RF5C164 PCM・CD-DAの4系統を使う初期コードを追加した。
既存の共通`cdda` / `pg.cdda` APIと状態表示パネルを再利用する。Genesis・32X・32X Nukedの構成は変更しない。

Mega CDを選び、**New Cassette**で新しい初期コードを開く。既存の編集済み`index.js`は保持する。
Exampleは`examples/mega-cd/megacd-four-sources.js`、PCM loop、samplerの3件。
samplerの内容は変更せず、旧FM＋PCM Exampleも保存済みCassetteとの互換用にファイルを残す。

## Implementation

- CD-DAタブは形式・track・位置・長さ・Mixer値などのread-only snapshot。Refresh／タブ移動／既存lifecycle通知で更新する。定期pollingや描画frameからの音声書込は追加しない。
- Run前のタブ表示・RefreshではAudioContext、Worklet、音源を生成しない。Mega-CDにはMSM5205／HuC6280タブを追加しない。
- CD-DAの操作は共通APIの`load`、`play`、`pause`、`resume`、`seek`、`stop`で行う。Web Audio／Native、Main／Workerで同じAPIを使う。CD-DAをGuitar Keyboardの音程付き楽器として扱わない。
- 初期コードは16 kHzの有限PCM bassと4秒の44.1 kHz stereo PCM16 WAVを生成する。外部disc・BIOS・ROM不要。PCMはfade後の無音だけをloopし、32個の連続end markerで高pitch時のRAM読み飛ばしも保護する。
- 4秒のphraseごとにCD-DAを再生し直す。Stopは全4系統とloopを停止する。音符・音声データの音量はExample内で設定するが、`mixer.set()`でユーザーのMixer値を上書きしない。
- selected-modeの型fixtureと初期コードの履歴を追加。ページ用cacheは`mega-cd-cdda-1`。音声processorのcache、共通runtime／DSP、Mixer校正値、固定SDK 0.1.5、既存WASMは変更しない。

## Local validation

Mode／declaration／Keyboard／read-only panelの56件、runtimeの142件、Example／catalog／starter履歴の44件が成功。
全modeの型検証と生成Exampleの照合も成功。既存Native JavaScriptの37件が成功。

Chromium 153／WebKit 26.6 × Main／Workerの全4構成で、実4音源の寄与・個別Mute・CD-DAのPause／Seek／Resume／単体Stop／再生、全体Stop後のexact zero、再実行とstrip重複防止を確認。
Run前の音声初期化0、inspectionがstate読取だけであること、desktop／compact表示、選択modeの型、Genesis／32X／32X Nuked／PC Engine CD-ROM²の8回帰も成功。
System presetを実Mixer UIから戻して新しい初期コードを再生し、clipしないことを確認した。
測定用の個別音源比較は専用fixtureのgainを使い、実初期コードのSystem preset試験とは区別している。

Chromiumの別の4秒録音6件（Main／Worker × 初期コード・FM単独・PCM単独）でもclip／非有限値／振幅差0.1超のsample jumpなし。
これは捕捉PCMの機械的な検証で、聴感によるノイズ判定や実機比較ではない。Browser試験の物理出力はmute。

Nativeは既存production Rustを変更せず、`native_genesis_cdda.rs`の`#[cfg(test)]`内だけに4音源統合試験を追加。
実coreの44.1／48 kHzで、4音源の和と「FM＋PSG＋RFの既知出力＋CD-DA」が誤差2e-6以内、masterが1回だけ適用されることを確認した。
CD-DAだけのMute／Stopで他3音源が保持され、全体Stopは未来のCD-DA再生予約を取り消しexact zeroになる。選択したCargo CD-DA moduleは8件すべて成功。
Native fixtureのmasterは0.5で、Browserの実初期コードを測ったSystem presetとは別条件。Tauri GUIでの実聴は未実施。

## Baseline CI

本体`524552ea5ad6be9f7b03cba24ca47f8095336ff4`のWASM SDK／VGM／SBI／Pagesの4 workflowは成功。
Tauri `764816fc9344b4a2ba35742b4b7fbe23b2ca2a1e`の[Build Desktop](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40597042397)を手動実行し、macOS Intel／ARM・Windows x64・Linux x64／ARMの5構成すべて成功した。
これは作業前の固定SDK移行までのCI確認で、今回の未commitのUI／Example／Rust試験追加は含まない。

## Distribution and resume

- Playground ZIP: `release/hello_ymfm_wasm_mega-cd-cdda-dev_itch_playground.zip`。1005 files、36,785,410 bytes。SHA256 `3205170c9dbbd67203ce6cc075e7a83f65d45ee6d942b047fc1884bdeeb76125`。全stage byte一致、同梱のCD-DA／MSM5205 source bundle検証成功。
- Tauri: 同ZIPから1004 effective frontend filesを取込済み。`import_release.py --check`成功。Native source ZIPは1996 files、SHA256 `7c62a289ed86115b2805aa8589fa41fceb5b32c0ea853a9180aec26b109bc123`。24 offline snapshot／固定SDK431 files／frontend pin／source ZIPを検証済み。
- 4秒の非正規化stereo Float32 WAV preview: `/private/tmp/megacd-cdda-preview.wav`。詳細なhash・測定値は同名JSONへ記録。
- 実装・検証・CI・配布物の記録：[megacd_cdda_01.json](megacd_cdda_01.json)。Browserの詳細：[megacd_cdda_01_browser.json](megacd_cdda_01_browser.json)。

本体・Tauriは未commit／未push。tag、npm／SDK／itch.io／desktop app公開は行っていない。
次は実聴確認後のconsumer変更のcommitと、そのcommitを対象にしたCI確認。今回の変更だけならnpm packageの再公開は不要。
