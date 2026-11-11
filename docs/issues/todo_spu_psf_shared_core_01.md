# SPU Synth：PSF再生を共通SPUコアへ統一（2026-11-11）

PSF PreviewのPlay! CPU／HLEは維持し、音源部分をSynth／Codeと同じ固定MAME由来SPUへ接続する。Noise・PMON・main／reverb出力音量等を別実装で省略する状態を解消し、後のCH Live／Captureの土台にする。

- [x] PS1のIO、DMA4、IRQ、CPU／音源clock境界と既存fixed SDK APIを調査し、接続方針を記録する。
- [x] PSF実行中のSPU register／RAM転送・IRQとPCM生成をMAME由来コアへ接続する。二重mixを作らず、実機側の設定を使う。固定SDK／DSP本体は変更しない。
- [x] main volume・Noise・PMON・reverb等が実際に反映される自作MIPS fixtureと、既存SPUに対する数値比較を追加する。PIO／DMA・IRQ・render分割・複数instance・Stop／Abortも確認する。
- [x] JS loader／ABI識別・配布ソースキット／ライセンス／再ビルド手順を更新し、旧engineとのcache混在を防ぐ。外部BIOS・共有メモリを要求しない。
- [x] Play／Pause／Resume／Stop・Master・monitor・編集音色／Codeとの所有権を無音headlessで回帰し、可能なローカル実PSFも数値検証する。
- [x] README・制限の説明・可読ソース付きZIP・検証記録を更新する。配布ソースキット単独からの再ビルドを確認する。commit／push／tag／公開は行わない。

曲のCH Live表示・Capture／Pause試奏は、このコア統一後の別作業。一般PSFの全互換性や実聴・長時間検証を今回完了した扱いにはしない。通常browser／native app／OS音量は操作せず、headlessはアプリ起動前からdestinationをgain0へ遮断し、Chromiumはmuteを併用する。

接続方針：Play!のCPU／HLEを維持し、SPU専用の幅付きbus callback・DMA4・IRQ9を固定MAME DSPの1 instanceへ接続する。Synth用C ABIの音色操作APIを経由せず、同じ未変更DSP sourceを直接ビルドする。1音源frame＝768 CPU tickの負債を繰り越す。Play!はbasic block単位の命令実行なので、cycle-exactな同期は主張しない。

完了確認：関連Node 395件、音量校正145件が成功。自作MIPS PSFのbus traceを通常のPs1Spuへ再適用し、stereo PCMと512 KiB RAMの完全一致を確認した。Noise、PMON、main／reverb音量、PIO／DMA往復、IRQ latch、SB／SW／LW、停止FIFO、未対応modeの拒否、無効WASM／旧ABI拒否を検証済み。

Chromium／WebKitでPSF transport・通常Synth・Code／Filesの無音headless回帰が成功。ローカル実PSFは4秒の有限PCMを生成できたが、実聴や長時間・全曲互換性の確認ではない。配布ソース単独からJS／WASMを再生成し、配布物とbyte単位で一致。固定SDK 476ファイルは変更なし。

検証記録：[spu_psf_shared_core_verification_01.json](spu_psf_shared_core_verification_01.json)。配布候補は `release/tetorica_spu_synth_psf-shared-core-20261111-a_itch.zip`（331 files）。commit／push／公開はしていない。
