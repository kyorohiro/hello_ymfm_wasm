// Compare the same VGM timeline using legacy PWM and the experimental MAME adapter.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {maybeDecodeVgmFile} from '../web/vgm_file.js';
import {Ym2612VGM} from '../web/ym2612vgm.js';
import {getNodePlaybackFactory} from '../cli/render.js';
import {createPlaybackEngine,createPlaybackPlayer} from '../docs/vgm_analyzer/playback_core.js';
import {renderVgmToWav} from '../docs/vgm_analyzer/vgm_wav.js';
const [input,prefix='output/pwm-comparison',seconds='10',pwmOutputMode='duty']=process.argv.slice(2);
if(!input)throw new Error('Usage: node scripts/compare_pwm.mjs song.vgz output/prefix [seconds] [duty|dac]');
if(!['duty','dac'].includes(pwmOutputMode))throw new Error('output mode must be duty or dac');
const maxSeconds=Number(seconds);if(!Number.isFinite(maxSeconds)||maxSeconds<=0||maxSeconds>600)throw new Error('seconds must be >0 and <=600');
const source=await readFile(input),buffer=await maybeDecodeVgmFile(source),parser=new Ym2612VGM(buffer,{logger:null});
if(!parser.header.pwmClock)throw new Error('This VGM has no 32X PWM clock');
await mkdir(dirname(resolve(prefix)),{recursive:true});
for(const pwmModel of ['legacy','mame']){
 const engine=await createPlaybackEngine(parser,{getFactory:getNodePlaybackFactory,pwmModel,pwmOutputMode});
 try {const player=createPlaybackPlayer(engine,buffer);player.play();const result=await renderVgmToWav(player,{maxSeconds});
  await writeFile(`${prefix}-${pwmModel}.wav`,result.bytes);console.log(`${pwmModel}: ${prefix}-${pwmModel}.wav`);
 }finally{engine.dispose();}
}
await writeFile(`${prefix}.json`,JSON.stringify({source:input,sha256:createHash('sha256').update(source).digest('hex'),pwmClock:parser.header.pwmClock,maxSeconds,startSeconds:0,pwmOutputMode,
 notice:'Experimental comparison: default duty output matches legacy PWM amplitude scaling; FIFO/timer and strict routing differ. Optional dac output uses MAME fixed 12-bit scaling. Not a claim of real-hardware equivalence.'},null,2)+'\n');
