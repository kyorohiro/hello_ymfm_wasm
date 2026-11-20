// SPDX-License-Identifier: BSD-3-Clause
// Installed-package inspection: no AudioContext, WASM instance or output device.
import {fileURLToPath} from 'node:url';
import {realpathSync} from 'node:fs';
import {buildPsgOperations, compilePsgOperations, createPsgOperationResetState}
  from 'tetorica-fm2612/segapsg_operations.js';
import {buildOpllOperations, compileOpllOperations, createOpllOperationResetState}
  from 'tetorica-fm2612/ym2413_operations.js';

export function runCompileExample() {
  const psgState = createPsgOperationResetState({stereoEnabled:true});
  const psgPlan = buildPsgOperations(b => {
    b.atSample(0).setAttenuation(0, 3).noteOn(0, 'E3');
    b.atSeconds(.1).off(0);
    b.atSample(6615).noise({type:'white', rate:'high', attenuation:8});
    b.atSeconds(.2).noiseOff();
  });
  const psgWrites = compilePsgOperations(psgPlan, psgState);

  const baseline = createOpllOperationResetState();
  baseline.registers[3] = 0xa8; // Waveform/KSL bits coexist with Feedback.
  const before = JSON.stringify(baseline);
  const opllPlan = buildOpllOperations(b => {
    b.atSample(0).setUserPatch({feedback:2, operators:[
      {multi:2, tl:18, ar:15, dr:6, sl:7, rr:6, egt:true},
      {multi:1, ar:15, dr:5, sl:6, rr:7, egt:true},
    ]});
    b.atSeconds(.1).setVoice(0, {instrument:0, attenuation:4}).noteOn(0, 'E3');
    b.atSeconds(.2).setUserOperator(0, {tl:6});
    b.atSeconds(.3).noteOff(0);
  });
  const opllWrites = compileOpllOperations(opllPlan, baseline);
  // Reuse the same baseline for another forecast. Compiling does not mutate it.
  const comparison = compileOpllOperations(
    buildOpllOperations(b => b.setUserOperator(0, {waveform:1})), baseline,
  );
  if (JSON.stringify(baseline) !== before) throw Error('Compilation modified its baseline');
  return {psgWrites, opllWrites, comparison};
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {psgWrites, opllWrites, comparison} = runCompileExample();
  console.log('Sega PSG command bytes (logical register / channel included):');
  console.table(psgWrites);
  console.log('YM2413 address/value writes:');
  console.table(opllWrites);
  console.log('Another operation from the same unchanged YM2413 baseline:');
  console.table(comparison);
}
