import {readdir, readFile, stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve, relative, extname} from 'node:path';

const root=fileURLToPath(new URL('../dist/demo/',import.meta.url));
const allowed=new Set(['.html','.js','.css','.woff','.woff2','.ttf','.svg','.png','.ico','.txt']);
const allowedJson=new Set(['assets/optimization/techniques-v1.json','prerendered-routes.json']);
const files=[];
async function visit(directory) {
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    const path=resolve(directory,entry.name);
    if(entry.isSymbolicLink()) throw Error('Static artifact must not contain symlinks');
    if(entry.isDirectory()) await visit(path);
    else {
      const name=relative(root,path).replaceAll('\\','/');
      if(!allowed.has(extname(name)) && !allowedJson.has(name)) throw Error(`Unexpected published file: ${name}`);
      files.push(name);
    }
  }
}
await visit(root);
const index=await readFile(resolve(root,'index.html'),'utf8');
const expectedBase=process.argv[2];
if(expectedBase && !index.includes(`<base href="${expectedBase}"`)) throw Error('Incorrect base href');
if(!files.some(name=>/^worker-.*\.js$/.test(name))) throw Error('Missing bundled scanner Worker');
await stat(resolve(root,'assets/optimization/techniques-v1.json'));
if(!files.some(name=>name.endsWith('.woff2'))) throw Error('Missing local icon font');
if(/https?:\/\/|localhost/.test(index)) throw Error('Index must use local static assets');
console.log('Demo artifact OK: static assets, Worker and catalogue; no telemetry, database, source maps or fixtures.');
