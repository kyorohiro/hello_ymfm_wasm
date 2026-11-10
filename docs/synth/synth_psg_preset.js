import {normalizeSynthPsgSettings} from './synth_psg.js?v=psg-envelope-1';

export const PSG_PRESET_VERSION=2;
export const PSG_PRESET_KIND='tetorica-sega-psg';
const legacyFields=['source','attenuation','noiseType','noiseRate'];
const fields=[...legacyFields,'envelope'];
const envelopeFields=['enabled','attackMs','decayMs','sustain','releaseMs'];
const exactObject=(value,keys,label)=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(value))||
    Reflect.ownKeys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))throw new TypeError(`Invalid ${label}`);
};

/** Recognize the document's chip tag; use normalize/parse to validate contents. */
export const isPsgPreset=value=>value?.kind===PSG_PRESET_KIND;
export const isPsgPresetPath=path=>/\.psg\.json$/i.test(String(path));

/** Validate complete file fields. Version 1 predates the software envelope and
 * migrates to version 2 with that feature Off; read/import keeps original bytes.
 */
export function normalizePsgPreset(value) {
  exactObject(value,['version','kind','settings'],'PSG preset document');
  if(![1,PSG_PRESET_VERSION].includes(value.version)||value.kind!==PSG_PRESET_KIND)throw new Error('Unsupported PSG preset version or kind');
  exactObject(value.settings,value.version===1?legacyFields:fields,'PSG preset settings');
  if(value.version===PSG_PRESET_VERSION)exactObject(value.settings.envelope,envelopeFields,'PSG software envelope');
  const settings=value.version===1?{...value.settings,envelope:{enabled:false}}:value.settings;
  return {version:PSG_PRESET_VERSION,kind:PSG_PRESET_KIND,settings:normalizeSynthPsgSettings(settings)};
}

/** Create a new document from editor settings, applying the editor defaults. */
export const createPsgPreset=(settings={})=>normalizePsgPreset({version:PSG_PRESET_VERSION,kind:PSG_PRESET_KIND,settings:normalizeSynthPsgSettings(settings)});

export function parsePsgPreset(data) {
  let text;
  try {
    if(typeof data==='string')text=data;
    else if(data instanceof Uint8Array||data instanceof ArrayBuffer)text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(data);
    else throw new TypeError('PSG presets require UTF-8 JSON text');
    return normalizePsgPreset(JSON.parse(text));
  } catch(error) {throw new Error(`Invalid PSG preset: ${error.message}`);}
}

export const serializePsgPreset=value=>JSON.stringify(normalizePsgPreset(value),null,2)+'\n';
