import {readFile,writeFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),[id,out]=process.argv.slice(2);
const digest=data=>createHash('sha256').update(data).digest('hex');
const inventory=JSON.parse(await readFile(path.join(root,'catalog/source_inventory.json'),'utf8'));
const artifact=[...inventory.artifacts,...(inventory.applicationAudio??[])].find(entry=>entry.id===id);if(!artifact)throw new Error('Unknown WASM artifact: '+id);
const names=artifact.format==='standalone-wasm'?['msfa.wasm']:[id+'_wasm.js',id+'_wasm.wasm'];
const sourceFiles=[];
for(const name of [...new Set([...artifact.sourceFiles,...(artifact.buildFiles??[artifact.buildScript])])].sort()){const bytes=await readFile(path.join(root,name));sourceFiles.push({path:name,sha256:digest(bytes),size:bytes.length});}
const outputs=[];for(const name of names){const file=path.join(out,name);outputs.push({path:name,sha256:digest(await readFile(file)),size:(await stat(file)).size});}
const compiler=id==='nuked_opn2'||artifact.format==='standalone-audio-wasm'?(process.env.EMCC??'emcc'):(process.env.EMXX??'em++');
const record={id,format:artifact.format,sourceFingerprint:digest(JSON.stringify(sourceFiles)),sourceFiles,outputs,
 compiler:{command:compiler,version:execFileSync(compiler,['--version'],{encoding:'utf8'}).trim()},verification:'compiled from the included source snapshot; runtime smoke is reported separately'};
const target=path.join(out,'build-info.json');let previous={schemaVersion:1,artifacts:[]};try{previous=JSON.parse(await readFile(target,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
previous.artifacts=[...previous.artifacts.filter(entry=>entry.id!==id),record].sort((a,b)=>a.id.localeCompare(b.id));await writeFile(target,JSON.stringify(previous,null,2)+'\n');
