import {Ym2612VGM, rawCommandLength} from '../js/ym2612vgm.js';

// Keep the original bytes and sparse scalar edits, never a JSON object per command.
export class CommandEditor {
  constructor(source) {
    this.parser = new Ym2612VGM(source,{logger:null});
    this.bytes = this.parser.bytes;
    this.edits = new Map();
    this.history = [];
    this.starts = [this.parser.header.dataOffset];
  }
  row(offset) {
    const length = rawCommandLength(this.bytes,this.parser.view,offset);
    if (offset + length > this.bytes.length) throw new Error(`Truncated command at ${offset}`);
    const op = this.bytes[offset];
    const wait = op === 0x61;
    const writable = wait || op === 0x50 || (op >= 0x51 && op <= 0x5f) || op === 0xa0
      || [0xb3,0xb4,0xb8,0xb9,0xd0,0xd2].includes(op);
    const original = wait ? this.parser.view.getUint16(offset+1,true) : this.bytes[offset+length-1];
    const preview = Array.from(this.bytes.subarray(offset,offset+Math.min(length,12)),b=>b.toString(16).padStart(2,'0')).join(' ');
    return {offset,length,op,writable,wait,original,value:this.edits.get(offset) ?? original,
      preview:preview+(length>12?` … (${length} bytes)`:''),
      description:op===0x67?'Data block (read only)':this.parser.describeCommandAt(offset)};
  }
  page(index) {
    if (!Number.isInteger(index) || index < 0 || this.starts[index] === undefined) throw new Error('Page not visited');
    const rows=[]; let offset=this.starts[index],end=false;
    while(rows.length<100 && offset<this.bytes.length){
      const row=this.row(offset); rows.push(row); offset+=row.length;
      if(row.op===0x66){end=true;break;}
    }
    const more=!end && offset<this.bytes.length;
    if(more)this.starts[index+1]=offset;
    return {rows,more};
  }
  edit(offset,value) {
    // Only offsets exposed by a visited page can be edited.
    let valid=false;
    const start=this.starts.findLast(p=>p<=offset);
    if(start!==undefined){
      let p=start;
      for(let i=0;i<100 && p<=offset && p<this.bytes.length;i++){
        if(p===offset){valid=true;break;}
        const row=this.row(p); if(row.op===0x66)break; p+=row.length;
      }
    }
    if(!valid)throw new Error('Not a command boundary on a visited page');
    const row=this.row(offset);
    if(!row.writable || !Number.isInteger(value) || value<0 || value>(row.wait?65535:255))throw new Error('Value is out of range or command is read only');
    if(row.value===value)return;
    this.history.push([offset,row.value]);
    if(this.history.length>1000)this.history.shift();
    if(value===row.original)this.edits.delete(offset);else this.edits.set(offset,value);
  }
  undo(){const entry=this.history.pop();if(!entry)return;const [offset,value]=entry;
    if(value===this.row(offset).original)this.edits.delete(offset);else this.edits.set(offset,value);
  }
  reset(){this.edits.clear();this.history=[];}
  async build() {
    const out=this.bytes.slice(),view=new DataView(out.buffer,out.byteOffset,out.byteLength);
    for(const [offset,value] of this.edits){const row=this.row(offset);
      if(row.wait)view.setUint16(offset+1,value,true);else out[offset+row.length-1]=value;
    }
    // Fixed command sizes preserve loop/GD3/data offsets. Recount wait samples only
    // when timing changed; reject unsupported/truncated streams instead of guessing.
    if([...this.edits.keys()].some(offset=>this.bytes[offset]===0x61)){
      let total=0,loopStart=null,ended=false,count=0;
      for(let p=this.parser.header.dataOffset;p<out.length;){
        if(p===this.parser.header.loopOffset)loopStart=total;
        const op=out[p],length=rawCommandLength(out,view,p);
        if(p+length>out.length)throw new Error('Truncated command');
        total+=op===0x61?view.getUint16(p+1,true):op===0x62?735:op===0x63?882:op>=0x70&&op<=0x7f?(op&15)+1:op>=0x80&&op<=0x8f?op&15:0;
        if(total>0xffffffff)throw new Error('Duration exceeds VGM header range');
        if(op===0x66){ended=true;break;}p+=length;
        if(++count%10000===0)await new Promise(resolve=>setTimeout(resolve,0));
      }
      if(!ended || (this.parser.header.loopOffset && loopStart===null))throw new Error('Invalid end or loop command boundary');
      view.setUint32(0x18,total,true);view.setUint32(0x20,loopStart===null?0:total-loopStart,true);
    }
    return out;
  }
}

export function mountCommandEditor(root,{onApply,setStatus}) {
  root.innerHTML=`<h2>Command Editor (experimental)</h2>
<p>Edit register data bytes (decimal 0–255) or 0x61 wait samples (0–65535). Apply to player, then press Play to audition. Other commands and data blocks are read only.</p>
<p>100 commands per page. Only changed values are retained; a full VGM copy is made on Apply or Save. Undo keeps the last 1,000 edits. Loading another track discards edits.</p>
<div><button data-prev>Previous</button> <span data-page></span> <button data-next>Next</button>
<button data-undo>Undo</button> <button data-reset>Restore original</button>
<button data-apply>Apply to player</button> <button data-save>Save edited VGM</button></div>
<p data-state role="status"></p><div style="overflow:auto;max-height:32em"><table><thead><tr><th>Offset</th><th>Original command</th><th>Description</th><th>Value (decimal)</th></tr></thead><tbody></tbody></table></div>`;
  const el=name=>root.querySelector(`[data-${name}]`),body=root.querySelector('tbody');
  let model=null,page=0,name='edited.vgm',busy=false,applied=false;
  const state=message=>{el('state').textContent=message;};
  function render(){
    body.replaceChildren();
    for(const button of root.querySelectorAll('button'))button.disabled=!model||busy;
    el('page').textContent=model?`Page ${page+1}`:'No file loaded';
    if(!model){state('No file loaded.');return;}
    try{
      const result=model.page(page);
      el('prev').disabled=busy||page===0;el('next').disabled=busy||!result.more;el('undo').disabled=busy||!model.history.length;
      for(const row of result.rows){
        const tr=document.createElement('tr');
        for(const text of [`0x${row.offset.toString(16)}`,row.preview,row.description]){const td=document.createElement('td');td.textContent=text;tr.append(td);}
        const td=document.createElement('td');
        if(row.writable){const input=document.createElement('input');input.type='number';input.min='0';input.max=row.wait?'65535':'255';input.step='1';input.value=String(row.value);input.style.width='7em';input.disabled=busy;
          input.setAttribute('aria-label',`Value at byte ${row.offset}`);
          input.addEventListener('change',()=>{try{if(input.value===''||!input.reportValidity())throw new Error('Enter an integer in range');model.edit(row.offset,Number(input.value));applied=false;render();}catch(e){render();state(e.message);}});td.append(input);
        }else td.textContent='Read only';tr.append(td);body.append(tr);
      }
      state(`${model.edits.size} changed commands. ${applied?'Applied to player.':'Player unchanged until Apply.'}`);
    }catch(error){state(error.message);el('next').disabled=true;}
  }
  el('prev').onclick=()=>{page--;render();};el('next').onclick=()=>{page++;render();};
  el('undo').onclick=()=>{model.undo();applied=false;render();};el('reset').onclick=()=>{model.reset();applied=false;render();};
  async function output(apply){
    const current=model;let failure=null;busy=true;render();
    try{
      const bytes=await current.build();if(current!==model)return;
      if(apply){await onApply(bytes,name);if(current!==model)return;applied=true;setStatus('Edited VGM applied. Press Play to audition.');}
      else{const url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));const a=document.createElement('a');a.href=url;a.download=name.replace(/\.[^.]+$/,'')+'_edited.vgm';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
      render();
    }catch(error){failure=error.message;if(model===current)setStatus(`Command editor: ${error.message}`);}
    finally{busy=false;render();if(failure && model===current)state(failure);}
  }
  el('apply').onclick=()=>output(true);el('save').onclick=()=>output(false);
  render();
  return {load(source,fileName){model=source?new CommandEditor(source):null;name=fileName??'edited.vgm';page=0;applied=false;render();}};
}
