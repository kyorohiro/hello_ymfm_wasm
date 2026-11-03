import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync,deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import git from 'isomorphic-git';
import {createVirtualFileSystem} from '../src/filesystem.js';
import {createVirtualGit,createGitFileSystem,registerGitShell} from '../src/git.js';
import {createShell} from '../src/shell.js';

const author={name:'Fixture',email:'fixture@example.invalid'};
const packet=value=>{const bytes=Buffer.from(value);return Buffer.concat([Buffer.from((bytes.length+4).toString(16).padStart(4,'0')),bytes]);};
const flush=Buffer.from('0000');
function packFrom(fs){
  const objects=fs.list().filter(file=>/^\/\.git\/objects\/[a-f0-9]{2}\/[a-f0-9]{38}$/.test(file.path));
  const header=Buffer.alloc(12);header.write('PACK');header.writeUInt32BE(2,4);header.writeUInt32BE(objects.length,8);
  const chunks=[header];
  for(const object of objects){
    const bytes=inflateSync(object.data),zero=bytes.indexOf(0),type=bytes.subarray(0,zero).toString().split(' ')[0],body=bytes.subarray(zero+1);
    let size=body.length,first=({commit:1,tree:2,blob:3,tag:4}[type]<<4)|(size&15);size>>>=4;
    const sizes=[first|(size?128:0)];while(size){let next=size&127;size>>>=7;if(size)next|=128;sizes.push(next);}
    chunks.push(Buffer.from(sizes),deflateSync(body));
  }
  const bytes=Buffer.concat(chunks);return Buffer.concat([bytes,createHash('sha1').update(bytes).digest()]);
}
async function fixture(extra){
  const fs=createVirtualFileSystem([{path:'/index.js',data:'play("C4");\n'},{path:'/lib/bom.js',data:'\uFEFFexport const note="C4";\n'},{path:'/voices/raw.tfi',data:new Uint8Array([0,127,255,8])}]);
  const base={fs:createGitFileSystem(fs),dir:'/',gitdir:'/.git'};
  await git.init({...base,defaultBranch:'stable'});
  const repo=createVirtualGit({fs});await repo.execute('stage',{paths:['/']});
  await repo.execute('commit',{...author,message:'First'});
  fs.writeText('/index.js','play("D4");\n');await repo.execute('stage',{paths:['/']});
  let oid=(await repo.execute('commit',{...author,message:'Second'})).commit;
  if(extra){
    const index=await git.readBlob({...base,oid,filepath:'index.js'});
    const blob=extra.mode==='160000'?oid:await git.writeBlob({...base,blob:new TextEncoder().encode('target')});
    const tree=await git.writeTree({...base,tree:[{mode:'100644',path:'index.js',type:'blob',oid:index.oid},{mode:extra.mode??'100644',path:extra.path,type:extra.mode==='160000'?'commit':'blob',oid:blob}]});
    oid=await git.commit({...base,tree,message:'Special tree',author});
  }
  await git.branch({...base,ref:'preview'});
  return {fs,oid};
}
function upload(source,hooks={}){
  const pack=packFrom(source.fs);
  return {async request({url,method='GET',signal}){
    signal?.throwIfAborted();await hooks.beforeRequest?.(method,signal);signal?.throwIfAborted();
    if(method==='GET')return {url,statusCode:200,statusMessage:'OK',headers:{'content-type':'application/x-git-upload-pack-advertisement'},body:[packet('# service=git-upload-pack\n'),flush,packet(`${source.oid} HEAD\0multi_ack_detailed side-band-64k ofs-delta symref=HEAD:refs/heads/stable\n`),packet(`${source.oid} refs/heads/stable\n`),packet(`${source.oid} refs/heads/preview\n`),flush]};
    return {url,statusCode:200,statusMessage:'OK',headers:{'content-type':'application/x-git-upload-pack-result'},body:[packet('NAK\n'),packet(Buffer.concat([Buffer.from([1]),pack])),flush]};
  }};
}

test('clone follows remote default HEAD, retains full history and binary/BOM bytes, and preserves bundled guides',async()=>{
  const source=await fixture(),fs=createVirtualFileSystem([{path:'/sys/README.md',data:'Bundled guide'}]);let scope,closed=0;
  const repo=createVirtualGit({fs,beginRemote:async request=>{scope=request;return {http:upload(source),close:async()=>{closed++;}};}});
  const result=await repo.execute('clone',{url:'https://example.invalid/project'});
  assert.deepEqual(result,{completed:true,operation:'clone',branch:'stable',url:'https://example.invalid/project.git'});
  assert.deepEqual(scope,{url:result.url,operation:'clone',branch:'',commit:''});assert.equal(closed,1);
  assert.equal(fs.get('/index.js').data,'play("D4");\n');assert.equal(fs.get('/lib/bom.js').data,'\uFEFFexport const note="C4";\n');
  assert.deepEqual(fs.get('/voices/raw.tfi').data,new Uint8Array([0,127,255,8]));assert.equal(fs.get('/sys/README.md').data,'Bundled guide');
  assert.equal((await repo.execute('log')).length,2);assert.equal((await repo.execute('status')).files.length,0);
  const base={fs:createGitFileSystem(fs),dir:'/',gitdir:'/.git'};
  assert.equal(await git.getConfig({...base,path:'branch.stable.remote'}),'origin');
  assert.equal(await git.getConfig({...base,path:'branch.stable.merge'}),'refs/heads/stable');
  assert.equal(await git.resolveRef({...base,ref:'refs/remotes/origin/stable'}),source.oid);
});

test('clone refuses nonempty FILES before networking and --replace publishes an exact project without old checkpoints',async()=>{
  const source=await fixture(),fs=createVirtualFileSystem([{path:'/index.js',data:'old'},{path:'/old.js',data:'old project'},{path:'/sys/README.md',data:'Bundled'}],{autoCheckpoint:true});
  fs.writeText('/index.js','uncommitted edit');assert(fs.has('/.tet.ss/index.js'));
  let sessions=0;const repo=createVirtualGit({fs,beginRemote:async()=>{sessions++;return {http:upload(source),close:async()=>{}};}}),before=fs.checkpoint();
  await assert.rejects(repo.execute('clone',{url:'https://example.invalid/project'}),/FILES is not empty.*--replace/);
  assert.equal(sessions,0);assert.deepEqual(fs.checkpoint(),before);
  const result=await repo.execute('clone',{url:'https://example.invalid/project',replace:true,branch:'preview'});
  assert.equal(result.branch,'preview');assert.equal(sessions,1);assert(!fs.has('/old.js'));assert(!fs.has('/.tet.ss/index.js'));assert(!fs.has('/.gitignore'));
  assert.equal(fs.get('/sys/README.md').data,'Bundled');assert.equal((await repo.execute('status')).files.length,0);
});

test('clone validates Shell syntax and the explicit destination relative to cwd',async()=>{
  const calls=[],fs=createVirtualFileSystem([{path:'/lib/a.js',data:''}]),shell=createShell({fs});
  registerGitShell(shell,{async execute(action,args){calls.push({action,args});return {url:args.url,branch:args.branch??'stable'};}});
  const good=await shell.execute('git clone --replace --branch preview https://example.invalid/project .');
  assert.equal(good.code,0,good.stderr);assert.equal(good.stdout,'Cloned https://example.invalid/project (preview).\n');
  assert.deepEqual(calls.pop(),{action:'clone',args:{replace:true,branch:'preview',url:'https://example.invalid/project',directory:'/'}});
  await shell.execute('cd lib');assert.equal((await shell.execute('git clone https://example.invalid/project .')).code,1);
  assert.equal((await shell.execute('git clone https://example.invalid/project')).code,0);assert.equal(calls.pop().args.directory,'/');
  for(const command of ['git clone','git clone -b','git clone --depth 1 https://example.invalid/project','git clone --branch preview -b stable https://example.invalid/project','git clone https://example.invalid/project nested','git clone https://example.invalid/project / extra'])assert.equal((await shell.execute(command)).code,1,command);
  assert.equal(calls.length,0);
});

test('failed requests, missing branches, bad URLs and protected tree entries retain the previous project',async()=>{
  const source=await fixture(),old=()=>createVirtualFileSystem([{path:'/index.js',data:'keep me'}]);
  for(const options of [{http:{async request(){throw Error('Network failed');}}},{http:upload(source),branch:'missing'},{http:upload(source),url:'http://example.invalid/project'},{http:upload(source),branch:'../bad'},{http:upload(source),replace:'false'},{http:upload(source),directory:'/nested'}]){
    const fs=old(),before=fs.checkpoint(),repo=createVirtualGit({fs,http:options.http});
    await assert.rejects(repo.execute('clone',{replace:options.replace??true,url:options.url??'https://example.invalid/project',branch:options.branch,directory:options.directory}));assert.deepEqual(fs.checkpoint(),before);
  }
  for(const extra of [{path:'.GiT'},{path:'sys'},{path:'.tet.ss'},{path:'link',mode:'120000'},{path:'module',mode:'160000'}]){
    const remote=await fixture(extra),fs=old(),before=fs.checkpoint();let closed=0;
    const repo=createVirtualGit({fs,beginRemote:async()=>({http:upload(remote),close:async()=>{closed++;}})});
    await assert.rejects(repo.execute('clone',{url:'https://example.invalid/project',replace:true}),/Protected path|Symbolic links|Submodules|unsafe character sequences/);
    assert.deepEqual(fs.checkpoint(),before);assert.equal(closed,1);
  }
});

test('clone cancellation, editor changes and project invalidation cannot publish a stale download',async()=>{
  const source=await fixture();
  for(const mode of ['abort','edit','invalidate']){
    const fs=createVirtualFileSystem([{path:'/index.js',data:'keep me'}]);let release,entered,active=true,receivedSignal;
    const started=new Promise(resolve=>{entered=resolve;}),controller=new AbortController();
    const repo=createVirtualGit({fs,http:upload(source,{async beforeRequest(method,signal){if(method==='POST'){receivedSignal=signal;entered();await new Promise(resolve=>{release=resolve;});}}})});
    const pending=repo.execute('clone',{url:'https://example.invalid/project',replace:true},{signal:controller.signal,assertActive(){if(!active)throw Error('Project changed');}});
    await started;assert.equal(receivedSignal,controller.signal);
    if(mode==='abort')controller.abort();else if(mode==='edit')fs.writeText('/index.js','newer editor work');else active=false;
    const before=fs.checkpoint();release();await assert.rejects(pending);assert.deepEqual(fs.checkpoint(),before);
  }
  const fs=createVirtualFileSystem();let enter,approve,active=true,requests=0,closed=0;
  const entered=new Promise(resolve=>{enter=resolve;});
  const repo=createVirtualGit({fs,beginRemote:async()=>{enter();await new Promise(resolve=>{approve=resolve;});return {http:{request(){requests++;throw Error('Should not request');}},close:async()=>{closed++;}};}});
  const pending=repo.execute('clone',{url:'https://example.invalid/project'},{assertActive(){if(!active)throw Error('Project changed');}});
  await entered;active=false;approve();await assert.rejects(pending,/Project changed/);assert.equal(requests,0);assert.equal(closed,1);assert.equal(fs.list().length,0);
});
