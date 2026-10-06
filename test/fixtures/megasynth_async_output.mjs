import {createOutput as createBase} from './megasynth_output.mjs';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let closedOutputs = 0;

/** Models an application backend with async writes and device lifecycle. */
export async function createOutput(options) {
  const base = await createBase(options);
  let started = false;
  return {
    frames: base.frames,
    get queuedFrames() {return base.queuedFrames;},
    async write(pcm) {await wait(2); base.write(pcm);},
    async start() {await wait(1); base.start(); started = true;},
    async stop() {await wait(1); base.stop(); started = false;},
    async close() {await wait(10); base.close(); closedOutputs++;},
    getState() {return {...base.getState(), started, closedOutputs};},
  };
}
