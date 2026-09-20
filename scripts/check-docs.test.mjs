import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {checkDocs} from './check-docs.mjs';

function fixture(t, pages = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'scanner-docs-test-'));
  // The only recursive cleanup target is the exact directory created by mkdtemp.
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const documents = {
    'README.md': '# Projekt\n\n[Dokumentacja](docs/README.md)\n',
    'AGENTS.md': '# Zasady\n',
    'docs/README.md': '# Dokumentacja\n\nStatus: aktualny.\n',
    ...pages
  };
  for (const [name, content] of Object.entries(documents)) {
    const file = path.join(root, name);
    mkdirSync(path.dirname(file), {recursive: true});
    writeFileSync(file, content);
  }
  return root;
}

test('checks moved chapters, Polish anchors, duplicate headings and fenced examples', t => {
  const root = fixture(t, {
    'docs/README.md': '# Dokumentacja\n\nStatus: aktualny.\n\n[Rozdział](chapter.md#żółć--api)\n[Drugi](chapter.md#żółć--api-1)\n',
    'docs/chapter.md': '# Rozdział\n\nStatus: aktualny.\n\n## Żółć — `API`\n\n## Żółć — `API`\n\n```md\n# Przykład\n[Brak](missing.md)\n```\n'
  });
  assert.deepEqual(checkDocs(root).errors, []);
});

test('reports a broken path and fragment without fetching external URLs', t => {
  const root = fixture(t, {'docs/README.md': '# Dokumentacja\n\nStatus: aktualny.\n\n[Brak](missing.md)\n[Sekcja](../README.md#missing)\n[Web](https://invalid.example/path)\n'});
  const errors = checkDocs(root).errors;
  assert.equal(errors.length, 2);
  assert.ok(errors.some(error => error.includes('Brak celu: missing.md')));
  assert.ok(errors.some(error => error.includes('Brak nagłówka: ../README.md#missing')));
});

test('reports missing status, an orphan document and an unclosed code fence', t => {
  const root = fixture(t, {'docs/orphan.md': '# Osierocony\n\n```text\n'});
  const errors = checkDocs(root).errors;
  assert.equal(errors.length, 3);
  assert.ok(errors.some(error => error.includes('Brak ścieżki nawigacji')));
  assert.ok(errors.some(error => error.includes('Brak jawnego Status:')));
  assert.ok(errors.some(error => error.includes('Niezamknięty blok kodu')));
});

test('accepts encoded paths and rejects links outside the repository', t => {
  const root = fixture(t, {
    'docs/README.md': '# Dokumentacja\n\nStatus: aktualny.\n\n[Plik](plik%20ze%20spacjami.md)\n[Poza](../../outside.md)\n',
    'docs/plik ze spacjami.md': '# Plik\n\nStatus: aktualny.\n'
  });
  const errors = checkDocs(root).errors;
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes('wychodzi poza repozytorium'));
});
