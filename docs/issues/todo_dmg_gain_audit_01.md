# DMG VGM再生：音量補正／歪みの確認（2026-11-13）

FM2612への横展開より先に、ユーザーがDMG SynthのVGM再生で感じた音割れを調査する。今回は確認・計測を行い、音量設定や製品コードは変更しない。スピーカー出力は行わない。

- [x] Playground Main／Worker／Native／AnalyzerとDMG Synthの補正値・Master経路・保存済み設定の扱いを整理する。
- [x] 配布中WASMの内部加算と正規化を調べ、内部clipの有無を実PCM・独立CH加算・NR50比で確認する。
- [x] Synth初期設定・NR50最大・4CH最大・Master上限を計測し、最終出力が±1を超える条件を求める。
- [x] ユーザーのVGMとMaster値が得られれば同じ条件でピーク／上限超過率／DCを測る。未提供なら一般的な上限と実ファイルの結論を分ける。
- [x] 検証記録を残し、補正の有無・測定上のclip・未確定な点を報告する。

対象はDMG SynthのVGM再生。添付は `/Users/kyorohiro/Downloads/Final_Fantasy_Legend_II_(Game_Boy)/01 The Legend Begins.vgz`。Masterの実設定値は未提供のため70／100／200／380%で比較。計測スクリプトと結果は `build/verification/dmg-gain-audit-20261113/` に保存する。実音の出力・修正・commit／push／公開は行わない。

検証完了：音量補正は有効。添付曲全体54.903秒の生ピーク0.75、計算上Master70%=0.147／100%=0.210／380%=0.798、全曲の上限超過0件。WASM内部の4CH加算も線形で内部clipなし。

一方、通常負荷のheadless Chromium／WebKitで、実時間AudioWorkletによる独立PCM計測でも追加の瞬間ピークを再現した。Master380%のpeakはそれぞれ1.596／1.229で±1超過あり。70%のpeakは両方0.196で±1超過なし。従来のAnalyser計測と一致し、Analyserだけの異常値ではない。測定tapのOffline校正は正常、単純な分割／44.1→48k変換のOffline対照でも再現せず、通常再生の予約late/gap/overlapは0だったため、正確な発生機序は未確定。

詳細は [検証記録](verification_dmg_gain_audit_20261113.json)。今回は確認のみで、製品・音量・WASMは変更していない。全出力はgain0、実聴・音声書出しなし。

次の修正候補（未着手）：

- [ ] 同じ曲の実時間PCMで、raw source → reference gain → songInput → Masterの各地点を照合し、余分な瞬間ピークが生じる場所を特定する。
- [ ] 発生機序に合うVGM再生経路の修正を行い、音量係数を安易に下げずに元のPCMと最終出力の整合を取る。
- [ ] 実曲・synthetic連続信号のlive AudioWorkletメーター回帰を追加し、VGMと手動操作の共存・Pause／Seekも確認してからFM2612へ横展開する。
