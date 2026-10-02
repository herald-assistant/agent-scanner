import {after, before, test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, stat, mkdir, writeFile, truncate} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

// Run against the actual optimized static output. No Spring, proxy or API stub.
const root = fileURLToPath(new URL('../dist/demo/', import.meta.url));
const fixtures = fileURLToPath(new URL('../../src/test/resources/fixtures/', import.meta.url));
const report = fileURLToPath(new URL('../test-results/', import.meta.url));
const database = 'agent-scanner-demo';
let browser, server, url, basePath;
const types = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.ico':'image/x-icon'};

before(async () => {
  const index = await readFile(resolve(root, 'index.html'), 'utf8');
  basePath = index.match(/<base href="([^"]+)"/)[1];
  assert.ok(basePath.startsWith('/') && basePath.endsWith('/'));
  if (process.env.DEMO_URL) {
    const published=new URL(process.env.DEMO_URL);
    assert.equal(published.protocol,'https:');
    assert.equal(published.pathname,basePath);
    url=published.href;
  } else {
    server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (!['GET','HEAD'].includes(request.method) || !path.startsWith(basePath)) throw Error('unavailable');
      const file = resolve(root, path.slice(basePath.length) || 'index.html');
      if (!file.startsWith(resolve(root) + sep) || !(await stat(file)).isFile()) throw Error('unavailable');
      response.writeHead(200, {'Content-Type': types[extname(file)] || 'application/octet-stream'});
      response.end(request.method === 'HEAD' ? undefined : await readFile(file));
    } catch { response.writeHead(404); response.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}${basePath}`;
  }
  browser = await chromium.launch({headless: true});
  await mkdir(report, {recursive:true});
});
after(async () => {await browser?.close(); if(server) await new Promise(resolve => server.close(resolve));});

async function run(action, {init, viewport = {width:1440,height:1000}} = {}) {
  const context = await browser.newContext({viewport, reducedMotion:'reduce'});
  const errors = [], invalidRequests = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  context.on('request', request => {
    const target = new URL(request.url());
    if (target.protocol === 'blob:' || target.protocol === 'data:') return;
    if (target.origin !== new URL(url).origin || !['GET','HEAD'].includes(request.method()) || /\/(api|v1)(\/|$)/.test(target.pathname)) {
      invalidRequests.push(`${request.method()} ${target.origin}${target.pathname}`);
    }
  });
  await context.route('**/*', route => {
    const request = route.request(), target = new URL(request.url());
    if (target.origin !== new URL(url).origin || !['GET','HEAD'].includes(request.method()) || /\/(api|v1)(\/|$)/.test(target.pathname)) return route.abort();
    return route.continue();
  });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  try {
    await page.goto(url);
    await page.getByRole('heading', {name:'Wczytaj sesje GitHub Copilot z pliku'}).waitFor();
    await action(page, context);
    assert.deepEqual(invalidRequests, [], 'Demo attempted an API call or a payload upload');
    assert.deepEqual(errors, [], 'Unexpected browser errors');
  } finally {await context.close();}
}
async function preview(page, name = 'copilot-file-detached-v1.jsonl', buffer) {
  await page.locator('.session-import-input').setInputFiles(buffer ? {name, mimeType:'application/x-ndjson', buffer} : resolve(fixtures, name));
  const dialog = page.getByRole('dialog', {name:'Wybierz sesję do importu'});
  await dialog.waitFor(); return dialog;
}
async function importFile(page, name = 'copilot-file-detached-v1.jsonl', selected) {
  const dialog = await preview(page, name);
  const checks = dialog.getByRole('checkbox');
  if (selected) for (const id of selected) await dialog.locator(`input[value="${id}"]`).check();
  else for (const item of await checks.all()) await item.check();
  await dialog.getByRole('button', {name:'Importuj wybrane sesje',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  await page.locator('.session-title h1').waitFor();
}
async function counts(page) {
  return page.evaluate(async name => {
    const db = await new Promise((resolve,reject) => {const r=indexedDB.open(name); r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error);});
    const tx=db.transaction(['sessions','spans','messages','signals','scopes','metadata']);
    const result=Object.fromEntries(await Promise.all([...tx.objectStoreNames].map(async key => [key, await new Promise(resolve => {const r=tx.objectStore(key).count();r.onsuccess=()=>resolve(r.result);})])));
    db.close(); return result;
  }, database);
}
async function rawLines(page) {
  return page.evaluate(async name => {
    const db=await new Promise(resolve=>{const r=indexedDB.open(name);r.onsuccess=()=>resolve(r.result);});
    const values=await new Promise(resolve=>{const r=db.transaction('spans').objectStore('spans').getAll();r.onsuccess=()=>resolve(r.result);});
    db.close();return values.map(value=>value.rawLine).join('\n');
  },database);
}
async function fullVersion(page, trigger) {
  await trigger();
  const dialog=page.getByRole('dialog',{name:'Dostępne w pełnej wersji'});
  await dialog.waitFor(); assert.equal(await page.getByRole('dialog').count(),1);
  assert.doesNotMatch(await dialog.innerText(),/płat|opłat|cena/i);
  await dialog.getByRole('button',{name:'Rozumiem'}).click();
  await dialog.waitFor({state:'hidden'});
}

test('static startup, onboarding, unsupported features and idle time never call the backend', async () => run(async page => {
  assert.match(await page.locator('.onboarding-code').innerText(), /"github.copilot.chat.otel.exporterType": "file"/);
  assert.equal(await page.locator('as-topbar .top-actions').count(),0);
  assert.equal(await page.locator('as-topbar button').count(),1);
  await page.screenshot({path:resolve(report,'demo-home-desktop.png'),fullPage:true});
  await page.getByRole('button',{name:'Nowa analiza repozytorium',exact:true}).click();
  await page.getByRole('heading',{name:'Nowa analiza repozytorium',exact:true}).waitFor();
  assert.equal(await page.getByRole('dialog').count(),0);
  assert.equal(await page.getByText('Model oceniający',{exact:true}).count(),0);
  for (const route of ['repositories/new','standardization']) {
    await page.goto(url+'#/'+route);
    await page.getByRole('heading',{name:'Nowa analiza repozytorium',exact:true}).waitFor();
  }
  await page.waitForTimeout(2500);
}));

test('repository input persists masked configuration and selection, reopens without the folder and blocks only AI', async () => run(async (page, context) => {
  const folder = resolve(report, 'synthetic-repository');
  await mkdir(resolve(folder,'.github'),{recursive:true});
  await writeFile(resolve(folder,'AGENTS.md'),'Shared instructions. token=synthetic-secret-value');
  await writeFile(resolve(folder,'.github','copilot-instructions.md'),'Copilot configuration.');
  await writeFile(resolve(folder,'package.json'),'{}');
  await page.getByRole('button',{name:'Nowa analiza repozytorium',exact:true}).click();
  await page.locator('input[webkitdirectory]').setInputFiles(folder);
  await page.waitForURL(/#\/repositories\/[a-f0-9-]+\/inputs\/[a-f0-9-]+$/);
  await page.locator('.file-row').first().waitFor();
  assert.equal(await page.locator('.file-row').count(),2);
  assert.equal(await page.getByText('Model oceniający',{exact:true}).count(),0);
  await page.getByRole('checkbox',{name:'Przekaż do analizy: AGENTS.md',exact:true}).uncheck();
  await page.getByRole('button',{name:'Uruchom analizę',exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('.analysis-buttons button')?.disabled);
  await page.reload();
  await page.locator('.file-row').first().waitFor();
  assert.equal(await page.getByRole('checkbox',{name:'Przekaż do analizy: AGENTS.md',exact:true}).isChecked(),false);
  await page.getByRole('button',{name:'Podejrzyj AGENTS.md',exact:true}).click();
  const dialog = page.getByRole('dialog');
  assert.match(await dialog.innerText(),/token=\[UKRYTO\]/);
  assert.doesNotMatch(await dialog.innerText(),/synthetic-secret-value/);
  await page.screenshot({path:resolve(report,'demo-repository-file-desktop.png'),fullPage:true});
  await page.getByRole('button',{name:'Zamknij podgląd pliku'}).click();
  await fullVersion(page,()=>page.getByRole('button',{name:'Uruchom analizę',exact:true}).click());
  await page.screenshot({path:resolve(report,'demo-repository-desktop.png'),fullPage:true});
  const stored = await page.evaluate(async () => {
    const db=await new Promise(resolve=>{const request=indexedDB.open('agent-scanner-demo-repositories');request.onsuccess=()=>resolve(request.result);});
    const snapshots=await new Promise(resolve=>{const request=db.transaction('snapshots').objectStore('snapshots').getAll();request.onsuccess=()=>resolve(request.result);});
    db.close();return snapshots;
  });
  assert.equal(stored.length,1);
  assert.equal(stored[0].files.find(file=>file.path==='AGENTS.md').selected,false);
  assert.doesNotMatch(JSON.stringify(stored),/synthetic-secret-value|package.json/);
  const other = await context.newPage();
  await other.goto(page.url()); await other.locator('.file-row').first().waitFor();
  assert.equal(await other.getByRole('checkbox',{name:'Przekaż do analizy: AGENTS.md',exact:true}).isChecked(),false);
  await other.close();
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Zwiń panel sesji',exact:true}).click();
  await page.locator('mat-drawer').waitFor({state:'hidden'});
  await page.screenshot({path:resolve(report,'demo-repository-mobile.png'),fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const download = page.waitForEvent('download');
  await page.getByRole('button',{name:'Eksportuj pliki repozytorium do JSON',exact:true}).click();
  const exported=await download;
  const content=JSON.parse(await readFile(await exported.path(),'utf8'));
  assert.equal(content.format,'agent-scanner-repository-input');
  assert.equal(content.snapshot.id,stored[0].id);
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Usuń pliki repozytorium',exact:true}).click();
  await page.getByRole('heading',{name:'Wczytaj sesje GitHub Copilot z pliku'}).waitFor();
  await page.reload();
  assert.equal(await page.locator('.repository-item').count(),0);
}));

test('repository report expands mechanisms and IDE settings, persists Git metadata and downloads a local PDF', async () => run(async (page, context) => {
  const folder = resolve(report, 'synthetic-report-repository');
  const files = {
    'AGENTS.md': '# Shared rules\nVerify changes.',
    '.github/skills/review/SKILL.md': '---\nname: review\ndescription: Przegląd zmian i testów\ndisable-model-invocation: true\n---\nReview procedure.',
    '.github/agents/reviewer.agent.md': '---\nname: Reviewer\ndescription: Przegląd implementacji\ntools: [read, search]\nagents: [Evidence Researcher]\nhandoffs:\n  - label: Review evidence\n    agent: Evidence Researcher\n    prompt: Review the collected evidence and separate availability from actual use.\n    send: false\n---\nReview changes.',
    '.github/prompts/release.prompt.md': '---\nname: Release\ndescription: Przygotuj wydanie\nagent: reviewer\n---\nPrepare release.',
    '.vscode/mcp.json': '{"servers":{"local":{"command":"node","args":["server.js"],"env":{"API_KEY":"synthetic-secret-value"}}}}',
    '.vscode/settings.json': '{"github.copilot.enable":{"*":true},"chat.includeApplyingInstructions":true,"unknown":{"preserved":true}}',
    '.vscode/extensions.json': '{"recommendations":["GitHub.copilot","unrelated.extension"]}',
    '.aiassistant/rules/review.md': '# Przegląd kodu\nVerify changes.',
    '.aiignore': 'target/\n.env\n',
    '.noai': '',
    '.idea/workspace.xml': '<project><component name="Unrelated">unrelated-private-data</component><component name="GitHubCopilotSettings"><option name="apiKey" value="synthetic-secret-value"/></component></project>',
    '.git/config': '[remote "origin"]\n url = https://user:synthetic-password@example.invalid/team/repo.git?token=synthetic-secret-value',
    '.git/HEAD': 'ref: refs/heads/main\n',
    '.git/packed-refs': 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa refs/heads/main\n'
  };
  for (const [path, content] of Object.entries(files)) {
    const destination = resolve(folder, path); await mkdir(resolve(destination, '..'), {recursive: true}); await writeFile(destination, content);
  }
  await page.getByRole('button', {name: 'Nowa analiza repozytorium', exact: true}).click();
  await page.locator('input[webkitdirectory]').setInputFiles(folder);
  await page.waitForURL(/#\/repositories\/[a-f0-9-]+\/inputs\/[a-f0-9-]+$/);
  const inventory = page.getByRole('region', {name: 'Raport konfiguracji repozytorium'});
  await inventory.waitFor();
  assert.match(await inventory.innerText(), /https:\/\/example.invalid\/team\/repo.git/);
  assert.doesNotMatch(await inventory.innerText(), /synthetic-password/);
  await page.locator('[data-report-mechanism="SKILLS"] > summary').click();
  await page.locator('[data-report-mechanism="SKILLS"] .report-entry > summary').click();
  assert.match(await page.locator('[data-report-mechanism="SKILLS"]').innerText(), /Przegląd zmian i testów/);
  await page.locator('[data-report-mechanism="AGENTS"] > summary').click();
  await page.locator('[data-report-mechanism="AGENTS"] .report-entry > summary').click();
  const agentDetails = await page.locator('[data-report-mechanism="AGENTS"] .entry-details pre').allTextContents();
  assert.ok(agentDetails.includes('["Evidence Researcher"]'));
  assert.ok(agentDetails.includes('[{"label": "Review evidence", "agent": "Evidence Researcher", "prompt": "Review the collected evidence and separate availability from actual use.", "send": false}]'));
  await page.locator('[data-report-mechanism="VSCODE"] > summary').click();
  await page.locator('[data-report-mechanism="VSCODE"] .report-entry > summary').first().click();
  await page.screenshot({path: resolve(report, 'repository-report-desktop.png'), fullPage: true});
  const pdfDownload = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Pobierz raport PDF', exact: true}).click();
  const pdf = await pdfDownload;
  const bytes = await readFile(await pdf.path());
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  await writeFile(resolve(report, 'repository-report.pdf'), bytes);
  await context.setOffline(true);
  const offlineDownload = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Pobierz raport PDF', exact: true}).click();
  assert.equal((await readFile(await (await offlineDownload).path())).subarray(0, 5).toString(), '%PDF-');
  await context.setOffline(false);
  await page.reload(); await inventory.waitFor();
  assert.match(await inventory.innerText(), /aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
  await page.locator('[data-report-mechanism="JETBRAINS"] > summary').click();
  assert.match(await page.locator('[data-report-mechanism="JETBRAINS"]').innerText(), /review.md/);
  await page.setViewportSize({width: 390, height: 844});
  await page.getByRole('button', {name: 'Zwiń panel sesji', exact: true}).click();
  await page.locator('mat-drawer').waitFor({state: 'hidden'});
  await page.screenshot({path: resolve(report, 'repository-report-mobile.png'), fullPage: true});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  const snapshot = await page.evaluate(async () => {
    const db = await new Promise(resolve => {const r=indexedDB.open('agent-scanner-demo-repositories');r.onsuccess=()=>resolve(r.result);});
    const all=await new Promise(resolve=>{const r=db.transaction('snapshots').objectStore('snapshots').getAll();r.onsuccess=()=>resolve(r.result);});db.close();return all;
  });
  assert.equal(snapshot[0].files.length, 5);
  assert.equal(snapshot[0].reportFiles.length, 6);
  assert.doesNotMatch(JSON.stringify(snapshot), /synthetic-secret-value|synthetic-password|unrelated-private-data/);
}));

test('one main conversation, persisted scope, every local tab, panels and export', async () => run(async page => {
  const sourceText=await readFile(resolve(fixtures,'copilot-file-detached-v1.jsonl'),'utf8');
  const exactInteger=sourceText.replace('"preserved":true','"preserved":true,"large":9007199254740993');
  assert.ok(exactInteger.includes('9007199254740993'));
  const dialog=await preview(page,'copilot-file-detached-v1.jsonl',Buffer.from(exactInteger));
  assert.equal(await dialog.getByRole('checkbox').count(),1);
  assert.match(await dialog.innerText(),/rundy głównego agenta: 2/);
  assert.match(await dialog.innerText(),/rundy subagentów: 2/);
  assert.match(await dialog.innerText(),/Wywołania pomocnicze modelu: 1/);
  assert.match(await dialog.innerText(),/Spany w wybranym zakresie importu: 10/);
  assert.equal(await dialog.getByRole('button',{name:'Importuj wybrane sesje',exact:true}).isDisabled(),true);
  await dialog.getByRole('checkbox').check();
  await page.screenshot({path:resolve(report,'demo-import-desktop.png'),fullPage:true});
  await dialog.getByRole('button',{name:'Importuj wybrane sesje',exact:true}).click();
  await page.locator('.session-title h1').waitFor();
  assert.equal(await page.locator('.session-list .session-card').count(),1);
  assert.equal((await counts(page)).spans,10);
  const source=await rawLines(page);
  assert.doesNotMatch(source,/chat progress|backgroundTodoAgent|synthetic log/);
  await page.reload(); await page.locator('.session-title h1').waitFor();
  await page.getByRole('button',{name:/^Koszt i przebieg/}).click();
  await page.locator('as-cost-dashboard').waitFor();
  await page.screenshot({path:resolve(report,'demo-cost-desktop.png'),fullPage:true});
  await page.locator('as-interaction-timeline .detail-trigger[role="button"]').first().click();
  const aside=page.locator('[data-round-details-aside]');await aside.waitFor();
  await page.locator('as-round-details-dialog').waitFor();
  await page.screenshot({path:resolve(report,'demo-round-desktop.png'),fullPage:true});
  await page.keyboard.press('Escape');await aside.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Mapa pracy',exact:true}).click();
  await page.locator('as-workflow-view').waitFor();
  await page.screenshot({path:resolve(report,'demo-map-desktop.png'),fullPage:true});
  assert.equal(await page.locator('as-workflow-view').count(),1);
  await page.locator('as-workflow-view .model-round-node').first().click();
  await aside.waitFor();await page.keyboard.press('Escape');await aside.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Dane techniczne',exact:true}).click();
  await page.locator('as-technical-view').waitFor();
  assert.match(await page.locator('as-technical-view').innerText(),/Spany/);
  assert.equal(await page.locator('as-technical-view .span-row').count(),10);
  await page.getByRole('button',{name:/chat title/}).click();
  await page.locator('.technical-inspector h3').filter({hasText:'chat title'}).waitFor();
  assert.match(await page.locator('.technical-payload pre').innerText(),/9007199254740993/);
  await page.getByRole('button',{name:/^Surowe payloady OTLP/}).click();
  await page.locator('as-technical-view .signal-row').first().waitFor();
  assert.equal(await page.locator('as-technical-view .signal-row').count(),3);
  await fullVersion(page,()=>page.getByRole('button',{name:'AI Hub',exact:true}).click());
  assert.match(page.url(),/\/technical$/);
  const sessionId=new URL(page.url()).hash.split('/')[2];
  await fullVersion(page,()=>page.goto(url+`#/sessions/${sessionId}/ai-hub`));
  await page.waitForURL(/\/overview$/);
  assert.match(page.url(),/\/overview$/);
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Eksportuj sesję do JSON',exact:true}).click();
  const download=await downloadPromise, exported=JSON.parse(await readFile(await download.path(),'utf8'));
  assert.equal(exported.format,'agent-scanner-session');
  assert.equal(exported.session.conversationId,'fixture-main');
  assert.equal(exported.spans.length+exported.relatedDetails.reduce((sum,item)=>sum+item.spans.length,0),10);
  await page.waitForTimeout(2200);
}));

test('multiple roots commit together, selective raw, repeated import, deletion and clearing', async () => run(async page => {
  await importFile(page,'copilot-file-v1.jsonl');
  assert.equal(await page.locator('.session-list .session-card').count(),2);
  assert.equal((await counts(page)).spans,7);
  const repeat=await preview(page,'copilot-file-v1.jsonl');
  for (const box of await repeat.getByRole('checkbox').all()) assert.equal(await box.isDisabled(),true);
  await page.keyboard.press('Escape');await repeat.waitFor({state:'hidden'});
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Usuń sesję',exact:true}).click();
  await page.getByRole('heading',{name:'Wczytaj sesje GitHub Copilot z pliku'}).waitFor();
  await page.reload(); await page.locator('.session-list .session-card').first().waitFor();
  assert.equal(await page.locator('.session-list .session-card').count(),1);
  assert.equal((await counts(page)).spans,5);
  assert.doesNotMatch(await rawLines(page),/file-session-b/);
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Wyczyść',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.session-list .session-card'));
  await page.reload();await page.getByRole('heading',{name:'Wczytaj sesje GitHub Copilot z pliku'}).waitFor();
  assert.deepEqual(await counts(page),{messages:0,metadata:0,scopes:0,sessions:0,signals:0,spans:0});
}));

test('cancel and selecting only one root never store unselected raw', async () => run(async page => {
  const cancelled=await preview(page,'copilot-file-v1.jsonl');
  await cancelled.getByRole('checkbox').first().check();
  await cancelled.getByRole('button',{name:'Anuluj',exact:true}).click();
  await cancelled.waitFor({state:'hidden'});assert.equal((await counts(page)).spans,0);
  await importFile(page,'copilot-file-v1.jsonl',['file-session-a']);
  assert.equal((await counts(page)).spans,5);
  assert.doesNotMatch(await rawLines(page),/file-session-b|synthetic log/);
}));

for (const fault of ['QuotaExceededError','AbortError']) {
  test(`a ${fault} after partial writes rolls back all selected roots and preserves existing data`, async () => run(async page => {
    await importFile(page);const before=await counts(page);
    const dialog=await preview(page,'copilot-file-v1.jsonl');
    for (const box of await dialog.getByRole('checkbox').all()) await box.check();
    await page.evaluate(fault=>{
      const original=IDBObjectStore.prototype.add;let writes=0;
      IDBObjectStore.prototype.add=function(...args){
        if(this.name==='spans' && ++writes===3) {
          IDBObjectStore.prototype.add=original;
          if(fault==='AbortError') {this.transaction.abort();throw new DOMException('Synthetic transaction abort',fault);}
          throw new DOMException('Synthetic quota limit',fault);
        }
        return original.apply(this,args);
      };
    },fault);
    await dialog.getByRole('button',{name:'Importuj wybrane sesje',exact:true}).click();
    await page.locator('mat-snack-bar-container').filter({hasText:fault==='QuotaExceededError'?'Brak miejsca':'IndexedDB'}).waitFor();
    assert.deepEqual(await counts(page),before);
    await page.reload();await page.locator('.session-title h1').waitFor();
    assert.equal(await page.locator('.session-list .session-card').count(),1);
  }));
}

test('a second tab can create a conflict after preview; the first tab commits nothing', async () => run(async (page,context) => {
  const dialog=await preview(page,'copilot-file-v1.jsonl');
  for (const box of await dialog.getByRole('checkbox').all()) await box.check();
  const second=await context.newPage();await second.goto(url);await second.locator('.session-import-input').waitFor({state:'attached'});
  await importFile(second,'copilot-file-v1.jsonl',['file-session-a']);
  const before=await counts(second);
  await dialog.getByRole('button',{name:'Importuj wybrane sesje',exact:true}).click();
  await page.locator('mat-snack-bar-container').filter({hasText:'już zapisany'}).waitFor();
  assert.deepEqual(await counts(page),before);
  assert.doesNotMatch(await rawLines(page),/file-session-b/);
}));

test('invalid UTF-8, JSON, duplicate conflicts and file limit leave existing data intact', async () => run(async page => {
  await importFile(page);const before=await counts(page);
  const input=page.locator('.session-import-input');
  const first=(await readFile(resolve(fixtures,'copilot-file-v1.jsonl'),'utf8')).split('\n')[0];
  for (const [buffer,message] of [
    [Buffer.from([0xff,0xfe]),'UTF-8'],
    [Buffer.from('{broken}'),'wierszu 1'],
    [Buffer.from(first+'\n'+first.replace('invoke_agent child','changed')),'Sprzeczne rekordy']
  ]) {
    await input.setInputFiles({name:'invalid.jsonl',mimeType:'application/x-ndjson',buffer});
    await page.locator('mat-snack-bar-container').filter({hasText:new RegExp(message,'i')}).waitFor();
    assert.deepEqual(await counts(page),before);
    await page.getByRole('button',{name:'Zamknij',exact:true}).last().click();
  }
  const oversized=resolve(report,'oversized-synthetic.jsonl');
  await writeFile(oversized,''); await truncate(oversized,64*1024*1024+1);
  await input.setInputFiles(oversized);
  await page.locator('mat-snack-bar-container').filter({hasText:'limit 64 MB'}).waitFor();
  assert.deepEqual(await counts(page),before);
}));

test('trace fallback remains a selectable main session and missing content stays a data state', async () => run(async page => {
  const source=(await readFile(resolve(fixtures,'copilot-file-v1.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  const invoke=source.find(span=>span.name==='invoke_agent A');
  assert.ok(invoke);
  invoke.attributes={'gen_ai.operation.name':'invoke_agent'};
  const dialog=await preview(page,'fallback.jsonl',Buffer.from(JSON.stringify(invoke)));
  assert.equal(await dialog.getByRole('checkbox').count(),1);
  assert.match(await dialog.innerText(),/trace:/);
  assert.match(await dialog.innerText(),/Bez przechwyconej treści/);
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button',{name:'Importuj wybrane sesje',exact:true}).click();
  await page.locator('.session-title h1').waitFor();
  assert.equal(await page.locator('.session-list .session-card').count(),1);
  await page.getByRole('button',{name:'Dane techniczne',exact:true}).click();
  await page.locator('as-technical-view').waitFor();
  assert.match(await page.locator('as-technical-view').innerText(),/niewyemitowana/);
  assert.equal(await page.getByRole('dialog').count(),0);
}));

test('worker cancellation releases a large preview and a subsequent import still works', async () => run(async page => {
  const first=(await readFile(resolve(fixtures,'copilot-file-v1.jsonl'),'utf8')).split('\n')[0]+'\n';
  const buffer=Buffer.from(first.repeat(Math.floor(40*1024*1024/Buffer.byteLength(first))));
  await page.locator('.session-import-input').setInputFiles({name:'large.jsonl',mimeType:'application/x-ndjson',buffer});
  await page.getByRole('button',{name:'Anuluj odczyt',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('[role="status"]')?.textContent?.includes('plik'));
  assert.equal((await counts(page)).spans,0);
  assert.equal(await page.getByRole('dialog').count(),0);
  await importFile(page);assert.equal((await counts(page)).spans,10);
}));

test('IndexedDB unavailable reports an error and never pretends that import succeeded', async () => run(async page => {
  await page.locator('mat-snack-bar-container').filter({hasText:'IndexedDB jest niedostępne'}).waitFor();
  await page.locator('.session-import-input').setInputFiles(resolve(fixtures,'copilot-file-v1.jsonl'));
  await page.locator('mat-snack-bar-container').filter({hasText:'IndexedDB jest niedostępne'}).waitFor();
  assert.equal(await page.getByRole('dialog').count(),0);
  assert.equal(await page.locator('.session-list .session-card').count(),0);
},{init:()=>Object.defineProperty(globalThis,'indexedDB',{value:undefined,configurable:true})}));

test('v1 migration preserves previous records and assigns noncolliding IDs', async () => run(async page => {
  await page.locator('.session-list .session-card').waitFor();
  assert.equal((await counts(page)).sessions,1);
  await importFile(page);
  assert.equal((await counts(page)).sessions,4);
  const ids=await page.evaluate(async name=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open(name);r.onsuccess=()=>resolve(r.result);});
    const sessions=await new Promise(resolve=>{const r=db.transaction('sessions').objectStore('sessions').getAll();r.onsuccess=()=>resolve(r.result);});
    db.close();return sessions.map(item=>item.id);
  },database);
  assert.ok(ids.includes(41) && ids.filter(id=>id!==41).every(id=>id>41));
  await page.reload();await page.locator('.session-title h1').waitFor();
  assert.equal(await page.locator('.session-list .session-card').count(),2);
}, {init: () => {
  // Open v1 before Angular's first transaction. This synthetic schema has no query indexes.
  if (!/^https?:$/.test(location.protocol)) return;
  const request=indexedDB.open('agent-scanner-demo',1);
  request.onupgradeneeded=()=>{
    const db=request.result;
    for(const name of ['sessions','spans','messages','signals','scopes','metadata']) db.createObjectStore(name,{keyPath:name==='scopes'?'rootId':name==='metadata'?'key':'id'});
    request.transaction.objectStore('sessions').add({id:41,conversationId:'legacy-main',agentName:'Legacy fixture',sourceKind:'vscode',sourceService:'copilot-chat',sourceVersion:'fixture',requestedModel:'synthetic-model',responseModel:'synthetic-model',startedAt:'2025-01-01T00:00:00Z',lastSeenAt:'2025-01-01T00:00:00Z',inputTokens:0,outputTokens:0,cacheReadTokens:0,cacheCreationTokens:0,reasoningTokens:0,turnCount:0,toolCount:0,errorCount:0,contentCaptured:false});
    request.transaction.objectStore('scopes').add({rootId:41,sessionIds:[41],parserVersion:'copilot-file-v1',coreVersion:'scanner-core-v1'});
  };
  request.onsuccess=()=>request.result.close();
}}));

test('blocked schema upgrade asks to close another tab and can be retried without deleting data', async () => run(async page => {
  await page.locator('mat-snack-bar-container').filter({hasText:'Zamknij inne karty'}).waitFor();
  await page.evaluate(()=>globalThis.syntheticBlockingDb.close());
  await page.getByRole('button',{name:'Spróbuj ponownie',exact:true}).click();
  await page.waitForTimeout(200);
  await importFile(page);assert.equal((await counts(page)).spans,10);
},{init:()=>{
  if (!/^https?:$/.test(location.protocol)) return;
  const request=indexedDB.open('agent-scanner-demo',1);
  request.onupgradeneeded=()=>{const db=request.result;db.createObjectStore('metadata',{keyPath:'key'});};
  request.onsuccess=()=>{globalThis.syntheticBlockingDb=request.result;};
}}));

test('narrow viewport supports modal selection and local navigation without horizontal page overflow', async () => run(async page => {
  // The sidebar can be collapsed on narrow screens; the onboarding import remains accessible.
  await page.locator('.onboarding input[type="file"]').setInputFiles(resolve(fixtures,'copilot-file-detached-v1.jsonl'));
  const dialog=page.getByRole('dialog',{name:'Wybierz sesję do importu'});await dialog.waitFor();
  await dialog.getByRole('checkbox').check();
  await page.screenshot({path:resolve(report,'demo-import-mobile.png'),fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await dialog.getByRole('button',{name:'Importuj wybrane sesje',exact:true}).click();
  await page.locator('.session-title h1').waitFor();
  await page.getByRole('button',{name:'Dane techniczne',exact:true}).click();
  await page.locator('as-technical-view').waitFor();
  await page.screenshot({path:resolve(report,'demo-technical-mobile.png'),fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
},{viewport:{width:390,height:844}}));
