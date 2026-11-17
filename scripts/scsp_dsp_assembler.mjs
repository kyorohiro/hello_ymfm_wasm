#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
// Local experimental codec only. Importing these modules opens no audio device.
import {readFile,writeFile} from 'node:fs/promises';
import {assembleScspDsp,disassembleScspDsp} from '../docs/synth-scsp/dsp_assembler.js';
import {delayProgram} from '../docs/synth-scsp/dsp.js';

const usage=`Usage:
  node scripts/scsp_dsp_assembler.mjs disassemble --delay [--out file.scspasm]
  node scripts/scsp_dsp_assembler.mjs disassemble words.json [--out file.scspasm]
  node scripts/scsp_dsp_assembler.mjs assemble program.scspasm [--out words.json]

JSON contains exactly 512 unsigned 16-bit word values in DSP program order.
Without --out, the result is printed to stdout. Existing output files are kept.
This tool does not upload programs or start audio. Syntax is provisional and
does not claim compatibility with SEGA's assembler.
`;

async function main(args){
  if(args.length===1&&['--help','-h'].includes(args[0])){process.stdout.write(usage);return;}
  const [action,input,...options]=args;
  if(!['assemble','disassemble'].includes(action)||!input||
    (options.length!==0&&!(options.length===2&&options[0]==='--out'&&options[1]&&!options[1].startsWith('--')))||
    (input.startsWith('--')&&!(action==='disassemble'&&input==='--delay')))
    throw new Error(usage.trimEnd());

  let result;
  if(action==='assemble'){
    const program=assembleScspDsp(await readFile(input,'utf8'));
    result=JSON.stringify(Array.from(program),null,2)+'\n';
  }else{
    const words=input==='--delay'?delayProgram():JSON.parse(await readFile(input,'utf8'));
    result=disassembleScspDsp(words);
    if(!result.endsWith('\n'))result+='\n';
  }
  if(options.length)await writeFile(options[1],result,{encoding:'utf8',flag:'wx'});
  else process.stdout.write(result);
}

main(process.argv.slice(2)).catch(error=>{
  process.stderr.write('SCSP DSP assembler: '+error.message+'\n');
  process.exitCode=1;
});
