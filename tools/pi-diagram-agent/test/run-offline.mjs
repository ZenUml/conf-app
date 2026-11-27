// Offline synthetic suite: browser tests are enabled; timing assertions run alone.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('..',import.meta.url));
const performanceTest='test/audit-performance.test.mjs';
const tests=['test','bench'].flatMap(dir=>fs.readdirSync(path.join(root,dir)).filter(name=>name.endsWith('.test.mjs')).map(name=>`${dir}/${name}`)).filter(file=>file!==performanceTest).sort();
for(const [exe,args] of [
 [process.execPath,['--import','./test/setup-runtime.mjs','--test','--test-concurrency=2',...tests]],
 [process.execPath,['--import','./test/setup-runtime.mjs','--test','--test-concurrency=1',performanceTest]],
 ['python3',['-m','unittest','discover','-s','kit','-p','test_*.py']],
]){
 const result=spawnSync(exe,args,{cwd:root,stdio:'inherit',env:process.env});
 if(result.error){console.error(result.error.message);process.exit(1)}
 if(result.status!==0)process.exit(result.status??1);
}
