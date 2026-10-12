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
  const [{filename}]=JSON.parse(run('npm',['pack','--json','--pack-destination',temporary],join(root,'dist/virtual-files')));
  const consumer=join(temporary,'consumer');
  await mkdir(consumer);
  await writeFile(join(consumer,'package.json'),JSON.stringify({private:true,type:'module'}));
  // Use an empty, offline cache: the normal install must succeed without peers.
  run('npm',['install',join(temporary,filename),'--offline','--ignore-scripts','--no-audit','--no-fund','--cache',join(temporary,'cache')],consumer);
  const lock=JSON.parse(await readFile(join(consumer,'package-lock.json'),'utf8'));
  assert.deepEqual(Object.keys(lock.packages).sort(),['','node_modules/tetorica-virtual-files']);
  run(process.execPath,['--input-type=module','-e',`
    import assert from 'node:assert/strict';
    import {createVirtualFileSystem,createShell} from 'tetorica-virtual-files';
    import {createShell as directShell} from 'tetorica-virtual-files/shell.js';
    const fs=createVirtualFileSystem([{path:'/index.js',data:'hello'}]);
    assert.equal(createShell,directShell);
    assert.equal((await createShell({fs}).execute('cat index.js')).stdout,'hello');
    await assert.rejects(import('tetorica-virtual-files/git'),{code:'ERR_MODULE_NOT_FOUND'});
  `],consumer);
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
  console.log('Packed core installs without dependencies; optional Git peers enable init/add/commit/status.');
} finally {
  await rm(temporary,{recursive:true,force:true});
}
