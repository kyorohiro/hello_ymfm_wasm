import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {selectPlaygroundDeclarations} from './playground_declarations.js';
import {selectSynthCodeDeclarations} from '../synth/synth_code_declarations.js';
import {selectSpuCodeDeclarations} from '../synth-spu/code_declarations.js';
import {selectSidCodeDeclarations} from '../synth-sid/code_declarations.js';

const source=await readFile(new URL('./tetorica-playground-globals.d.ts',import.meta.url),'utf8');
const usage=`export {};
const bytes=new Uint8Array([1,2,3]);
const bank:Ps1VabBank=readVab(bytes);
const split:Ps1VabBank=pg.readVab(bytes.buffer,new DataView(bytes.buffer));
const version:6|7=bank.version;
const program:Ps1VabProgram=bank.programs[0];
const tone:Ps1VabTone=program.tones[0];
const sample:Ps1VabSample=bank.samples[0];
const raw:Uint8Array=sample.bytes;
const prepared:Ps1VabPreparedTone=prepareVabTone(bank,0);
const other:Ps1VabPreparedTone=pg.prepareVabTone(split,1);
const base:number=prepared.options.baseFrequencyHz;
const loop:number|undefined=prepared.options.loopStartSamples;
const send:boolean=prepared.preset.reverb;
const settings:Ps1VabExportOptions={toneNumber:1};
const full:Uint8Array=exportVab(bank),single:Uint8Array=pg.exportVab(bank,settings);
const limit:number=MAX_VAB_FILE_BYTES+pg.MAX_VAB_FILE_BYTES;
// @ts-expect-error byte input never means a path or a network fetch
readVab('bank.vab');
// @ts-expect-error no guessed filename/pair resolver
pg.readVab(bytes,'bank.vb');
// @ts-expect-error choose the global numeric index, not a Tone object
prepareVabTone(bank,tone);
// @ts-expect-error export accepts the original parsed bank, not raw bytes
exportVab(bytes);
// @ts-expect-error standard VAB export never encodes edited PCM
pg.exportVab(bank,{pcm:new Float32Array(112)});
// @ts-expect-error prepared sample has explicit frequency tuning, no inferred root note
prepared.options.rootNote;
// @ts-expect-error samples are raw bytes, not decoded PCM
const pcm:Float32Array=sample.bytes;
`;

test('VAB completion types stay precise in all primary modes and shared Synth Code hosts',async()=>{
  const work=await mkdtemp(join(tmpdir(),'playground-vab-types-'));
  try {
    const profiles=[['ym2612',selectPlaygroundDeclarations(source,'ym2612')],['ps1',selectPlaygroundDeclarations(source,'ps1')],
      ['snes',selectPlaygroundDeclarations(source,'snes')],['fm-code',selectSynthCodeDeclarations(source)],
      ['spu-code',selectSpuCodeDeclarations(source)],['sid-code',selectSidCodeDeclarations(source)]];
    const compiler=fileURLToPath(new URL('../../node_modules/typescript/bin/tsc',import.meta.url));
    for(const [name,declarations]of profiles){
      const path=join(work,name);await mkdir(path);await writeFile(join(path,'globals.d.ts'),declarations);
      await writeFile(join(path,'entry.ts'),usage);
      const selector=name.endsWith('-code')?'':`type TetoricaSelectedChip='${name}';\n`;
      await writeFile(join(path,'selected.d.ts'),selector);
      try{execFileSync(process.execPath,[compiler,'--strict','--noEmit','--skipLibCheck','false','--target','ES2022','--module','ESNext',
        '--moduleResolution','Bundler','--lib','ES2022,DOM',join(path,'globals.d.ts'),join(path,'selected.d.ts'),join(path,'entry.ts')],{stdio:'pipe'});}
      catch(error){assert.fail(`${name}: ${error.stdout?.toString()??error.message}`);}
    }
  }finally{await rm(work,{recursive:true,force:true});}
});
