import {createVirtualFileSystem,createShell} from 'tetorica-virtual-files';

const initialFiles=[
  {path:'/index.js',data:"const {notes} = await import('./lib/notes.js');\nconsole.log(notes);\n"},
  {path:'/lib/notes.js',data:'export const notes = [60, 64, 67];\n'},
  {path:'/README.md',data:'# Virtual Files\n\nエディターとシェルは同じファイルを操作します。\n\ncat /index.js\nmkdir /work\ncp /lib/notes.js /work/notes.js\n'},
  {path:'/samples/data.bin',data:new Uint8Array([0,1,2,127,128,254,255])},
];
const fs=createVirtualFileSystem(initialFiles);fs.mkdir('/empty');
const initial=fs.snapshot();
const shell=createShell({fs});
shell.register('count',({fs})=>`${fs.list().length} files, ${fs.listDirectories().length-1} directories\n`);
const element=id=>document.getElementById(id);
const editor=element('editor'),output=element('output');
let selected='/index.js';
function status(text){element('status').textContent=text;}
function render(){
  function directory(path){
    const list=document.createElement('ul');
    for(const name of fs.readdir(path)){
      const full=path==='/'?'/'+name:path+'/'+name,item=document.createElement('li');
      if(fs.stat(full).type==='directory'){
        const details=document.createElement('details');details.open=true;
        const label=document.createElement('summary');label.textContent=name;label.title=full;
        details.append(label,directory(full));item.append(details);
      }else{
        const button=document.createElement('button');button.type='button';button.textContent=name;button.title=full;
        button.setAttribute('aria-current',String(full===selected));
        button.addEventListener('click',()=>{selected=full;render();});item.append(button);
      }
      list.append(item);
    }
    return list;
  }
  if(!fs.has(selected))selected=fs.has('/index.js')?'/index.js':fs.list()[0]?.path??'';
  element('files').replaceChildren(directory('/'));
  const file=selected?fs.get(selected):null;
  element('selectedPath').textContent=selected||'ファイルなし';
  editor.readOnly=!file||file.type!=='text';
  const value=!file?'':file.type==='text'?file.data:[...file.data.subarray(0,256)].map(byte=>byte.toString(16).padStart(2,'0')).join(' ')+(file.data.length>256?'\n…':'');
  if(editor.value!==value)editor.value=value;
  element('fileInfo').textContent=file?`${fs.stat(selected).size} bytes · ${file.type==='text'?'text':'binary / read-only'}`:'';
  element('prompt').textContent=shell.cwd+' $';
}
fs.onDidChange(render);
editor.addEventListener('input',()=>{if(selected&&!editor.readOnly){fs.writeText(selected,editor.value);status('メモリー上のファイルを更新しました。');}});
editor.addEventListener('keydown',event=>{if(event.key==='Tab'&&!editor.readOnly){event.preventDefault();editor.setRangeText('  ',editor.selectionStart,editor.selectionEnd,'end');editor.dispatchEvent(new Event('input'));}});
let queue=Promise.resolve();
element('shellForm').addEventListener('submit',event=>{
  event.preventDefault();const input=element('command'),source=input.value;input.value='';
  queue=queue.then(async()=>{
    const cwd=shell.cwd,result=await shell.execute(source);
    output.textContent+=`${cwd} $ ${source}\n${result.stdout}${result.stderr?result.stderr+'\n':''}`;
    if(output.textContent.length>50000)output.textContent=output.textContent.slice(-50000);
    output.scrollTop=output.scrollHeight;render();status(result.code===0?'コマンドを実行しました。':`終了コード ${result.code}: ${result.stderr}`);
  }).catch(error=>status(error.message));
});
for(const source of ['help','ls /','cat /index.js','mkdir /work','cp /lib/notes.js /work/notes.js',`write /lib/notes.js 'export const notes = [62, 65, 69];'`,'count']){
  const button=document.createElement('button');button.type='button';button.textContent=source;
  button.addEventListener('click',()=>{element('command').value=source;element('command').focus();});element('recipes').append(button);
}
element('reset').addEventListener('click',()=>{selected='/index.js';fs.restore(initial);status('初期データに戻しました。保存済みの内容は、保存ボタンを押すまで保持します。');});
element('import').addEventListener('change',async event=>{
  try{
    for(const file of event.target.files){
      const path='/imports/'+file.name;
      if(/\.(js|json|md|txt|css|html)$/i.test(file.name))fs.writeText(path,await file.text());
      else fs.writeBinary(path,await file.arrayBuffer());
      selected=path;
    }
    render();status('ファイルを /imports に追加しました。');
  }catch(error){status(`追加できませんでした: ${error.message}`);}
  event.target.value='';
});

// Persistence belongs to this host page, not to the filesystem or shell.
const database=new Promise((resolve,reject)=>{
  const request=indexedDB.open('tetorica-virtual-files-example',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('snapshots');
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});
async function storage(mode,operation){
  const db=await database;
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction('snapshots',mode),request=operation(transaction.objectStore('snapshots'));
    transaction.oncomplete=()=>resolve(request.result);
    transaction.onabort=()=>reject(transaction.error??request.error);
    transaction.onerror=()=>reject(transaction.error??request.error);
  });
}
for(const id of ['save','restore'])element(id).addEventListener('click',async()=>{
  element(id).disabled=true;
  try{
    await queue;
    if(id==='save'){await storage('readwrite',store=>store.put({filesystem:fs.snapshot(),selected},'main'));status('ブラウザー内に保存しました。');}
    else{
      const saved=await storage('readonly',store=>store.get('main'));
      if(!saved){status('保存された内容はまだありません。');return;}
      fs.restore(saved.filesystem);selected=saved.selected;render();status('保存内容を復元しました。');
    }
  }catch(error){status(`保存・復元できませんでした: ${error.message}`);}
  finally{element(id).disabled=false;}
});
void database.catch(error=>{status(`ブラウザー内の保存を利用できません: ${error.message}`);element('save').disabled=true;element('restore').disabled=true;});
render();status('準備できました。ファイルを選んで編集するか、シェルで help を実行してください。');
