// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Report blocks: the structured pieces a report can hold besides prose and charts.
 *
 *   :::excerpt{source="files/paper.pdf" page=4 title="Madaan et al. 2023"}
 *   Verbatim text from the source.
 *   :::
 *
 *   :::callout{kind="caveat" title="Evidence level"}
 *   Abstract-only review; numbers are author-reported.
 *   :::
 *
 * The agent writes them as Markdown directives; a markdown-it rule turns them into
 * `<figure data-type="excerpt">` / `<aside data-type="callout">` HTML, which the Tiptap
 * nodes in `reportBlockNodes.ts` parse and render. The backend reads the same syntax in
 * `analyst/skills/report/excerpts.py` (it checks excerpts against their sources for the agent).
 */

import type MarkdownIt from 'markdown-it';

export type BlockAttrs = Record<string, string>;

export const CALLOUT_KINDS = ['summary', 'finding', 'caveat', 'definition', 'note'] as const;
export type CalloutKind = typeof CALLOUT_KINDS[number];

/** Directive names that are callouts of a fixed kind (`:::caveat` = `:::callout{kind=caveat}`). */
const CALLOUT_ALIASES: Record<string, CalloutKind> = {
    summary: 'summary', tldr: 'summary', takeaways: 'summary', 'key-takeaways': 'summary', abstract: 'summary',
    note: 'note', info: 'note', tip: 'note', aside: 'note',
    finding: 'finding', takeaway: 'finding', key: 'finding', insight: 'finding',
    caveat: 'caveat', warning: 'caveat', limitation: 'caveat', caution: 'caveat', risk: 'caveat',
    definition: 'definition', term: 'definition',
};

/** The block types and the directive names that make each (besides callout aliases). */
export type BlockType = 'excerpt' | 'callout' | 'metrics' | 'compare' | 'column' | 'details' | 'references';
const BLOCK_NAMES: Record<string, BlockType> = {
    excerpt: 'excerpt', quote: 'excerpt',
    metrics: 'metrics', kpis: 'metrics', stats: 'metrics',
    compare: 'compare', columns: 'compare', comparison: 'compare',
    column: 'column', card: 'column', col: 'column',
    details: 'details', more: 'details', collapse: 'details', appendix: 'details',
    references: 'references', sources: 'references', bibliography: 'references',
};

/** Each block's HTML wrapper: its tag, `data-type`, and which attributes it carries. A block with a
 *  body wrapper (`.report-block-body`) also shows non-editable chrome (caption, title) around it. */
export const BLOCK_HTML: Record<BlockType, { tag: string; attrs: readonly string[]; body: boolean }> = {
    excerpt: { tag: 'figure', attrs: ['source', 'title', 'page', 'section', 'url'], body: true },
    callout: { tag: 'aside', attrs: ['kind', 'title'], body: true },
    metrics: { tag: 'div', attrs: [], body: false },
    compare: { tag: 'div', attrs: [], body: false },
    column: { tag: 'div', attrs: ['title'], body: true },
    details: { tag: 'div', attrs: ['title'], body: true },
    references: { tag: 'section', attrs: [], body: true },
};

export const EXCERPT_ATTRS = BLOCK_HTML.excerpt.attrs;

const OPENER = /^(:{3,})\s*([A-Za-z][\w-]*)\s*(?:\{(.*)\})?\s*$/;
const CLOSER = /^(:{3,})\s*$/;
const ATTR = /([A-Za-z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'}]+))/g;

/** `source="a b" page=4 title='x'` → `{source: 'a b', page: '4', title: 'x'}`. */
export function parseBlockAttrs(text: string | undefined): BlockAttrs {
    const attrs: BlockAttrs = {};
    if (!text) return attrs;
    for (const match of text.matchAll(ATTR)) {
        attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
    }
    return attrs;
}

/** The inverse of `parseBlockAttrs`, for serializing a node back to Markdown. */
export function formatBlockAttrs(attrs: Record<string, unknown>): string {
    const parts = Object.entries(attrs)
        .filter(([, value]) => value !== null && value !== undefined && value !== '')
        .map(([key, value]) => `${key}="${String(value).replace(/"/g, "'")}"`);
    return parts.length ? `{${parts.join(' ')}}` : '';
}

/** What a directive name means: one of the block types (callout aliases set the kind), or nothing we know. */
export function resolveBlock(name: string, attrs: BlockAttrs): { type: BlockType; attrs: BlockAttrs } | null {
    const lower = name.toLowerCase();
    if (BLOCK_NAMES[lower]) return { type: BLOCK_NAMES[lower], attrs };
    if (lower === 'callout') {
        const kind = CALLOUT_ALIASES[(attrs.kind || '').toLowerCase()] ?? 'note';
        return { type: 'callout', attrs: { ...attrs, kind } };
    }
    const alias = CALLOUT_ALIASES[lower];
    return alias ? { type: 'callout', attrs: { ...attrs, kind: alias } } : null;
}

/** Only web links become clickable hrefs; session paths open in the app instead. */
export function safeHttpUrl(url: string | undefined | null): string | undefined {
    if (!url) return undefined;
    const trimmed = url.trim();
    return /^https?:\/\//i.test(trimmed) ? trimmed : undefined;
}

/** A session path's file in the app: `files/x` opens as workspace file `x`, `scratch/…` as itself. */
export function sessionFileName(path: string | undefined | null): string | undefined {
    const trimmed = (path || '').trim();
    if (trimmed.startsWith('files/')) return trimmed.slice('files/'.length) || undefined;
    if (trimmed.startsWith('scratch/')) return trimmed;
    return undefined;
}

/** Where an excerpt's source opens: its session file in a canvas tab, and/or a web page. */
export function excerptLinks(attrs: { source?: string | null; url?: string | null }): { fileName?: string; href?: string } {
    return {
        fileName: sessionFileName(attrs.source),
        href: safeHttpUrl(attrs.url) ?? safeHttpUrl(attrs.source),
    };
}

/** The citation shown under an excerpt: its title (or the source's file name), then where in it. */
export function excerptCitation(attrs: { source?: string | null; title?: string | null; page?: string | null; section?: string | null },
    pageLabel: (page: string) => string = page => `p. ${page}`): { label: string; locator: string } {
    const source = (attrs.source || '').trim();
    const fallback = source ? (safeHttpUrl(source) ? source.replace(/^https?:\/\//i, '').replace(/\/$/, '') : source.split('/').pop() || source) : '';
    const label = (attrs.title || '').trim() || fallback;
    const locator = [attrs.page ? pageLabel(String(attrs.page).trim()) : '', (attrs.section || '').trim()]
        .filter(Boolean).join(', ');
    return { label, locator };
}

// ── markdown-it rule ───────────────────────────────────────────────────────

const escapeAttr = (value: string) => value
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const dataAttrs = (attrs: BlockAttrs, keys: readonly string[]) => keys
    .filter(key => attrs[key])
    .map(key => ` data-${key}="${escapeAttr(attrs[key])}"`)
    .join('');

interface BlockState {
    src: string;
    bMarks: number[];
    eMarks: number[];
    tShift: number[];
    sCount: number[];
    blkIndent: number;
    lineMax: number;
    line: number;
    parentType: string;
    md: MarkdownIt;
    push: (type: string, tag: string, nesting: number) => { block: boolean; markup: string; info: string; map: [number, number] | null; meta: any };
}

function lineText(state: BlockState, line: number): string {
    return state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
}

function blockRule(state: BlockState, startLine: number, endLine: number, silent: boolean): boolean {
    if (state.sCount[startLine] - state.blkIndent >= 4) return false;
    const open = lineText(state, startLine).match(OPENER);
    if (!open) return false;
    const resolved = resolveBlock(open[2], parseBlockAttrs(open[3]));
    if (!resolved) return false;
    if (silent) return true;

    // Find the matching closer, counting nested openers so `:::` can close an inner block.
    let nextLine = startLine;
    let depth = 0;
    let closed = false;
    while (++nextLine < endLine) {
        if (state.sCount[nextLine] < state.blkIndent && lineText(state, nextLine).length > 0) break;
        if (state.sCount[nextLine] - state.blkIndent >= 4) continue;
        const text = lineText(state, nextLine);
        if (OPENER.test(text)) { depth++; continue; }
        if (CLOSER.test(text)) {
            if (depth === 0) { closed = true; break; }
            depth--;
        }
    }

    const oldParent = state.parentType;
    const oldLineMax = state.lineMax;
    state.parentType = 'report_block' as any;
    state.lineMax = nextLine;

    const html = BLOCK_HTML[resolved.type];
    const token = state.push('report_block_open', html.tag, 1);
    token.block = true;
    token.markup = open[1];
    token.info = resolved.type;
    token.meta = resolved.attrs;
    token.map = [startLine, nextLine];

    state.md.block.tokenize(state as any, startLine + 1, nextLine);

    const close = state.push('report_block_close', html.tag, -1);
    close.block = true;
    close.markup = open[1];
    close.info = resolved.type;

    state.parentType = oldParent;
    state.lineMax = oldLineMax;
    state.line = nextLine + (closed ? 1 : 0);
    return true;
}

/** markdown-it plugin: `:::excerpt{…}`, `:::callout{…}`, `:::metrics`, `:::compare` / `:::column`,
 *  `:::references` (and aliases) blocks. Safe to `use` twice. */
export function reportBlocksPlugin(md: MarkdownIt): void {
    const flagged = md as MarkdownIt & { __dfReportBlocks?: boolean };
    if (flagged.__dfReportBlocks) return;
    flagged.__dfReportBlocks = true;
    // Link only explicit web addresses: names like "cs.AI" or "model.py" are not links.
    md.linkify.set({ fuzzyLink: false, fuzzyEmail: false });

    md.block.ruler.before('fence', 'report_block', blockRule as any, {
        alt: ['paragraph', 'reference', 'blockquote', 'list'],
    });
    md.renderer.rules.report_block_open = (tokens, idx) => {
        const token = tokens[idx];
        const type = token.info as BlockType;
        const html = BLOCK_HTML[type];
        return `<${html.tag} data-type="${type}"${dataAttrs(token.meta as BlockAttrs, html.attrs)}>`
            + (html.body ? '<div class="report-block-body">' : '') + '\n';
    };
    md.renderer.rules.report_block_close = (tokens, idx) => {
        const html = BLOCK_HTML[tokens[idx].info as BlockType];
        return (html.body ? '</div>' : '') + `</${html.tag}>\n`;
    };
}

// ── Front matter and citations ─────────────────────────────────────────────

/** What a report is for, which shapes how it is written (see the report skill). */
export const REPORT_GENRES = ['notes', 'analysis', 'research', 'search', 'brief'] as const;
export type ReportGenre = typeof REPORT_GENRES[number];
const GENRE_ALIASES: Record<string, ReportGenre> = {
    notes: 'notes', note: 'notes', prose: 'notes', exploration: 'notes', story: 'notes', blog: 'notes', article: 'notes',
    analysis: 'analysis', data: 'analysis', logs: 'analysis', log: 'analysis', business: 'analysis', memo: 'analysis',
    financial: 'analysis', finance: 'analysis', pricing: 'analysis', prices: 'analysis',
    research: 'research', 'research-brief': 'research', literature: 'research', 'literature-review': 'research',
    academic: 'research', papers: 'research',
    search: 'search', web: 'search', 'web-research': 'search', survey: 'search', news: 'search', scan: 'search',
    brief: 'brief', 'one-pager': 'brief', onepager: 'brief', executive: 'brief', 'executive-summary': 'brief', summary: 'brief',
};

/**
 * A leading `---` front matter block (`style: research`), split off the report. While the
 * front matter is still streaming in (no closing `---` yet) the whole text is withheld.
 */
export function splitFrontMatter(text: string): { style?: ReportGenre; body: string } {
    const leading = text.match(/^\s*---[ \t]*\r?\n/);
    if (!leading) return { body: text };
    const rest = text.slice(leading[0].length);
    const end = rest.match(/^---[ \t]*(?:\r?\n|$)/m);
    if (!end || end.index === undefined) {
        // Not front matter after all if it has run long without closing (a document opening with a rule).
        return rest.length > 400 ? { body: text } : { body: '' };
    }
    const block = rest.slice(0, end.index);
    if (!/^\s*[A-Za-z][\w-]*\s*:/m.test(block) && block.trim()) return { body: text };
    const style = block.match(/^\s*(?:style|genre)\s*:\s*["']?([\w-]+)["']?\s*$/mi)?.[1]?.toLowerCase();
    return { style: style ? GENRE_ALIASES[style] : undefined, body: rest.slice(end.index + end[0].length) };
}

const CITE_REF = /\[\^([^\]\s]+)\](?!:)/g;
const CITE_DEF = /^\[\^([^\]\s]+)\]:[ \t]+(.*)$/;

/**
 * Footnote-style citations: `claim[^madaan]` with `[^madaan]: [Self-Refine](files/…) (2023) — "a quoted line"`.
 * Defined references are numbered in order of first use and become `<sup class="report-cite" data-cite="n">`
 * (the reader hovers to preview the source and clicks to open it); the definitions move, in that order,
 * into a `:::references` block at the end (unused ones last). A citation with no definition shows `?`.
 */
export function resolveCitations(markdown: string): string {
    if (!markdown.includes('[^')) return markdown;
    const definitions = new Map<string, string>();
    const body: string[] = [];
    let current: string | null = null;
    for (const line of markdown.split('\n')) {
        const definition = line.match(CITE_DEF);
        if (definition) {
            current = definition[1];
            definitions.set(current, definition[2].trim());
        } else if (current && /^( {2,}|\t)\S/.test(line)) {
            definitions.set(current, `${definitions.get(current)} ${line.trim()}`);
        } else {
            current = null;
            body.push(line);
        }
    }
    const numbers = new Map<string, number>();
    const text = body.join('\n').replace(CITE_REF, (_match, key: string) => {
        if (!definitions.has(key)) return '<sup class="report-cite report-cite-missing">?</sup>';
        if (!numbers.has(key)) numbers.set(key, numbers.size + 1);
        const number = numbers.get(key);
        return `<sup class="report-cite" data-cite="${number}">${number}</sup>`;
    });
    if (!definitions.size) return text;
    for (const key of definitions.keys()) {
        if (!numbers.has(key)) numbers.set(key, numbers.size + 1);
    }
    const entries = [...numbers.entries()]
        .sort((a, b) => a[1] - b[1])
        .map(([key, number]) => `${number}. ${definitions.get(key)}`);
    return `${text.replace(/\s+$/, '')}\n\n:::references\n${entries.join('\n')}\n:::\n`;
}

/** The longest quoted passage in a reference ("…" or “…”): what to find when opening its source. */
export function quotedPassage(text: string): string | undefined {
    const quotes = [...text.matchAll(/[“"]([^”"]{12,})[”"]/g)].map(match => match[1].trim());
    return quotes.sort((a, b) => b.length - a.length)[0];
}

// ── Streaming view ─────────────────────────────────────────────────────────

export type StreamSegment =
    | { type: 'lines'; lines: string[] }
    | { type: 'block'; block: BlockType; attrs: BlockAttrs; children: StreamSegment[]; closed: boolean };

/**
 * Group streamed Markdown lines into plain runs and (possibly still open) blocks, so the
 * lightweight typewriter view can draw a block's box while it is being written.
 */
export function segmentStreamingLines(lines: string[]): StreamSegment[] {
    const root: StreamSegment[] = [];
    const stack: Extract<StreamSegment, { type: 'block' }>[] = [];
    const current = () => (stack.length ? stack[stack.length - 1].children : root);
    const pushLine = (line: string) => {
        const target = current();
        const last = target[target.length - 1];
        if (last?.type === 'lines') last.lines.push(line);
        else target.push({ type: 'lines', lines: [line] });
    };
    for (const line of lines) {
        const trimmed = line.trim();
        const open = trimmed.match(OPENER);
        const resolved = open ? resolveBlock(open[2], parseBlockAttrs(open[3])) : null;
        if (resolved) {
            const block: Extract<StreamSegment, { type: 'block' }> = {
                type: 'block', block: resolved.type, attrs: resolved.attrs, children: [], closed: false,
            };
            current().push(block);
            stack.push(block);
        } else if (stack.length && CLOSER.test(trimmed)) {
            stack.pop()!.closed = true;
        } else if (/^:{3,}/.test(trimmed)) {
            // Directive syntax still being typed (`:::excerpt{sou`) or a stray closer: not prose.
            continue;
        } else {
            pushLine(line);
        }
    }
    return root;
}
