// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {API} from 'typescript/unstable/sync';
import {createVirtualFileSystem} from 'typescript/unstable/fs';

const globals = await readFile(new URL('../../docs/playground/tetorica-playground-globals.d.ts', import.meta.url), 'utf8');
const example = await readFile(new URL('../../packages/fm2612/examples/timed-registers/playground.js', import.meta.url), 'utf8');

function check(source, selectedChip='master-system') {
  const root = resolve('.'), directory = resolve(root, '__sega_timed_public_types__');
  const config = resolve(directory, 'tsconfig.json');
  const api = new API({cwd:root, fs:createVirtualFileSystem({
    [config]:JSON.stringify({compilerOptions:{strict:true,noEmit:true,skipLibCheck:false,
      target:'es2022',module:'esnext',types:[],lib:['es2022','dom']},files:['globals.d.ts','example.ts']}),
    [resolve(directory,'globals.d.ts')]:`type TetoricaSelectedChip = '${selectedChip}';\n${globals}`,
    [resolve(directory,'example.ts')]:`${source}\nexport {};\n`,
  })});
  try {
    const snapshot = api.updateSnapshot({openProjects:[config]});
    try {
      const project = snapshot.getProject(config);
      assert(project, 'strict public declaration project exists');
      const program = project.program;
      return [...program.getConfigFileParsingDiagnostics(), ...program.getProgramDiagnostics(),
        ...program.getSyntacticDiagnostics(), ...program.getBindDiagnostics(),
        ...program.getGlobalDiagnostics(), ...program.getSemanticDiagnostics()];
    } finally { snapshot.dispose(); }
  } finally { api.close(); }
}
const format = diagnostics => diagnostics.map(d=>`${d.fileName??'<config>'}:${d.pos} TS${d.code} ${d.text}`).join('\n');

test('common Sega PSG/YM2413 timed APIs and packaged Code example have strict public types', () => {
  const usage = `
const psgChip=await useSoundChip('segapsg');
const opllChip=await createSoundChip('ym2413');
const pulse=psgChip.build(b=>{
  b.atSample(0).setPeriod(CH1,100).noteOn(CH1,'C4');
  b.atSeconds(.01).setAttenuation(CH1,5).off(CH1);
  b.noise({type:'white',rate:'high',attenuation:8}).noiseOff();
}, {referenceSampleRate:48000});
const bell=opllChip.build(b=>{
  b.setUserOperator(OP1,{tl:20,ar:15});
  b.setUserOperator(OP2,{multi:2,ar:15});
  b.setUserPatch([0,0,0,0,0,0,0,0]);
  b.atSample(0).noteOn(CH9,'C4').setVoice(CH9,{attenuation:5});
  b.atSeconds(.05).setRhythm({enabled:true,snare:true}).setRhythmLevel('snare',4);
  b.noteOff(CH9);
});
const psgSnapshot=await psgChip.captureState(), opllSnapshot=await opllChip.captureState();
const psgTraces:PlaygroundSegaPsgCompiledWrite[][]=await Promise.all([
  psgChip.compile(pulse),psgChip.compile(pulse,{initialState:'reset'}),
  psgChip.compile(pulse,{initialState:'client'}),psgChip.compile(pulse,{initialState:psgSnapshot}),
]);
const opllTraces:PlaygroundYm2413CompiledWrite[][]=await Promise.all([
  opllChip.compile(bell),opllChip.compile(bell,{initialState:'reset'}),
  opllChip.compile(bell,{initialState:'client'}),opllChip.compile(bell,{initialState:opllSnapshot}),
]);
for(const trace of psgTraces)for(const row of trace){
  const seconds:number=row.offsetSeconds;
  if('stereo' in row){const mask:number=row.stereo;void mask;}
  else {const command:number=row.value;const reg:number=row.register;void command;void reg;}
  void seconds;
}
await psgChip.schedule(pulse,{name:'pulse',repeatSeconds:.1});
await opllChip.schedule(bell,{name:'bell'});
const cleared:boolean=await opllChip.clearSchedule('bell');void cleared;void opllTraces;
// The Master System/Game Gear primary psg API inherits the same recorder.
psg.build(b=>b.keyOn(CH1).off(CH1));
`;
  for(const mode of ['master-system','game-gear']) {
    const diagnostics=check(`${example}\n${usage}`,mode);
    assert.equal(diagnostics.length,0,format(diagnostics));
  }
});

test('common recorder types reject unsupported operators/channels/data and mixed snapshots', () => {
  const negative = `
const psgChip=await useSoundChip('segapsg'),opllChip=await useSoundChip('ym2413');
const pulse=psgChip.build(b=>{
  // @ts-expect-error Noise is not a tone channel.
  b.noteOn(CH4,'C4');
  // @ts-expect-error Tone period is not a Noise register.
  b.setPeriod(CH4,4);
  // @ts-expect-error Reset is not a recorded operation.
  b.reset();
});
const bell=opllChip.build(b=>{
  // @ts-expect-error Carrier TL is not part of the shared user patch.
  b.setUserOperator(OP2,{tl:24});
  // @ts-expect-error Only nine OPLL melody channels exist.
  b.noteOn(9,'C4');
  // @ts-expect-error Recorded patches require plain number arrays.
  b.setUserPatch(new Uint8Array(8));
  // @ts-expect-error Nested recorded presets also require plain patch data.
  b.setPreset(CH1,{instrument:0,userPatch:new Uint8Array(8)});
  // @ts-expect-error A structured user patch also has no carrier TL.
  b.setUserPatch({operators:[{tl:3},{tl:6}]});
  // @ts-expect-error Nested presets preserve the same modulator/carrier distinction.
  b.setPreset(CH1,{userPatch:{operators:[{},{tl:6}]}});
});
// @ts-expect-error Build callbacks execute synchronously once.
psgChip.build(async b=>b.off(CH1));
// @ts-expect-error Build callbacks execute synchronously once.
opllChip.build(async b=>b.noteOff(CH1));
const snapshot=await opllChip.captureState();
// @ts-expect-error Snapshots are chip specific.
await psgChip.compile(pulse,{initialState:snapshot});
// @ts-expect-error Reservations require a name.
await opllChip.schedule(bell,{});
// @ts-expect-error Only documented baselines are accepted.
await opllChip.compile(bell,{initialState:'live'});
`;
  const diagnostics=check(negative);
  assert.equal(diagnostics.length,0,format(diagnostics));
  const raw=check(negative.replace(/^\s*\/\/ @ts-expect-error.*$/gm,''));
  assert(raw.length>=14,format(raw));
});
