# SCSP PCMファイル入力・編集RAM再利用 — 2026-10-30

SCSP panelに音声ファイル入力と明示的な区間選択を追加した。
WAVは既存PCM parser、M4A等は既存offline decoderで読む。
64 MiBまでの元録音をhost側に保持し、start／end秒・selection rate・手動root MIDIを指定して
Use selection → Apply PCM → 新しいnoteで試せる。音程の自動検出や自動normalizeはしない。
Stereoは平均してmono。read／trim時点ではSPU RAMやlive audio deviceに触れない。

1つのsampleはSCSP APIの2..65,535点まで。44.1kHzなら約1.486秒。
長い録音全体を1voiceに無条件uploadする機能ではなく、必要な区間を選ぶ。
低いselection rateで長くできるが、出力点数・hardware pitch・RAMの制約は通常どおり検証する。
超過やdecode失敗時は以前の録音／waveform／bankを維持する。
同時decodeの古い結果、dispose後の結果は世代tokenで拒否する。

## 編集pool

通常の`loadPCM`の永続allocationは維持した。
内部`ScspSynth._editPCM`だけが、2の冪サイズのeditor pageを確保・再利用する。
入力・pitch・loopの全検証を終えてからRAMへ1回書く。

- 別slotのpresetが指すpage、実際の発音元`#playing`が指すpageは再利用しない。
  requested gateがOffでもreleaseは保護し、Stop／同slot再triggerまでpinする。
- Workletでperformance sessionが実行中の間は、batch未着でもApplyを変更前に拒否し、Stopを案内する。予約済みpreset／noteと波形変更を競合させない。
- 再利用可能なpageがなければ追加確保し、RAM不足は変更前に拒否する。
- 再利用時は旧editor handleだけを失効させ、新しい単調増加IDにする。
  Main／Workerのprojectionへ編集slotのdeltaと実発音元IDを同期する。最初のApplyやlive pitchも、旧sampleを使った誤検証にならない。
- poolは縮小しない。RAM counterは予約capacityを含む。
  共有slotの音を変えず、Stop後はidle編集pageを再利用できる。全解放はclearRam。

個別page返却／compaction、一般のloadPCMのfree APIは追加していない。
Copy voiceは適用済みPCMをordinary loadPCMで再生成するため、editorの一時IDには依存しない。
Native SDK pin／C++／WASM／PCM render mathは変更していない。

## 検証と記録

[実ブラウザ結果](scsp_pcm_files_browser_01.json)：Chromium／WebKit × Main／Workerで、
20 MiB超の自作120秒stereo WAVを読み、5..5.25秒だけを切り出して発音。
実M4A（自作440Hz）もdecode／selection／Apply／発音を確認。
readとselectionだけではRAM不変、13回のApplyでもidle allocation量が一定。
従来のKeyboard／EG／Copy voice／Mixer／FX／suspend-resume／Stopも通した。
全physical outputは常時mute。人間の試聴や実機比較ではない。

Nodeでは100回の再利用、共有／release保護、full RAMのatomic rejectionとStop後の再利用、
queued presetの保護、Worker projectionの同期、長いWAV・downmix・resample・oversize拒否を確認。
旧UIのexact-hash監査は、旧receiptに一致するgzip fixtureを使い履歴として保持した。
現在の配布source freshnessは、新しい全測定reportで別途確認する。
旧measurement JSONは上書きしない。

## 再実行

```sh
node --test web/scsp_sample.test.mjs web/scspsynth.test.mjs web/playground_scsp_worklet.test.mjs
ffmpeg -v error -f lavfi -i sine=frequency=440:duration=1 -c:a aac -b:a 128k -y /private/tmp/scsp-import-test.m4a
node scripts/check_playground_scsp_browser.cjs --compressed /private/tmp/scsp-import-test.m4a --out /private/tmp/scsp-pcm-files-browser.json
```

## 最終配布検証

関連Node **106 tests**・全Playground mode型が成功。
npm buildは343 modules／394 declarations。実tarballを一時consumerへinstallし、
新helper・実SCSP WASMのPCM・100回のpool再利用・旧音源・ブラウザimport・型を確認。
Tarballは2,048,534 bytes／1,047 files。

PS1・WonderSwan・POKEY・SCSPを最終sourceで新規reportへ再測定した。
`ps1_scsp_pcm_chip_levels_01.json`／`wonderswan_scsp_pcm_chip_levels_01.json`／
`pokey_scsp_pcm_chip_levels_01.json`／`scsp_pcm_chip_levels_01.json`。
SCSPは`scsp_pcm_chip_levels_verify_01.json`でも生成済みpolicyを全48経路＋8 FM anchorで再検証。
pilot PCMは連続、Stop後0、適用期待値との差はpeak最大約0.0054%、AC RMS約0.057%。
source freshnessは現在の完全なraw hashで確認した。旧校正JSONは変更していない。
SCSPの係数は両経路0.128826、POKEY primary／extraは0.413052、dualは0.413051。
前回からの丸め差はSCSP＋0.000001、POKEY primary／extra＋0.000002。
PS1 0.129331、WonderSwan 1.172528、旧153件のtargetは維持。

専用`release/*scsp-pcm-files-dev-20261030*`を作成し、**実Run ZIPを展開したもの**で
Chromium／WebKit × Main／Workerの全4経路を検証した。Run ZIPは**965 entries**。
WAV／M4A、RAM再利用、Stop後Apply、既存操作が成功。
ZIP検証harnessは、minify後もruntime参照を取得できるようWorker timing UIの束縛名を特定する。
配布appの動作を変える処理ではない。
[配布・report hashと検証集計](scsp_pcm_files_01.json)。

旧releaseファイルは保持した。公開、npm publish、commitは実施していない。
