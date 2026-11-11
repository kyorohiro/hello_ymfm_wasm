# SPU Synth：PSF Noise CHのPause試奏・Capture（2026-11-12）

- [x] PSF snapshotのNoise mask／Clock・ADSR・左右音量・reverb sendを、既存Noiseモードへ安全に対応付ける。NoiseではReference key／PITCHを音高として扱わず、波形RAMの有効性も要求しない。PMON carrierの単体Capture制限は維持する。
- [x] 共通Capture helperからportable Noise presetを生成する。必要な無音loop用データは明示した固定データとし、元PSFのADPCMを抽出したと表示しない。新しいkey-onからADSRを開始し、Noise LFSR位相はコピーしない。
- [x] 一時checkpointを使うPause試奏でもNoiseを有効にし、Clock／ENV／Note Off・和音・切り替え・Resume・Code・元音色復帰の所有権を保つ。private borrowed-client APIが必要なら既存公共APIを変えずに追加する。
- [x] UIでNoiseのCaptureを許可し、Reference keyをNoiseでは無効化する。Clockと音階の違い、共有reverb保持、PMON制限を既存「?」へ明記する。
- [x] 実WASM／NodeとChromium／WebKitの無音headlessでNoise Capture／試奏／保存・再読み込み、ADPCM回帰とPSF状態不変を確認する。
- [x] README／可読ソース付き配布ZIP／検証記録を更新する。commit／push／公開は行わない。

通常browser／native app／OS音量は操作しない。headlessはアプリ起動前からdestinationをgain 0へ遮断し、Chromiumはmuteを併用する。Noise Clockは質感の制御で、鍵盤音高ではない。NoiseとPMONの同時flagは、変調元を含めない単体Captureの対象外とする。

完了：関連Node 488件成功（Capture helper 12／Pause controller 19／audio・実WASM 47件を含む）。Capture／Live／Pause試奏の3系統が最終a ZIPでChromium／WebKitとも成功。Noise-onlyの元PITCH／Start／Repeatが0でもClock37でCaptureでき、実鍵盤C2／C5ともPITCH4096とNON・Clockを保持した。JSON保存・再読み込み、共有reverb保持、ADPCM／容量エラー／Codeの回帰も成功。物理出力gain 0で、実聴なし。

Noiseは固定64-byte無音loopを補助データとして使う。元ADPCMの抽出、実行中のLFSR／ADSR位相の複製はしない。同時点payloadの512 KiB RAM形状は既存transport契約として必要だが、Noise分岐でその波形byteは参照しない。private Noise sample bindingはleaseごとのobject参照とし、clearRam／endCode／disposeで解放する。

検証記録：[spu_psf_noise_capture_verification_01.json](spu_psf_noise_capture_verification_01.json)。配布ZIP：`release/tetorica_spu_synth_psf-noise-capture-20261112-a_itch.zip`（335 files、SHA-256 `6d6bf551adc6a6d08994cad15d61dde54c52504425e61125dc3abba033ea2fac`）。Native SDK／WASM／PSF ABI 4は変更していない。
