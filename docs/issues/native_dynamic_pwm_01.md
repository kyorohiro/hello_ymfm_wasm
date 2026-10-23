# Native追加32X PWM

2026-10-24。[追加音源計画](todo_createSoundChip01.md)の32X PWM追加生成。
Mode内蔵と同じ共通C++コアを、独立した追加音源としてラックへ接続する。

```js
const out = await createSoundChip('pwm', {id: 'pwm-left-right'});
await out.writeRegister(0, 0x0105); // Normal left/right routing.
await out.writeRegister(1, 520);
const baseFrame = await out.scheduleWrites([
  {frame: 0, register: 2, value: 130},
  {frame: 0, register: 3, value: 390},
  {frame: 24, register: 4, value: 260},
]);
```

## 対象と完了条件

- 左右の3段FIFO、routing、cycle、保持出力、clock、予約cursorを個別保持する。
- Browser公開APIと同じ生成optionは`{id}`のみ。既定clockは23,011,361 Hz、modelは`mame`、outputは`duty`、core gainは1。
  `initialize()`とnote APIは追加しない。既存のregister・schedule・clock APIを使う。
- `createSoundChip()`は全Native Modeで独立生成する。
  32X Modeの`useSoundChip('pwm')`は内蔵を借り、他Modeでは共有追加音源を取得する。
- 対応19種類で合計16台・64 MiB。不要な同居音源を作らず、準備中・退役待ち・予約payloadも予算に含める。
- Main／Worker、個別Mixer、既存のFIFO／routing／cycle編集へ接続する。
  PWMはPCM出力なので、楽器用Keyboardの対象には追加しない。
- `scheduleWrites()`は次の出力frameを基準とする相対frame指定と、予約受付時のbaseFrameの戻り値を保つ。
  予約の受付と未来の書込み完了を区別し、未来frame待ちで命令FIFOやStopを止めない。
- performance／ownerとMain private groupを追跡し、取消したownerの予約・FIFO・保持出力を回収する。
  左右swap／同一出力へのroutingやFIFO overflowでも、他ownerの音を誤って止めない。
- 明示的な`reset()`はBrowserと同じくチップ全体のregister・FIFO・timer phaseを初期化し、clockは維持する。
  Nativeの予約削除は呼出しownerと命令順に従い、他ownerや後続命令の予約を保つ。
  loop停止・取消しによる自動回収はチップ全体をresetせず、該当ownerの予約・FIFO・保持出力だけを取り除く。
- session／generation／instance、生成待ち中Stop、同ID再生成、遅延応答・disposeを回収する。
- 観測のための常時polling、callback内allocation・最終free・待機lockを増やさない。

## 検証方針

実配布WASM・既存JSとC++を44.1／48／96 kHz・可変callbackで比較し、primaryも回帰確認する。
独立2台、左右FIFO、overflow／underflow、routing、clock、reset／Stop、予約取消しを対象にする。
Rustでは台数／予算・適用済みsnapshot・大量予約・owner取消し・受付失敗時のtransactionを確認する。
Chromium／WebKitでは実Main／logic Workerと既存UIを使い、Native IPCのみmockする。
物理音声デバイスを開かず、実機試聴・dropout評価とは区別する。

## C++／PCM

Native C ABI・実配布Worklet／WASM・従来JSの225ケース・1,334,016 stereo framesを比較し、差分0。
44.1／48／96 kHz、1 frame／128 frame／不規則callback分割、FIFO・routing・clock境界を含む。
既存primaryのfixtureも成功した。
公開API範囲は既定のduty／gain 1で検証し、非公開のDAC／mute設定はfixture内の共通Coreだけで比較する。
共通DSPコアとWASM binaryは変更せず、Native wrapperへtag付きwrite／cancel／tag照会／core size照会を追加する。

左右FIFOとlatched outputにownerのtagを保持する。
取消しでは該当tagのFIFO要素を詰め、該当する保持出力だけを無効にする。
routing全16通りと左右FIFO数の全組合せ、overflow、tag 0のprimary互換、読取りの無作用を確認した。
同じ出力へ左右両FIFOが流れる場合も、tick内の左右の適用順を保って最後の出力ownerを追跡する。
Native state ABIは96 Bで維持し、1台のwrapper heapは168 B。
callback allocation／freeは0。

## 予約・寿命・予算

1台あたり1,000,000 entries／1,024 batchesを上限とする。
uploadの検証・sort・payload確保は制御側で行い、callbackは固定確保したcursor heapで次の書込みを選ぶ。
scope tableは予約batch、左右FIFO・保持出力、適用中の新ownerを数えた容量を持つ。
予約参照数をscopeごとに保持し、scope回収のために全予約を繰り返し走査しない。

`status(after:id)`は要求したIDの受付結果・baseFrameを返し、別予約の結果を混ぜない。
完了結果は直近512件を保持する。適用待ちは10秒で失敗し、命令FIFOの外で待機する。
Worker bridgeも未来のclockや状態照会を待って占有せず、別loopの命令・取消し・disposeを通す。
遅れて届いた古いsnapshotは新しいclock／state cacheを上書きしない。

固定予約は1台3,473,408 B。共通管理・退役queue、PWM用の固定queue・cursor・scope・結果履歴を含む。
実測した型サイズと固定容量からの使用上限見積りは2,280,224 Bで、予約内に収まる。
16台の固定予約は55,574,528 B（53 MiB）。可変payloadも合計64 MiBの予算から確保するため、
16台それぞれに最大数の予約を同時保持できるという意味ではない。
Instance 22,656 B、Session Renderer 36,960 Bは従来と同じ。
PWM生成は専用の制御側factoryで行い、既存の大きな生成関数のdebug stackを増やさない。

## 統合検証

- Node全体：4,473成功・1 skip。Modeの型チェックも成功。
- Rust：全体627成功・4 ignored。追加PWM 22件、追加音源全体322件も成功。
- Chromium／WebKit：最終Tauri distでMain／実logic Worker、独立2台、19種類を16台以内で混在、
  FIFO／routing／cycle／clock、予約、Mixer、主音源借用、停止・同ID再生成を確認した。
  Native IPCだけをmockし、AudioContext／AudioWorkletは生成していない。画面も目視確認した。
- 配布物：964件のmodule／asset参照、Mode starter、Native API、WASM、ライセンスを検証。
  ZIPはTauriへ取り込み、870 filesの一致を確認した。
- 対応ソース：21種類のoffline snapshotと、1,382 filesの再ビルド用ソースZIPを照合した。

配布ZIP：`release/hello_ymfm_wasm_native-extra-pwm_itch_playground.zip`。
SHA-256：`20c19ce98dff1733f607b3a9eda5c688170e2d06c9c8f4778590c5fcdab70dda`。
実機での試聴・dropout評価と、Windows／Linux／ARM64のCI実行はこの検証には含めない。

主な再実行コマンド（root checkoutで実行）：

```sh
node scripts/check_native_extra_pwm.mjs --out /private/tmp/native-extra-pwm-pcm.json
node --test web/*.test.mjs docs/playground/*.test.mjs docs/vgm_analyzer/*.test.mjs test/*.test.mjs
node scripts/check_playground_mode_types.mjs
node --experimental-vm-modules scripts/check_playground_package.mjs w/tetorica-fm2612-playground-tauri/dist
node scripts/check_playground_native_backend_browser.cjs --extra-pwm-only --root=w/tetorica-fm2612-playground-tauri/dist
cargo test --locked --manifest-path w/tetorica-fm2612-playground-tauri/src-tauri/Cargo.toml --quiet
```

対応ソースの照合はTauri checkoutで`python3 scripts/check_native_sources.py --bundle`を実行する。

## オフライン負荷測定

Apple M2・Clang 17 `-O2`、48 kHz、1秒分をfresh processで3回測った中央値。
clock 23,011,361 Hz・cycle 1000で、各frameに左右2個のtag付きFIFO書込みと音声生成を行う。

| PWM台数 | CPU時間／音声時間 | C++ heap |
| --- | --- | --- |
| 1 | 0.14% | 168 B |
| 2 | 0.23% | 336 B |
| 4 | 0.47% | 672 B |
| 8 | 0.85% | 1,344 B |
| 16 | 1.60% | 2,688 B |

16種類の混在では22.67%、C++ heap 2,590,256 B。
Rustラック・IPC・UI・FX・音声デバイスは測定外。
clock／cycleによってtick密度が変わるため、この値は最悪条件や実機のcallback締切・dropoutの保証ではない。
