import {Ym2612VGM} from '../js/ym2612vgm.js?v=pokey-vgm-1';
import {createGameboyVoices} from './gameboy_voices.js?v=instrument-chips-1';
import {createGameboyWaves} from './gameboy_waves.js';

// Read the command log directly so offline inspection also works for two APUs.
export async function extractGameboyInstruments(source, chipIndex, signal) {
  const parser = new Ym2612VGM(source, {logger:null});
  const voices = createGameboyVoices(chipIndex), waves = createGameboyWaves();
  let time = 0;
  for (let i = 0; ; i++) {
    if (signal?.aborted) throw new DOMException('Cancelled','AbortError');
    const event = parser.step();
    if (event.type === 'wait' || event.type === 'end') waves.flush(time);
    if (event.type === 'end') break;
    if (event.type === 'wait') time += event.samples;
    if (event.type === 'gameboy-dmg-write' && event.chipIndex === chipIndex) {
      voices.apply(event,time);
      waves.apply(event,time);
    }
    if (i % 4096 === 4095) await new Promise(resolve => setTimeout(resolve,0));
  }
  voices.finish(time);
  const offset = waves.samples.length;
  return {
    samples:[...waves.samples,...voices.samples.map(s=>({...s,id:s.id+offset}))],
    events:[...waves.events,...voices.events.map(e=>({...e,chipIndex,sampleId:e.sampleId+offset}))],
    warnings:[...waves.warnings,...voices.warnings],
  };
}
