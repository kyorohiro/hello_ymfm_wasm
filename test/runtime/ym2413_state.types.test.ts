import {Ym2413} from '../../tetorica_src/runtime/ym2413.js';
import {Ym2413AudioEngine} from '../../tetorica_src/runtime/ym2413audioengine.js';
declare const chip: Ym2413;
declare const engine: Ym2413AudioEngine;
const chipState: Readonly<{byteLength:number}> = chip.saveState();
chip.validateState(chipState);chip.loadState(chipState);
const engineState: Readonly<{byteLength:number}> = engine.saveState();
engine.validateState(engineState);engine.loadState(engineState);
const supported: boolean = engine.supportsState() && chip.supportsState();
const key: string = engine.stateSettingsKey();
void supported;void key;
// @ts-expect-error State handles expose no writable byte arrays.
engineState.byteLength = 0;
// @ts-expect-error A state handle is required, not an encoded file.
engine.loadState('snapshot');
