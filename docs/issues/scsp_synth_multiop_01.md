# SCSP Synth 4／6-operator FM — 2026-10-31

- [x] PCM／2／4／6-opの音色モデルとChain／Pairs／Branch接続。
- [x] A〜Fの独立PCM・EG・LFO・mix、operator別ratio、共通MDL。
- [x] 同じcanvasで編集対象切替、接続と出力operatorを表示。
- [x] 6 source slots予約。PCM26／2-op13／4-op6／6-op4 voices。全operatorを一組として離鍵・steal。
- [x] live ratio／depth／Pitch／mix／LFO、PCM保護、不正変更時の演奏保持。
- [x] v3 presetに6 PCM・接続・ratioを保存。v1／v2読込互換。
- [x] 実WASM、最終destination出力を両browserで検証、配布ZIP作成。

接続はソフト側の固定プリセット。各slotは実SCSPの2入力以内、先行slotのみ参照し、feedbackは今回含めない。
Chainは全段直列、Pairsは2-op組の並列出力、Branchは最大2入力の木。
6個の編集元を予約するため従来版より同時発音数が減る。Voice mode／接続変更は検証後に全音停止。
FM入力を受けるoperatorにはfull forward loopが必要。guardは各operatorに自動配置する。
旧2-opのratioは全modulatorの初期値に移行し、各operatorで個別調整できる。
共有Playground／SDK／Native／npmは変更・公開しない。旧ZIPは保持。


## 操作・完了記録

Start audio → Voice modeを4／6-operator FM → ConnectionをChain／Pairs／Branchにする。
A〜Fを選び、同じcanvasで波形を編集・Apply。Selected operator ratioは選択中の比率。
All modulator ratiosはAを1、B〜Fを指定値にリセットする。比率はFMのみ有効。
接続欄で全edgeとOutput operatorを表示し、Output以外のdirect出力を自動的に消す。
operatorのDirect level設定自体は保持するため、別の接続でOutputになった際に適用できる。

実WASMのNode **15件成功**。4／6-opの全接続、各段の音への寄与、group steal／release、
個別ratio／Pitch／mix／LFO、held PCM保護、不正設定とRAM満杯のatomic拒否、v3往復PCM一致、
v1／v2互換、2／4／6-op × 44.1／48／96kHzのrender分割一致・Stop／接続変更時の無音を確認。
最終ZIPを展開し、**Chromium／WebKit両方で成功**。Volume通過後のdestination信号でPCM／FMの発音と
Volume mute／復帰を検証。単一canvas、全接続、operator比率、v3保存再読込、旧v1／v2、
blur／Stop／再接続、WAV、390px overflow 0。page error／欠損／外部requestなし。
物理出力はmuteしているため人の試聴は未実施。

配布：`release/tetorica_scsp_synth_multiop-dev-20261031_itch.zip`（36 files、1,182,220 bytes）。
SHA256：`a15f6de5e922af219779ca91c789c509c1ae69ea2eb9ab64fd93b44b9ac34ca6`。
[最終browser report](scsp_synth_multiop_browser_01.json)／[source・ZIP集約記録](scsp_synth_multiop_01.json)。
配布ZIPのauthenticated original inputsと現在のsourceが全一致することを確認した。
共有runtime／Playground／SDK／WASMは差分なし。両校正policy generator --checkも成功。
公開npm・旧ZIPを保持し、公開・commit／pushはしていない。次は人の試聴。
自由なgraph／feedback／実機timing精度／DSP／専用Synth Nativeは別作業。
