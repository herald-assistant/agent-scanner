import type {Content, ContentStack, CustomTableLayout, Node, TableCell, TDocumentDefinitions} from 'pdfmake/interfaces';
import {RepositoryReport, ReportEntry, ReportGroup} from './repository-report';
import {repositoryFileLink, repositoryFilePreview, type FilePreview} from './repository-report-preview';

// Print identity: forest greens with the application's lime accent. Color does not encode a score.
const forest = '#123c30', green = '#226347', lime = '#b8f36b', mint = '#edf5ee';
const ink = '#20382e', muted = '#596e63';
const pageWidth = 595.28, pageHeight = 841.89, inset = 42, contentWidth = pageWidth - inset * 2;
const bodyTop = 90;
interface Continuation { category: string; name?: string; path?: string; }
// Only running headers are abbreviated; source values use pdfmake's native hard wrapping.
const runningText = (text: string, limit: number): string => text.length > limit ? text.slice(0, limit - 1) + '…' : text;
type KeepWithNext = (id: string, heading: Content[], body: Content[]) => Content[];
const noLines: CustomTableLayout = {hLineWidth: () => 0, vLineWidth: () => 0,
  paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0};
interface CategoryVisual { title: string; path: string; }
const visuals: Record<string, CategoryVisual> = {
  INSTRUCTIONS: {title: 'Instrukcje', path: 'M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h6'},
  SKILLS: {title: 'Skills', path: 'M2 8l10-5 10 5-10 5z M6 11v6l6 3 6-3v-6 M22 8v8'},
  AGENTS: {title: 'Agenci', path: 'M5 7h14v13H5z M12 7V3 M9 3h6 M8 12h1 M15 12h1 M9 16h6 M2 11v5 M22 11v5'},
  MCP: {title: 'MCP', path: 'M9 9h6v6H9z M3 3h4v4H3z M17 3h4v4h-4z M3 17h4v4H3z M17 17h4v4h-4z M7 7l2 2 M15 9l2-2 M7 17l2-2 M15 15l2 2'},
  PROMPTS: {title: 'Prompty', path: 'M3 4h18v13H9l-6 4z M7 8h10 M7 12h7'},
  VSCODE: {title: 'VS Code', path: 'M8 5L2 12l6 7 M16 5l6 7-6 7 M14 3l-4 18'},
  JETBRAINS: {title: 'IntelliJ / JetBrains', path: 'M4 3h16v18H4z M4 8h16 M8 12v5 M12 11v7 M16 13v3'}
};

export function repositoryReportDefinition(report: RepositoryReport, generatedAt = new Date(),
  continuations: ReadonlyMap<number, Continuation> = new Map(), breaks: ReadonlySet<string> = new Set()): TDocumentDefinitions {
  const groups = report.groups.filter(group => group.id !== 'CONTEXT');
  const titleSize = report.name.length > 100 ? 22 : report.name.length > 50 ? 26 : 31;
  const content: Content[] = [
    {stack: [
      {columns: [{width: 326, stack: [
        {columns: [
          {svg: brandMark(), width: 21},
          {text: 'AGENT SCANNER', fontSize: 9, bold: true, characterSpacing: 0.7, color: forest, margin: [9, 5, 0, 0]}
        ], margin: [0, 0, 0, 31]},
        {text: 'RAPORT KONFIGURACJI AI', style: 'eyebrow', color: green},
        {text: report.name, id: 'repository', outline: true, fontSize: titleSize, bold: true, color: forest, lineHeight: 1.04, margin: [0, 10, 0, 12]},
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
        ...categoryIndex(groups)
      ]},
      ...(groups.some(group => group.entries.some(entry => repositoryFileLink(report.git, entry.path))) ? [{
        text: 'Odnośniki prowadzą do wersji w repozytorium. Lokalne zmiany i nieopublikowane pliki mogą być tam niedostępne.',
        style: 'note', margin: [0, 8, 0, 0]
      } as Content] : []),
      ...(report.unreadableCount ? [{text: 'Nie odczytano treści ' + report.unreadableCount + ' plików. Szczegóły pominięć są wskazane przy plikach.', style: 'warning'} as Content] : [])
    ], margin: [0, -30, 0, 0]}
  ];
  let sectionNumber = 0;
  const keep: KeepWithNext = (id, heading, body) => [
    {id: id + '-keep', stack: [{pageBreak: breaks.has(id + '-keep') ? 'before' : undefined, stack: heading}]},
    {id: id + '-next', stack: body}
  ];
  const shownSources = new Set<string>();
  const previews = new Map<ReportEntry, Content[]>();
  for (const group of groups) for (const entry of group.entries) {
    // MCP can expose several declarations from one file. Show the source only once.
    if (!shownSources.has(entry.path)) {
      const excerpt = repositoryFilePreview(entry);
      const id = 'preview-' + previews.size;
      previews.set(entry, previewContent(entry, excerpt, id, breaks.has(id), keep));
      shownSources.add(entry.path);
    }
  }
  const header = (entry: ReportEntry): Content[] => entryHeader(entry, repositoryFileLink(report.git, entry.path));
  for (const group of groups) {
    if (!group.entries.length) continue;
    const firstGroup = sectionNumber === 0;
    const heading = sectionHeading(group, ++sectionNumber, firstGroup);
    const entries: Content[] = group.entries.map((entry, index) => {
      const id = 'entry-' + group.id + '-' + index;
      const body = [...entryBody(entry, id, keep), ...(previews.get(entry) ?? []), ...linkedFilesContent(entry, report, id, keep)];
      return {id, stack: keep(id, header(entry), body)};
    });
    content.push({pageBreak: firstGroup ? 'before' : undefined,
      stack: keep('section-' + group.id, [heading], entries)});
  }
  return {
    pageSize: 'A4', pageMargins: [inset, bodyTop, inset, 60],
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
      {text: [{text: 'RAPORT REPOZYTORIUM', fontSize: 7, characterSpacing: 1}, {text: ' · ' + runningText(report.name, 50)}],
        alignment: 'right', fontSize: 8, color: muted, margin: [inset, 29, inset, 0]},
      ...(continuations.has(page) ? [{stack: [
        {text: runningText(continuations.get(page)!.category + (continuations.get(page)!.name ? ' · ' + continuations.get(page)!.name : ''), 95)
          + ' · ciąg dalszy', fontSize: 8},
        ...(continuations.get(page)!.path ? [{text: runningText('/' + continuations.get(page)!.path, 130), fontSize: 7, margin: [0, 3, 0, 0]} as Content] : [])
      ], margin: [inset + 56, 8, inset, 0], color: muted} as Content] : [])
    ]},
    footer: (page, count) => ({text: String(page).padStart(2, '0') + ' / ' + String(count).padStart(2, '0'),
      alignment: 'right', fontSize: 8, color: muted, margin: [inset, 28, inset, 0]}),
    content
  };
}

/** Measure ordinary flow nodes: unbreakable transactions report stale page positions in pdfmake. */
export async function paginatedRepositoryReportDefinition(report: RepositoryReport,
  measure: (definition: TDocumentDefinitions) => Promise<unknown>, generatedAt = new Date()): Promise<TDocumentDefinitions> {
  const groups = report.groups.filter(group => group.id !== 'CONTEXT');
  const breaks = new Set<string>();
  const inspect = async (): Promise<Map<string, Node>> => {
    const nodes = new Map<string, Node>();
    const definition = repositoryReportDefinition(report, generatedAt, new Map(), breaks);
    definition.pageBreakBefore = node => {
      if (node.id) nodes.set(node.id, node);
      return false;
    };
    await measure(definition);
    return nodes;
  };
  let nodes = await inspect();
  for (;;) {
    let changed = false;
    for (const [id, heading] of nodes) {
      const splitPreview = /^preview-\d+$/u.test(id) && heading.pageNumbers.length > 1;
      if (!splitPreview && !id.endsWith('-keep')) continue;
      const following = nodes.get(id.slice(0, -5) + '-next');
      if (heading.startPosition.top > bodyTop + 1 && !breaks.has(id)
        && (splitPreview || following && following.startPosition.pageNumber > heading.startPosition.pageNumber)) {
        if (following && !splitPreview) for (const existing of breaks) {
          const child = nodes.get(existing);
          // Transfer a break from the first body block to its preceding heading.
          if (child?.startPosition.pageNumber === following.startPosition.pageNumber
            && child.startPosition.top <= following.startPosition.top + 1) breaks.delete(existing);
        }
        breaks.add(id);
        changed = true;
        // Fix the first orphan, then remeasure before deciding about later content.
        // Batch decisions would leave obsolete breaks after a preceding heading moves.
        break;
      }
    }
    if (!changed) break;
    nodes = await inspect();
  }
  const continuations = new Map<number, Continuation>();
  for (const group of groups) {
    const heading = nodes.get('group-' + group.id), section = nodes.get('section-' + group.id + '-next');
    if (!heading || !section) continue;
    for (const page of section.pageNumbers.filter(page => page > heading.startPosition.pageNumber)) {
      if (continuations.has(page)) continue;
      const continuedEntry = group.entries.find((_, index) => {
        const entry = nodes.get('entry-' + group.id + '-' + index);
        return entry && entry.startPosition.pageNumber < page && entry.pageNumbers.includes(page);
      });
      continuations.set(page, {category: categoryVisual(group).title, name: continuedEntry?.name, path: continuedEntry?.path});
    }
  }
  return repositoryReportDefinition(report, generatedAt, continuations, breaks);
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
function categoryVisual(group: ReportGroup): CategoryVisual { return visuals[group.id] ?? {title: group.title, path: visuals['INSTRUCTIONS'].path}; }
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
    {text: value, width: 261, fontSize: 9, color: ink}], margin: [0, 0, 0, 8]};
}
function visibleDetails(entry: ReportEntry): ReportEntry['details'] {
  return entry.details.filter(detail => !entry.readable || !['Deklaracja XML', 'Wzorce ograniczeń'].includes(detail.label)
    || detail.value.trim() !== entry.content.trim());
}
function entryHeader(entry: ReportEntry, link: string | null): Content[] {
  return [{text: [{text: entry.name}, ...(link ? [{text: ' ↗', font: 'ReportMono', link, color: green}] : [])],
    style: 'entry', margin: [56, 10, 0, 4]},
    {text: '/' + entry.path, style: 'path', margin: [56, 0, 0, 5]},
    ...(!entry.readable || entry.redacted ? [{text: !entry.readable ? 'Treść nieodczytana' : 'Zamaskowane wartości', style: 'note', margin: [56, 0, 0, 5]} as Content] : [])];
}
function entryBody(entry: ReportEntry, id: string, keep: KeepWithNext): Content[] {
  const content: Content[] = [];
  if (entry.description) content.push({text: entry.description, margin: [56, 0, 0, 8]});
  // These fields are the source itself, now presented below with an explicit excerpt limit.
  const details = visibleDetails(entry);
  for (let index = 0; index < details.length; index++) {
    const detail = details[index], next = details[index + 1];
    const compact = (item: {label: string; value: string}): boolean => item.label.length <= 36 && item.value.length <= 70 && !item.value.includes('\n');
    if (next && compact(detail) && compact(next)) {
      content.push({columns: [detail, next].map((item, offset) => ({width: (contentWidth - 56 - 24) / 2,
        stack: [detailBlock(item, id + '-detail-' + (index + offset), keep)]})), columnGap: 24, margin: [56, 0, 0, 8]});
      index++;
    } else content.push({stack: [detailBlock(detail, id + '-detail-' + index, keep)], margin: [56, 0, 0, 8]});
  }
  for (const text of entry.notes) content.push({text, style: 'note', margin: [56, 0, 0, 8]});
  return content;
}
function detailBlock(detail: {label: string; value: string}, id: string, keep: KeepWithNext): Content {
  return {stack: keep(id,
    [{text: detail.label, fontSize: 8, color: muted, margin: [0, 0, 0, 4]}],
    [{text: detail.value, fontSize: 9.5, color: ink}])};
}

function previewContent(entry: ReportEntry, preview: FilePreview, id: string, pageBreak: boolean, keep: KeepWithNext): Content[] {
  if (!entry.readable) return [];
  if (!preview.blocks.length && !preview.omittedMarkup) return [{stack: [
    {text: entry.content.trim() ? 'Brak treści poza metadanymi.' : 'Plik pusty.', style: 'note'}
  ], margin: [56, 2, 0, 12]}];
  const blocks: Content[] = preview.blocks.map((block, index) => {
    const spans = block.spans.map(span => ({...span}));
    if (preview.truncated && index === preview.blocks.length - 1) {
      while (spans.length && !spans.at(-1)!.text.trim()) spans.pop();
      const last = spans.at(-1);
      if (last) last.text = last.text.trimEnd().replace(/[.\u2026]+$/u, '') + '...';
    }
    return {
      text: spans.map(span => ({text: span.text, bold: span.bold || block.kind === 'heading',
        italics: span.italics, decoration: span.strike ? 'lineThrough' : undefined,
        font: span.code ? 'ReportMono' : 'Roboto', fontSize: span.code ? 8.5 : undefined})),
      fontSize: block.kind === 'heading' ? 10 : 9.5, color: ink, lineHeight: 1.18,
      preserveLeadingSpaces: block.kind === 'code', margin: [block.indent * 9, 0, 0, 4]
    };
  });
  if (!blocks.length) blocks.push({text: 'Brak tekstowego fragmentu do wyświetlenia.', style: 'note'});
  if (preview.omittedMarkup) blocks.push({text: 'Obrazy i HTML pominięto w podglądzie.', style: 'note'});
  const source: ContentStack & {id: string} = {id, stack: [
    {pageBreak: pageBreak ? 'before' : undefined, table: {widths: [contentWidth - 56 - 24], body: [[{fillColor: mint, stack: keep(id,
      [{text: 'TREŚĆ', fontSize: 7, bold: true, characterSpacing: 0.7, color: muted, margin: [0, 0, 0, 7]}], blocks)
    }]]}, layout: {...noLines, paddingLeft: () => 12, paddingRight: () => 12, paddingTop: () => 11, paddingBottom: () => 7}},
  ], margin: [56, 2, 0, 8]};
  return [source];
}
function linkedFilesContent(entry: ReportEntry, report: RepositoryReport, id: string, keep: KeepWithNext): Content[] {
  if (!entry.linkedFiles.length) return [];
  const rows: Content[] = entry.linkedFiles.map(file => {
    const link = repositoryFileLink(report.git, file.path);
    const status = !file.source ? ' (treść poza migawką)' : !file.source.readable ? ' (treść nieodczytana)' : '';
    return {ul: [{text: [{text: '/' + file.path, link: link ?? undefined},
      ...(status ? [{text: status, italics: true}] : [])]}], margin: [0, 0, 0, 3]};
  });
  return [{stack: [
    ...keep(id + '-links',
      [{text: 'PODLINKOWANE PLIKI', fontSize: 7, bold: true, characterSpacing: 0.5, margin: [0, 0, 0, 4]}], [rows[0]]),
    ...rows.slice(1)
  ], fontSize: 8, color: muted, lineHeight: 1.1, margin: [56, 2, 0, 12]}];
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
