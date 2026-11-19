import {Ym2608,normalizeYm2608SourceGains,type Ym2608SourceGains} from '../../tetorica_src/runtime/ym2608.js';
import {Ym2608AudioEngine} from '../../tetorica_src/runtime/ym2608audioengine.js';
import {YM2608RuntimeSynth} from '../../tetorica_src/runtime/ym2608synth.js';
import type {WasmModuleFactory} from '../../tetorica_src/runtime/soundchip.js';

async function sourceGainContracts(chip:Ym2608, engine:Ym2608AudioEngine, factory:WasmModuleFactory) {
  const normalized:Ym2608SourceGains=normalizeYm2608SourceGains({rhythm:.5});
  const chipResult:Ym2608SourceGains=chip.setSourceGains({fm:.5,ssg:.6,rhythm:.7,adpcm:.8});
  const engineResult:Ym2608SourceGains=engine.setSourceGains({adpcm:.25});
  const runtime=new YM2608RuntimeSynth({sourceGains:{fm:.4,rhythm:.5}});
  const runtimeResult:Ym2608SourceGains=runtime.setSourceGains({ssg:.7});
  const created=await Ym2608AudioEngine.create({
    ym2608ModuleFactory:factory,sourceGains:{fm:1,ssg:1,rhythm:0,adpcm:.5},
  });
  const read:Ym2608SourceGains=created.getSourceGains();
  const legacy:{fm:number,ssg:number}=chip.getOutputGains();
  // @ts-expect-error Independent sources have no DAC source field.
  chip.setSourceGains({dac:.5});
  // @ts-expect-error Source faders accept numbers, not UI strings.
  engine.setSourceGains({adpcm:'50%'});
  // @ts-expect-error Legacy bus controls do not accept independent sources.
  runtime.setOutputGains({rhythm:1});
  // @ts-expect-error Source-gain construction rejects unknown sources.
  new YM2608RuntimeSynth({sourceGains:{pwm:1}});
  void [normalized,chipResult,engineResult,runtimeResult,read,legacy];
}
void sourceGainContracts;
