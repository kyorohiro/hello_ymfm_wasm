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
    import {createShell as directShell} from 'tetorica-virtual-files/shell.js';
    const fs=createVirtualFileSystem([{path:'/index.js',data:'hello'}]);
    assert.equal(createShell,directShell);
    assert.equal((await createShell({fs}).execute('cat index.js')).stdout,'hello');
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
    transferVirtualFiles(tracked,'/work.txt','/moved.txt');
    assert.equal(tracked.checkpoints.get('/moved.txt').data,'C');
    assert.equal(CHECKPOINT_ROOT,'/.tet.ss');assert(isCheckpointPath('/.tet.ss/moved.txt'));
    const restored=createVirtualFileSystem();restored.restore(tracked.snapshot());
    assert.equal(restored.checkpoints.auto,false);assert.equal(restored.checkpoints.get('/moved.txt').data,'C');
    await assert.rejects(import('tetorica-virtual-files/git'),{code:'ERR_MODULE_NOT_FOUND'});
  `],consumer);
  await writeFile(join(consumer,'checkpoints.mts'), `
    import {createVirtualFileSystem,isCheckpointPath,CHECKPOINT_ROOT} from 'tetorica-virtual-files';
    const fs=createVirtualFileSystem([{path:'/a',data:'A'}],{autoCheckpoint:true});
    fs.checkpoints.set('/a',{expectedRevision:fs.getRevision('/a')});
    const saved=fs.checkpoints.get('/a');
    if(saved?.type==='text')saved.data.toUpperCase();
    fs.checkpoints.revert('/a');fs.checkpoints.setAuto(false);
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
    import {createVirtualFileSystem,createShell} from 'tetorica-virtual-files';
    import {createVirtualGit,registerGitShell} from 'tetorica-virtual-files/git';
    const fs=createVirtualFileSystem([{path:'/index.js',data:'hello'}]);
    const shell=createShell({fs}); registerGitShell(shell,createVirtualGit({fs}));
    for(const command of ['git init','git config user.name Test','git config user.email test@example.com','git add .','git commit -m first']){
      const result=await shell.execute(command);assert.equal(result.code,0,result.stderr);
    }
    assert.match((await shell.execute('git status')).stdout,/Working tree clean/);
    assert(fs.has('/.git/HEAD'));
  `],consumer);
  console.log('Packed core installs without dependencies; sync/checkpoint APIs/types pass NodeNext/Bundler; optional Git peers enable init/add/commit/status.');
} finally {
  await rm(temporary,{recursive:true,force:true});
}
