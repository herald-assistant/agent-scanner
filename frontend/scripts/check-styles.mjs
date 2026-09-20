import {readdirSync, readFileSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
function files(directory) {
  return readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const file = join(directory, entry.name);
    return entry.isDirectory() ? files(file) : file.endsWith('.css') ? [file] : [];
  });
}

const sources = files(root).map(file => ({
  file: relative(root, file).replaceAll('\\', '/'),
  css: readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ''))
}));
const defined = new Set(sources.flatMap(({css}) => [...css.matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1])));
const problems = [];
function report(file, css, index, message) {
  problems.push(`${file}:${css.slice(0, index).split('\n').length}: ${message}`);
}

for (const {file, css} of sources) {
  const isTokens = file === 'styles/tokens.css';
  const checks = [
    [/::ng-deep/g, 'Move explicitly scoped dynamic content styles to styles/markdown.css.'],
    ...(!isTokens ? [
      [/#(?:[\da-f]{3,8})\b|\b(?:rgb|rgba|hsl|hsla|oklch|oklab)\(/gi, 'Use a semantic color token from styles/tokens.css.'],
      [/\bfont(?:-size)?\s*:[^;{}]*\b\d+(?:\.\d+)?px\b/g, 'Use the shared rem typography scale (or an icon-size token).'],
      [/\bborder-radius\s*:[^;{}]*\b\d+px\b/g, 'Use a radius token.']
    ] : []),
    ...(file.startsWith('app/') ? [
      [/!important/g, 'Fix specificity or the shared primitive instead of adding !important.'],
      [/\.(?:mat-mdc-|mdc-)[\w-]+/g, 'Keep Material internals in the central styles/material.css adapter.'],
      [/--mat-[\w-]+\s*:/g, 'Keep Material theme overrides in styles/material.css.']
    ] : [])
  ];
  for (const [pattern, message] of checks) {
    for (const match of css.matchAll(pattern)) report(file, css, match.index, message);
  }
  for (const match of css.matchAll(/var\((--[\w-]+)\s*\)/g)) {
    if (!defined.has(match[1]) && !match[1].startsWith('--mat-')) {
      report(file, css, match.index, `Undefined token ${match[1]}.`);
    }
  }
}

// Check the actual palette, not duplicated expected color values.
const palette = sources.find(source => source.file === 'styles/tokens.css').css;
const colors = new Map([...palette.matchAll(/(--color-[\w-]+):\s*(#[\da-f]{6});/gi)]
  .map(match => [match[1], match[2]]));
function luminance(hex) {
  const channels = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}
const pairs = ['--color-text', '--color-text-secondary', '--color-text-muted'].flatMap(text =>
  ['--color-bg', '--color-surface', '--color-surface-raised', '--color-surface-inset', '--color-surface-hover']
    .map(surface => [text, surface]));
pairs.push(['--color-text-inverse', '--color-accent'], ['--color-text-inverse', '--color-info']);
for (const [foreground, background] of pairs) {
  if (!colors.has(foreground) || !colors.has(background)) {
    problems.push(`styles/tokens.css: Define ${foreground} and ${background} as palette HEX values so text contrast can be checked.`);
    continue;
  }
  const a = luminance(colors.get(foreground)), b = luminance(colors.get(background));
  const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  if (ratio < 4.5) problems.push(`styles/tokens.css: ${foreground} on ${background}: ${ratio.toFixed(2)}:1 contrast; at least 4.5:1 required.`);
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Style contract OK: ${sources.length} stylesheets; shared tokens, no component-level Material overrides, ${pairs.length} text/surface pairs meet 4.5:1 contrast.`);
}
