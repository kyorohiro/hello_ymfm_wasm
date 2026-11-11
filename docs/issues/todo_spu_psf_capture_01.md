# SPU Synth：PSFの選択CHをCapture（2026-11-11）

Pause中のLive表示で選んだ通常ADPCM音色を、同じ時点のSPU RAMとregisterからSynthへ取り込む。ADPCM bytes・loop・ADSR・voice volume・再生Pitchを保持し、指定したReference key（既定C4）で元のPitchを試せるようにする。Root noteを推定した表示にはしない。Noise／PMONペアのCaptureは別作業。

- [x] 同時点RAMの取得方式と取得／保持上限、ADPCM終端／repeat／対応範囲、調律・shared reverbの扱いを決める。
- [x] coreに副作用のないRAM copy APIと、純粋なCapture検証・音色変換処理を追加する。固定SDK／DSPは変更しない。
- [x] Liveの短い履歴へ同時点RAMを有界に保持し、Pause／CH選択と一致するCaptureを取り出す。Off／Stop／曲変更／失敗時の解放・古い結果排除を検証する。
- [x] Pause時のCapture操作とReference keyをコンパクトに追加する。検証成功後にSynthへ反映し、鍵盤試奏と既存preset保存につなぐ。失敗時はPause中の曲・編集音色を保持する。
- [x] 動的RAM書換え・lookahead・loop／one-shot・調律・負荷上限を数値検証し、Chromium／WebKitで無音のCapture→試奏→保存／復元を確認する。
- [x] README・配布ソース付きZIP・検証記録を更新する。必要な回帰確認を終え、commit／push／tag／公開は行わない。

通常browser／native app／OS音量は操作しない。headlessはアプリ起動前からdestinationをgain0へ遮断し、Chromiumはmuteを併用する。音色の取り込みで曲の途中からの再生状態や現在のenvelope段階を凍結するわけではなく、鍵盤で新たに発音する音色として扱う。

方式：core.observe()の直後、CPUを進めずにcore.copySpuRam()で512 KiBを取得し、公開Live stateとは別のprivate履歴へ保持する。標準lookaheadは7 snapshot（約3.5 MiB）、独立したPause保持を含めても約4 MiB。Live Offでは取得を止め、既存のPause snapshotだけ再利用できる。APIでlookaheadを大きくした場合も既存history上限に従って有界だが、保持量は設定に応じ増える。

取り込みは先頭から最初のENDまでの連続した16-byte ADPCM packetを対象とし、bytesを書き換えない。Repeatが範囲外、RAM wrap、複数／不一致loop marker、END不在等は理由を表示して保持中の音色を変えない。Reference keyは推定Root noteではなく、raw PITCHで鳴らすための基準。shared reverbはSynthの編集設定を維持し、PSFのmain volume／custom reverbをコピーした扱いにはしない。

実PSFの数値検証：ローカルAlatosの0.25秒時点で、active CH1〜4のloop／one-shot（560／8560／13376／10624 bytes）を元RAMのbytesと一致して取り込めた。Reference C4でraw PITCHが再現され、Capture前後のPCMも無操作の別instanceと完全一致。ゲーム由来のbytesは検証記録／リポジトリ／配布物へ追加しない。

Capture UIはStageAでChromium／WebKitとも成功。C5基準鍵盤で元PITCH 6144・元64-byte ADPCMを確認。二度目CaptureでnextAddressが増えず、実際に空き32 bytesのbankではPause／編集音色を保ったまま失敗した。Codeが一時RAM bankを使っている通常preset読み込みは、従来どおりStop→編集bank復帰→cache検索を守る（Capture時だけpreflightを先行）。

完了：関連Node 428件、校正145件、最終targeted 63件（重複含む）が成功。StageAでCapture／PSF transport／Live／Code・Files／通常SynthをChromium／WebKitの無音headlessで検証し、すべて成功。既存LiveのWebKit Pause／Resume 30往復も継続成功。

配布sourcekit単独で再ビルドしたJS／WASMが配布物・既存native artifactとbyte一致。WASM／C++／固定SDKの変更はない。333 entriesのZIP CRC、81 moduleと295 original inputsのsource hash整合性を確認。

検証記録：[spu_psf_capture_verification_01.json](spu_psf_capture_verification_01.json)。配布候補：`release/tetorica_spu_synth_psf-capture-20261111-a_itch.zip`。commit／push／公開はしていない。
