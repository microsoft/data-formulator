// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tiptap nodes for report blocks (see `reportBlocks.ts` for the Markdown syntax).
 *
 * They render plain DOM (no React node view) so the report's PDF export and rich-text
 * copy carry them like any other element. An excerpt's citation names its source: a
 * session file opens in a canvas tab (`data-open-file`, near `data-page`), a web page
 * in a browser tab.
 */

import { Mark, Node, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import {
    CALLOUT_KINDS, CalloutKind, EXCERPT_ATTRS, excerptCitation, excerptLinks, formatBlockAttrs, reportBlocksPlugin,
} from './reportBlocks';

export interface ReportBlockLabels {
    page: (page: string) => string;
    callout: Record<CalloutKind, string>;
    references: string;
    details: string;
    openWebSource: string;
}

export const DEFAULT_REPORT_BLOCK_LABELS: ReportBlockLabels = {
    page: page => `p. ${page}`,
    callout: { summary: 'Summary', note: 'Note', finding: 'Key finding', caveat: 'Caveat', definition: 'Definition' },
    references: 'References',
    details: 'Details',
    openWebSource: 'Open the web page',
};

const dataAttr = (name: string, fallback: string | null = null) => ({
    default: fallback,
    parseHTML: (element: HTMLElement) => element.getAttribute(`data-${name}`) ?? fallback,
    renderHTML: (attributes: Record<string, any>) => attributes[name] ? { [`data-${name}`]: attributes[name] } : {},
});

/** The element holding a block's content; older HTML without the wrapper falls back to the block itself. */
const bodyOf = (element: HTMLElement) =>
    (element.querySelector(':scope > .report-block-body') as HTMLElement | null) ?? element;

const markdownParse = { setup(markdownit: any) { markdownit.use(reportBlocksPlugin); } };

function serializeBlock(name: string, keys: readonly string[]) {
    return (state: any, node: PMNode) => {
        const attrs = Object.fromEntries(keys.map(key => [key, node.attrs[key]]));
        state.write(`:::${name}${formatBlockAttrs(attrs)}\n`);
        state.renderContent(node);
        state.flushClose(1);
        state.write(':::');
        state.closeBlock(node);
    };
}

export const Excerpt = Node.create<{ labels: ReportBlockLabels }>({
    name: 'excerpt',
    group: 'block',
    content: 'block+',
    defining: true,

    addOptions() {
        return { labels: DEFAULT_REPORT_BLOCK_LABELS };
    },

    addAttributes() {
        return Object.fromEntries(EXCERPT_ATTRS.map(key => [key, dataAttr(key)]));
    },

    parseHTML() {
        return [{ tag: 'figure[data-type="excerpt"]', contentElement: bodyOf }];
    },

    renderHTML({ node, HTMLAttributes }) {
        const { label, locator } = excerptCitation(node.attrs, this.options.labels.page);
        const { fileName, href } = excerptLinks(node.attrs);
        const web = { href, target: '_blank', rel: 'noopener noreferrer' };
        const caption: any[] = ['figcaption', { contenteditable: 'false' }];
        if (label) {
            caption.push(fileName
                ? ['a', { class: 'report-excerpt-source', href: '#', 'data-open-file': fileName,
                    ...(node.attrs.page ? { 'data-page': node.attrs.page } : {}) }, label]
                : href ? ['a', { class: 'report-excerpt-source', ...web }, label]
                    : ['span', { class: 'report-excerpt-source' }, label]);
        }
        if (locator) caption.push(['span', { class: 'report-excerpt-locator' }, locator]);
        if (fileName && href) {
            caption.push(['a', { class: 'report-excerpt-web', ...web, title: this.options.labels.openWebSource,
                'aria-label': this.options.labels.openWebSource }, '↗']);
        }
        return ['figure', mergeAttributes({ 'data-type': 'excerpt', class: 'report-excerpt' }, HTMLAttributes),
            ['div', { class: 'report-block-body' }, 0], caption];
    },

    addStorage() {
        return { markdown: { serialize: serializeBlock('excerpt', EXCERPT_ATTRS), parse: markdownParse } };
    },
});

export const Callout = Node.create<{ labels: ReportBlockLabels }>({
    name: 'callout',
    group: 'block',
    content: 'block+',
    defining: true,

    addOptions() {
        return { labels: DEFAULT_REPORT_BLOCK_LABELS };
    },

    addAttributes() {
        return { kind: dataAttr('kind', 'note'), title: dataAttr('title') };
    },

    parseHTML() {
        return [{ tag: 'aside[data-type="callout"]', contentElement: bodyOf }];
    },

    renderHTML({ node, HTMLAttributes }) {
        const kind: CalloutKind = (CALLOUT_KINDS as readonly string[]).includes(node.attrs.kind) ? node.attrs.kind : 'note';
        const title = node.attrs.title || this.options.labels.callout[kind];
        return ['aside', mergeAttributes({ 'data-type': 'callout', class: 'report-callout' }, HTMLAttributes, { 'data-kind': kind }),
            ['div', { class: 'report-callout-title', contenteditable: 'false' }, title],
            ['div', { class: 'report-block-body' }, 0]];
    },

    addStorage() {
        return { markdown: { serialize: serializeBlock('callout', ['kind', 'title']), parse: markdownParse } };
    },
});

/** Key numbers: a bullet list (`- **$7.2k** Monthly revenue — at full enrollment`) drawn as cards. */
export const Metrics = Node.create({
    name: 'metrics',
    group: 'block',
    content: 'block+',
    defining: true,
    parseHTML() {
        return [{ tag: 'div[data-type="metrics"]' }];
    },
    renderHTML({ HTMLAttributes }) {
        return ['div', mergeAttributes({ 'data-type': 'metrics', class: 'report-metrics' }, HTMLAttributes), 0];
    },
    addStorage() {
        return { markdown: { serialize: serializeBlock('metrics', []), parse: markdownParse } };
    },
});

/** Side-by-side columns (`:::compare` holding `:::column{title=…}` blocks). */
export const Compare = Node.create({
    name: 'compare',
    group: 'block',
    content: 'column+',
    defining: true,
    parseHTML() {
        return [{ tag: 'div[data-type="compare"]' }];
    },
    renderHTML({ HTMLAttributes }) {
        return ['div', mergeAttributes({ 'data-type': 'compare', class: 'report-compare' }, HTMLAttributes), 0];
    },
    addStorage() {
        return { markdown: { serialize: serializeBlock('compare', []), parse: markdownParse } };
    },
});

export const Column = Node.create({
    name: 'column',
    content: 'block+',
    defining: true,
    isolating: true,
    addAttributes() {
        return { title: dataAttr('title') };
    },
    parseHTML() {
        return [{ tag: 'div[data-type="column"]', contentElement: bodyOf }];
    },
    renderHTML({ node, HTMLAttributes }) {
        const spec: any[] = ['div', mergeAttributes({ 'data-type': 'column', class: 'report-column' }, HTMLAttributes)];
        if (node.attrs.title) spec.push(['div', { class: 'report-column-title', contenteditable: 'false' }, node.attrs.title]);
        spec.push(['div', { class: 'report-block-body' }, 0]);
        return spec as any;
    },
    addStorage() {
        return { markdown: { serialize: serializeBlock('column', ['title']), parse: markdownParse } };
    },
});

/**
 * Collapsible detail (`:::details{title=…}`): method, full data, raw logs — there when wanted,
 * out of the way otherwise. Closed when a report opens; the node view toggles it in the page
 * (an open/closed state is the reader's, not the document's). Exports open every one.
 */
export const Details = Node.create<{ labels: ReportBlockLabels }>({
    name: 'details',
    group: 'block',
    content: 'block+',
    defining: true,
    addOptions() {
        return { labels: DEFAULT_REPORT_BLOCK_LABELS };
    },
    addAttributes() {
        return { title: dataAttr('title') };
    },
    parseHTML() {
        return [{ tag: 'div[data-type="details"]', contentElement: bodyOf }];
    },
    renderHTML({ node, HTMLAttributes }) {
        return ['div', mergeAttributes({ 'data-type': 'details', class: 'report-details' }, HTMLAttributes),
            ['div', { class: 'report-details-title', contenteditable: 'false' }, node.attrs.title || this.options.labels.details],
            ['div', { class: 'report-block-body' }, 0]];
    },
    addNodeView() {
        const labels = this.options.labels;
        return ({ node }) => {
            const dom = document.createElement('div');
            dom.className = 'report-details';
            dom.setAttribute('data-type', 'details');
            if (node.attrs.title) dom.setAttribute('data-title', node.attrs.title);
            const header = document.createElement('button');
            header.type = 'button';
            header.className = 'report-details-title';
            header.contentEditable = 'false';
            header.setAttribute('aria-expanded', 'false');
            header.textContent = node.attrs.title || labels.details;
            header.addEventListener('mousedown', event => event.preventDefault());
            header.addEventListener('click', event => {
                event.preventDefault();
                const open = dom.classList.toggle('is-open');
                header.setAttribute('aria-expanded', String(open));
            });
            const body = document.createElement('div');
            body.className = 'report-block-body';
            dom.append(header, body);
            return {
                dom,
                contentDOM: body,
                // Only the content is the document's; the toggle and its title are the page's.
                ignoreMutation: mutation => mutation.type !== 'selection' && !body.contains(mutation.target),
                update: updated => {
                    if (updated.type.name !== 'details') return false;
                    header.textContent = updated.attrs.title || labels.details;
                    return true;
                },
            };
        };
    },
    addStorage() {
        return { markdown: { serialize: serializeBlock('details', ['title']), parse: markdownParse } };
    },
});

/** The numbered source list that footnote citations (`[^key]`) are collected into. */
export const References = Node.create<{ labels: ReportBlockLabels }>({
    name: 'references',
    group: 'block',
    content: 'block+',
    defining: true,
    addOptions() {
        return { labels: DEFAULT_REPORT_BLOCK_LABELS };
    },
    parseHTML() {
        return [{ tag: 'section[data-type="references"]', contentElement: bodyOf }];
    },
    renderHTML({ HTMLAttributes }) {
        return ['section', mergeAttributes({ 'data-type': 'references', class: 'report-references' }, HTMLAttributes),
            ['div', { class: 'report-references-title', contenteditable: 'false' }, this.options.labels.references],
            ['div', { class: 'report-block-body' }, 0]];
    },
    addStorage() {
        return { markdown: { serialize: serializeBlock('references', []), parse: markdownParse } };
    },
});

/** A citation number (`<sup class="report-cite" data-cite="2">2</sup>`): entry 2 of the references list. */
export const Cite = Mark.create({
    name: 'cite',
    excludes: '_',
    addAttributes() {
        return {
            cite: dataAttr('cite'),
            missing: {
                default: false,
                parseHTML: (element: HTMLElement) => element.classList.contains('report-cite-missing'),
                renderHTML: (attributes: Record<string, any>) => attributes.missing ? { class: 'report-cite-missing' } : {},
            },
        };
    },
    parseHTML() {
        return [{ tag: 'sup.report-cite' }];
    },
    renderHTML({ HTMLAttributes }) {
        return ['sup', mergeAttributes({ class: 'report-cite' }, HTMLAttributes), 0];
    },
});

/** All report block extensions, labelled in the user's language. */
export function reportBlockExtensions(labels: ReportBlockLabels) {
    return [
        Excerpt.configure({ labels }), Callout.configure({ labels }), Metrics, Compare, Column,
        Details.configure({ labels }), References.configure({ labels }), Cite,
    ];
}
