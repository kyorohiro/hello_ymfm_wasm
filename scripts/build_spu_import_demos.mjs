// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
// Reproducible original fixtures for manual import; no dependency on release/.
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {zipSync} from '../docs/playground/vendor/fflate.js';
import {createVabFixture} from '../test/helpers/spu_vab_fixture.mjs';
import {createPsfFixture} from '../test/helpers/spu_psf_fixture.mjs';

const defaultDirectory=fileURLToPath(new URL('../docs/playground/samples/spu-import/',import.meta.url));
const help=new TextEncoder().encode(`Original synthetic PS1 sound bank demos. No game code, game samples or recordings.
Data and generator: BSD-3-Clause; see LICENSE.

SPU Synth: PSF / VAB tab. Playground: PS1 mode -> SPU -> Prepare audio.
For VAB, open spu-synth-demo.vab, or select demo.vh and demo.vb together.
For PSF, extract this ZIP, Open PSF folder and choose Demo. Select track.minipsf,
Extract VAB banks, choose a bank/Tone and load it. Use the keyboard to play.
MiniPSF needs all three files in Demo, including the lib subdirectory.
`);

export async function buildSpuImportDemos({outDir=defaultDirectory,check=false}={}) {
  const {vab,vh,vb}=createVabFixture(),fixture=createPsfFixture();
  const license=new Uint8Array(await readFile(new URL('../LICENSE',import.meta.url)));
  const psfFiles={};
  for(const file of fixture.files)psfFiles[file.webkitRelativePath]=new Uint8Array(await file.arrayBuffer());
  const contents={...psfFiles,'README.txt':help,LICENSE:license};
  const archive={};
  for(const [name,bytes] of Object.entries(contents))archive[name]=[bytes,{mtime:new Date(2026,0,1),level:9}];
  const outputs={...psfFiles,'spu-synth-demo.vab':vab,'demo.vh':vh,'demo.vb':vb,
    'standalone.psf':fixture.standalone,'spu-psf-demo.zip':zipSync(archive),LICENSE:license};
  for(const [name,bytes]of Object.entries(outputs)) {
    const path=join(outDir,name);
    if(check) {
      const existing=await readFile(path);
      if(!existing.equals(Buffer.from(bytes)))throw new Error(`SPU demo is stale: ${path}`);
    }else {await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes);}
  }
  return {files:Object.keys(outputs).length,check,directory:outDir};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv.slice(2).some(arg=>arg!=='--check'))throw new Error('Usage: node scripts/build_spu_import_demos.mjs [--check]');
  console.log(JSON.stringify(await buildSpuImportDemos({check:process.argv.includes('--check')})));
}
