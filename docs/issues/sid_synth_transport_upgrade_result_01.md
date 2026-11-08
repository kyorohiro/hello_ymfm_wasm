# SID Synth: Pauseが拒否されResumeが出ない更新不整合（2026-11-08）

ユーザーの実画面を確認すると、`localhost:8791/synth-sid/index.html` に **SID pause failed: Unknown SID command: pause** と表示されていた。単にResume表示を見落とした状態ではなく、音声側がPauseを拒否してpreviewを閉じていた。

現在配信される `sid-player/audio.js` はPause／Resume対応だった。このエラーはmain-thread facadeのcommand検証に由来し、新しいSynth UIと旧audio moduleが混在した状態と判断した。どのHTTP／module cache層が保持したかを直接計測したものではない。

## 修正

- HTMLのSynth entry、Synthからimportするcontroller、controllerからの共有audio、AudioWorklet URLを **?sid-transport=2** で対応付けた。relative URLでは親のqueryが継承されないため各linkへ明示する。
- Worklet readyは `transportProtocol:2` と `supportedCommands` を返す。audioはprotocolとload／start／pause／resume／stop／readの6commandを出力接続前に確認する。
- 不整合時は **SID audio files are out of date. Reload the page.** と案内し、出力未接続のままcontextを解放する。途中でPauseだけが失敗する状態を防ぐ。
- standalone root HTMLの書換えもqueryを保持し、root／nestedの両入口で正しい実行fileを参照する。JSは引き続き可読moduleを維持する。
- Native DSP／5本のWASM／SDK／校正は不変。既存processorのstate／receive／render部分はHEADと同一で、今回はready metadataのみを変更した。

## 実画面と自動確認

元のタブを保持し、同じChromeに修正版の別タブを開いた。同じ **Froehn.sid／Fröhn・subtune 1/3** を読み、Master 0でPlay→Pauseを操作すると **Resume** と **Your sound · Paused CH 1** が出た。Resume後は表示位置が6.658秒から7.129秒へ進み、再Pause時は10.594秒。最終的にMaster 70%、Resume表示で一時停止したまま置いた。実聴は行っていない。[Native UI記録](sid_synth_transport_upgrade_native_ui_01.json)。

- `npm run test:sid-synth`: **135件成功**。queryを保持するZIP入口と全local assetの解決を含む。
- `npm run test:sid-player`: **138件成功**。protocol未指定／不一致、command不足／不正なcapability、重複readyの解放・エラー一度だけを含む。
- focused upgradeは5項目×2engine×source／ZIP＝**20項目成功**。同じdocumentに残る旧facadeで元のUnknown SID commandを再現し、現在のversioned graphが別に動いてResume／Capture／再開することを確認した。旧ready応答をHTTP serverから注入し、出力・load／start前の拒否と解放、その後の再試行も確認した。これは制御した旧URL／応答のシミュレーションで、実HTTP cacheを測ったとの主張はしない。
- 既存Synth import／Pause38項目×2engine×source／ZIP＝**152項目**、通常SID Player35×2＝**70項目**も成功。合計 **242 browser項目成功**、全物理出力gain 0。自動検証にゲーム曲・ROM・PCM保存は含めない。
- focused pilotではWorklet fetchがpage routeを通らず、network requestからURLを推定するテストが失敗した。各contextの実addModule呼出しを記録し、旧ready注入をHTTP server側へ移して修正した。失敗記録は `build/validation/sid-synth-transport-upgrade-pilot-01.json` に保持する。

記録: [focused source](sid_synth_transport_upgrade_browser_01.json)／[focused ZIP](sid_synth_transport_upgrade_zip_browser_01.json)／[Synth source回帰](sid_synth_transport_upgrade_regression_01.json)／[Synth ZIP回帰](sid_synth_transport_upgrade_zip_regression_01.json)／[通常Player回帰](sid_synth_transport_upgrade_player_regression_01.json)／[変更範囲](sid_synth_transport_upgrade_scope_01.json)／[配布検証](sid_synth_transport_upgrade_package_01.json)。

## 配布と再開

配布候補は `release/tetorica_sid_synth_20261108-transport2_itch.zip`。既に開いていた旧タブは再読み込みして、新しい対応済みmoduleを読み直す。修正前のタブを自動で書き換えたり、読み込んだ音色やファイルを消したりはしない。

```sh
npm run test:sid-synth
npm run test:sid-player
node scripts/check_sid_synth_transport_upgrade_browser.cjs --out build/validation/sid-upgrade-recheck.json --screenshots build/validation/sid-upgrade-recheck-images
sh scripts/package_itch_sid_synth.sh sid-transport-next
```

version名は未使用のものを選ぶ。commit／push／公開は未実行。CIにfocused source／ZIP検証を追加し、YAML構文とdiff checkが成功した。
