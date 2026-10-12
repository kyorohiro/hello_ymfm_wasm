import {normalizeVirtualPath} from './playground_virtual_files.js';

const inside=(path,root)=>path===root||path.startsWith(root+'/');
const exists=(fs,path)=>fs.has(path)||fs.listDirectories().includes(path);
const writable=path=>path!=='/sys'&&!path.startsWith('/sys/');

// Copy captures content; cut retains a source path until the move succeeds.
export function createExplorerClipboard(fs) {
  let entry=null;
  return {
    get available(){return Boolean(entry);},
    clear(){entry=null;},
    capture(path,cut=false){
      path=normalizeVirtualPath(path);
      if(path==='/'||!writable(path))throw Error('This path cannot be copied or cut.');
      if(cut&&path==='/index.js')throw Error('/index.js cannot be moved.');
      fs.stat(path);
      entry={path,cut,files:fs.list().filter(file=>inside(file.path,path)),directories:fs.listDirectories().filter(dir=>inside(dir,path))};
    },
    paste(directory,move){
      if(!entry)throw Error('Copy or cut a file or folder first.');
      directory=normalizeVirtualPath(directory);
      if(!writable(directory))throw Error('/sys is reserved for built-in files.');
      if(fs.stat(directory).type!=='directory')throw Error('Paste destination must be a folder.');
      const {path,cut,files,directories}=entry;
      if(inside(directory,path))throw Error('Cannot paste a folder inside itself.');
      const name=path.split('/').pop();
      let destination=normalizeVirtualPath(`${directory}/${name}`);
      if(cut){
        if(destination===path)throw Error('The item is already in this folder.');
        if(exists(fs,destination))throw Error(`Destination already exists: ${destination}`);
        if(move(path,destination)===false)return null;
        entry=null;
      }else{
        const extension=directories.length?'':name.match(/\.[^./]+$/)?.[0]??'';
        const stem=extension?name.slice(0,-extension.length):name;
        for(let number=1;exists(fs,destination);number++){
          destination=normalizeVirtualPath(`${directory}/${stem}-copy${number===1?'':`-${number}`}${extension}`);
        }
        const target=source=>destination+source.slice(path.length);
        fs.replace([...fs.list(),...files.map(file=>({...file,path:target(file.path)}))],
          [...fs.listDirectories(),...directories.map(target)]);
      }
      return destination;
    },
  };
}

export function installFileExplorerMenu({root,fs,sync,transfer,onChanged,onCreated,onDelete,status}) {
  const clipboard=createExplorerClipboard(fs);
  const menu=document.createElement('div');
  menu.className='file-context-menu';
  menu.setAttribute('role','menu');
  menu.setAttribute('aria-label','File actions');
  menu.hidden=true;
  document.body.append(menu);
  let anchor=null;
  function close(restore=false){
    const wasOpen=!menu.hidden;
    menu.hidden=true;
    if(wasOpen&&restore&&anchor?.isConnected)anchor.focus?.({preventScroll:true});
  }
  async function copyPath(path){
    const text=path==='/'?'.':path.slice(1);
    if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);}
    else{
      const input=document.createElement('textarea'); input.value=text;
      input.style.position='fixed';input.style.opacity='0';document.body.append(input);input.select();
      try{if(!document.execCommand('copy'))throw Error('Clipboard is unavailable.');}finally{input.remove();}
    }
    status(`Copied relative path: ${text}`);
  }
  function open(event,path,element){
    event.preventDefault();event.stopPropagation();
    anchor=element;
    const directory=path==='/'||fs.stat(path).type==='directory'?path:path.split('/').slice(0,-1).join('/')||'/';
    const mutable=path!=='/'&&path!=='/index.js'&&writable(path);
    const create=folder=>{
      const name=window.prompt(folder?'New folder name':'New file name',folder?'new-folder':'new-file.js');
      if(!name)return;
      const destination=normalizeVirtualPath(`${directory}/${name}`);
      if(!writable(destination))throw Error('/sys is reserved for built-in files.');
      if(exists(fs,destination))throw Error(`Destination already exists: ${destination}`);
      sync();
      if(folder)fs.mkdir(destination,{recursive:true});else fs.writeText(destination,'');
      onChanged(directory);if(!folder)onCreated(destination);
    };
    const actions=[
      ['Copy Relative Path',()=>copyPath(path),true],
      ['Copy',()=>{sync();clipboard.capture(path);status(`Copied ${path}.`);},path!=='/'&&writable(path)],
      ['Paste',()=>{sync();const destination=clipboard.paste(directory,transfer);if(destination){onChanged(directory);status(`Pasted ${destination}.`);}},clipboard.available],
      ['Delete',()=>onDelete(path),mutable],
      ['Cut',()=>{sync();clipboard.capture(path,true);status(`Cut ${path}. Choose a folder and paste to move.`);},mutable],
      ['Rename…',()=>{
        const name=window.prompt('Rename',path.split('/').pop());if(!name)return;
        if(name==='.'||name==='..'||name.includes('/')||name.includes('\\'))throw Error('Enter a name without a folder path.');
        transfer(path,normalizeVirtualPath(`${path.split('/').slice(0,-1).join('/')}/${name}`));
      },mutable],
      ['New File…',()=>create(false),writable(directory)],
      ['New Folder…',()=>create(true),writable(directory)],
    ];
    menu.replaceChildren();
    for(const [label,action,enabled] of actions){
      const button=document.createElement('button');button.type='button';button.textContent=label;
      button.setAttribute('role','menuitem');button.disabled=!enabled;
      button.addEventListener('click',()=>{close(true);Promise.resolve().then(action).catch(error=>status(`File operation failed: ${error.message}`));});
      menu.append(button);
    }
    menu.hidden=false;
    menu.style.left=`${Math.max(0,Math.min(event.clientX,window.innerWidth-menu.offsetWidth))}px`;
    menu.style.top=`${Math.max(0,Math.min(event.clientY,window.innerHeight-menu.offsetHeight))}px`;
    menu.querySelector('button:not(:disabled)')?.focus();
  }
  root.addEventListener('contextmenu',event=>{
    const item=event.target.closest('[data-file-path]');
    try{open(event,item?.getAttribute('data-file-path')??'/',item??root);}catch(error){status(error.message);}
  });
  root.addEventListener('keydown',event=>{
    if(event.key!=='ContextMenu'&&!(event.shiftKey&&event.key==='F10'))return;
    const item=event.target.closest('[data-file-path]');const bounds=(item??root).getBoundingClientRect();
    try{open({preventDefault:()=>event.preventDefault(),stopPropagation:()=>event.stopPropagation(),clientX:bounds.left,clientY:bounds.top},item?.getAttribute('data-file-path')??'/',item??root);}catch(error){status(error.message);}
  });
  menu.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();close(true);return;}
    const buttons=[...menu.querySelectorAll('button:not(:disabled)')];
    const index=buttons.indexOf(document.activeElement);
    const next=event.key==='ArrowDown'?(index+1)%buttons.length:event.key==='ArrowUp'?(index-1+buttons.length)%buttons.length:event.key==='Home'?0:event.key==='End'?buttons.length-1:null;
    if(next!==null){event.preventDefault();buttons[next]?.focus();}
    if(event.key==='Tab')close();
  });
  document.addEventListener('pointerdown',event=>{if(!menu.contains(event.target))close();});
  document.addEventListener('scroll',()=>close(),true);
  window.addEventListener('resize',()=>close());
  window.addEventListener('blur',()=>close());
  return {close,clear(){close();clipboard.clear();}};
}
