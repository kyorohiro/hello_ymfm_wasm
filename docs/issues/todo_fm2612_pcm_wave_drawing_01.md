# FM2612 Synth PCM：波形の描画編集（2026-11-11）

依頼：既定のStart／End位置指定を維持し、PC Engine Synthのように同じcanvasへ描いてPCM波形を変更できるようにする。

- [x] 既存のPCM preset／共有RAM／Code／録音・Looper・保存経路とHuC6280の描画操作を確認する。
- [x] Sample表示にRange（既定）／Drawの切替を追加。同じcanvasを使い、マウス・touch／penで振幅を描けるようにする。新しい画面やselectで演奏用キー入力を奪わない。
- [x] RF5C164のsign-magnitudeと予約値0xffを尊重し、飛んだpointer位置の間も補間する。sampleRate・Root・長さ・Loop設定と描画外のデータを保つ。
- [x] 描画中はpreview、pointer releaseで一度だけ既存のsample変更処理へ反映。cancel／lost capture／blur／mode・表示・音色切替／Live移行では未確定の描画を破棄する。描画はsoftware編集であることと、適用時に保持音が止まることをUIのhelpで示す。
- [x] 編集結果を既存preset／Files／Cassette／Code／Event Rec・Looperへ接続し、Liveはread-onlyを維持する。必要な使用説明・cache revision・配布依存リストを更新する。
- [x] 意味あるNode／実WASMとheadless Chromium／WebKitで無音検証し、通常のSynth配布ZIPを検査する。ブラウザは全destination接続をアプリ読込前にgain 0へ通し、Chromiumはmute指定。通常ブラウザ・実聴・OS音量変更はしない。

実装・関連Node検証・Chromium／WebKit検証・通常Synth dev ZIPの再生成／照合まで完了。commit／push／npm公開／itch.ioへのアップロードは行わない。

## 実装と動作

- Sample右上の `Edit: Range / Draw`。起動時はRange、同じcanvasで切り替える。Waveform／Spectrumでは編集mode UIを隠し、VGM Live／Files処理中は編集不可。
- 描画中だけdraftの波形を表示。離した時に既存 `applyPcmEditPreset()` へ1回渡し、保持音を止めて共有RAMへ適用する。設定値・範囲・描画外のbyteは保つ。何も変わらなければ適用しない。
- Escape、pointercancel、lostpointercapture、window blur、表示・タブ・音色・Live・サイズの変更で未確定の一筆を破棄。現在の設定変更は確定時にも保持し、別音源へ古い一筆を上書きしない。
- `synth_pcm_wave_edit.js` は純粋なsoftware editor helper。描画の量子化は符号＋振幅0..126で、予約0xffを生成しない。既存のsample codec／C++／WASM／preset schemaは変更しない。
- Files／JSON／Cassetteで編集内容を保存・復元。Codeの共有PCMも既存sample変更経路で更新する。録音済みtake／Looper layerは自身が保存したサンプルを保つ。

## 検証

- Node関連150件成功（PCM、実WASM出力配列、Files／project、録音・Looper、Code）。ログ: `/private/tmp/fm2612-pcm-wave-drawing-node-20261111.log`。
- 実配布候補のheadless Chromium／WebKit双方で成功。draft中はexport／RAM／保持音を変更せず、releaseで1回upload。両方向補間、取消、元データ保持、保存往復、Liveのread-only、既存Range保持音、FM／PSG非退行を確認。
- 全destination接続をアプリ読込前にgain 0へ通し、Chromiumもmute指定。実聴・OS音量操作・通常ブラウザ利用なし。
- Browser receipt: `/private/tmp/fm2612-pcm-wave-drawing-browser-20261111.json`。390px／1240pxの画像と横overflowなしを確認。
- 配布変更はSynth ZIPへ新helperを1件追加するのみ。PlaygroundはPCM editorを収録しないため変更不要。共有runtime／npm／校正receipt・補正gainは変更しない。

最終配布照合成功：`release/hello_ymfm_wasm_dev_itch_synth.zip`（283 files）、SHA256 `c70933b22028a2a3e2ee0b2dd23dfabfb7744815ddf040d1994ea391408b1283`。検証したcandidate／通常dev stage／ZIPの全ファイル一致、およびbrowserで実際に配信した153 assetsのSHA一致を確認。恒久記録は [fm2612_pcm_wave_drawing_verification_01.json](fm2612_pcm_wave_drawing_verification_01.json)。
