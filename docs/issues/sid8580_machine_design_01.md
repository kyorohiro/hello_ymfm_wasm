# 8580研究用C64／AudioWorklet接続の設計（2026-11-07）

第16段階の独立SID候補を、実CPU／CIA／VICとAudioWorkletへ接続する**研究用の別入口**を作る。本番SID Player／Synth／SDK、既知8580拒否、固定runtime／過去の報告・ZIPは変更しない。この文書は実装境界と検証計画であり、実機品質・実曲・音切れの合格記録ではない。

## sourceとmoduleの境界

- C64機械は既存の固定`chips` revision `9e88298ce56319953ac7a43213a1120359f7a3a6`を再利用する。CPU・2 CIA・VIC・RAM banking・IRQ／NMIを実際にclockし、hostの周期callbackでplayを代用しない。原本[`c64.h`](../../third_party/chips-c64/upstream/systems/c64.h)・device headers・[source manifest](../../third_party/chips-c64/SOURCES.json)は無変更。
- 新しい互換SID endpoint headerが、C64の要求するSID型・pin／init／reset／tick／sample契約を受け持ち、固定sidera 1.1.1の研究用Probeへ渡す。`m6581`互換名は接続用の型名であり、本体を従来6581コアへ置き換える意味ではない。SIDは毎machine cycleで1tick進み、readは各core自身の値をCPUへ返す。
- 既存[`sid_rsid_core.h`](../../tetorica_src/wasm/sid_rsid_core.h)は変更しない。固定原本から**新しいmarked research copy**を生成し、include・SID handle lifecycle・対応する診断だけを変更する。現在の原本は25,178bytes／SHA-256 `1de69a5fcb1cc4b7284c12c7f8de52f4c2109a4c8944396c94072a3f49f9ece1`。
- NativeはRust static libraryとC／C++機械をlinkする。browserは別々の研究用Rust SID WASMとC64 machine WASMを使い、RustのWASM export関数をmachineのimportへ直接渡す。per-cycleのJS closure／message／PCM copyを挟まない。両moduleのlinear memoryは別なので、片方のpointerをもう片方で参照しない。tick／sample／read等はscalar ABIとする。
- research outputは既存hostの**12Hz software DC blocker**を残し、その後の出力として明示する。候補自身の出力RC／samplingとの違いを隠さず、gain／phase合わせや既存quality測定と同一音声段という主張をしない。

順序は、CPU tick→SIDの1cycle進行→選択されたSID read／write→CIA／VIC処理という既存の境界を維持する。SIDのclock後に同cycleのbus操作を行う点は、固定`m6581_tick`と先のCPU閉ループProbeに揃える。native／WASMで同じ順序を検証する。

## ownershipと実行policy

SID handleは各machineのSID structに保持し、globalな「現在のSID」を使わない。upstream `c64_discard`は外部SID handleを解放せず、`c64_init`はstructを初期化するため、reload／初期化の前とdispose時に研究用handleを明示解放する。Stop／faultではqueueと出力を消し、CPU／IRQ／SID clockを凍結する。POT等の未対応readは値を捏造せずaddress付きで停止し、次のCPU tickへ偽のread値を渡さない。

upstream snapshotはC64 structをcopyする。Rust handleの複製・二重解放になるので、今回はsnapshot ABIを公開しない。全voiceの内部値を互換structへ作り込まず、必要な観測は実CPUによるOSC3／ENV3／bus readとcycle付きtraceを優先する。非破壊peekを追加する場合は別契約として検証する。

PAL985,248Hz・single SIDに限定し、PSID VBI／CIAとRSIDの既存load range・driver空きpage・bank／ROM・init／play上限を継承する。minimal shimは元の独自実装を使い、元ROMは配布しない。未実装device／VIC・CIAのupstream制約、volume-DAC／digiや音源近似を含むため「完全なC64」とは呼ばない。

## parserと研究用UI

入口は新しい`docs/sid8580-lab/`。研究用modelの明示選択と元headerの宣言を分けて表示し、headerを書き換えない。既知NTSC・multi-SID等の対象外条件は拒否する。既存CLI／本番browser parserの6581契約は保持する。

PSIDの構造読取は、固定`tetorica_src/runtime/sid_psid.js`の無変更内容に`parsePsidStructure`のexportだけを追加した**生成view**を使う。元のstrict entryを緩めず、生成元・recipe・生成物のhashを記録する。RSIDは無変更の公開`parseRsid`を利用する。未知／両対応のclock・modelは研究用wrapperで明示選択し、raw metadataを残す。研究用profileはresonance／cutoffとも独立・既定Offとし、有効な設定をread stateへ返す。

## 再現可能な生成と配布

patcherは元host・C64 manifest／headersのhashを**出力前に**確認し、各置換anchorをexact-oneで要求する。新しい生成directoryにmarked copyを作り、original／recipe／outputのhashを保存する。`--check`は再計算してbyte一致を確認し、原本の1byte変更・欠落／重複anchor・stale生成物を拒否する。既存sourceやreceiptを再生成して受理する逃げ道は作らない。

独立receiptには、固定C64／CPU sourceとzlib notice、元BSD host・生成recipe／hash、sidera原本・adapted tree・PATCHES・両profile JSON、新C ABI／build script、Rust／C／C++ compilerとlink profile、両WASMを含める。Rust標準library noticesを維持し、新しいlink構成のC／C++ runtimeが入る場合も実際のtoolchain noticeを確認する。別source kitは親repoへのfallbackなしで生成・Native／WASM build・検証を行い、過去のkitは上書きしない。GPL SID参照実装・binary、ROM、音楽、PCMは含めない。

## 最小の検証matrix

1. **原本と生成**: 既存SID／PSID／C64／probe receiptの不変、patcher拒否テスト、research source kitだけでの独立buildとhash確認。
2. **機械とCPUへの因果関係**: 自作CIA IRQ／VIC raster IRQ／NMI／masked・one-shot／可変timer／busy-loop、PSID VBI／CIA／長いinitを再利用。実read→RAM→条件分岐→SID writeを確認する。bus保持差を観測するprogramでもread cycleを記録し、CPUへ期待値を注入しない。
3. **境界と隔離**: 44.1／48／96kHz、render chunk1／128／4096のNative／WASM PCM・RAM・trace一致。POT／JAM／ROM／範囲／timeout、Stop全zero・clock不変、reload・複数instance・dispose・失敗候補の旧音保持を確認する。従来m6581とのPCM一致は要求しない。
4. **Worklet lifecycleと性能**: 実AudioWorkletの開始／停止／再開、pending load／Stop／古いACK、processor fatal、profile／model設定の保持を検証する。per-render時間とframe数／sample rateからdeadlineを測り、単体SIDのbatch速度から音切れなしと推定しない。browser計測と実音出力・長時間／実聴は分ける。
5. **実ファイル**: 元曲をコピーせず、許可されたlocal入力の代表例を短時間実行する。model／profile／ROM環境・subtune・実行時間を残す。成功しても全8580曲・全subtune・実機品質や本番採用の合格とはしない。

実装後の証跡と残作業は別resultへ記録する。今回の接続試作と、本番Player／Synth／SDKへ採用する判断は分ける。
