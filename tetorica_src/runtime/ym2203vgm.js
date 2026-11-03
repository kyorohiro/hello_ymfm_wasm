/**
 * @file ym2203vgm.js
 * 実行環境: Browser / Node.js
 * 依存: JavaScript のデータ処理。DOM・Web Audio への依存なし。
 */
/**
 * YM2203 VGM facade. The shared parser remains in ym2612vgm.js for
 * compatibility while the export policy targets native YM2203 registers.
 */
export {
  Ym2612VGM as Ym2203VGM,
  exportYm2203VgmToPlaygroundJavaScript,
} from "./ym2612vgm.js";
