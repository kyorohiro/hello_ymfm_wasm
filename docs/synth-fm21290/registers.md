# YM21280 OPS / YM21290 EGS

## CPU書き込み

以下の番地はDX7 CPU側。OP番号は人向けに1..6、バス上のオフセットは `s = 6 - OP`、発音枠は `v = CH - 1`。ROMラベルは[注釈付きv1.8逆アセンブル](https://github.com/ajxs/yamaha_dx7_rom_disassembly/blob/b9df0c0d2500a654904ff5e9bde1276e50fe010e/yamaha_dx7_rom_v1.8.asm)に対応する。

| アドレス | ROMまたはダイ解析で確認できること | 今回のモデル |
|---|---|---|
| 2804, 2805 | PATCH_ACTIVATE_ALG_MODE は30h/50h（キー同期有／無）の後に (algorithm << 3) + feedback を書く | 通常は全声に反映。ダイ解析に基づく個別Aレジスタ選択も実装。テストモードとシフト待ち時間は未実装 |
| 3000 + 2v | VOICE_ADD_LOAD_FREQ_TO_EGS は上位→下位の順に書く。14bit log pitch、左詰めで1oct = 1000h | MIDI A4を5AA8hで440 Hzとする近似。二度のバイト書き込みはレンダー境界で反映 |
| 3020 + 2s | PATCH_ACTIVATE_OPERATOR_PITCH。ratio/fixedをbit 0で選択。ratio 1の基準232Ch、fixed 1 Hzの基準16ACh | log2による位相増分。実機の整数テーブル・丸めの差が残る |
| 3030 + s | PATCH_ACTIVATE_OPERATOR_DETUNE。符号と3bitの大きさ | 符号付きcentの近似。音域別実測は未実施 |
| 3040 / 3060 + 4s + stage | PATCH_ACTIVATE_OPERATOR_EG_RATE / EG_LEVEL。4区間、rateは編集値×164の上位バイト。levelはROMの対数テーブル経由 | rateとlevelのCPU変換を実装。levelはTABLE_LOGの値を1ビット右シフトする。EGS側のゲイン曲線・消音点と到達時間は近似。離鍵で第4区間に進む |
| 3080 + 16s + v | VOICE_ADD_LOAD_OPERATOR_DATA_TO_EGS。96バイト。KLSとvelocityをCPUで合成する。FFhは消音 | OP別・CH別。書き込みは発音中にも反映。減衰と鍵盤曲線は近似 |
| 30E0 + s | PATCH_ACTIVATE_OPERATOR_KBD_SCALING_RATE。AMS << 3 とrate scalingを合成 | 音域によるEG速度と振幅変調感度を近似 |
| 30F0, 30F2/3 | ファームウェアが計算した振幅変調と符号付きピッチ変調。ベンドを合算して上下バイトを書き込む | AM/PM書き込みとMIDIベンドに対応。CPU側LFOとピッチEGは未実装 |
| 30F1 | VOICE_RESET_EGS。bits 2..5は声番号、下位値1がon、2がoff | エッジとして扱う。同じ値の再書き込みもイベント |

## 確度と検証の限界

DX7の通常の音色変更は全声へ同じAlgorithm/Feedbackを書き込む。一方、OPSのダイには16個の設定を保持するシフトレジスタがあり、個別設定経路も報告されている。個別設定を実装した根拠は回路解析であり、著者自身も実機未試験としている。[Ken ShirriffのOPS制御レジスタ解析](https://www.righto.com/2022/02/yamaha-dx7-chip-reverse-engineering_7.html)

VOICE_ADD_POLYの空き声探索は巡回して最大16枠を調べ、全枠がactiveならこのルーチンから戻る。今回のAUTOはこの探索部分を実装した。DX7のMIDI入力バッファ、ペダル、モノ動作を含むファームウェア全体での振る舞いは別途照合する。

PCMはホストのサンプルレートで浮動小数点合成する。96スロットのクロック位相、log-sine ROM、DAC、EGS内部のラッチ遅延は未再現。A4周波数とレジスタ再演の一致はソフトウェアテストによる。実機の全パラメータや音色の一致は未確認。

## 単一キャリアの包絡比較（2026-11-25）

`node scripts/compare_fm21290_envelope.mjs` で同梱MSFAと独自コアを48 kHzで比較する。単一キャリアのA4、velocity 127、3秒押鍵と3秒離鍵、音色のR1/R4を同じ値に固定。L1..L4は99/80/80/0（EGSバイト0/9/9/63）、R2/R3は85（EGSバイト54）。5 msごとのPCMピークを測定した。

| R1/R4編集値（EGS値） | ピークの90%到達 ms（独自 / MSFA） | 定常振幅 dB・ピーク比（独自 / MSFA） | 離鍵後−20 dB到達 ms（独自 / MSFA） |
|---|---:|---:|---:|
| 40（25） | 315 / 310 | −13.5 / −13.5 | 990 / 1000 |
| 60（38） | 30 / 30 | −13.3 / −13.2 | 105 / 105 |
| 80（51） | 0 / 0 | −13.2 / −13.4 | 15 / 15 |

時刻は閾値を通過した窓の開始時刻。0 msは最初の5 ms窓を表す。修正前はR40で離鍵後−20 dBまで160 msだった。下降区間を対数ゲイン上の一定速度にし、立ち上がりの近似速度も調整した。MSFA内部のレート刻みは同梱の `third_party/tetorica-soundchip-native/vendor/msfa/env.cc` を参照した。低い音量からの再打鍵、音域別のrate scaling、曲線全体と実機との一致は未検証。
