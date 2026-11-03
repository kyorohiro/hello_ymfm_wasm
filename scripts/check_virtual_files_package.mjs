import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, symlink, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const temporary=await mkdtemp(join(tmpdir(),'tetorica-virtual-files-package-'));
const run=(command,args,cwd)=>execFileSync(command,args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']});
try {
  const metadata=JSON.parse(await readFile(join(root,'dist/virtual-files/package.json'),'utf8'));
  assert.equal(Object.keys(metadata.dependencies??{}).length,0);
  for(const name of ['buffer','diff','isomorphic-git'])assert.equal(metadata.peerDependenciesMeta[name].optional,true);
  const [{filename}]=JSON.parse(run('npm',['pack','--json','--pack-destination',temporary,'--cache',join(temporary,'cache')],join(root,'dist/virtual-files')));
  const consumer=join(temporary,'consumer');
  await mkdir(consumer);
  await writeFile(join(consumer,'package.json'),JSON.stringify({private:true,type:'module'}));
  // Use an empty, offline cache: the normal install must succeed without peers.
  run('npm',['install',join(temporary,filename),'--offline','--ignore-scripts','--no-audit','--no-fund','--cache',join(temporary,'cache')],consumer);
  const lock=JSON.parse(await readFile(join(consumer,'package-lock.json'),'utf8'));
  assert.deepEqual(Object.keys(lock.packages).sort(),['','node_modules/tetorica-virtual-files']);
  run(process.execPath,['--input-type=module','-e',`
    import assert from 'node:assert/strict';
    import {createVirtualFileSystem,createShell,transferVirtualFiles,isCheckpointPath,CHECKPOINT_ROOT} from 'tetorica-virtual-files';
    import {createShell as directShell,parseRmArgs} from 'tetorica-virtual-files/shell.js';
    const fs=createVirtualFileSystem([{path:'/index.js',data:'hello'}]);
    assert.equal(createShell,directShell);
    assert.equal((await createShell({fs}).execute('cat index.js')).stdout,'hello');
    assert.deepEqual(parseRmArgs(['-fr','--','-sample']),{path:'-sample',recursive:true,force:true});
    assert.deepEqual(parseRmArgs(['--recursive','--force','samples']),{path:'samples',recursive:true,force:true});
    assert.throws(()=>parseRmArgs(['-x','samples']),/Unsupported rm option/);
    const removal=createVirtualFileSystem([{path:'/samples/a.raw',data:new Uint8Array([1])},{path:'/-sample',data:'option-like filename'}]);
    const removalShell=createShell({fs:removal});
    const rejected=await removalShell.execute('rm -xf samples');
    assert.equal(rejected.code,1);assert(removal.has('/samples/a.raw'));
    for(const command of ['rm -fr samples','rm --force missing','rm -- -sample']) {
      const result=await removalShell.execute(command);assert.equal(result.code,0,result.stderr);
    }
    assert.equal(removal.list().length,0);assert.deepEqual(removal.listDirectories(),['/']);
    assert.deepEqual(await fs.sync('/index.js',{syncRoot:'/ss.tet'}),{sourcePath:'/index.js',destinationPath:'/ss.tet/index.js',changed:true});
    assert.equal(fs.get('/ss.tet/index.js').data,'hello');
    assert.equal((await fs.sync('/index.js',{syncRoot:'/ss.tet'})).changed,false);
    fs.mkdir('/empty');await fs.sync('/empty');assert.equal(fs.stat('/.tet.ss/empty').type,'directory');
    await assert.rejects(fs.sync('/index.js',{syncRoot:'app-storage://~/'}),/Unsupported sync location/);
    const tracked=createVirtualFileSystem([{path:'/work.txt',data:'A'}],{autoCheckpoint:true});
    tracked.writeText('/work.txt','B');tracked.writeText('/work.txt','C');
    assert.equal(tracked.checkpoints.get('/work.txt').data,'A');
    assert.equal(tracked.checkpoints.isModified('/work.txt'),true);
    tracked.checkpoints.set('/work.txt');tracked.writeText('/work.txt','D');
    tracked.checkpoints.revert('/work.txt');assert.equal(tracked.get('/work.txt').data,'C');
    tracked.writeFiles([{path:'/work.txt',data:'E'},{path:'/state.json',data:'{}'}]);
    tracked.checkpoints.setMany(['/work.txt','/state.json']);
    assert.equal(tracked.checkpoints.get('/work.txt').data,'E');
    assert.equal(tracked.checkpoints.get('/state.json').data,'{}');
    tracked.writeText('/work.txt','C');tracked.checkpoints.set('/work.txt');
    transferVirtualFiles(tracked,'/work.txt','/moved.txt');
    assert.equal(tracked.checkpoints.get('/moved.txt').data,'C');
    assert.equal(CHECKPOINT_ROOT,'/.tet.ss');assert(isCheckpointPath('/.tet.ss/moved.txt'));
    const restored=createVirtualFileSystem();restored.restore(tracked.snapshot());
    assert.equal(restored.checkpoints.auto,false);assert.equal(restored.checkpoints.get('/moved.txt').data,'C');
    await assert.rejects(import('tetorica-virtual-files/git'),{code:'ERR_MODULE_NOT_FOUND'});
  `],consumer);
  await writeFile(join(consumer,'checkpoints.mts'), `
    import {createVirtualFileSystem,isCheckpointPath,CHECKPOINT_ROOT} from 'tetorica-virtual-files';
    import {parseRmArgs} from 'tetorica-virtual-files/shell.js';
    const removal:{path:string,recursive:boolean,force:boolean}=parseRmArgs(['-rf','.']);
    // @ts-expect-error rm arguments must be strings.
    parseRmArgs([123]);
    // @ts-expect-error Parsed flags are booleans.
    const invalidRemoval:string=removal.recursive;
    const fs=createVirtualFileSystem([{path:'/a',data:'A'}],{autoCheckpoint:true});
    fs.checkpoints.set('/a',{expectedRevision:fs.getRevision('/a')});
    const saved=fs.checkpoints.get('/a');
    if(saved?.type==='text')saved.data.toUpperCase();
    fs.checkpoints.revert('/a');fs.checkpoints.setAuto(false);
    fs.writeFiles([{path:'/a',data:'B',expectedRevision:fs.getRevision('/a')},{path:'/b',data:new Uint8Array([1])}],{checkpointChanges:false});
    fs.checkpoints.setMany(['/a','/b']);
    // @ts-expect-error Batch writes require valid file data.
    fs.writeFiles([{path:'/a',data:123}]);
    // @ts-expect-error Checkpoint batches require path strings.
    fs.checkpoints.setMany([123]);
    const enabled:boolean=fs.checkpoints.auto, changed:boolean=fs.checkpoints.isModified('/a');
    const internal:boolean=isCheckpointPath(CHECKPOINT_ROOT);
    const synced:Promise<{sourcePath:string,destinationPath:string,changed:boolean}>=fs.sync('/a',{syncRoot:'/ss.tet'});
    fs.sync('/');fs.sync('/a');
    // @ts-expect-error A destination is explicitly named in the options object.
    fs.sync('/a','/ss.tet');
    // @ts-expect-error The sync root must be a path string.
    fs.sync('/a',{syncRoot:123});
    fs.replace([{path:'/a',data:'B'}],[],{checkpointChanges:true});
    fs.checkpoint().snapshot.files;
    // @ts-expect-error Auto requires an explicit boolean.
    fs.checkpoints.setAuto('on');
    // @ts-expect-error The auto property is read-only.
    fs.checkpoints.auto=true;
    // @ts-expect-error Revision preconditions are numeric.
    fs.checkpoints.revert('/a',{expectedRevision:'1'});
    // @ts-expect-error Persistent file checkpoint operations are namespaced.
    fs.setCheckpoint('/a');
  `);
  for(const resolution of ['NodeNext','Bundler']) {
    await writeFile(join(consumer,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,noEmit:true,skipLibCheck:false,target:'ES2022',lib:['ES2022','DOM'],types:[],module:resolution==='NodeNext'?'NodeNext':'ESNext',moduleResolution:resolution},files:['checkpoints.mts']}));
    run(process.execPath,[join(root,'node_modules/typescript/bin/tsc'),'-p',join(consumer,'tsconfig.json')],consumer);
  }
  // Supply the application's peers, then exercise the same packed Git entry point.
  for(const name of ['buffer','diff','isomorphic-git'])await symlink(join(root,'node_modules',name),join(consumer,'node_modules',name),'dir');
  run(process.execPath,['--input-type=module','-e',`
    import assert from 'node:assert/strict';
    import {createHash} from 'node:crypto';
    import {deflateSync} from 'node:zlib';
    import {createVirtualFileSystem,createShell} from 'tetorica-virtual-files';
    import {createVirtualGit,registerGitShell} from 'tetorica-virtual-files/git';
    const fs=createVirtualFileSystem([{path:'/index.js',data:'hello'}]);
    const shell=createShell({fs}); registerGitShell(shell,createVirtualGit({fs}));
    for(const command of ['git init','git config user.name Test','git config user.email test@example.com','git add .','git commit -m first']){
      const result=await shell.execute(command);assert.equal(result.code,0,result.stderr);
    }
    assert.match((await shell.execute('git status')).stdout,/Working tree clean/);
    assert(fs.has('/.git/HEAD'));
    for(const alias of ['rm','remove']) {
      const added=await shell.execute('git remote add origin https://example.invalid/project');
      assert.equal(added.code,0,added.stderr);
      const removed=await shell.execute('git remote '+alias+' origin');assert.equal(removed.code,0,removed.stderr);
      assert.equal((await shell.execute('git remote -v')).stdout,'');
      assert.equal(fs.get('/index.js').data,'hello');assert(fs.has('/.git/HEAD'));
    }
    // An isolated smart-HTTP fixture exercises the packed clone implementation.
    // No external repository, network, credentials or host filesystem is used.
    const objects=[];
    const object=(type,data)=>{
      const body=Buffer.from(data),bytes=Buffer.concat([Buffer.from(type+' '+body.length+'\\0'),body]);
      const oid=createHash('sha1').update(bytes).digest('hex');objects.push({type,body});return oid;
    };
    const blob=object('blob','play("C4");\\n');
    const tree=object('tree',Buffer.concat([Buffer.from('100644 index.js\\0'),Buffer.from(blob,'hex')]));
    const oid=object('commit','tree '+tree+'\\nauthor Package Fixture <fixture@example.invalid> 1700000000 +0000\\ncommitter Package Fixture <fixture@example.invalid> 1700000000 +0000\\n\\nPacked clone fixture\\n');
    const header=Buffer.alloc(12);header.write('PACK');header.writeUInt32BE(2,4);header.writeUInt32BE(objects.length,8);
    const chunks=[header];
    for(const {type,body} of objects) {
      let size=body.length;const sizes=[({commit:1,tree:2,blob:3}[type]<<4)|(size&15)];size>>>=4;if(size)sizes[0]|=128;
      while(size){let next=size&127;size>>>=7;if(size)next|=128;sizes.push(next);}
      chunks.push(Buffer.from(sizes),deflateSync(body));
    }
    const packed=Buffer.concat(chunks),pack=Buffer.concat([packed,createHash('sha1').update(packed).digest()]);
    const packet=value=>{const bytes=Buffer.from(value);return Buffer.concat([Buffer.from((bytes.length+4).toString(16).padStart(4,'0')),bytes]);};
    const flush=Buffer.from('0000');let requests=0;
    const http={async request({url,method='GET'}) {
      requests++;
      const body=method==='GET'
        ? [packet('# service=git-upload-pack\\n'),flush,packet(oid+' HEAD\\0multi_ack_detailed side-band-64k ofs-delta symref=HEAD:refs/heads/stable\\n'),packet(oid+' refs/heads/stable\\n'),flush]
        : [packet('NAK\\n'),packet(Buffer.concat([Buffer.from([1]),pack])),flush];
      return {url,statusCode:200,statusMessage:'OK',headers:{'content-type':method==='GET'?'application/x-git-upload-pack-advertisement':'application/x-git-upload-pack-result'},body};
    }};
    const cloned=createVirtualFileSystem([{path:'/old.txt',data:'Keep until success'}]),cloneShell=createShell({fs:cloned});
    const cloneRepo=createVirtualGit({fs:cloned,http});registerGitShell(cloneShell,cloneRepo);
    const refused=await cloneShell.execute('git clone https://example.invalid/project .');
    assert.equal(refused.code,1);assert.match(refused.stderr,/FILES is not empty/);assert.equal(requests,0);
    const result=await cloneShell.execute('git clone --replace -b stable https://example.invalid/project .');
    assert.equal(result.code,0,result.stderr);assert(requests>=2);
    assert.equal(cloned.get('/index.js').data,'play("C4");\\n');assert(!cloned.has('/old.txt'));
    assert.equal((await cloneRepo.execute('log')).length,1);assert.match((await cloneShell.execute('git status')).stdout,/Working tree clean/);
    assert.equal((await cloneShell.execute('git remote rm origin')).code,0);
    assert.equal((await cloneShell.execute('git remote -v')).stdout,'');
    assert.equal((await cloneRepo.execute('log')).length,1);assert(cloned.has('/.git/refs/heads/stable'));
    assert(!cloned.has('/.git/refs/remotes/origin/stable'));
  `],consumer);
  console.log('Packed core installs without dependencies; sync/checkpoint/batch/rm APIs and types pass NodeNext/Bundler; optional Git peers enable local Git, remote removal and isolated HTTPS clone.');
} finally {
  await rm(temporary,{recursive:true,force:true});
}
