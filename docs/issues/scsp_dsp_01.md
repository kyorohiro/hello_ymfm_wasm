# SCSP DSP・Synth UI整理 — 2026-10-31

後続：[初期Delay効果量の修正](scsp_dsp_level_fix_01.md)。最新配布はそちら。下記は初回実装時の記録。

- [x] 固定SCSP DSPの独自microprogramでDelay入出力を検証する。Web Audio DelayNodeではなくSCSP core内で処理。
- [x] Playground内のDSP Labで短い音・Delay・Send／Return・Feedbackを試す。
- [x] DSP ring専用RAMとPCMの領域を分離し、編集・preset読込・Stopで残響や破損を残さない。
- [x] SynthへEnable／Delay time／Feedback／Send／Returnを追加。設定はpresetへ保存し旧presetはOffで読み込む。
- [x] SynthのVoice／DSP／Operator編集を分け、接続図と単一canvasの編集対象を連動させる。
- [x] 実WASMのimpulse／反復減衰／RAM保護・render分割、最終destination出力を両browserで確認。
- [x] 配布ZIP、README、再開用記録を更新。

まずmono Delayを1本。Reverbは次段階でmicroprogram・RAM・係数を別途設計する。
SDK snapshotは編集せず、現固定core上の結果を検証する。実機一致は主張しない。
PlaygroundのDSP Labは専用の実験ページとして分離し、既存のMain／Worker／Native共通APIへの公開は後続。
参照：SEGA SCSP manual、DSP assembler programming guide、固定SDKのscspdsp.cpp。


## 後続（今回のDelayとは別）

- [ ] Reverbのmicroprogram・係数・RAM配置、Decay／Sizeなどの操作を設計する。
- [ ] 共通JavaScript API・型・Playground Main／Worker・Nativeへ公開する。現在は専用Synthと独立DSP Labのみ。
- [ ] Native／WASMのDSP出力一致と実機比較を拡張する。
- [ ] 全operatorのDSP Send／Return先やstereo effectのルーティングを設計する。

参照：
- https://antime.kapsi.fi/sega/files/ST-077-R2-052594.pdf
- https://docs.exodusemulator.com/Archives/SSDDV25/segahtml/sndt/tool/dasm/hon/p06_10.htm


## 完了・操作・検証

Synth：Start audio → **SCSP DSP · Delay → Enable Delay**。
Time／Feedback／Send／Returnは発音中も変更できる。Time／Enable変更は残響だけをクリアし、現在のvoiceは維持。
通常の離鍵は残響を残す。Stop／mode／Connection変更はvoiceと残響を消す。
先頭64KiBを常時予約してDSP ringへ使い、PCM／guardは残り448KiB。予約領域は波形一覧に表示せず、編集page再利用からも保護する。
SCSP floating PCMの無音は`0x6000`。ゼロbyteでclearするとDC音になるため、packed silenceを明示的に書く。

独自6-step programはMIXS0 → delay ring → EFREG0。入力は現在の接続でOutputになっているoperatorだけ。
Send／Returnはhardware level 0〜7、Timeは20〜700ms、Feedbackは0〜0.85。
Delay feedbackとOPのFM feedbackは別機能。DSPのDelayは固定core内で処理し、Web Audioはgainと出力に使う。

UIはVoice／SCSP DSP／Operatorsへ整理し、接続図のA〜Fボタンが単一canvasの編集対象と連動する。
自由配線のInput X／Y・Depth・独立Output・slot割当・世代サンプルとFeedbackは[FM後続TODO](scsp_fm_followup_01.md)。
DSP共有セクションと選択operator詳細を分ける方向を記録した。自由配線自体は今回実装していない。

[Playground DSP Lab](../playground/scsp-dsp.html)：Start audio → Play short tone。Dry outputをOffにするとwetだけを確認できる。
Labは独立した専用実験ページ。通常PlaygroundのRun／Main／Worker／NativeへのDSP公開は別TODO。
Synth footerから開け、専用Synth ZIPにも同梱している。

presetはversion 4でDSP設定を保存。旧v1／v2／v3はDSP Offで読み込む。
64KiB予約後の総RAMで全体を事前検証するため、予算超過や不正effect設定でも現在の演奏を止めない。
旧presetの中でも448KiBを超えるPCM／guardは短縮が必要。

Node **19成功**。実WASMで20ms impulse、Feedback 0の単一echo、約1/2で減衰する6反復、
無入力のDCなし、ring外の波形不変、Outputだけのsend、voice維持、Stop完全無音、v4音声一致、
不正preset拒否、2／4／6-op × 44.1／48／96kHzのrender分割一致を確認。
最終ZIPを実際に展開し、SynthとLabの両方を**Chromium／WebKitで成功**。
測定はVolume後のdestination入力。wet-only／bypass／Return mute／tail／Stop／再Enable、
旧v1／v2／v3、単一canvas、390px overflow 0、page error／欠損なし。
[集約source・配布hash](scsp_dsp_01.json)／[Synth report](scsp_dsp_synth_browser_01.json)／[Lab report](scsp_dsp_lab_browser_01.json)。

最終ZIP：`release/tetorica_scsp_synth_dsp-delay-dev-20261031-checked_itch.zip`
（38 files、3 bundles、1,196,232 bytes）。
SHA256：`a0ccb41399678f6f5ae1803489fca250ea581c4fd694adc80187bb3ba67b133d`。
ZIPのauthenticated browser inputsと現在のsourceの全一致を確認。旧ZIPは保持。
共有`web/`／`docs/js/`／固定SDK／WASMは差分なし。既存の校正policy generator両方も--check成功。
DSPの一般的な実機一致、Reverb、Native DSP比較、人の試聴は未実施。物理出力はmute。
公開npm／通常Playground配布は変更せず、commit／push／公開はしていない。
