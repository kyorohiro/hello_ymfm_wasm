import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createVirtualFileSystem} from '../src/filesystem.js';
import {createVirtualGit,registerGitShell} from '../src/git.js';
import {createShell} from '../src/shell.js';
import {createPlaygroundCassetteZip,loadPlaygroundCassette} from '../../../docs/playground/playground_cassette.js';

test('local Git: init, stage, commit, diff, binary, deletion, and Cassette round trip',async()=>{
  const fs=createVirtualFileSystem([{path:'/index.js',data:'first\n'},{path:'/sound.bin',data:new Uint8Array([0,128,255])}]);
  const repo=createVirtualGit({fs});
  await repo.execute('init');assert(fs.has('/.git/HEAD'));
  assert.equal((await repo.execute('status')).files[0].untracked,true);
  assert.match((await repo.execute('diff')).text,/first/);
  await repo.execute('stage',{paths:['/']});
  assert.equal((await repo.execute('diff')).text,'');
  assert.match((await repo.execute('diff',{staged:true})).text,/first/);
  await repo.execute('commit',{message:'first',name:'Test',email:'test@example.com'});
  assert.equal((await repo.execute('status')).files.length,0);
  fs.writeText('/index.js','edited\n');fs.delete('/sound.bin');
  assert.match((await repo.execute('diff')).text,/edited/);
  await repo.execute('stage',{paths:['/']});await repo.execute('commit',{message:'second'});
  assert.equal((await repo.execute('log')).length,2);
  const cassette=await loadPlaygroundCassette(createPlaygroundCassetteZip(fs.list(),{directories:fs.listDirectories()}));
  const restored=createVirtualFileSystem([...cassette.files].map(([path,data])=>({path:'/'+path,data})));const next=createVirtualGit({fs:restored});
  assert.equal((await next.execute('log')).length,2);
  assert.equal((await next.execute('status')).files.filter(f=>f.path!=='metadata.json').length,0);
});
test('Shell configuration and local Git work without Node filesystem or networking',async()=>{
  const fs=createVirtualFileSystem([{path:'/index.js',data:'one'}]),shell=createShell({fs});registerGitShell(shell,createVirtualGit({fs}));
  for(const command of ['git init','git config user.name Test','git config user.email test@example.com','git add index.js','git commit -m first'])assert.equal((await shell.execute(command)).code,0,command);
  assert.match((await shell.execute('git status')).stdout,/Working tree clean/);
  assert.match((await shell.execute('git push')).stderr,/Tauri/);
});
test('late edits and cancellation cannot publish a stale Git transaction',async()=>{
  const fs=createVirtualFileSystem([{path:'/index.js',data:'one'}]),repo=createVirtualGit({fs});const controller=new AbortController();
  const pending=repo.execute('init',{}, {signal:controller.signal});controller.abort();await assert.rejects(pending);assert(!fs.has('/.git/HEAD'));
  const changed=repo.execute('init');fs.writeText('/later.js','later');await assert.rejects(changed,/Files changed/);assert(fs.has('/later.js'));assert(!fs.has('/.git/HEAD'));
});
test('a live editor buffer changed during Git is retained when publishing is refused',async()=>{
  const fs=createVirtualFileSystem([{path:'/index.js',data:'one'}]);let buffer='one';
  const repo=createVirtualGit({fs,syncWorkingFiles(){fs.writeText('/index.js',buffer);}});
  const pending=repo.execute('init');buffer='later edit';await assert.rejects(pending,/Files changed/);
  assert.equal(fs.get('/index.js').data,'later edit');assert(!fs.has('/.git/HEAD'));
});
test('Git path arguments are relative to shell cwd, and remote -v lists fetch/push URLs',async()=>{
  const fs=createVirtualFileSystem([{path:'/index.js',data:'root\n'},{path:'/lib/a.js',data:'library\n'},{path:'/lib/b.js',data:'other\n'}]);
  const shell=createShell({fs});registerGitShell(shell,createVirtualGit({fs}));
  await shell.execute('git init');
  const scoped=await shell.execute('git status lib/a.js');assert.equal(scoped.code,0);assert.match(scoped.stdout,/lib\/a.js/);assert.doesNotMatch(scoped.stdout,/index.js|lib\/b.js/);
  await shell.execute('cd lib');const current=await shell.execute('git status .');assert.match(current.stdout,/lib\/a.js/);assert.doesNotMatch(current.stdout,/index.js/);
  assert.equal((await shell.execute('git status -s -- a.js')).stdout,'?? lib/a.js\n');
  const diff=await shell.execute('git diff -- a.js');assert.match(diff.stdout,/library/);assert.doesNotMatch(diff.stdout,/root|other/);
  await shell.execute('git add a.js');assert.equal((await shell.execute('git status --short a.js')).stdout,'A  lib/a.js\n');
  assert.match((await shell.execute('git diff --cached a.js')).stdout,/library/);
  await shell.execute('git remote add origin https://github.com/owner/one.git');
  const remote=await shell.execute('git remote -v');assert.equal(remote.code,0);assert.equal(remote.stdout,'origin\thttps://github.com/owner/one.git (fetch)\norigin\thttps://github.com/owner/one.git (push)\n');
  await shell.execute('git remote set-url origin https://github.com/owner/two.git');assert.equal((await shell.execute('git remote get-url origin')).stdout,'https://github.com/owner/two.git\n');
  assert.equal((await shell.execute('git remote')).stdout,'origin\n');assert.equal((await shell.execute('git status --unknown')).code,1);
});
test('push uses the supplied native transport, sends a pack, and closes its credential scope',async()=>{
  const fs=createVirtualFileSystem([{path:'/index.js',data:'first\n'}]);let closed=0,scope,pack;
  const pkt=text=>new TextEncoder().encode((new TextEncoder().encode(text).length+4).toString(16).padStart(4,'0')+text);
  const repo=createVirtualGit({fs,beginRemote:async request=>{scope=request;return{close:async()=>{closed++;},http:{async request({url,method,body}){
    if(method==='GET')return{url,statusCode:200,statusMessage:'OK',headers:{'content-type':'application/x-git-receive-pack-advertisement'},body:[pkt('# service=git-receive-pack\n'),new TextEncoder().encode('0000'),pkt('0000000000000000000000000000000000000000 capabilities^{}\0report-status side-band-64k\n'),new TextEncoder().encode('0000')]};
    const chunks=[];for await(const chunk of body)chunks.push(Buffer.from(chunk));pack=Buffer.concat(chunks);
    return{url,statusCode:200,statusMessage:'OK',headers:{'content-type':'application/x-git-receive-pack-result'},body:[pkt('\x01'+new TextDecoder().decode(pkt('unpack ok\n'))+new TextDecoder().decode(pkt(`ok refs/heads/${scope.branch}\n`))+'0000'),new TextEncoder().encode('0000')]};
  }}};}});
  await repo.execute('init');await repo.execute('stage',{paths:['/']});const committed=await repo.execute('commit',{message:'first',name:'Test',email:'test@example.com'});
  await repo.execute('remote',{url:'https://github.com/owner/repository'});await repo.execute('push');
  assert.equal(scope.commit,committed.commit);assert.equal(scope.branch,'main');assert.equal(closed,1);assert(pack.includes(Buffer.from('PACK')));assert(pack.includes(Buffer.from('refs/heads/main')));
  const shell=createShell({fs});registerGitShell(shell,repo);
  assert.match((await shell.execute('git branch -a')).stdout,/\* main/);assert.match((await shell.execute('git branch -a')).stdout,/remotes\/origin\/main/);
  assert.match((await shell.execute('git branch -r')).stdout,/origin\/main/);
  assert.equal((await shell.execute('git branch feature')).code,0);
  fs.writeText('/index.js','second\n');await repo.execute('stage',{paths:['/index.js']});await repo.execute('commit',{message:'second'});
  assert.equal((await shell.execute('git push -u origin feature')).code,0);
  assert.equal(scope.branch,'feature');assert.equal(scope.commit,committed.commit);assert(pack.includes(Buffer.from('refs/heads/feature')));
  assert.equal(fs.get('/.git/config').type,'binary');assert.match(new TextDecoder().decode(fs.get('/.git/config').data),/\[branch "feature"\]/);
  assert.match((await shell.execute('git branch --all')).stdout,/remotes\/origin\/feature/);
  assert.equal((await shell.execute('git push origin main')).code,0);assert.equal(scope.branch,'main');assert.notEqual(scope.commit,committed.commit);
  const count=closed;assert.equal((await shell.execute('git push origin missing')).code,1);assert.equal(closed,count);
  assert.equal((await shell.execute('git push --force origin main')).code,1);
  assert(!fs.list().some(file=>String(file.data).includes('personal access token')));
});
