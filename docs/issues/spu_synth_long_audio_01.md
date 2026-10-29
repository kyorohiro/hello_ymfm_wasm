# SPU Synth: 長い音声をSoftware audioで演奏 — 2026-10-30

ユーザーがM4Aを読み込んだ際、`Audio exceeds free SPU sample RAM` で拒否された。
「普通に長いaudioを使えるようにしたい、20mbくらいの」という指示で対応。

## 動作

Load audioは32 MiBまでのファイル、デコード後30分までの録音を受け付ける。
ブラウザが対応する形式を44.1 kHzでデコードし、monoに変換する。
空きSPU RAMに入る短い音声は従来のADPCM経路を維持する。
入らない音声は自動的に**Software audio**へ切り替え、符号付き16bit PCMをホストメモリに置く。
長さを切り詰めたり、録音全体を短い周期波形に変換したりしない。

ソフト拡張であることをAudioタブの説明とサンプル名の横に明記した。
入力音声のADPCM変換は省くが、SPUコアのGaussian補間、ピッチ、ADSR、PMON、ステレオ音量、Reverbは引き続き使う。
24声（PMON時12組）は1つの録音を共有し、各声の再生位置は独立する。
Root／Loopは読み込み前に設定する。長い録音のLoopは末尾を落とさず全体を繰り返す。

読み込み状況・成功・エラーは、従来の上部表示に加えてLoad audioの直下にも表示。
Software audioのプリセットはversion 2で、PCMをlittle-endianのbase64として保存する。
従来のversion 1プリセットも引き続き読み書き可能。プリセットファイル上限は224 MiB。
Stop後も録音を保持し、別の長い録音への差し替えではホストbankを再利用する。
PCM描画やMorphへ切り替えた場合は録音を解除する。Noiseでは録音を保持したまま一時的に使わなくなる。

上限はすべての端末でのメモリ確保を保証するものではない。圧縮音声はデコード後に大きくなる。
M4Aのコーデック対応はブラウザのdecoderに従う。

## 実装とSDK

SDK原本へ任意C API `ps1_spu_set_host_pcm`／`ps1_spu_set_host_mask` を追加。
physical RAMと別のsample cacheを共有し、key-on時に選択する。
RAMの読み書き・512 KiB制限・既定のチップ再生経路は維持し、standalone Synthだけが新機能を使う。
ソース準備は読み込み時だけ。発音ごとの音声コピーやrender中のエンコードは追加していない。
WASMの初期メモリ32 MiBを維持し、必要時の成長上限を1 GiBに変更した。

固定SDKは0.1.7の未公開ローカル候補。base commit `9693c0b50f6d9f0321af7a0d1625a4d1ccd169e3`、455ファイル。
source archive SHA256：`0cb199b062017ecf30cd25dd2956a485cb92427c1f63d40564ea238c2c2bf0d0`。
SDK原本から正規package／importし、配布用source mirrorとWASMを更新。
共有JavaScript APIやTauriのSDKは変更していない。

## 検証記録

- 関連Nodeテスト215件成功。長い録音の調律、複数声、Pitch bend、ADSR、Reverb、PMON、Noise切替、Stop、PCMへの復帰、version 2保存／復元を含む。
- native fixture／ASan／UBSan成功。filter-zero ADPCMの実RAM再生とhost PCMが完全一致。24秒の録音を23秒まで進めても発音し、末尾で停止。
- SDK import整合性成功。配布sourceだけで再buildしたJS／WASMが同一。
- [通常ページのブラウザ検証](spu_synth_long_audio_browser_01.json)：Chromium／WebKitとも、20,971,564 bytesのWAV（約237.77秒）を読み込み、発音とversion 2プリセット保存／復元に成功。保存ファイル27,966,909 bytes。
- [最終ZIPのブラウザ検証](spu_synth_long_audio_zip_browser_01.json)：Chromium／WebKitとも同じWAVと保存／復元を確認し、さらに21,170,885 bytesのM4A（生成元760秒のAAC）を読み込んで発音に成功。物理出力はミュートして測定し、実聴は行っていない。
- [更新WASMの音量再校正](ps1_long_audio_chip_levels_01.json)：PS1 48条件＋YM2612 8条件成功。primary／extraとも従来gain 0.129331を維持。policy関連34テスト成功。
- 完成パッケージの再build、1097件のローカル参照、28 WASM engine、15 renderer、npm pack／install、385宣言と型検査成功。

## 試用ZIP

`release/tetorica_spu_synth_long-audio-dev_itch.zip`：45ファイル、5,492,465 bytes。
SHA256：`87a327a2cc6b9acc587272a40b810c1596f481b802ec98670455eb8eb77f4ffe`。

今回の長い音声対応は未公開。commit／push／公開は行っておらず、リリース済みの精度修正版ZIPは上書きしていない。
