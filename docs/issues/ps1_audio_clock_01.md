# PS1 Browser音声: currentFrameと実PCMの連続性を分けて検証する

2026-10-28。[SDK／Native接続時のBrowser失敗](ps1_sdk_native_01.md)の追跡。前回の失敗ログは保持する。今回の対象はテストの連続性判定であり、製品のJS／C++／WASM、SDK pin、Tauri、Mixer gain、npm versionは変更しない。commit／push／公開は行わない。

## 判明したこと

Chromiumでは、PS1を含まない最小AudioWorkletでも、処理中のglobal `currentFrame`が1 quantumだけ重複し、次の呼び出しで追いつく挙動を観測した。その間も、独立して生成したカウンターPCMは全sample連続していた。したがって、`currentFrame !== firstFrame + copiedFrames`だけを、PCMの欠落・重複と同じ失敗条件にするのは適切でなかった。

これは今回のデータに基づく判断であり、Chromiumの実装原因や既知issueを特定した意味ではない。[Web Audio仕様のcurrentFrame](https://www.w3.org/TR/webaudio-1.1/#dom-audioworkletglobalscope-currentframe)は別途参照し、観測したglobal clockの不一致自体は診断情報として残す。

## PS1を使わない対照試験

物理出力直前のGainを常に0に固定。`sum → zeroGain → destination`と並行して`sum → capture → zeroGain`を接続し、音源に含めない独立カウンターを収録した。

- 起動時の32条件: Chromium／WebKit各16条件、44.1／48kHz、Oscillator／カウンター、追加Oscillator／追加AudioWorklet／追加なし。Chromiumの11条件で`0 → 384`（期待128）から+256の差を観測。WebKitは16条件すべてclock不一致0。各Browserのカウンター12条件は全sampleで欠落・重複0。
- 起動後300msを待った54収録窓: Chromium・48kHz、18条件×3窓、各48,000frames。並列／直列グラフ、追加なし／OscillatorとAudioWorkletの追加・停止・切断／AudioWorkletの切断だけを比較した。
- 54窓中3窓で、起動直後とは別の`83072 → 83072 → 83328`型の変化を観測した。最初の重複は期待値より-128、次は+256で追いつく。並列／直列の両方で再現した。
- 全**2,592,000カウンターsamplesの欠落・重複0**、各quantumの入力長128・カウンター増分128を維持。`currentTime`は`currentFrame / sampleRate`と一致し、process内の4回のclock読み取りも一致した。
- 不一致窓は再試行で破棄していない。全窓の結果と、不一致の前後8行を保存した。集計とraw report／診断コードのSHA256は[JSON](ps1_audio_clock_01.json)に記録する。

## 実PS1と旧版の比較

- 実PS1 AudioWorkletで、旧版／現行×direct／Worker×44.1／48kHzの8条件を収録。primaryは左、追加SPUは右、別入力に独立カウンターを接続。各196,608framesとStop後4,096framesを確認した。
- 8条件すべてfinite PCM・カウンター連続・Stop後左右exact zero。追加SPUを2回ずつ破棄した後の計16窓は、primaryを保持したまま追加SPU側がexact zeroだった。
- primaryの隣接sample最大差は旧版／現行で一致した。44.1kHzは`0.003143118694424629`、48kHzは`0.002887740731239319`。この試験の8条件ではglobal clock不一致も0だった。
- 試験で使用したPS1 WASM JS／binary、PS1 audio／worklet、performance senderは旧版／現行で同じSHA256だった。旧版は`/private/tmp/ps1-clock-before-sdk-native/docs`を別展開して比較した。
- 旧判定の公開UI checkerでも、旧版／現行のChromium Workerが今回それぞれ完走した。これだけで前回の失敗を消さず、発生が確率的である証拠として扱う。初回の現行UI試行は並行診断負荷下でPCM描画metadataのassertionに失敗したため、clock問題の根拠には使わず、失敗ログを保持した。

実PS1 raw reportは約27MBのPCMを含むためリポジトリへ丸ごと複製しない。JSONに全8条件の集計、各PCMのSHA256、破棄後16窓、原report hashを保持する。

## テストの修正

- 共通の`audio_clock_audit.cjs`で、`currentFrame`から独立した24bitカウンターPCMとclock診断を収録する。
- PS1 voice UI checkerは別入力のpilot PCMでsampleの欠落・重複、長さ、finite性を検査する。pilotは製品の音声mixへ入れず、物理出力もmuteする。
- `currentFrame`の不一致は`clockContinuous`と詳細rowへ残す。削除・再試行による隠蔽や、無音だけを理由にした成功扱いはしない。
- 音程・倍音・ADSR・wet tail・Keyboard・Stop・別声保持などの既存PCM条件は維持し、試験内の全captureへ独立PCM検査を適用する。reportはschema 3へ更新する。
- 破損したpilot、欠落／重複、長さ不一致、非有限値などを拒否する負例と、音源非依存のportable Browser診断を追加する。

## 最終検証

- 共通helperの**18件成功、失敗・skip 0**。128frameの欠落・重複・zero挿入、全zero、短い／欠けた入力、非有限値、counter wrap、65,536frameのskip、clock row破損等を拒否する。clockが-128変化しても実PCMが連続する対照も検証した。
- portable診断はChromium／WebKit×6構成×3窓の**36窓／1,728,000samplesでpilot PCM連続**、測定row有効、process内clock読み一致、processor error 0。Chromiumの並列・AudioWorklet切断だけの構成の3窓目で、row160に`actual136832 / expected136960 / previous136832`を観測した。reportは`passed:true, pcmContinuous:true, clockContinuous:false`で、clock異常を保持したままpilot PCMで判定した結果である。`clockContinuous`は収録窓内の判定であり、起動時・窓間を含むpilot生成側の`sourceStatus`も別に保持する。
- **voice UI checker**のsource本体と実Run ZIP×Chromium／WebKit×Main／Workerの**8条件が新判定で成功**。sourceは209captures／1,953,792frames、ZIPは206captures／1,941,504frames、計415captures／3,895,296framesの各試行でpilotを検査した。このUI matrixでは収録窓内のglobal clockも連続していた。音源PCMについては既存のPCM描画、音程・倍音、CH24、別CH保持、ADSR、owned retrigger、実wet tail、Keyboard、Stop、切断、error回復、copy復元の条件を維持した。
- 両UI reportはschema3、checker SHA256 `3e8ee501e3b213e50fbfa5a37bc9daef9313dc6e59a585d4814095c6e694f37c`、helper SHA256 `0f1199be1e7719aa43b693cd941fba5cab5d5771e7508be30fc2dc71fc9d6133`で一致。配信assetはsource287／ZIP215files。実Run ZIPは従来の`ab83876a942add3ab6a91ff7ab53e333dcc943134642ae151721235c0f6556e2`のまま、製品のpackage内容は変更していない。
- `.github/workflows/itch-web.yml`へ共通helperのunitとportable診断を接続。YAML parse／`git diff --check`成功。remote Actionsは今回未実行。SDK／Tauri repoは変更なし。

最終reportは`/private/tmp/ps1-clock-fixed-source.json`／`ps1-clock-fixed-zip.json`／`ps1-clock-browser-final.json`、unit logは`ps1-clock-unit.log`。hash・route別件数・clock異常の前後rowは[JSON](ps1_audio_clock_01.json)に保持する。旧判定による6成功／2失敗を新判定の8成功へ遡って置き換えたものではなく、別の判定と追跡試験の結果として記録した。

## 限界と次の作業

確認したのは独立pilotの連続性と、上記の条件における音源PCMの性質である。物理device／driverのdeadline、出力drop、全操作・全環境での可聴ノイズの不存在を保証する試験ではない。今回の診断はすべて物理出力muteで、人による実聴は行っていない。global clockの異常の実装原因も未確定。

pilotはcaptureの別入力を流れる独立信号であり、SPUが生成した全frameの同一性・欠落のなさを直接証明するものではない。音源PCMは上記の既存音声条件と、別途行った実PS1新旧比較で確認している。

`check_playground_ps1_browser.cjs`、`check_ps1_sample_editor_browser.cjs`、`check_ps1_adpcm_encoder_browser.cjs`の3本は従来の`currentFrame` assertionのまま変更していない。今回の新判定による8条件成功はvoice UI checkerだけの結果である。これらのcheckerへ共通判定を展開する作業は、次の機械的な追跡項目として残す。

この追跡で製品の音声処理を変更する必要を示す再現は得られていない。次はTauri GUIの実操作・人による実聴と、各OSのremote CI。PS1 Mixerの基準音量は未測定unity1.0のまま。

機械可読記録: [ps1_audio_clock_01.json](ps1_audio_clock_01.json)。前段階の失敗記録: [ps1_sdk_native_01.md](ps1_sdk_native_01.md)。全体計画: [todo_ps1_01.md](todo_ps1_01.md)。

## 2026-10-28 follow-up: remaining checker migration

The three-checker follow-up is complete: Mode, PCM-to-ADPCM and Sample Editor pass 24 newly executed source / actual Run ZIP routes, auditing 771 captures / 6,500,352 frames. One Mode ZIP capture retains a global-clock anomaly while its independent pilot remains continuous. The 43 helper/aggregate unit tests pass. Previous voice UI evidence was reused only after current checker/helper/archive hashes matched; its eight routes were not rerun in this stage or counted among the 24. The local packaged aggregate passes four reports / 16 routes, including the previous voice ZIP proof. See [ps1_capture_migration_01.md](ps1_capture_migration_01.md) / [JSON](ps1_capture_migration_01.json). All historical results above remain unchanged. Production audio, WASM, Mixer, fixed SDK, Tauri and package versions are unchanged. Remote CI and human listening remain pending; no commit, push or publication was performed.
