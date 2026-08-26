import ym2612ModuleFactory from "../../generated/ym2612_wasm.js";
import { createYm2612 } from "../../js/ym2612.js";
import {
  YM2612DirectTransport,
  YM2612Synth,
} from "../../js/ym2612synth.js";

const ym2612 = await createYm2612(ym2612ModuleFactory);

const transport = new YM2612DirectTransport(ym2612);
const synth = new YM2612Synth({ transport });

const CH1 = 0;
const OP1 = 0;
const OP2 = 1;
const OP3 = 2;
const OP4 = 3;

synth.setOperator(CH1, OP1, { tl: 0x7f });
synth.setOperator(CH1, OP2, { tl: 0x7f });
synth.setOperator(CH1, OP3, { tl: 0x7f });

synth.setOperator(CH1, OP4, {
  dt: 0,
  multi: 1,
  tl: 8,
  ar: 22,
  d1r: 6,
  d2r: 3,
  sl: 3,
  rr: 8,
});

synth.setAlgo(CH1, 7, 0);
synth.setPan(CH1, true, true);

synth.noteOn(CH1, 4, 553);

// Later:
synth.noteOff(CH1);
