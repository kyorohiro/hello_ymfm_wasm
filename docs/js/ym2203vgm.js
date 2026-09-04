/**
 * YM2203 VGM facade. The shared parser remains in ym2612vgm.js for
 * compatibility while the export policy targets native YM2203 registers.
 */
export {
  Ym2612VGM as Ym2203VGM,
  exportYm2203VgmToPlaygroundJavaScript,
} from "./ym2612vgm.js";
