// SPDX-License-Identifier: BSD-3-Clause
// Installed-package inspection: no AudioContext, WASM instance or output device.
import {fileURLToPath} from 'node:url';
import {realpathSync} from 'node:fs';
import {buildGameboyOperations, compileGameboyOperations, createGameboyOperationResetState}
  from 'tetorica-fm2612/gameboy_operations.js';
import {buildSidOperations, compileSidOperations, createSidOperationResetState}
  from 'tetorica-fm2612/sid_operations.js';

export function runDmgSidCompileExample() {
  // Hardware reset is uninitialized. Raw writes can be inspected from that
  // baseline without initializing a real chip or pretending it is ready.
  const dmgBaseline = createGameboyOperationResetState();
  const dmgBefore = JSON.stringify(dmgBaseline);
  const dmgWrites = compileGameboyOperations(buildGameboyOperations(b => {
    b.atSample(0).writeRegister(0x16, 0x80); // NR52: power on
    b.writeRegister(0x14, 0x77);             // NR50: left/right master level
    b.writeRegister(0x15, 0x11);             // NR51: CH1 left + right
    b.writeRegister(0x01, 0x80);             // NR11: duty
    b.writeRegister(0x02, 0x90);             // NR12: envelope/DAC
    b.writeRegister(0x03, 0x80);             // NR13: frequency low
    b.writeRegister(0x04, 0x87);             // NR14: frequency high + trigger
    b.atSeconds(.2).writeRegister(0x02, 0);  // DAC off
  }), dmgBaseline);
  if (JSON.stringify(dmgBaseline) !== dmgBefore) throw Error('DMG compilation changed its baseline');

  const sidBaseline = createSidOperationResetState({model:'6581'});
  const sidBefore = JSON.stringify(sidBaseline);
  const sidWrites = compileSidOperations(buildSidOperations(b => {
    b.atSample(0).writeRegister(5, 0x24); // CH1 attack/decay
    b.writeRegister(6, 0xa5);            // CH1 sustain/release
    b.writeRegister(24, 8);             // hardware volume
    b.writeRegister(0, 0x68);            // frequency low
    b.writeRegister(1, 0x11);            // frequency high
    b.writeRegister(4, 0x21);            // saw + Gate
    b.writeRegister(4, 0x21);            // repeated event write is retained
    b.atSample(8820).writeRegister(4, 0x20);
  }), sidBaseline, {model:'6581', clock:sidBaseline.clock});
  const sidComparison = compileSidOperations(buildSidOperations(b => {
    b.writeRegister(4, 0x11); // triangle + Gate, from exactly the same baseline
  }), sidBaseline, {model:'6581', clock:sidBaseline.clock});
  if (JSON.stringify(sidBaseline) !== sidBefore) throw Error('SID compilation changed its baseline');
  return {dmgWrites, sidWrites, sidComparison};
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {dmgWrites, sidWrites, sidComparison} = runDmgSidCompileExample();
  console.log('DMG register writes (normalized addresses 0x00..0x2f):');
  console.table(dmgWrites);
  console.log('SID register writes; repeated Gate writes stay visible:');
  console.table(sidWrites);
  console.log('Another SID operation from the same unchanged reset baseline:');
  console.table(sidComparison);
}
