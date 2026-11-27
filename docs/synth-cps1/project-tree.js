// SPDX-License-Identifier: BSD-3-Clause
import {renderFileTree} from '../playground/playground_file_tree.js';
import {installSpuFileContextMenu} from '../synth-spu/file_context_menu.js';
import {createVirtualFileSystem,transferVirtualFiles} from '../js/tetorica_virtual_files/filesystem.js';
import {dirname,resolvePath} from '../js/tetorica_virtual_files/path.js';

export const base=path=>path.split('/').pop();
export const inside=(path,folder)=>path===folder||path?.startsWith(folder+'/');
const suffix=path=>path.match(/(?:\.fm\.json|\.[^.\/]+)$/i)?.[0]??'';
export function checkPath(path) {
  if (path==='/' || resolvePath(path)!==path || !path.startsWith('/') ||
      path.split('/').some(name=>['.git','.tet.ss','__proto__'].includes(name)) ||
      /[\x00-\x1f\\<>:"|?*]/.test(path) || /^\/(metadata\.json|cassette\.metadata\.js)(\/|$)/i.test(path))
    throw Error('Invalid project path: '+path);
  return path;
}

export function installProjectTree({root,getFiles,getFolders,selected,select,open,label,create,change,importFiles,report}) {
  const expanded=new Map([['/examples',true]]);
  const actions={duplicate:'Duplicate',rename:'Rename…',delete:'Delete',instrument:'New instrument…',code:'New JavaScript file…',folder:'New folder…'};
  function index() {
    const fs=createVirtualFileSystem();
    fs.replace([...getFiles().keys()].map(path=>({path,data:''})),getFolders());
    return fs;
  }
  function named(parent,name,ext='') {
    name=name.trim();
    if (!name || name==='.' || name==='..' || name.includes('/')) throw Error('Enter a file or folder name.');
    return checkPath((parent==='/'?'':parent)+'/'+name+(ext&&!name.toLowerCase().endsWith(ext.toLowerCase())?ext:''));
  }
  function available(fs,path) {
    if (fs.has(path)||fs.listDirectories().includes(path)) throw Error('Already exists: '+path);
  }
  function transfer(from,to,copy) {
    if (from===to) return;
    const fs=index();
    const moves=transferVirtualFiles(fs,from,checkPath(to),{copy});
    change({from,to,copy,moves,folders:fs.listDirectories()});
  }
  function askName(title,value) {
    const dialog=document.getElementById('fileNameDialog'),input=document.getElementById('fileName');
    document.getElementById('fileNameTitle').textContent=title;
    input.value=value;dialog.returnValue='';
    document.getElementById('fileNameCancel').onclick=()=>dialog.close();
    return new Promise(resolve=>{
      dialog.addEventListener('close',()=>resolve(dialog.returnValue==='save'?input.value:null),{once:true});
      dialog.showModal();input.select();
    });
  }
  async function perform(action,path) {
    const fs=index(), file=fs.has(path), parent=file?dirname(path):path;
    if (action==='delete') {
      if (!confirm('Delete '+path+'?')) return;
      fs.remove(path,{recursive:true});change({from:path,folders:fs.listDirectories()});return;
    }
    if (action==='duplicate') {
      const ext=file?suffix(path):'', stem=ext?base(path).slice(0,-ext.length):base(path);
      let n=1,to;
      do {to=named(dirname(path),stem+' copy'+(n>1?' '+n:''),ext);n++;} while (fs.has(to)||fs.listDirectories().includes(to));
      transfer(path,to,true);return;
    }
    const ext=action==='rename'&&file?suffix(path):action==='code'?'.js':action==='instrument'?'.fm.json':'';
    const name=await askName(actions[action],action==='rename'?base(path):'untitled'+ext);
    if (name===null) return;
    const directory=action==='instrument'&&!parent.startsWith('/presets')?'/presets':
      action==='code'&&file&&!/\.m?js$/i.test(path)?'/':parent;
    const to=named(action==='rename'?dirname(path):directory,name,ext);
    if (action==='rename') {transfer(path,to,false);return;}
    available(fs,to);
    create(action,to);
  }
  const getActions=path=>Object.entries(actions).map(([id,label])=>({id,label,
    disabled:path==='/'&&['duplicate','rename','delete'].includes(id)}));
  installSpuFileContextMenu({root,getActions,onTarget:select,onAction:perform,onError:error=>report(error.message)});
  root.addEventListener('click',event=>{const folder=event.target.closest('summary,.file-tree-root');if(folder)select(folder.dataset.filePath);});
  for(const button of document.querySelectorAll('[data-tree-action]')) button.onclick=()=>{
    const path=selected(),action=button.dataset.treeAction;
    if(getActions(path).find(a=>a.id===action)?.disabled)return;
    perform(action,path).catch(error=>report(error.message));
  };
  return function render() {
    const files=getFiles(),path=selected();
    for(let parent=dirname(path);parent!=='/';parent=dirname(parent)) expanded.set(parent,true);
    renderFileTree(root,[...Array.from(files.keys(),path=>({path})),...getFolders().filter(p=>p!=='/').map(path=>({path,type:'directory'}))],{
      selectedPath:path,expanded,onOpen:open,
      onTransfer:(from,to,copy)=>{try{transfer(from,to,copy);}catch(error){report(error.message);}},
      onImport:(incoming,parent)=>importFiles(incoming,parent||'/').catch(error=>report(error.message)),
    });
    for(const node of root.querySelectorAll('button[data-file-path]')) {
      const text=label(files.get(node.dataset.filePath));
      if(text)node.textContent=text;
    }
  };
}
