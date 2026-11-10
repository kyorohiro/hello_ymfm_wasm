# FM2612 Synth：PCM Loop Endを発音中に変更（2026-11-10）

指摘：PCMのLoop Startは発音を保って変更できるが、Loop Endを変えると全音が停止する。Endの終端マーカーをRAMへ再転送するときにアプリが停止しているため、Startと同様に鍵盤を押したまま変更できるようにする。

- [x] End編集だけのRAM転送ではkeyOff／keyOnや再生位置のリセットを行わず、押下中の各CHを保持する。サンプル交換・初回準備は従来どおり安全に停止する。
- [x] 転送待ち・連続編集・Stop／サンプル交換・古いACK完了を扱い、古い処理が発音やready状態を復活させない。
- [x] Event Rec／LooperでもEnd編集の前後に保持中の音が続き、設定変更と録音再生の意味を揃える。Loop Offの終端による自然な無音化は保持する。
- [x] 説明・cache keyを更新し、実WASMと完全muteしたheadless browserで発音継続・移動後の終端・録音・Looper・停止を検証する。通常browser／native app／OS音量は操作しない。
- [x] 配布ZIPと再開記録を確認する。共有SDK／DSP／WASMは変更せず、commit／push／公開はしない。

実機のLoop Startはレジスタ、ここでのEndは0xff終端マーカーを使った編集UI。Endを動かした瞬間に波形が変わること自体と、Loop Offで終端へ達した音が無音になることは、強制Note Offと区別する。

## 実装・互換性

- `synth_pcm.js`：End変更ではRAMのrevisionだけを更新し、同じサンプル・endpointへの再転送中もheldと現在位置を保つ。Pitch・Note Offは転送待ち中も受け付ける。新規Note Onは最新RAMの準備後に行う。サンプル交換・新しいendpointへの初回installでは停止する。
- `synth.js`：End変更時の入力状態クリアを除いた。鍵盤を押したままマーカー／数値UIからStart／Endを変更できる。
- Event Recのtrackerと専用playerもEnd変更でheldを維持する。Use current soundはEnd変更を含む設定変更を無視する。サンプル交換に伴う停止は維持し、Looperのoffline生成にも同じplayerを使う。
- JSON形式はv1のまま。旧版で録音したEnd変更も、新版では発音を継続する。旧版の暗黙停止は明示的noteOffとして保存されていなかったため、その停止まで再現する必要がある場合は新たにnoteOff／stopを記録する。
- Loop Offで旧End後の無音位置に留まっているheld音は、End拡大でその位置へサンプルが戻ると再び鳴る場合がある。実WASMで確認したRAM書換えの動作で、keyOnによる再発音ではない。helpに記載した。
- cache keyは`pcm-live-end-1`へ更新。共有SDK／DSP／WASM／校正値は変更していない。

## 検証

- `node --test --test-concurrency=1 docs/synth/*.test.mjs`：389件成功。8CHのEnd短縮・拡大と直接RAM／register操作の波形一致、keyOn／keyOffの未発行、Loop Off、遅延転送・連続編集・離鍵・Stop・サンプル交換、Event RecとLooperでの継続を含む。
- Nodeログ：`/private/tmp/fm2612-pcm-live-end-node-20261110.log`。
- `scripts/check_synth_pcm_browser.cjs`：最終配布stageのChromium／WebKitで成功。2音を保持したままEnd短縮／拡大・Start変更を行い、入力ownerと物理channel maskの維持、keyOff／keyOn／start resetの未発行、片方ずつ離鍵したときの実stereo出力を確認。幅1240／390 pxで横overflowなし。
- `scripts/check_synth_pcm_recording_browser.cjs`：同stageのChromium／WebKitで成功。実際の録音中のEnd変更と、専用Workletでの通常再生／Use current soundの両方で、保持音の継続と本来のnoteOffによる停止を確認。既存のJSON・元音色保持・gain・取消の回帰も成功。
- `scripts/check_synth_pcm_looper_browser.cjs`：同stageのChromium／WebKitで成功。録音中のEnd短縮・拡大とStart変更でも保持音が継続し、offline生成したレイヤーの該当区間にも実PCMが残ることを確認。既存の重ね録り・Undo・停止／再開・音源保持・取消・RAM転送待ち中の即時Stopも成功。
- 上記のbrowserは全speaker接続をページ実行前からgain 0へ迂回し、Chromiumは`--mute-audio`も使用した。通常browser・native app・OS音量は操作せず、人による実聴はしていない。

## 配布候補・再検証

- `sh scripts/package_itch_synth.sh pcm-live-end-check-20261110`成功。373件のローカル参照を確認。ZIPは935,217 bytes／253 filesで、全fileがstageとbyte一致。
- ZIP：`release/hello_ymfm_wasm_pcm-live-end-check-20261110_itch_synth.zip`。SHA-256：`681ca832c47e096068bc140f33c8e1ebb54b8e35432a6141f35d85be6e71da9b`。
- stage：`release/itch_synth_pcm-live-end-check-20261110`。
- 3つのbrowser検証が取得した全assetsは、それぞれZIP内のbytes／SHA-256と一致した。通常編集129件、Event Rec130件、Looper131件。page error・欠落asset・外部通信なし。
- 記録：`/private/tmp/fm2612-pcm-live-end-{browser,recording-browser,looper-browser}-20261110.json`、`/private/tmp/fm2612-pcm-live-end-package-proof-20261110.json`。

```sh
node --test --test-concurrency=1 docs/synth/*.test.mjs
sh scripts/package_itch_synth.sh pcm-live-end-check
node scripts/check_synth_pcm_browser.cjs --root=release/itch_synth_pcm-live-end-check --entry=/index.html
node scripts/check_synth_pcm_recording_browser.cjs --root=release/itch_synth_pcm-live-end-check --entry=/index.html
node scripts/check_synth_pcm_looper_browser.cjs --root=release/itch_synth_pcm-live-end-check --entry=/index.html
```

## 残り

- [ ] 人による実聴：内蔵波形／実WAVを押しっぱなしにし、Start／End変更、Loop Offでの終端と拡大、録音・重ね録りの聴こえ方を確認する。瞬間的な波形変更によるクリックと、強制的なNote Offを区別する。

commit／push／公開は未実施。
