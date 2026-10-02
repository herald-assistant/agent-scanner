import type {Content, ContentStack, CustomTableLayout, Node, TableCell, TDocumentDefinitions} from 'pdfmake/interfaces';
import {RepositoryReport, ReportEntry, ReportGroup} from './repository-report';
import {repositoryFileLink, repositoryFilePreview, type FilePreview} from './repository-report-preview';

// Print identity: forest greens with the application's lime accent. Color does not encode a score.
const forest = '#123c30', green = '#226347', lime = '#b8f36b', mint = '#edf5ee';
const ink = '#20382e', muted = '#596e63';
const pageWidth = 595.28, pageHeight = 841.89, inset = 42, contentWidth = pageWidth - inset * 2;
const wrap = (text: string): string => text.replace(/\S{49,}/gu, token => token.replace(/(\S{24})(?=\S)/gu, '$1\u200b'));
const noLines: CustomTableLayout = {hLineWidth: () => 0, vLineWidth: () => 0,
  paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0};
interface CategoryVisual { title: string; path: string; }
const visuals: Record<string, CategoryVisual> = {
  INSTRUCTIONS: {title: 'Instrukcje', path: 'M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h6'},
  SKILLS: {title: 'Skills', path: 'M2 8l10-5 10 5-10 5z M6 11v6l6 3 6-3v-6 M22 8v8'},
  AGENTS: {title: 'Agenci', path: 'M5 7h14v13H5z M12 7V3 M9 3h6 M8 12h1 M15 12h1 M9 16h6 M2 11v5 M22 11v5'},
  MCP: {title: 'MCP', path: 'M9 9h6v6H9z M3 3h4v4H3z M17 3h4v4h-4z M3 17h4v4H3z M17 17h4v4h-4z M7 7l2 2 M15 9l2-2 M7 17l2-2 M15 15l2 2'},
  PROMPTS: {title: 'Prompty', path: 'M3 4h18v13H9l-6 4z M7 8h10 M7 12h7'},
  CONTEXT: {title: 'Materiały konfiguracji', path: 'M3 6h7l2 3h9v12H3z M3 6V3h7l2 3h7v3'},
  VSCODE: {title: 'VS Code', path: 'M8 5L2 12l6 7 M16 5l6 7-6 7 M14 3l-4 18'},
  JETBRAINS: {title: 'IntelliJ / JetBrains', path: 'M4 3h16v18H4z M4 8h16 M8 12v5 M12 11v7 M16 13v3'}
};

export function repositoryReportDefinition(report: RepositoryReport, generatedAt = new Date(),
  continuations: ReadonlyMap<number, string> = new Map(), sectionBreaks: ReadonlySet<string> = new Set()): TDocumentDefinitions {
  const titleSize = report.name.length > 100 ? 22 : report.name.length > 50 ? 26 : 31;
  const content: Content[] = [
    {stack: [
      {columns: [{width: 326, stack: [
        {columns: [
          {svg: brandMark(), width: 21},
          {text: 'AGENT SCANNER', fontSize: 9, bold: true, characterSpacing: 0.7, color: forest, margin: [9, 5, 0, 0]}
        ], margin: [0, 0, 0, 31]},
        {text: 'RAPORT KONFIGURACJI AI', style: 'eyebrow', color: green},
        {text: wrap(report.name), id: 'repository', outline: true, fontSize: titleSize, bold: true, color: forest, lineHeight: 1.04, margin: [0, 10, 0, 12]},
        {text: 'Mechanizmy i ustawienia zadeklarowane w repozytorium', fontSize: 10.5, color: muted, lineHeight: 1.3},
        {text: 'Wygenerowano: ' + generatedAt.toLocaleString('pl-PL'), fontSize: 8, color: muted, margin: [0, 17, 0, 0]}
      ]}, {text: '', width: '*'}], margin: [0, 0, 0, 27]},
      {unbreakable: true, columns: [{width: 326, stack: [
        meta('ORIGIN', report.git?.origin ?? 'Brak danych'),
        meta('COMMIT', report.git?.commit ?? 'Brak danych'),
        meta('BRANCH', report.git?.branch ?? 'Brak danych')
      ]}, {text: '', width: '*'}]},
      {unbreakable: true, stack: [
        {canvas: [{type: 'rect', x: 0, y: 0, w: 32, h: 3, color: green}], margin: [0, 25, 0, 12]},
        {text: 'Przegląd kategorii', fontSize: 21, bold: true, color: forest, margin: [0, 0, 0, 5]},
        {text: 'Wybierz kategorię, aby przejść do deklaracji i plików źródłowych.', style: 'note', margin: [0, 0, 0, 15]},
        ...categoryIndex(report.groups)
      ]},
      ...(report.groups.some(group => group.entries.some(entry => repositoryFileLink(report.git, entry.path))) ? [{
        text: 'Odnośniki prowadzą do wersji w repozytorium. Lokalne zmiany i nieopublikowane pliki mogą być tam niedostępne.',
        style: 'note', margin: [0, 8, 0, 0]
      } as Content] : []),
      ...(report.unreadableCount ? [{text: 'Nie odczytano treści ' + report.unreadableCount + ' plików. Szczegóły pominięć są wskazane przy plikach.', style: 'warning'} as Content] : [])
    ], margin: [0, -30, 0, 0]}
  ];
  let sectionNumber = 0;
  const shownSources = new Set<string>();
  const previews = new Map<ReportEntry, Content[]>();
  for (const group of report.groups) for (const entry of group.entries) {
    // MCP can expose several declarations from one file. Show the source only once.
    if (!shownSources.has(entry.path)) {
      const excerpt = repositoryFilePreview(entry);
      previews.set(entry, previewContent(entry, excerpt, repositoryFileLink(report.git, entry.path)));
      shownSources.add(entry.path);
    }
  }
  const body = (entry: ReportEntry): Content[] => [...entryBody(entry), ...(previews.get(entry) ?? [])];
  const completeEntry = (entry: ReportEntry): Content[] => [...entryHeader(entry), ...body(entry)];
  for (const group of report.groups) {
    if (!group.entries.length) continue;
    const firstGroup = sectionNumber === 0;
    const heading = sectionHeading(group, ++sectionNumber, firstGroup);
    const section: Content[] = [];
    const addSection = (): void => {
      const sectionNode: ContentStack & {id: string} = {id: 'section-' + group.id, stack: section};
      content.push({pageBreak: firstGroup || sectionBreaks.has(group.id) ? 'before' : undefined, stack: [sectionNode]});
    };
    const first = group.entries[0];
    const keepFirstEntry = compactEntry(first);
    const keepFirstHeader = keepFirstEntry || shortHeader(first);
    section.push({unbreakable: true, stack: [
      heading,
      ...(keepFirstEntry ? completeEntry(first) : keepFirstHeader ? entryHeader(first) : [])
    ]});
    for (const [entryIndex, entry] of group.entries.entries()) {
      if (!entryIndex && keepFirstEntry) continue;
      if (entryIndex && compactEntry(entry)) { section.push({unbreakable: true, stack: completeEntry(entry)}); continue; }
      if (entryIndex || !keepFirstHeader) section.push({unbreakable: shortHeader(entry), stack: entryHeader(entry)});
      section.push(...body(entry));
    }
    addSection();
  }
  return {
    pageSize: 'A4', pageMargins: [inset, 72, inset, 60],
    info: {title: 'Raport konfiguracji AI · ' + report.name, author: 'Agent Scanner', subject: 'Lokalna inwentaryzacja konfiguracji repozytorium'},
    defaultStyle: {font: 'Roboto', fontSize: 9.5, color: ink, lineHeight: 1.15},
    styles: {
      eyebrow: {fontSize: 8, bold: true, characterSpacing: 1.5, color: muted},
      entry: {fontSize: 13, bold: true, color: forest},
      path: {fontSize: 8, color: muted},
      note: {fontSize: 8.5, color: muted, margin: [0, 3, 0, 3]},
      warning: {fontSize: 8.5, color: '#86551f', margin: [0, 6, 0, 3]}
    },
    background: page => ({svg: pageArtwork(page === 1), width: pageWidth, height: pageHeight}),
    header: page => page === 1 ? {text: ''} : {stack: [
      {text: [{text: 'RAPORT REPOZYTORIUM', fontSize: 7, characterSpacing: 1}, {text: ' · ' + wrap(report.name)}],
        alignment: 'right', fontSize: 8, color: muted, margin: [inset, 29, inset, 0]},
      ...(continuations.has(page) ? [{text: continuations.get(page) + ' · ciąg dalszy',
        absolutePosition: {x: inset + 56, y: 55}, fontSize: 8, color: muted} as Content] : [])
    ]},
    footer: (page, count) => ({text: String(page).padStart(2, '0') + ' / ' + String(count).padStart(2, '0'),
      alignment: 'right', fontSize: 8, color: muted, margin: [inset, 28, inset, 0]}),
    content
  };
}

/** Use measured page positions, never estimated character counts, for section breaks and continuation labels. */
export async function paginatedRepositoryReportDefinition(report: RepositoryReport,
  measure: (definition: TDocumentDefinitions) => Promise<unknown>, generatedAt = new Date()): Promise<TDocumentDefinitions> {
  const sectionBreaks = new Set<string>();
  const inspect = async (): Promise<Map<string, Node>> => {
    const nodes = new Map<string, Node>();
    const definition = repositoryReportDefinition(report, generatedAt, new Map(), sectionBreaks);
    definition.pageBreakBefore = node => {
      if (node.id?.startsWith('section-') || node.id?.startsWith('group-')) nodes.set(node.id, node);
      return false;
    };
    await measure(definition);
    return nodes;
  };
  let nodes = await inspect();
  for (;;) {
    const previousCount = sectionBreaks.size;
    for (const group of report.groups) {
      const heading = nodes.get('group-' + group.id), section = nodes.get('section-' + group.id);
      if (heading && section && heading.startPosition.top > pageHeight * 0.58
        && section.pageNumbers.some(page => page > heading.startPosition.pageNumber)) sectionBreaks.add(group.id);
    }
    if (sectionBreaks.size === previousCount) break;
    nodes = await inspect(); // At most one added break per category; no body text is forced to be unbreakable.
  }
  const continuations = new Map<number, string>();
  for (const group of report.groups) {
    const heading = nodes.get('group-' + group.id), section = nodes.get('section-' + group.id);
    if (!heading || !section) continue;
    // Stack positions may include the previous page before an unbreakable child moves.
    for (const page of section.pageNumbers.filter(page => page > heading.startPosition.pageNumber)) {
      if (!continuations.has(page)) continuations.set(page, categoryVisual(group).title);
    }
  }
  return repositoryReportDefinition(report, generatedAt, continuations, sectionBreaks);
}

function pageArtwork(cover: boolean): string {
  const art = cover
    ? `<path d="M392 0H596V297L507 245 423 107Z" fill="${forest}"/>
       <path d="M392 0h95l-58 80-63-35Z" fill="${mint}"/>
       <path d="M487 0h109v156l-150-52Z" fill="${green}"/>
       <path d="M596 0v245l-86-71Z" fill="#337d58"/>
       <path d="M596 245v82l-69-41Z" fill="${lime}"/>
       <g fill="none" stroke="#d7e9d8" stroke-width="1.2" opacity="0.6">
         <path d="M472 136l35-20 35 20v40l-35 20-35-20Z M507 116v40m-35-20 35 20 35-20m-35 20v40"/>
         <path d="M507 116V93m35 43 19-11m-19 51 19 11m-54 9v23m-35-43-19 11"/>
         <circle cx="507" cy="90" r="3"/><circle cx="564" cy="123" r="3"/>
         <circle cx="564" cy="189" r="3"/><circle cx="507" cy="222" r="3"/><circle cx="450" cy="189" r="3"/>
       </g>`
    : `<path d="M0 0h18v80L0 109Z" fill="${forest}"/><path d="M18 0h7v51l-7 12Z" fill="${lime}"/>
       <path d="M596 727v115H526Z" fill="${mint}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${pageWidth}" height="${pageHeight}" viewBox="0 0 ${pageWidth} ${pageHeight}">${art}</svg>`;
}
function brandMark(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M6 0h12l6 12-6 12H6L0 12Z" fill="${forest}"/><path d="M7 16v-4m5 4V6m5 10V9" fill="none" stroke="${lime}" stroke-width="2.2" stroke-linecap="round"/></svg>`;
}
function categoryVisual(group: ReportGroup): CategoryVisual { return visuals[group.id] ?? visuals['CONTEXT']; }
function categoryIcon(visual: CategoryVisual): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><path d="M10 2h20l9 18-9 18H10L1 20Z" fill="${mint}"/><path d="${visual.path}" transform="translate(8 8)" fill="none" stroke="${green}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function categoryIndex(groups: ReportGroup[]): Content[] {
  const result: Content[] = [];
  for (let index = 0; index < groups.length; index += 2) {
    result.push({table: {widths: ['*', 24, '*'], body: [[
      categoryItem(groups[index]), {text: ''}, groups[index + 1] ? categoryItem(groups[index + 1]) : {text: ''}
    ]]}, layout: noLines, margin: [0, 0, 0, 8]});
  }
  return result;
}
function categoryItem(group: ReportGroup): TableCell {
  const visual = categoryVisual(group), width = (contentWidth - 24) / 2, height = 55;
  const summary = group.entries.length ? group.summary : group.complete ? 'Nie znaleziono' : 'Nie ustalono';
  // One invisible link rectangle covers the complete index entry, including its whitespace.
  return {stack: [
    {svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white" fill-opacity="0"/></svg>`,
      width, height, linkToDestination: group.entries.length ? 'group-' + group.id : undefined},
    {relativePosition: {x: 0, y: -height}, table: {widths: [42, width - 42], heights: height, body: [[
      {svg: categoryIcon(visual), width: 34, verticalAlignment: 'middle'},
      {verticalAlignment: 'middle', margin: [9, 0, 2, 0], stack: [
        {text: visual.title, bold: true, fontSize: 11.5, color: forest},
        {text: summary, fontSize: 9, color: muted, margin: [0, 4, 0, 0]}
      ]}
    ]]}, layout: noLines}
  ]};
}
function sectionHeading(group: ReportGroup, number: number, first: boolean): Content {
  return {columns: [
    {text: String(number).padStart(2, '0'), width: 56, fontSize: 31, color: green, lineHeight: 1},
    {stack: [
      {text: categoryVisual(group).title, id: 'group-' + group.id, outline: true, fontSize: 23, bold: true, color: forest},
      {text: group.summary, fontSize: 9, color: muted, margin: [0, 5, 0, 0]},
      {canvas: [{type: 'rect', x: 0, y: 0, w: 25, h: 3, color: lime}], margin: [0, 12, 0, 0]}
    ]}
  ], margin: [0, first ? 0 : 14, 0, 5]};
}
function meta(label: string, value: string): Content {
  return {columns: [{text: label, width: 65, fontSize: 7.5, bold: true, color: muted, characterSpacing: 0.8},
    {text: wrap(value), fontSize: 9, color: ink}], margin: [0, 0, 0, 8]};
}
function shortHeader(entry: ReportEntry): boolean { return entry.name.length + entry.path.length <= 800; }
function entryText(entry: ReportEntry): string {
  return [entry.name, entry.path, entry.description, ...entry.notes, ...visibleDetails(entry).flatMap(detail => [detail.label, detail.value])].filter(Boolean).join('\n');
}
function visibleDetails(entry: ReportEntry): ReportEntry['details'] {
  return entry.details.filter(detail => !entry.readable || !['Deklaracja XML', 'Wzorce ograniczeń'].includes(detail.label)
    || detail.value.trim() !== entry.content.trim());
}
function compactEntry(entry: ReportEntry): boolean {
  const text = entryText(entry);
  return entry.name.length + entry.path.length <= 200 && entry.details.length <= 6 && text.length <= 650 && text.split('\n').length <= 16;
}
function entryHeader(entry: ReportEntry): Content[] {
  return [{text: wrap(entry.name), style: 'entry', margin: [56, 10, 0, 4]},
    {text: wrap(entry.path), style: 'path', margin: [56, 0, 0, 5]},
    ...(!entry.readable || entry.redacted ? [{text: !entry.readable ? 'Treść nieodczytana' : 'Zamaskowane wartości', style: 'note', margin: [56, 0, 0, 5]} as Content] : [])];
}
function entryBody(entry: ReportEntry): Content[] {
  const content: Content[] = [];
  if (entry.description) content.push({text: wrap(entry.description), margin: [56, 0, 0, 8]});
  // These fields are the source itself, now presented below with an explicit excerpt limit.
  const details = visibleDetails(entry);
  for (let index = 0; index < details.length; index++) {
    const detail = details[index], next = details[index + 1];
    const compact = (item: {label: string; value: string}): boolean => item.label.length <= 36 && item.value.length <= 70 && !item.value.includes('\n');
    if (next && compact(detail) && compact(next)) {
      content.push({unbreakable: true, columns: [detailBlock(detail), detailBlock(next)], columnGap: 24, margin: [56, 0, 0, 8]});
      index++;
    } else content.push({stack: [detailBlock(detail)], margin: [56, 0, 0, 8]});
  }
  for (const text of entry.notes) content.push({text: wrap(text), style: 'note', margin: [56, 0, 0, 8]});
  return content;
}
function detailBlock(detail: {label: string; value: string}): Content {
  const text = detail.label + '\n' + detail.value;
  return {unbreakable: text.length < 600 && text.split('\n').length < 16, stack: [
    {text: wrap(detail.label), fontSize: 8, color: muted, margin: [0, 0, 0, 4]},
    {text: wrap(detail.value), fontSize: 9.5, color: ink}
  ]};
}

function previewContent(entry: ReportEntry, preview: FilePreview, link: string | null): Content[] {
  if (!entry.readable) return link ? [sourceLink(link)] : [];
  if (!preview.blocks.length && !preview.omittedMarkup) return [{unbreakable: true, stack: [
    {text: entry.content.trim() ? 'Brak treści poza metadanymi.' : 'Plik pusty.', style: 'note'},
    ...(link ? [sourceLink(link, false)] : [])
  ], margin: [56, 2, 0, 12]}];
  const blocks: Content[] = preview.blocks.map(block => ({
    text: block.spans.map(span => ({text: span.text, bold: span.bold || block.kind === 'heading',
      italics: span.italics, decoration: span.strike ? 'lineThrough' : undefined,
      font: span.code ? 'ReportMono' : 'Roboto', fontSize: span.code ? 8.5 : undefined})),
    fontSize: block.kind === 'heading' ? 10 : 9.5, color: ink, lineHeight: 1.18,
    preserveLeadingSpaces: block.kind === 'code', margin: [block.indent * 9, 0, 0, 4]
  }));
  if (!blocks.length) blocks.push({text: 'Brak tekstowego fragmentu do wyświetlenia.', style: 'note'});
  if (preview.omittedMarkup) blocks.push({text: 'Obrazy i HTML pominięto w podglądzie.', style: 'note'});
  return [{unbreakable: true, stack: [
    {table: {widths: ['*'], body: [[{fillColor: mint, stack: [
      {text: preview.truncated ? 'FRAGMENT TREŚCI · SKRÓCONO' : 'FRAGMENT TREŚCI', fontSize: 7, bold: true, characterSpacing: 0.7, color: muted, margin: [0, 0, 0, 7]},
      ...blocks
    ]}]]}, layout: {...noLines, paddingLeft: () => 12, paddingRight: () => 12, paddingTop: () => 11, paddingBottom: () => 7}},
    ...(link ? [sourceLink(link, false)] : [])
  ], margin: [56, 2, 0, 8]}];
}
function sourceLink(link: string, inset = true): Content {
  return {text: [{text: 'Szczegóły w repozytorium'}, {text: ' ↗', font: 'ReportMono'}], link, fontSize: 8.5, bold: true, color: green,
    margin: [inset ? 56 : 0, 7, 0, 3]};
}

export async function createRepositoryReportPdf(report: RepositoryReport): Promise<Blob> {
  const [{default: pdfMake}, {default: vfs}, {default: mono}] = await Promise.all([
    import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts'), import('./fonts/report-mono')]);
  pdfMake.addVirtualFileSystem(vfs);
  pdfMake.addVirtualFileSystem(mono);
  pdfMake.addFonts({Roboto: {normal: 'Roboto-Regular.ttf', bold: 'Roboto-Medium.ttf', italics: 'Roboto-Italic.ttf', bolditalics: 'Roboto-MediumItalic.ttf'}});
  pdfMake.addFonts({ReportMono: {normal: 'ReportMono.ttf', bold: 'ReportMono.ttf', italics: 'ReportMono.ttf', bolditalics: 'ReportMono.ttf'}});
  const definition = await paginatedRepositoryReportDefinition(report, draft => pdfMake.createPdf(draft).getBuffer());
  return pdfMake.createPdf(definition).getBlob();
}
