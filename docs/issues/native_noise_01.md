# Native Genesisのnoise生成

2026-10-21。`noise.create()`をNative Genesisへ接続する。
Web Audioを既定とし、Tauriで明示選択したGenesisだけを対象にする。
ここでのnoiseは音作り用のノイズ音源であり、断続的な再生ノイズの原因調査とは別の作業。

## 構成と対応範囲

- Web Audio版と同じ`native/audio_effect/noise.c`をNativeでも使う。
  JSは作成・発音・パラメーター命令を送り、生成は音声callbackで連続して行う。
  AudioContext／AudioWorkletや、生成PCMを毎block転送する経路は追加しない。
- white／pink／brown／gray／clip、seed、gain／pan、attack／release、filter、
  パラメーターのrampと`control(voice, {slide: ...})`に対応する。
  filterのpeaking／lowshelf／highshelfは共有DSPの現仕様どおり0dBの通過となる。
  周波数・Qを指定しても、boost／cutは追加されない。
- MainとWorkerは同じAPIを使う。WorkerではFM／PSG／sample／FXと同じ音声clock・lookaheadを使う。
  Nativeへの命令は既存の有界キューに入り、同時刻の送信順を保持する。
- チップ出力→noise→汎用PCM→FX→master音量→停止フェード・clipの順に処理する。
  最終出力のAudioモニターと録音にもnoiseが含まれる。
- Native全体で32声を上限とし、作成済み・発音待ち・release中の領域も数える。
  callback内では固定長の状態を使い、領域確保・mutex・IPCを行わない。

## 声の所有と停止

Mainと各Workerのnoiseに別のnamespaceを割り当て、slotとtokenで個々の声を識別する。
Workerを作り直した場合やStop後に同じslotを再利用した場合も、古い命令を新しい声へ適用しない。
seedが0の場合の初期値も論理slotから決め、Native内部の割当て位置で音が変わらないようにする。

通常の`voice.stop()`はrelease後も声の設定・乱数状態を保持し、`voice.start()`で再利用できる。
`voice.dispose()`は明示的に領域を解放する。loop内で作った声をloop取消しで片付ける場合は、
内部のretire命令でreleaseを残し、音声側で終了を確認してから領域を回収する。
loopの外で用意した声は取消しでも破棄せず、別loopや手動操作での再利用を可能にする。
新しいownerが発音を引き継いだ声を、古いloopの後処理で停止・破棄しない。
最初のstartまでの設定を準備情報として保持し、取消された未来のcreateより先に別ownerが
startした場合も初期音量・pan等を失わない。発音後のパラメーター変更は指定時刻に適用する。

Workerの取消しとcleanupは異なるMessagePortから順不同で到着し得る。
Workerのvoice作成と初期パラメーターは、発音を伴わない準備として同じ演奏session内で即時処理する。
作成元のloopが取消されても、別loopへ引き継いだvoiceの準備を失わない。
自動startを含む発音と後続の変更には、通常のloop ownerと時刻を付ける。
声の後片付けに限った命令は同じ演奏session内で受け付け、通常の古い発音・制御命令は拒否する。
Stop／Runをまたいだcleanupにはsessionの検査を残す。
Nativeの全体Stopは既存の短い停止フェード後に全noiseをresetし、JSの古いhandleも無効にする。

## 検証

物理デバイスを開かず、実Native DSP／schedulerと、IPCを模擬した実ブラウザーを分けて確認する。
実際の音の試聴・長時間の安定性・断続的ノイズの再発有無は別途確認が必要。

| 検証 | 結果 |
| --- | --- |
| 共通Runtime／Worker／Native adapter／既存Audio・Keyboard・実行ガード | Node 366件成功。遅延IPC中の作成元取消しと、別loopへのvoice引継ぎも確認 |
| Tauri Rust | 67件成功、4件ignored。noise関連11件を含む。資格情報2件・物理音声デバイス1件・明示的な計測1件は未実行 |
| 実Nativeと実WASMのnoise DSP比較 | 44.1／48／96kHz、54ケース成功。最大PCM差0。独立instanceも確認 |
| 共有C DSPスナップショット | 由来・生成結果・SHA-256照合成功 |
| Chromium／WebKitの共通ページ | Main／Worker、filter・ramp、loop取消し、Stop／Runと既存FM・DAC・sample・FX・monitor・録音を確認。Native IPCは模擬 |
| Tauri取り込み | 787ファイル、archive SHA-256 `548064eefeed5a86b7a87ff8bb92deb316f711b00da2f9cfd24677bb8ff6a9fb`。ハッシュ検査成功 |
| 配布アセットのWebKit | 上記の統合検証が成功。Nativeでlive AudioContext／AudioWorkletを生成しないことを確認 |
| Tauri `cargo build --offline --locked` | 取り込んだ配布アセットで成功 |

再実行例（Tauriリポジトリーから）:

```sh
python3 scripts/sync_native_genesis_noise.py --check --source ../..
node scripts/check_native_genesis_noise.mjs ../..
cargo test --offline --locked --manifest-path src-tauri/Cargo.toml native_genesis
```

上流リポジトリーの統合検証:

```sh
node scripts/check_playground_native_backend_browser.cjs
```
