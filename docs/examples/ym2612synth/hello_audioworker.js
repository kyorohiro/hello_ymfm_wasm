import {
  YM2612Synth,
  YM2612WorkletTransport,
} from "../../js/ym2612synth.js";

const audioContext = new AudioContext();

await audioContext.audioWorklet.addModule("../../js/ym2612-worklet.js");

const node = new AudioWorkletNode(
  audioContext,
  "ym2612-processor",
  {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  }
);

node.connect(audioContext.destination);

// Wait until the YM2612 WASM instance is ready inside AudioWorklet.
const ready = new Promise((resolve, reject) => {
  node.port.onmessage = (event) => {
    if (event.data?.type === "ready") {
      resolve();
    }

    if (event.data?.type === "error") {
      reject(new Error(event.data.message));
    }
  };
});

node.port.postMessage({
  type: "initialize",
});

await ready;

const transport = new YM2612WorkletTransport(node);
const synth = new YM2612Synth({ transport });

const CH1 = 0;
const OP1 = 0;
const OP2 = 1;
const OP3 = 2;
const OP4 = 3;

// Use operator 4 only.
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

await audioContext.resume();

synth.noteOn(CH1, 4, 553);

setTimeout(() => {
  synth.noteOff(CH1);
}, 1000);
