import {mkdir,readFile,writeFile} from 'node:fs/promises';

const directory=new URL('../src/scanner-core/testing/',import.meta.url);
const source=new URL('../../src/test/resources/fixtures/',import.meta.url);
const fixtureNames=['copilot-file-v1.jsonl','copilot-file-detached-v1.jsonl'];
const fixtures=Object.fromEntries(await Promise.all(fixtureNames.map(async name=>[name,await readFile(new URL(name,source),'utf8')])));
const expectations=JSON.parse(await readFile(new URL('copilot-file-expectations-v1.json',source),'utf8'));
await mkdir(directory,{recursive: true});
await writeFile(new URL('copilot-fixtures.generated.ts',directory),
  `// Generated from shared synthetic contract fixtures. Do not commit.\nexport const fixtures = ${JSON.stringify(fixtures)};\nexport const expectations = ${JSON.stringify(expectations)};\n`);
