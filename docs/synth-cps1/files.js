// SPDX-License-Identifier: BSD-3-Clause
import {createPlaygroundCassetteZip,loadPlaygroundCassette} from '../playground/playground_cassette.js';
import {Ym2151VoiceInspector} from '../js/playground_ym2151_inspector.js';

const decode = bytes => new TextDecoder('utf-8',{fatal:true}).decode(bytes);
const voicePatch = ({algorithm,feedback,pan,ams,pms,operators}) => ({algorithm,feedback,pan,ams,pms,operators});
const voicePath = i => 'presets/ch'+(i+1)+'.fm.json';
const bankPath = i => 'banks/'+i+'.rom';
const presetPath = i => 'presets/saved-'+(i+1)+'.fm.json';

export function setupFiles({inspector,panel,defaultBank,applyBank,getCode,setCode,stop}) {
  const el = id => document.getElementById(id);
  let banks = [defaultBank], presets = [], active = 0;
  const report = message => {el('fileStatus').textContent = message;};
  function render() {
    const voices = Array.from({length:8},(_,i) => new Option('/'+voicePath(i),i));
    presets.forEach((_,i) => voices.push(new Option('/'+presetPath(i),8+i)));
    el('fmFiles').replaceChildren(...voices);
    el('fmFiles').value = String(panel.getSelectedChannel());
    el('romFiles').replaceChildren(...banks.map(({name},i) => new Option(name,i)));
    el('romFiles').value = String(active);
  }
  function useBank(index) {
    active = index;
    const {bytes,names,name} = banks[index];
    applyBank(bytes,names,name);
    el('romFiles').value = String(index);
  }
  function addBank(bytes,names,name) {
    banks.push({bytes,names,name});
    render(); useBank(banks.length-1);
  }
  el('loadBank').onclick = () => {useBank(Number(el('romFiles').value));report('Loaded '+banks[active].name); document.querySelector('[data-tab="pcm"]').click();};
  el('loadVoice').onclick = () => {
    const i = Number(el('fmFiles').value), ch = panel.getSelectedChannel();
    const patch = i<8 ? voicePatch(inspector.read().channels[i]) : presets[i-8];
    inspector.invoke('setVoice',[ch,patch]); report('Loaded voice on CH'+(ch+1));
  };
  el('saveVoice').onclick = () => {
    presets.push(voicePatch(inspector.read().channels[panel.getSelectedChannel()]));
    render(); el('fmFiles').value = String(7+presets.length);
    report('Saved /'+presetPath(presets.length-1));
  };
  el('openCode').onclick = () => document.querySelector('[data-tab="code"]').click();
  el('exportCassette').onclick = () => {
    try {
      const state = inspector.read();
      const text = (path,data) => ({path,type:'text',data});
      const files = [text('index.js',getCode())];
      state.channels.forEach((v,i) => files.push(text(voicePath(i),JSON.stringify(voicePatch(v)))));
      presets.forEach((v,i) => files.push(text(presetPath(i),JSON.stringify(v))));
      banks.forEach(({bytes},i) => files.push({path:bankPath(i),type:'binary',data:bytes}));
      const cps1 = {version:1,lfo:state.lfo,noise:state.noise,active,presets:presets.length,
        banks:banks.map(({name,names}) => ({name,names}))};
      const zip = createPlaygroundCassetteZip(files,{metadata:{cps1}});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([zip],{type:'application/zip'}));
      a.download = 'tetorica-cps1.cassette.zip'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href),1000);
      report('Exported Cassette');
    } catch (error) {report(error.message);}
  };
  el('importCassette').onchange = async event => {
    const file = event.target.files[0]; event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 16*1024*1024) throw Error('Cassette exceeds 16 MiB.');
      const {files,metadata} = await loadPlaygroundCassette(await file.arrayBuffer());
      const m = metadata.cps1;
      if (m?.version!==1 || !Array.isArray(m.banks) || !m.banks.length ||
          !Number.isInteger(m.active) || !m.banks[m.active] || !Number.isInteger(m.presets) ||
          m.presets<0 || m.presets>files.size) throw Error('Invalid CPS1 Cassette.');
      const read = path => {
        if (!files.has(path)) throw Error('Missing '+path);
        return files.get(path);
      };
      const nextCode = decode(read('index.js'));
      const nextBanks = m.banks.map(({name,names},i) => {
        const bytes = read(bankPath(i));
        if (typeof name!=='string' || !Array.isArray(names) || !names.length || names.length>128 ||
            !names.every(v=>typeof v==='string') || bytes.length<8 || bytes.length>0x40000) throw Error('Invalid sample bank.');
        return {name,names,bytes};
      });
      const validator = new Ym2151VoiceInspector({dispatch(){}});
      const loadVoice = path => {
        const patch = JSON.parse(decode(read(path)));
        if (!Array.isArray(patch?.operators) || patch.operators.length!==4) throw Error('Invalid FM voice in '+path);
        validator.invoke('setVoice',[0,patch]); return patch;
      };
      const voices = Array.from({length:8},(_,i) => loadVoice(voicePath(i)));
      const nextPresets = Array.from({length:m.presets},(_,i) => loadVoice(presetPath(i)));
      validator.invoke('setLFO',[m.lfo]); validator.invoke('setNoise',[m.noise]);
      if (!window.confirm('Replace the current voices, sample banks and code with this Cassette?')) return;
      stop();
      voices.forEach((v,i) => inspector.invoke('setVoice',[i,v]));
      inspector.invoke('setLFO',[m.lfo]); inspector.invoke('setNoise',[m.noise]);
      banks=nextBanks; presets=nextPresets; active=m.active;
      render(); useBank(active); setCode(nextCode); report('Imported '+file.name);
    } catch (error) {report(error.message);}
  };
  render();
  return {addBank,restoreKit() {
    let i=banks.findIndex(bank=>bank===defaultBank);
    if (i<0) {banks.push(defaultBank);i=banks.length-1;render();}
    useBank(i);
  }};
}
