# SPU Synth：モニター上の曲一覧（2026-11-11）

FM2612と同様に、読み込んだ曲の選択と再生操作をEnvelope／Waveform／Spectrumの上へ置く。SPUはPSFフォルダー／ファイルセットを読み込み、その中のPSF／MiniPSFを曲一覧にする。PSFLibは依存関係として保持し、通常は曲一覧に並べない。

- [x] PSF曲一覧とPlay／Pause／Resume／Stopをモニター上へまとめる。フォルダー名・相対パスで曲を判別でき、読み込み前は場所を取らないようにする。
- [x] PSF／VABタブの抽出は、上の曲一覧で選択したentryを使う。選択変更で勝手に再生せず、既存音色を保持する。
- [x] 読み込み失敗・キャンセル、フォルダー依存解決、鍵盤フォーカスを維持し、desktop／mobileと既存再生・音色抽出を無音で検証する。
- [x] READMEと可読ソース付き配布ZIP・検証記録を更新する。commit／push／公開は行わない。

曲のLive表示・Capture・再生エンジンの再現精度は今回変更しない。通常browser／native app／OS音量は操作しない。headlessはアプリ起動前からdestinationをgain0へ遮断し、Chromiumはmuteを併用する。

## 完了記録

- 既存のentry select・再生操作を一つのままモニター上へ移動。読み込むまでは非表示。PSF／VABタブのExtractは同じentryを使う。
- フォルダー名と相対曲パスを表示。通常はPSF／MiniPSFだけを並べ、PSFLibは依存データとして保持する。PSFLib単体を渡した場合はLibraryと明示し、Playを無効にして従来のバンク抽出を維持する。
- Node／WASM／PSF／配布検証140件成功。最終ZIPでChromium／WebKit各9項目成功。1240px／390px・全5タブでの曲一覧表示、依存ライブラリーの除外、選択MiniPSFからのVAB抽出、Library単体、既存transport・PCM・Codeとの所有権を確認。
- 従来PSF／VAB browser回帰も両engine成功。依存関係・エラー／キャンセル・音色／preset保持と、移動したselectにfocusした状態での鍵盤演奏を確認。全出力gain0、実聴なし。両engine・両幅の画像に重なり・横はみ出しなし。
- 配布ZIP：`release/tetorica_spu_synth_psf-song-list-20261111_itch.zip`（314 files、6,759,136 bytes、SHA-256 `0347dbdbfd26c99312889238ab3e5a7de07306ffa58893379ac0d4389b8ea5f5`）。可読JS／CSS・既存PSFエンジンsourcekitを保持。276元入力と配信assetを照合済み。
- 詳細：[検証記録](spu_synth_song_list_verification_01.json)。commit／push／公開なし。
