# SPU Synth：曲の横からVAB抽出・名前付きpreset保存（2026-11-11）

`曲一覧 → Play / Pause / Stop / Extract VAB → Bank / Tone → 名前付きpreset保存 → Filesから呼び戻す`をつなぐ。全Toneの一括ファイル化はせず、選んだ音色だけを保存する。既存presetやsampleを上書きしない。

- [x] 曲一覧の再生操作の横へExtract VABを移し、抽出時にPSF／VABタブで結果を見せる。読み込み・失敗・キャンセル・音色保持を維持する。
- [x] Save soundを`/presets/<音色名>.spu.json`への名前付き保存に変更する。同名は安全に別名を付け、複数音色をFilesへ保持し、保存後に一覧を見せる。
- [x] 音色編集側からも保存できる入口を用意し、VABのTone読み込み→保存→Filesで再選択の流れを明確にする。
- [x] 保存済みADPCMを呼び直す際、同じbytes・tuning・loopの読み込み済みsampleを再利用する。2つの約200 KiB音色を切り替えるだけでRAMが尽きる問題を修正し、可変PCM／PMON／host用slotを流用しない。
- [x] 保存・名前衝突・失敗・ローカル復元／Project ZIPを検証し、無音headlessで抽出・複数音色の再読み込みとPC／スマホ幅を確認する。
- [x] README・可読ソース付き配布ZIP・検証記録を更新する。commit／push／tag／公開は行わない。

既存のSave presetダウンロードは維持する。PSF再生精度・Live／Capture・全音色の自動展開は今回の対象外。通常browser／native app／OS音量は操作せず、headlessはアプリ起動前からdestinationをgain0へ遮断する。Chromiumはmuteを併用する。

## 完了記録

- 上部の曲一覧にExtract VABを配置。クリックするとPSF／VABタブを開いて結果欄へ移動し、処理中はExtracting…を表示する。抽出は音源を起動・変更せず、失敗やキャンセル時は既存音色とバンクを保持する。
- Instrument nameの横へSave to presetsを追加。Files側のSave soundと同じ保存処理を使い、`/presets/<音色名>.spu.json`を追加する。同名は連番、大文字小文字／Unicode正規化や同名directoryも考慮し、既存ファイルを上書きしない。成功後はFilesを開き、新presetを選択・保存する。
- 名前付きpresetの実用上の問題として、呼び戻すたびに同じADPCMを再確保していた。アプリ専用の読み取り操作findADPCMを追加し、現在のSPU RAMにある同じbytes・tuning・loopを再利用する。編集用Waveform／Morph・PMON・host slotを除外し、CodeのRAM reset／Stop復元に追従。公開SDK／npm API・DSPは変更なし。
- Node／WASM／Files／PSF／配布テスト150件成功。Files 13件、audio／実WASM 43件を含み、保存失敗時の原状保持、容量上限、名前衝突、Project ZIP／ローカル復元を検証した。
- 最終ZIPでChromium／WebKit各7項目の新workflow回帰と、Code／Files／Live各7項目、従来SPU full回帰が成功。200 KiBの2音色をA/B/A/B/Aと呼び直してもsample ID 25／26・nextAddress 415296・sample数27のまま増加しない。ADPCM・ADSR・tuningを照合した。
- 両engineの1240px／390px、通常／Files表示の画像に重なりや横はみ出しなし。全音声出力gain0、実聴なし。
- ZIP：`release/tetorica_spu_synth_extract-presets-20261111-final_itch.zip`（314 files、6,762,632 bytes、SHA-256 `e4d81f2e7b5653aaa2ac412330dd231cfd31dbbc65d1be3f3616e99585245ca5`）。可読JS／CSS・既存エンジンsourcekitを保持し、276元入力と配信assetを照合。固定Native SDKは0.1.7のまま。
- 詳細：[検証記録](spu_synth_extract_presets_verification_01.json)。commit／push／tag／公開なし。
