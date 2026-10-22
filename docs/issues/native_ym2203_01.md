# PC-98 YM2203 Native対応

2026-10-22着手、2026-10-23検証完了。PC-98（YM2203 / OPN）modeをTauriのNativeエンジンへ接続する。Web Audioを既定とする。

## 構成

`pc98-26`ではYM2203だけを生成する。4,000,000 Hz、FM 3CH＋SSG 3CHで、FMと3つのSSG出力を合算・clampしたモノラル値を左右へ流す。
SSGの標準clockはmasterの1/2。`fm`／`fm.ssg`／`ssg`、`play()`、Main／Worker、`useSoundChip('ym2203')`によるprimaryの借用に対応する。
YM2612、YM2608、Sega PSGは生成せず、YM2608のrhythm／ADPCM／ROM APIは追加しない。

KeyboardはFM 3CHとSSG 3CHから選択し、既存の音源タブでも試奏・編集する。
YM2203にはチャンネル別pan／LFOを用意せず、音源タブでも該当操作を無効にする。チップ全体の音量・panは共通ミキサーで扱う。
共通FX・liveFx・monitor・録音へ接続する。

## 状態と操作

Stopは発音・未来の予約・手動試奏を止め、音色・clock・CH3特殊モード・SSGのtone／noise／envelope設定を保持する。
FMの通常keyOffはリリースを残し、試奏の解放ではTLを保持して次の実FMクロック境界でミュートする。他チャンネルの位相は変えず、次の発音でTLを復元する。全体のStopは即時に無音化する。
clock変更は適用済みのframeを確認してからJSへ反映し、手動試奏中のclock変更拒否だけでは音声エンジンを停止しない。

SSGの音量0と一時的なkeyOffはバス上では同じ書込みになるため、保持する設定音量を別の命令としてMain／Workerから渡す。
明示的な音量0・raw書込み0とenvelope選択をStop後も保持する。未設定・無音のSSGをKeyboardで試奏する際は既存UIと同じ音量12を使い、設定済みの音量0は変更しない。
MainのSSG loopは所有するチャンネルだけを解放し、古いloopのkeyOffで新しいloopの音を止めない。
Workerの表示用observerでは音量メタデータも再送せず、表示同期を音声更新へ戻さない。

適用済みのレジスター・SSG保持音量・gate・status／IRQは必要時に非同期で取得する。
CH3特殊周波数、raw prescaler、timer／CSMは実コアで処理する。Hzヘルパーは既存Webと同じ標準prescalerを想定し、raw変更時はblock／fnum・periodによる指定を使う。

## 検証

音声デバイスを開かないオフラインPCM比較と、Native IPCを模擬した画面操作で検証する。
比較元は独立した追加OPN用Workletではなく、PC-98（YM2203）が実際に使うprimary Workletと配布WASMとする。reset時に出力resamplerのphaseを保持する差も合わせる。

- JS対象35件で、FM／SSGのWebと同じ命令生成、CH3特殊モード、Main／実Worker、全6声のKeyboard・Guitar、音量0・Stop保持、loop所有権、observerの再送防止、clock適用確認を検証。
- JS全体：4,032成功、既存skip 1件。YM2203で無効にしたpan／LFO操作がYM2612へ戻すと有効になること、表示変更がレジスターを書かないことも確認。
- Rust全体：291成功、既存ignore 4件。YM2203対象17件は、FM＋SSGの実モノラルPCM、共通FX・master・録音、時刻・保持設定・clock・prescaler、通常key-onを伴わないCSMの所有者取消しと未来命令の取消しを含む。
- 配布WASMと実際のprimary Workletによる44.1／48／96 kHz・186ケース・1,142,784ステレオframeで、PCM・status・IRQ・read portの最大差0。全3 FM×8アルゴリズム、SSGの16 envelope形状、noise、合算後clamp、prescaler、CH3特殊／CSM、timer、clock、Stop／reset、再発音を含む。
- 同じ186ケースをASan／UBSanでも検証。描画callbackのメモリー確保・解放はいずれも0。原典9ファイル・共有ソース9ファイルの照合も成功。
- Chromium／WebKitでMain／Workerの初期コード、FM／SSG、CH3特殊モード、音量0と再発音、全6声とFM Round robinのKeyboard、Guitar、音源タブ、独立ポート間の適用確認、clock／ミキサー、Stop保持とmode切替を確認。Native IPCは模擬。
- 既存NativeモードとWeb Audioを含む画面検証、取り込み後の最終`dist`のYM2203画面検証も両ブラウザーで成功。
- Tauriへ838ファイルを取り込み、整合性確認・macOSの`cargo build --offline --locked`・Python 8件／Node 31件が成功。
  アーカイブSHA-256：`9610268ecf7f3fd8057f68ed1fa66e5b4cc5d5ae075269269c088163fb529368`。

比較結果は[native_ym2203_pcm_validation.json](native_ym2203_pcm_validation.json)に保存する。

実機の音声デバイスでの聴感とWindows／Linuxでの実行確認は別途行う。
