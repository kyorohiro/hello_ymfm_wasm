# tetorica-vgm 0.2.13

2026-10-24。Analyzerの測定初期音量とPSG系の再調整を、CLIのWAV描画にも反映して公開する。
今回の公開対象は`tetorica-vgm`のみ。`tetorica-fm2612`は`0.2.26`を維持する。
2パッケージは互いへのruntime依存を持たず、同時公開は必要ない。

## 内容

- Analyzerと共通のchip Mixer初期値をWAV描画で使う。
- Sega PSG・AY・NESの矩形波基準をFMのAC RMSに合わせた初期値にする。
- OPN内部のFM／SSG／rhythm／ADPCM比率を維持する。
- YM2608の借用PCM経路でMixerのgain／pan／muteが実出力へ届くようにする。
- `tetorica-fm2612`の任意プリセットは別の公開物で、今回のAnalyzer専用補正は含めない。

詳しい値は[PSG系初期音量の再調整](analyzer_psg_levels_01.md)を参照。

## 配布物

- `tetorica-vgm-0.2.13.tgz`：250 files、826,372 bytes。
- SHA256：`2dbd1f5571ba8ce802852a6cde16a44ab2fe533dab3908b32096d852090e68b8`
- npm shasum：`993a0d6dc9dc18ad7b7abe834eae018985619e12`
- npm integrity：`sha512-nFb3Zz7+OMaRbOX+5nTQpnBKHBBtfCVPz7mYix//iKQmrVRqDxvNZbqRZcvdAeSIXDbZr1ZnvWLETiI+Jqgtkg==`

## 検証

- CLI／VGM／S98／SPCの16試験がすべて成功。
- tarballを隔離環境へオフラインインストールし、157 modulesの参照、SPC分析・音程指定・
  MIDI／MusicXML／LilyPond、CLI validation、VGM／S98の回帰確認が成功。
- public `readSource()`／`renderSource()`を使い、Sega PSG・AY・NES・YM2608 FM・SSGの
  5本のWAVが、配布物と作業ツリーでbyte一致。新初期値8種類も一致した。
  比較用の自作VGMは各440 Hz、44,100 Hz出力、0.4秒。警告・clipなし。
- 最終READMEの表現修正後に再packし、検証済みtarballとREADME以外の全payloadがbyte一致。
  最終tarball内250 filesとstageのbyte一致も確認した。
- 前段のAnalyzer検証は595件成功／既存の外部compiler依存1件skip、
  Chromium／WebKitのソース・配布stage確認が成功している。

```sh
node --test --test-concurrency=3 test/cli.test.mjs test/s98-cli.test.mjs test/spc-cli.test.mjs
node scripts/pack_cli.mjs --json
node scripts/check_vgm_spc_package.mjs ./tetorica-vgm-0.2.13.tgz
npm publish ./tetorica-vgm-0.2.13.tgz --access public --tag latest
```

## 公開状況

ブラウザー認証後、`npm publish`はexit 0、`+ tetorica-vgm@0.2.13`を返した。
registry処理完了後、`latest=0.2.13`とnpm integrityの一致を確認した。
公開tarballを再取得し、検証済みの最終tarballとbyte一致することも確認した。

[npm: tetorica-vgm 0.2.13](https://www.npmjs.com/package/tetorica-vgm/v/0.2.13)
