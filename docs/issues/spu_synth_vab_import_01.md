# SPU Synth: 標準VAB音色インポート — 2026-10-30

ユーザーの「進めて」により、[音色インポートTODO](todo_spu_synth_import_01.md) の第一段階を実装。
PSFからの抽出は後続。実ゲーム由来のバンクでの対応率は未検証。

## 操作

Audio → **Open VAB / VH + VB…** → ファイル選択 → Tone選択 → **Load selected Tone** → 鍵盤で演奏。
一体型VABは1ファイル、分離型はVHとVBを同時選択する。Program／Tone番号は0始まり。
バンクを開くだけでは現在の音色を変更しない。読み込んだ音色は通常のSave presetで保存できる。

## 実装

- `docs/synth-spu/spu_synth_vab.js` にSony形式v6／v7の純粋パーサーと単一Tone準備処理を追加。
- 疎なProgram番号と詰められたTone表を区別し、サイズ表のentry 0によるVB先頭予約も扱う。
- ファイル長、各表、サンプル境界、音程・音量値、鍵域・サンプル参照を検証する。
- 各サンプルのサイズ表内で初回ENDを探し、そのパケットまでを元のADPCMのまま渡す。
  デコード／再圧縮も制御フラグの書き換えも行わない。
- 元のADSR1／2とループ位置を使用。正のfine shiftは再生ピッチを上げる向きに変換する。
  連続的な半音計算を使い、特定ドライバの整数pitch表とのビット一致は保証しない。
- 音量はbank／Program／Toneを合成、panは各段の減衰を合成する静的近似。
  ゲームのvelocity／controller値は不明。Reverb sendはTone modeを使い、共有preset／returnは現在値を維持する。
- Tone読み込みで発音を止め、PMON／Noise／MorphをOffにして全24voiceへ同じ音色を適用する。
- 同一バンク内の同一サンプル・音程の再選択はRAMを再利用する。エンジン再起動時は古いcacheを使わない。
- 不正なToneは停止・音色変更前に検証。asset世代チェックで新しい読み込み／resetを優先する。
- ZIPにはブラウザ用READMEも同梱する。

## 初期対応の制限

- 単一Toneを全鍵域で演奏。鍵域分割・複数Toneの重ね音、vibrato／portamento、曲再生は未対応。
- sample 0（未割当）と255（libsnd Noise）は一覧に残すが、そのToneの読み込みを明示的に拒否する。
  同じバンク内の通常Toneは読み込める。
- 複数LOOP START、one-shotでのLOOP START、既存ADPCM APIが扱えないpacketは拒否する。
- SPU RAMを使う。異なる音程設定や再オープンしたバンクは新規確保になる場合があり、残量不足なら保存後にページ再読み込みが必要。
- PSF／MiniPSF／PSFLib、VAB v5以前や独自形式は未対応。実ゲームのVABはまだ試していない。

## 検証

オリジナルの合成バンクを使用。ゲーム音源は同梱しない。
疎なProgram、共有サンプル、微調整、ループ、one-shot、VB先頭予約、END後paddingを含む。
パーサー異常系と実WASMの音程レジスター・PCM・preset往復を検証する。
ブラウザでは実UIを操作し、実AudioWorkletのPCMを取得する。物理出力はミュートし、実聴は行わない。

最終結果：[検証JSON](spu_synth_vab_import_01.json)。

- `npm run test:spu-synth`：67 tests成功（VAB用8 testsを含む）。
- `check_spu_synth_browser.cjs`：ソース版と新規展開ZIP版、それぞれChromium／WebKitの計4経路で成功。
  元ADPCM、fine tuneの実PCM、VH＋VBの逆順選択、preset往復、RAM再利用、selectのfocus中のPC鍵盤演奏を確認。
  不正ファイル／packetの拒否後も保持中の音が継続すること、モバイル幅での表示も確認。
- 途中の検証中にソースを編集した実行は整合性チェックで失敗したため、最終ソースを固定して全経路を再実行し成功した。
- source付き試用ZIP：`release/tetorica_spu_synth_vab-import-dev_itch.zip`、46 files、5,509,892 bytes。
  SHA-256：`334eca2ecfd1835ea7732a8b92184f6bcd4b69498d74997d86b5d58131ab9134`。
- 試用用の合成バンク：`release/spu-synth-demo.vab`。ゲーム由来データを含まず、上記fixtureと同じ内容。

未公開。npm公開、Web deploy、git commit／pushは行っていない。実ゲームのVAB確認はTODOに残す。

## 参照

- [VGMTrans VABパーサー](https://github.com/vgmtrans/vgmtrans/blob/master/src/main/formats/PS1/Vab.cpp)
- [PSX-SPX VAB資料](https://psx-spx.consoledev.net/cdromfileformats/#vab-header-vh)（countに曖昧さがあるため実装も照合）
- [libsndのpitch処理](https://github.com/Xeeynamo/sotn-decomp/blob/master/src/main/psxsdk/libsnd/vmanager.c)
- [libsndのVABヘッダー処理](https://github.com/Xeeynamo/sotn-decomp/blob/master/src/main/psxsdk/libsnd/vs_vh.c)
