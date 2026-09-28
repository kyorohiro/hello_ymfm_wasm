import test from 'node:test';
import assert from 'node:assert/strict';
import {mountSbiExports} from './sbi_ui.js';

test('SBI controls select/download extracted and snapshot voices, ZIP and handle empty tracks', async () => {
  const oldDocument=globalThis.document, oldURL=globalThis.URL, oldTimeout=globalThis.setTimeout;
  const downloads=[], blobs=[], statuses=[], revoked=[];
  const node = () => ({children:[],events:{},style:{},value:'0',
    append(...children){this.children.push(...children);},
    replaceChildren(...children){this.children=children;this.value=children[0]?.value??'';},
    addEventListener(type,fn){this.events[type]=fn;},
    click(){this.events.click?.();},remove(){},showModal(){this.open=true;},
    querySelector(selector){this.selectors??=new Map();if(!this.selectors.has(selector))this.selectors.set(selector,node());return this.selectors.get(selector);},
  });
  const body=node(), buttons=new Map();
  globalThis.document={body,createElement(tag){const result=node();if(tag==='a')result.click=()=>downloads.push({name:result.download,url:result.href});return result;},
    getElementById(id){if(!buttons.has(id))buttons.set(id,node());return buttons.get(id);}};
  globalThis.URL={createObjectURL(blob){blobs.push(blob);return `blob:${blobs.length}`;},revokeObjectURL(url){revoked.push(url);}};
  globalThis.setTimeout=fn=>fn();
  const source=new Uint8Array(270),view=new DataView(source.buffer);
  source.set([86,103,109,32]);view.setUint32(8,0x171,true);view.setUint32(0x34,0xcc,true);view.setUint32(0x50,3579545,true);
  source.set([0x5a,0x20,7,0x5a,0xb0,32,0x61,100,0,0x66],256);
  let track={buffer:source,atSample:50};
  try {
    mountSbiExports({getTrack:()=>track,setStatus:s=>statuses.push(s)});
    const dialog=body.children[0];
    buttons.get('exportSbiButton').click();assert.equal(dialog.open,true);
    assert.equal(dialog.querySelector('select').children.length,1);
    dialog.querySelector('.sbi-download').click();
    assert.equal(downloads[0].name,'CH1_001.sbi');
    const bytes=new Uint8Array(await blobs[0].arrayBuffer());assert.equal(bytes.length,52);assert.equal(bytes[36],7);
    buttons.get('exportSnapshotSbiButton').click();
    assert.equal(dialog.querySelector('h3').textContent,'Snapshot SBI');
    assert.equal(dialog.querySelector('select').children.length,9);
    dialog.querySelector('select').value='8';dialog.querySelector('.sbi-download').click();
    assert.equal(downloads[1].name,'CH9_001.sbi');
    buttons.get('exportAllSbiButton').click();assert.equal(downloads[2].name,'all_sbi_patches.zip');
    assert.equal(blobs[2].type,'application/zip');assert.equal(revoked.length,3);
    const empty=source.slice();empty[261]=0;track={buffer:empty,atSample:0};
    buttons.get('exportAllSbiButton').click();assert.match(statuses.at(-1),/No keyed/);
    buttons.get('exportSbiButton').click();assert.match(statuses.at(-1),/No melodic/);
    track={buffer:null};buttons.get('exportAllSbiButton').click();assert.equal(downloads.length,3);
  } finally {
    globalThis.document=oldDocument;globalThis.URL=oldURL;globalThis.setTimeout=oldTimeout;
  }
});
