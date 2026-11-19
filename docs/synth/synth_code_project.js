// Use the same Files/module expansion as Playground, without its Shell UI.
import {createVirtualFileSystem} from '../js/tetorica_virtual_files/filesystem.js';
import {normalizeVirtualPath} from '../js/tetorica_virtual_files/path.js';
import {createVirtualFileReader} from '../js/tetorica_virtual_files/reader.js';
import {resolveVirtualDynamicImports,createVirtualFileRuntimeSource} from '../playground/playground_virtual_files.js';

export function createSynthCodeProject(project,{version='working'}={}) {
  if(!['working','saved'].includes(version))throw TypeError('Unknown Code file version');
  const fs=version==='saved'?project?.savedFs:project?.fs;
  if(typeof fs?.snapshot!=='function')throw TypeError('Code needs the Synth file project');
  return {
    readFile(path,options={},entry={}) {
      return createVirtualFileReader(fs,entry.path??'/index.js')(path,options);
    },
    prepareSource(source,{path='/index.js'}={}) {
      if(typeof source!=='string')throw TypeError('Code source must be text');
      path=normalizeVirtualPath(path);
      // Run / Apply uses the accepted document. Saving never executes it.
      // The editor may still show an unsaved working draft at this path.
      if(version==='saved') {
        const entry=fs.get(path);
        if(!entry)throw Error(`Save ${path} before running Code.`);
        if(entry.type!=='text')throw TypeError('Code entry must be text');
        source=entry.data;
      }
      const files=createVirtualFileSystem();files.restore(fs.snapshot());
      const resolved=resolveVirtualDynamicImports(files,source,path,(text,modulePath)=>
        `data:text/javascript;charset=utf-8,${encodeURIComponent(createVirtualFileRuntimeSource(files,modulePath)+'\n'+text)}`);
      // Install optional host adapters outside the user's lexical scope.
      // A natural `const sample = await ps1.loadADPCM(...)` (or `const midi`)
      // must not put those adapters' typeof checks in a temporal dead zone.
      // The user block still inherits this snapshot's relative file reader.
      return `{\n${createVirtualFileRuntimeSource(files,path,{install:true})}\n{\n${resolved}\n}\n}`;
    },
  };
}
