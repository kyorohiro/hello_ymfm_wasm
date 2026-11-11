# SPU Synth：選択式software click guard（2026-11-11）

方針合意：Synth内の高水準`noteOn`／`noteOff`は鍵盤と同じ短いクリック抑制を利用し、既定On／切替可能とする。`setNote`＋`keyOn`／`keyOff`は生のレジスタ操作を維持する。公開Playground／npm APIやSPU coreの仕様は変更しない。

- [x] app専用click guard設定を追加し、KeyboardとCodeの高水準発音へ接続する。各voice内の既存native audition rampを使い、Master／他CH／reverbをまとめてフェードしない。
- [x] UIに「Click guard · Software」を明示し、Code実行中も切替可能にする。古いCode sessionを破棄せず、設定の変更は次のgate操作から適用する。
- [x] raw key操作、ADSR値と長い／無限Release、他voice、PMON／Noise、Stop／sample復帰を維持する。型・help・README・cacheを更新する。
- [x] native PCMの数値測定と無音headlessで、クリック抑制の差・raw一致・On／Off・状態の復帰を確認する。
- [x] 可読ソース付きZIPと検証記録を更新する。commit／push／公開は行わない。

ユーザーからのKeyOff例：`await ps1.setNote(channel, "E3"); await ps1.keyOn(channel); await beat(1.12); await ps1.keyOff(channel);`。修正・検証は無音で行い、通常browser／native app／OS音量は操作しない。

## 完了記録

- Keyboard／Codeタブの下に独立したチェックを配置（既定On）。Live中も操作でき、次のgateから適用する。private `setClickGuard`はvalueだけを返し、Code sessionや元音色の保存状態へ干渉しない。Stop／Run／instrument resetでも現在の選択を維持する。
- 高水準`noteOn`／`noteOff`／`allNotesOff`と鍵盤に既存128-frameのvoice内処理を使用。Codeの`keyOn`／`keyOff`はPMON sourceも含め常にraw。ADSR codeや長い／無限Releaseは維持し、portable preset／projectへ設定を混ぜない。
- Node／実WASMテスト102件成功。Sineの高速Release最大段差0.120568→0.002991（約40.3倍低減）、再発音も約40.4倍低減。Offと旧raw、raw keyのOn／Off、別stereo voiceはPCM一致。
- 最終ZIPでChromium／WebKitのClick guard各5項目、Code／Files／Live各7項目、実Monaco各5項目成功。3回ずつのRelease比較、raw keyの2048-frame prefix差0、実行中toggleでsession／gate／ADSR／sample保持、起動前選択と1240／390px表示を確認。全出力gain0、実聴なし。
- ZIP：`release/tetorica_spu_synth_spu-click-guard-20261111_itch.zip`（139 files、6,053,254 bytes、SHA-256 `de54090977c3d3b97653b4f04d1512d94e3480478389a760aa6cd69c825b1f06`）。内包ソース106入力はrepoと一致し、minify／bundleなし。
- 詳細：[検証記録](spu_synth_click_guard_verification_01.json)。commit／push／公開なし。
