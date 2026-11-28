// SPDX-License-Identifier: BSD-3-Clause
const libraryUrl=new URL('../playground/samples/sonic-pi/',import.meta.url);
export async function fetchSample(name){
  const response=await fetch(new URL(encodeURIComponent(name),libraryUrl));
  if(!response.ok)throw Error('Could not load '+name);
  return response;
}

export function setupSampleRomCreator({build,save,defaultName,formats=[]}){
  document.getElementById('rom-creator').innerHTML=`<fieldset id="creator-controls"><legend>ROM <button id="creator-open" type="button">Add samples…</button></legend>
<p id="creator-empty">No samples added.</p><ul id="creator-list" aria-label="ROM samples"></ul></fieldset>
<button id="creator-build" type="button" disabled>Create…</button>
<dialog id="creator-picker" aria-labelledby="creator-picker-title"><h3 id="creator-picker-title">Add samples</h3>
<button type="button" id="creator-import">Import WAV / FLAC…</button><input id="creator-files" hidden type="file" accept=".wav,.flac" multiple>
<button type="button" id="creator-browse" aria-expanded="false" aria-controls="creator-browser">Sonic Pi Library</button>
<div id="creator-browser" hidden><small>Samples marked <code>pi/</code> come from Sonic Pi’s CC0 sample library. <a href="../playground/samples/sonic-pi/README_SONICPI.md" target="_blank" rel="noopener">Sample credits</a></small>
<label>Filter samples<input id="creator-filter" type="search"></label>
<label>Samples<select id="creator-library" multiple size="7"></select></label>
<output id="creator-library-status" role="status"></output>
<button id="creator-add" type="button" disabled>Add selected</button></div>
<button type="button" id="creator-close">Close</button></dialog>
<dialog id="creator-naming" aria-labelledby="creator-name-title"><form id="creator-form">
<h3 id="creator-name-title">Create ROM</h3><label>ROM name<input id="creator-name" required></label>
<output id="creator-status" role="status"></output><button type="submit" id="creator-confirm">Create</button>
<button type="button" id="creator-cancel">Cancel</button></form></dialog>`;
  const el=id=>document.getElementById('creator-'+id);
  const entries=[];
  let names=[],loading=false,revision=0;
  function showLibrary(){
    const query=el('filter').value.toLowerCase();
    el('library').replaceChildren(...names.filter(n=>n.includes(query)).map(n=>new Option('pi/'+n,n)));
    el('add').disabled=true;
    el('library-status').textContent=names.length && !el('library').length?'No matching samples.':'';
  }
  function render(){
    el('list').replaceChildren(...entries.map((entry,index)=>{
      const row=document.createElement('li'),label=document.createElement('span');
      label.textContent=entry.file?entry.name:'pi/'+entry.name;
      const kind=document.createElement('select');kind.setAttribute('aria-label',entry.name+' format');
      for(const format of formats)kind.add(new Option(format,format));
      kind.value=entry.kind;kind.onchange=()=>{entry.kind=kind.value;};
      const remove=document.createElement('button');remove.textContent='Remove';
      remove.onclick=()=>{entries.splice(entries.indexOf(entry),1);render();};
      if(formats.length)row.append(label,kind,remove);
      else{
        const slot=document.createElement('span');
        slot.textContent=String(index);
        row.append(slot,label,remove);
      }
      return row;
    }));
    el('empty').hidden=entries.length>0;
    el('build').disabled=!entries.length;
  }
  function add(name,file){
    if(entries.some(e=>e.name===name && e.file===file))return;
    entries.push({name,file,kind:'PCM'});
  }
  el('open').onclick=()=>{
    el('browser').hidden=true;
    el('browse').setAttribute('aria-expanded','false');
    el('picker').showModal();
  };
  el('import').onclick=()=>el('files').click();
  el('close').onclick=()=>el('picker').close();
  el('browse').onclick=()=>{
    el('browser').hidden=!el('browser').hidden;
    el('browse').setAttribute('aria-expanded',String(!el('browser').hidden));
    if(!el('browser').hidden){load();el('filter').focus();}
  };
  el('filter').oninput=showLibrary;
  el('library').onchange=()=>{el('add').disabled=!el('library').selectedOptions.length;};
  el('add').onclick=()=>{
    for(const option of el('library').selectedOptions)add(option.value);
    render();el('picker').close();
  };
  el('files').onchange=e=>{
    for(const file of e.target.files)add(file.name,file);
    e.target.value='';render();el('picker').close();
  };
  el('build').onclick=()=>{
    el('name').value=defaultName();
    el('status').textContent='';
    el('naming').showModal();
    el('name').select();
  };
  el('cancel').onclick=()=>el('naming').close();
  el('naming').onclose=()=>{revision++;el('confirm').disabled=false;};
  el('form').onsubmit=async event=>{
    event.preventDefault();
    if(el('confirm').disabled)return;
    const name=el('name').value.trim();
    if(!name){el('status').textContent='Enter a ROM name.';return;}
    const buildRevision=revision;
    el('confirm').disabled=true;
    try{
      const result=await build([...entries],n=>{
        if(revision!==buildRevision)throw Error('Cassette changed.');
        el('status').textContent='Converting '+n;
      });
      if(revision!==buildRevision || !el('naming').open)return;
      save(name,result);
      el('naming').close();
    }catch(error){if(revision===buildRevision)el('status').textContent=error.message;}
    finally{if(revision===buildRevision)el('confirm').disabled=false;}
  };
  async function load(){
    if(names.length||loading)return;
    loading=true;
    try{
      const response=await fetchSample('samples.txt');
      names=(await response.text()).trim().split(/\r?\n/);
      showLibrary();
    }catch(error){el('library-status').textContent=error.message;}
    finally{loading=false;}
  }
  function reset(){
    revision++;entries.length=0;
    el('confirm').disabled=false;
    el('status').textContent='';
    el('picker').close();el('naming').close();
    render();
  }
  return {reset};
}
