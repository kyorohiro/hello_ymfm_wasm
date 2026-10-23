# Native追加YM2151

2026-10-23。[追加音源計画](todo_createSoundChip01.md)のYM2151を実装する。
OPM 8CHのみの単独コアを使い、X68000のOKIM6258やPCM保持領域は作らない。

```js
const lead = await createSoundChip('ym2151', {id: 'opm-lead'});
lead.setAlgo(0, 7, 0);
lead.setPan(0, true, true);
for (let op = 0; op < 4; op++) {
  lead.setOperator(0, op, {mul: 1, tl: op === 3 ? 32 : 127, ar: 31, rr: 15});
}
await mixer.set(lead.id, {volume: 0.5});
lead.noteOn(0, 'C4');
```

## APIと状態

- 既存の追加音源用`playground_ym2151.js`と実際のWorkletを基準にする。
  追加音源は既定3,579,545 Hz。X68000主音源の4 MHzとOKIM6258は維持する。
- raw register、operator、algorithm／feedback、pan、note／frequency／KC・KF、
  key mask、共有LFOのAM／PM、CH8のnoise、timer／CSM、clock、resetに対応する。
  追加APIにpreset、ROM、timeline、同期read／generateを新設しない。
- 公開`setOperator()`はregister順のM1／C1／M2／C2。
  音色情報画面はalgorithmのlogical順M1／M2／C1／C2で編集し、対応するregisterへ変換する。
- AM depthとPM depthは同じregister 0x19の別ラッチとして保持する。
  snapshotは256 registers、8 key masks、AM／PM、clock、status／IRQ、手動保持と適用待ち命令を観測する。
  JSの編集用状態とNativeの適用済み状態を分け、snapshot読取りで予約済みの編集を上書きしない。
- `useSoundChip('ym2151')`はX68000 Modeなら主音源を借用する。
  他ModeではRun内で共有する追加音源を使う。`createSoundChip()`は常に独立する。

## 演奏・画面・寿命

Mainのprivate owner group、Workerのperformance／owner、手動Keyboardのvoice leaseを区別する。
YM2151のCSMは全8CHに作用するため、通常keyOnと別のglobal sourceとして追跡する。
他ownerの後発keyOnや手動発音を、古いloopの取消し・keyOffで消さない。
LFO・noise・clock・resetなどの共有変更も、手動試奏と干渉しないように扱う。
明示的な`reset()`は、通常のコード発音に対しては既存APIどおりインスタンス全体をリセットする。
owner取消しのような部分停止へ意味を変えず、手動発音が保持中の場合は保護する。

YM2151タブは追加音源の接続時に表示し、インスタンスとCHを選んで編集・試奏できる。
下部Keyboardとタブ側Keyboardは同じ対象選択を使う。
生成・初回表示・Refreshはpresetや発音を変更しない。
追加YM2151の画面は接続・状態通知・編集完了・明示Refreshで更新し、常時ポーリングを追加しない。
同じIDで作り直した場合もconnection tokenを確認し、旧画面の操作・遅いsnapshot・解放が新音源へ届かない。

追加ラックはPSG／YM2612／YM2203／YM2608／YM2610／YM2151合計16台・64 MiB。
固定queue・準備中・退役待ちも含める。既存の予算超過時の回復・Mixer保存規則に従う。
生成・破棄だけでは`mixer/current.json`を変更しない。

## 音声callback

Browserのresetはコアを作り直し、free-running LFO・noise・envelopeの位相も初期化する。
Nativeでは生成時にpower-on状態を固定bufferへ保存し、callbackではそれを復元する。
callback内でコアを作り直さない。

手動試奏の再triggerは一度keyOffし、通常の音声生成が1 source intervalを消費してからkeyOnする。
制御処理で音声を生成・破棄して発音準備しない。
低いclockでのupsample中も、取消し対象以外のCHの保持PCMを残す。

既存Browser版はcold生成直後ならCSMのみでも発音するが、明示reset後のsilent gateは通常keyOnまで開かない。
この既存動作も比較対象に含める。Browser側の挙動変更は今回の範囲に含めない。
public `allNotesOff()`はtimer／CSM設定を保持する。RuntimeのStop・owner取消しは、停止後の再発音を防ぐため
該当するCSM sourceを終了させる。

## 検証

- `scripts/check_native_extra_ym2151.mjs`で実際の追加Workletと配布WASMを比較する。
  44.1／48／96 kHz、全8CH・8 algorithms、operator順、noise、LFO AM／PM、timer／IRQ、
  全CH CSM、clock、power-on reset、手動再triggerを含む。
- C++ fixtureで通常keyとglobal CSMの分離、低clock中の他CHのPCM保持、観測snapshot、callback内allocation／freeを確認する。
- Rustの実ラックで同種2台＋異種、6種類共通上限・予算・取消し・退役、Main／Worker／手動所有権、
  clockの適用待ち、生成中Stop・dispose・同ID置換、全Native Modeを確認する。
- Chromium／WebKitの実Main・logic Worker、編集画面・Keyboard・Mixer・X68000主音源借用を確認する。
  `scripts/check_playground_native_backend_browser.cjs --extra-ym2151-only`を使い、Native IPCだけをmockする。
  AudioContext／AudioWorklet・物理音声デバイスを生成しない。
- 最終配布ZIP、Tauri取り込み、module参照、同梱ソースと原典snapshotを照合する。

## まとめて進める場合

共通のラック・予算・生成・画面接続の準備は並行できる。
チップ固有の発音・停止・共有設定は異なるため、音源ごとのPCM・寿命・画面検証を通してから配布物へ統合する。
次のOPLL／AY／OPLもこの単位で進め、未検証の複数音源を同時に完成扱いにしない。


## 検証結果

- 実際の追加Worklet／配布WASMとの252ケース・1,548,288 stereo framesでPCM・status／IRQ・read ports・
  key masks・AM／PMの差分0。44.1／48／96 kHzを含む。
- 既存X68000主音源＋OKIM6258は42ケース・258,048 framesで差分0。
- C++ fixtureで全CH CSMと通常keyの取消し分離、他CHの保持PCM、power-on状態復元、
  public `allNotesOff()`後のtimer／CSM保持と通常keyOnによる再開を確認した。
  描画中allocation／freeは0。
- ソース段階と最終distのChromium／WebKitで、実Main／logic Worker、同種2台＋既存5種類、
  音色・LFO編集、インスタンス／CH選択、両Keyboard、Mixer、個別dispose・同ID置換・Stop／再Run、
  X68000主音源の借用と追加OPMの共存を確認した。Native IPCはmockし、AudioContext／AudioWorkletは生成していない。
- 最終distでは追加YM2610／YM2608／YM2203／YM2612／PSGも両ブラウザーで回帰確認した。
- Node全体は4,288成功・1 skip。関連JS 129件と画面36件も成功。
- Rust全体は414成功・4 ignored。追加YM2151の15件を含む。同種2台＋既存5種類・共通16台上限、全22 Native Mode、
  共有予算、生成／取消し／退役、通常key・global CSM・手動試奏の所有権、pending audition、
  clockの適用待ち、Stop／同ID再生成、public allNotesOff後の再開を含む。
- Nativeビルドの確認環境はmacOS ARM64。他CPU・MSVC／GCCは既存CIで確認する。
  物理デバイスを開くignoredテスト、実機試聴・長時間のdropout確認は実行していない。

### オフラインDSP測定

Apple M2・Clang 17 `-O2`、48 kHzで2秒分を3回測った中央値。
各YM2151は8CH・4operator、LFO AM／PM、random waveform、CH8 noiseを動かす。

| YM2151台数 | 音声時間に対するCPU時間 | C++コアの確保量 |
| --- | --- | --- |
| 1 | 1.27% | 12,368 B |
| 2 | 2.57% | 24,736 B |
| 4 | 5.15% | 49,472 B |
| 8 | 10.28% | 98,944 B |
| 16 | 25.28% | 197,888 B |

コアの確保量には4,096 Bのpower-on状態bufferを含み、OKI・PCM RAMは持たない。
4 YM2151＋4 YM2610＋2 YM2608＋2 YM2612＋2 YM2203＋2 PSGは22.04%、4,863,056 B。
描画中allocation／freeは全ケース0。Rustラック・固定queue・退役待ち・allocator overhead・IPC・FX・UIは含まない。
実機のcallback締切・dropoutを保証する測定ではない。`scripts/benchmark_native_extra_chips.mjs`で再実行できる。

ARM64のRust layoutはInstance 14,720 B、YM2151 Shared 4,992 B、Renderer 632 B、session Shared 137,088 B。
1台の退役queueは1,048,576 B。固定予約1,114,112 Bに、Rust状態・C++コアが収まる管理余裕64 KiBを含む。
固定分以外の所有payloadは既存の共通予算規則で予約する。

## 配布・同梱

- `web`から`docs/js`へ同期し、cache revisionを`native-extra-ym2151-1`へ更新した。
- `release/hello_ymfm_wasm_native-extra-ym2151_itch_playground.zip`を作成した。
  SHA256: `fb4e2dcacfd3cad96d0904a78ff0da4c620f8600657938a6c00337853625112b`。
- Tauriへ859ファイルを取り込み、release lockとの一致を確認した。
  886件のlocal module／asset参照、Mode starter・Native API・WASM・ライセンスを確認した。
- Native source ZIPは1,337ファイル。SHA256:
  `f01be8a2b5bcdc2a6b03a229270d0e2a68a4fc79621425dd3589590ec7c282ea`。
  21種類の原典snapshotと、現在のソース／同梱ZIPの一致を確認した。
- npm・itch.ioへの公開は行っていない。
