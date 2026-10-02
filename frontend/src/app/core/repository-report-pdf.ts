import type {Content, CustomTableLayout, TableCell, TDocumentDefinitions} from 'pdfmake/interfaces';
import {RepositoryReport, ReportEntry, ReportGroup} from './repository-report';

// Print palette: category accents identify an area, never a quality or adoption score.
const ink = '#243448', navy = '#122235', muted = '#627286', line = '#dde5ec', pale = '#f3f6f9';
const wrap = (text: string): string => text.replace(/\S{49,}/gu, token => token.replace(/(\S{24})(?=\S)/gu, '$1\u200b'));
const missing = 'Brak danych';
const noLines: CustomTableLayout = {hLineWidth: () => 0, vLineWidth: () => 0,
  paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0};
interface CategoryVisual { title: string; color: string; tint: string; path: string; }
const visuals: Record<string, CategoryVisual> = {
  INSTRUCTIONS: {title: 'Instrukcje', color: '#226b73', tint: '#edf5f5', path: 'M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h6'},
  SKILLS: {title: 'Skills', color: '#70538d', tint: '#f3eff8', path: 'M2 8l10-5 10 5-10 5z M6 11v6l6 3 6-3v-6 M22 8v8'},
  AGENTS: {title: 'Agenci', color: '#3c638d', tint: '#eef3f9', path: 'M5 7h14v13H5z M12 7V3 M9 3h6 M8 12h1 M15 12h1 M9 16h6 M2 11v5 M22 11v5'},
  MCP: {title: 'MCP', color: '#217789', tint: '#eaf5f8', path: 'M9 9h6v6H9z M3 3h4v4H3z M17 3h4v4h-4z M3 17h4v4H3z M17 17h4v4h-4z M7 7l2 2 M15 9l2-2 M7 17l2-2 M15 15l2 2'},
  PROMPTS: {title: 'Prompty', color: '#9a586a', tint: '#faf0f3', path: 'M3 4h18v13H9l-6 4z M7 8h10 M7 12h7'},
  CONTEXT: {title: 'Materiały konfiguracji', color: '#586b80', tint: '#f1f4f7', path: 'M3 6h7l2 3h9v12H3z M3 6V3h7l2 3h7v3'},
  VSCODE: {title: 'VS Code', color: '#316b99', tint: '#edf4fa', path: 'M8 5L2 12l6 7 M16 5l6 7-6 7 M14 3l-4 18'},
  JETBRAINS: {title: 'IntelliJ / JetBrains', color: '#735784', tint: '#f4f0f7', path: 'M4 3h16v18H4z M4 8h16 M8 12v5 M12 11v7 M16 13v3'}
};

export function repositoryReportDefinition(report: RepositoryReport, generatedAt = new Date()): TDocumentDefinitions {
  const content: Content[] = [
    {table: {widths: ['*'], body: [[{fillColor: navy, margin: [20, 16, 20, 17], stack: [
      {text: 'RAPORT KONFIGURACJI AI', fontSize: 8, bold: true, characterSpacing: 1.6, color: '#a8dbe0'},
      {text: wrap(report.name), fontSize: 25, bold: true, color: '#ffffff', margin: [0, 8, 0, 6]},
      {text: 'Mechanizmy i ustawienia zadeklarowane w repozytorium', fontSize: 10, color: '#d2dce6'},
      {text: 'Wygenerowano: ' + generatedAt.toLocaleString('pl-PL'), fontSize: 8, color: '#d2dce6', margin: [0, 11, 0, 0]}
    ]}]]}, layout: noLines, margin: [0, 2, 0, 16]},
    {text: 'Repozytorium', id: 'repository', outline: true, style: 'eyebrow', margin: [0, 0, 0, 10]},
    meta('ORIGIN', report.git?.origin ?? missing),
    meta('COMMIT', report.git?.commit ?? missing),
    meta('BRANCH', report.git?.branch ?? missing),
    {text: 'Przegląd kategorii', style: 'heading', margin: [0, 19, 0, 4]},
    {text: 'Wybierz kategorię, aby przejść do deklaracji i plików źródłowych.', style: 'note', margin: [0, 0, 0, 12]},
    ...categoryCards(report.groups),
    ...(report.unreadableCount ? [{text: 'Nie odczytano treści ' + report.unreadableCount + ' plików. Szczegóły pominięć są wskazane przy plikach.', style: 'warning'} as Content] : [])
  ];
  let firstGroup = true;
  for (const group of report.groups) {
    if (!group.entries.length) continue;
    const visual = categoryVisual(group);
    const keepFirstEntry = compactEntry(group.entries[0]);
    const keepFirstHeader = keepFirstEntry || shortHeader(group.entries[0]);
    content.push({unbreakable: true, pageBreak: firstGroup ? 'before' : undefined, stack: [
      {table: {widths: ['*'], body: [[{fillColor: visual.tint, margin: [12, 10, 12, 10], columns: [
        {svg: categoryIcon(visual), width: 26, margin: [0, 1, 0, 0]},
        {stack: [{text: group.title, id: 'group-' + group.id, outline: true, fontSize: 15, bold: true, color: visual.color},
          {text: group.summary, fontSize: 9, color: muted, margin: [0, 3, 0, 0]}]}
      ], columnGap: 11}]]}, layout: noLines, margin: [0, firstGroup ? 0 : 17, 0, 2]},
      ...(keepFirstEntry ? entryContent(group.entries[0]) : keepFirstHeader ? entryHeader(group.entries[0]) : [])]});
    firstGroup = false;
    for (const [index, entry] of group.entries.entries()) {
      if (!index && keepFirstEntry) continue;
      if (index && compactEntry(entry)) { content.push({unbreakable: true, stack: entryContent(entry)}); continue; }
      if (index || !keepFirstHeader) content.push({unbreakable: shortHeader(entry), stack: entryHeader(entry)});
      content.push(...entryBody(entry));
    }
  }
  return {
    pageSize: 'A4', pageMargins: [42, 72, 42, 60],
    info: {title: 'Raport konfiguracji AI · ' + report.name, author: 'Agent Scanner', subject: 'Lokalna inwentaryzacja konfiguracji repozytorium'},
    defaultStyle: {font: 'Roboto', fontSize: 9.5, color: ink, lineHeight: 1.15},
    styles: {
      eyebrow: {fontSize: 8, bold: true, color: muted, characterSpacing: 1},
      heading: {fontSize: 17, bold: true, color: navy},
      entry: {fontSize: 11, bold: true, color: navy},
      path: {fontSize: 8.5, color: muted, margin: [0, 0, 0, 5]},
      note: {fontSize: 8.5, color: muted, margin: [0, 3, 0, 3]},
      warning: {fontSize: 8.5, color: '#86551f', margin: [0, 5, 0, 3]}
    },
    header: page => page === 1 ? {columns: [
      {svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" rx="6" fill="#122235"/><path d="M6 17v-4M11 17V7M16 17v-7" fill="none" stroke="#b8f36b" stroke-width="2.5" stroke-linecap="round"/></svg>', width: 20},
      {text: 'AGENT SCANNER', bold: true, fontSize: 9, color: navy, margin: [7, 5, 0, 0]}
    ], margin: [42, 24, 42, 0]} : {
      text: [{text: 'RAPORT REPOZYTORIUM', fontSize: 7, characterSpacing: 1}, {text: ' · ' + wrap(report.name)}],
      alignment: 'right', fontSize: 8, color: muted, margin: [42, 29, 42, 0]
    },
    footer: (page, count) => ({
      text: String(page).padStart(2, '0') + ' / ' + String(count).padStart(2, '0'),
      alignment: 'right', fontSize: 8, color: muted, margin: [42, 28, 42, 0]
    }),
    content
  };
}

function categoryVisual(group: ReportGroup): CategoryVisual { return visuals[group.id] ?? visuals['CONTEXT']; }
function categoryIcon(visual: CategoryVisual): string {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="' + visual.path
    + '" fill="none" stroke="' + visual.color + '" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}
function categoryCards(groups: ReportGroup[]): Content[] {
  const result: Content[] = [];
  for (let index = 0; index < groups.length; index += 2) {
    result.push({unbreakable: true, table: {widths: ['*', 12, '*'],
      body: [[categoryCard(groups[index]), {text: ''}, groups[index + 1] ? categoryCard(groups[index + 1]) : {text: ''}]]},
      layout: noLines, margin: [0, 0, 0, 9]});
  }
  return result;
}
function categoryCard(group: ReportGroup): TableCell {
  const visual = categoryVisual(group);
  const summary = group.entries.length ? group.summary : group.complete ? 'Nie znaleziono' : 'Nie ustalono';
  const width = (595.28 - 84 - 12) / 2, height = 76;
  // The SVG owns the link rectangle; detached text remains selectable above it.
  return {stack: [
    {svg: '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height
      + '"><rect width="100%" height="100%" fill="' + (group.entries.length ? visual.tint : pale) + '"/></svg>',
      width, height, linkToDestination: group.entries.length ? 'group-' + group.id : undefined},
    {relativePosition: {x: 0, y: -height}, table: {widths: [39, width - 39], heights: height, body: [[
      {svg: categoryIcon(visual), width: 25, verticalAlignment: 'middle', margin: [14, 0, 0, 0]},
      {verticalAlignment: 'middle', margin: [10, 0, 14, 0], stack: [
        {text: visual.title, bold: true, fontSize: 12, color: visual.color},
        {text: summary, fontSize: 9.5, color: ink, margin: [0, 5, 0, 0]}
      ]}
    ]]}, layout: noLines}
  ]};
}
function meta(label: string, value: string): Content {
  return {columns: [{text: label, width: 65, fontSize: 8, bold: true, color: muted, characterSpacing: 0.5},
    {text: wrap(value), fontSize: 9, color: ink}], margin: [0, 0, 0, 8]};
}
function shortHeader(entry: ReportEntry): boolean { return entry.name.length + entry.path.length <= 800; }
function compactEntry(entry: ReportEntry): boolean {
  const text = [entry.name, entry.path, entry.description, ...entry.notes, ...entry.details.flatMap(detail => [detail.label, detail.value])].join('\n');
  return entry.name.length + entry.path.length <= 200 && entry.details.length <= 6 && text.length <= 650 && text.split('\n').length <= 16;
}
function entryContent(entry: ReportEntry): Content[] { return [...entryHeader(entry), ...entryBody(entry)]; }
function entryBody(entry: ReportEntry): Content[] {
  const content: Content[] = [];
  if (entry.description) content.push({text: wrap(entry.description), margin: [0, 5, 0, 8]});
  if (entry.details.length) content.push(detailTable(entry.details.map(detail => [detail.label, detail.value])));
  for (const text of entry.notes) content.push({text: wrap(text), style: 'note'});
  return content;
}
function entryHeader(entry: ReportEntry): Content[] {
  return [{text: wrap(entry.name), style: 'entry', margin: [0, 12, 0, 3]},
    {text: wrap(entry.path), style: 'path'},
    ...(!entry.readable || entry.redacted ? [{text: !entry.readable ? 'Treść nieodczytana' : 'Zamaskowane wartości', style: 'note'} as Content] : [])];
}
function detailTable(rows: string[][]): Content {
  return {table: {widths: [145, '*'], dontBreakRows: rows.every(row => row.join('\n').length <= 600 && row.join('\n').split('\n').length <= 15), body: rows.map(([label, value]) => [
    {text: wrap(label), fontSize: 8.5, color: muted, fillColor: pale, margin: [8, 6, 8, 6]},
    {text: wrap(value), fontSize: 9, margin: [8, 6, 8, 6]}
  ])}, layout: {...noLines, hLineWidth: () => 0.5, hLineColor: () => line}, margin: [0, 3, 0, 7]};
}

export async function createRepositoryReportPdf(report: RepositoryReport): Promise<Blob> {
  const [{default: pdfMake}, {default: vfs}] = await Promise.all([import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts')]);
  pdfMake.addVirtualFileSystem(vfs);
  pdfMake.addFonts({Roboto: {normal: 'Roboto-Regular.ttf', bold: 'Roboto-Medium.ttf', italics: 'Roboto-Italic.ttf', bolditalics: 'Roboto-MediumItalic.ttf'}});
  return pdfMake.createPdf(repositoryReportDefinition(report)).getBlob();
}
