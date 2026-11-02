import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import MarkdownIt from 'markdown-it';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { createTheme } from '@mui/material/styles';
import {
    excerptCitation, excerptLinks, parseBlockAttrs, quotedPassage, reportBlocksPlugin, resolveCitations, segmentStreamingLines,
    splitFrontMatter,
} from '../../../../src/views/reportBlocks';
import {
    Callout, DEFAULT_REPORT_BLOCK_LABELS, Excerpt, reportBlockExtensions,
} from '../../../../src/views/reportBlockNodes';
import { mergeStyles, reportContentSx, reportDensityFor, reportTypefaceFor } from '../../../../src/views/reportThemes';
import { findQuoteRange, onSourceLocation, requestSourceLocation, takeSourceLocation } from '../../../../src/app/sourceLocation';

const REPORT = `# Brief

:::callout{kind="caveat" title="Evidence level"}
Abstract-only review.
:::

:::excerpt{source="files/papers/self-refine.pdf" page=4 title="Madaan et al. 2023" url="https://arxiv.org/abs/2303.17651"}
The model **critiques** its own output.
:::

:::finding
Nested:
:::excerpt{source="scratch/mcp/paper.md"}
Inner quote.
:::
:::
`;

describe('report block markdown', () => {
    const md = new MarkdownIt({ html: true }).use(reportBlocksPlugin).use(reportBlocksPlugin);

    it('renders excerpts and callouts (including aliases and nesting) as tagged HTML', () => {
        const html = md.render(REPORT);
        expect(html).toContain('<aside data-type="callout" data-kind="caveat" data-title="Evidence level"><div class="report-block-body">\n<p>Abstract-only review.</p>');
        expect(html).toContain('<figure data-type="excerpt" data-source="files/papers/self-refine.pdf" data-title="Madaan et al. 2023" data-page="4" data-url="https://arxiv.org/abs/2303.17651">');
        expect(html).toContain('<p>The model <strong>critiques</strong> its own output.</p>');
        expect(html).toMatch(/<aside data-type="callout" data-kind="finding"><div class="report-block-body">\n<p>Nested:<\/p>\n<figure data-type="excerpt" data-source="scratch\/mcp\/paper.md"><div class="report-block-body">\n<p>Inner quote.<\/p>\n<\/div><\/figure>\n<\/div><\/aside>/);
    });

    it('leaves unknown directives and attribute injection inert', () => {
        expect(md.render(':::mystery\ntext\n:::')).toContain('<p>:::mystery\ntext\n:::</p>');
        const html = md.render(':::excerpt{source="a\\"><script>x</script>"}\nq\n:::');
        expect(html).not.toContain('<script>');
    });

    it('links only explicit web addresses', () => {
        const linked = new MarkdownIt({ linkify: true }).use(reportBlocksPlugin);
        const html = linked.render('cs.AI and cs.CL papers, see model.py or https://arxiv.org/abs/1');
        expect(html).not.toContain('href="http://cs.AI"');
        expect(html).not.toContain('model.py</a>');
        expect(html).toContain('<a href="https://arxiv.org/abs/1">');
    });

    it('parses attribute quoting styles', () => {
        expect(parseBlockAttrs(`source="a b" page=4 Title='x'`)).toEqual({ source: 'a b', page: '4', title: 'x' });
    });
});

describe('excerpt citation and target', () => {
    it('labels with the title or the file name, and locates by page and section', () => {
        expect(excerptCitation({ source: 'files/papers/x.pdf', page: '4', section: '§3' })).toEqual({ label: 'x.pdf', locator: 'p. 4, §3' });
        expect(excerptCitation({ source: 'https://arxiv.org/abs/1/', title: 'Paper' }).label).toBe('Paper');
    });

    it('opens session files in the app and only http(s) links on the web', () => {
        expect(excerptLinks({ source: 'files/papers/x.pdf' })).toEqual({ fileName: 'papers/x.pdf', href: undefined });
        expect(excerptLinks({ source: 'scratch/mcp/x.md' })).toEqual({ fileName: 'scratch/mcp/x.md', href: undefined });
        expect(excerptLinks({ source: 'files/x.pdf', url: 'https://a.b/c' })).toEqual({ fileName: 'x.pdf', href: 'https://a.b/c' });
        expect(excerptLinks({ source: 'https://a.b/c' })).toEqual({ fileName: undefined, href: 'https://a.b/c' });
        expect(excerptLinks({ source: 'javascript:alert(1)' })).toEqual({ fileName: undefined, href: undefined });
    });
});

describe('segmentStreamingLines', () => {
    it('groups lines into blocks, keeps an unclosed block open, and hides partial directives', () => {
        const segments = segmentStreamingLines(['Intro', ':::excerpt{source="files/a.md"}', 'Quoted', ':::', ':::callout{kind=caveat}', 'Still writ', ':::excer']);
        expect(segments).toEqual([
            { type: 'lines', lines: ['Intro'] },
            { type: 'block', block: 'excerpt', attrs: { source: 'files/a.md' }, closed: true, children: [{ type: 'lines', lines: ['Quoted'] }] },
            { type: 'block', block: 'callout', attrs: { kind: 'caveat' }, closed: false, children: [{ type: 'lines', lines: ['Still writ'] }] },
        ]);
    });
});

describe('report block Tiptap nodes', () => {
    const makeEditor = (content: string) => new Editor({
        element: document.createElement('div'),
        extensions: [StarterKit, Excerpt, Callout, Markdown.configure({ html: true })],
        content,
    });

    it('parses the Markdown, renders citations, and survives an HTML round trip', () => {
        const editor = makeEditor(REPORT);
        const html = editor.getHTML();
        // The source opens in the app near its page; the paper's web page is a secondary link.
        expect(html).toContain('<figcaption contenteditable="false"><a class="report-excerpt-source" href="#" data-open-file="papers/self-refine.pdf" data-page="4">Madaan et al. 2023</a>'
            + '<span class="report-excerpt-locator">p. 4</span>'
            + '<a class="report-excerpt-web" href="https://arxiv.org/abs/2303.17651" target="_blank" rel="noopener noreferrer" title="Open the web page" aria-label="Open the web page">↗</a></figcaption>');
        expect(html).toContain('<div class="report-callout-title" contenteditable="false">Evidence level</div>');
        expect(html).toContain('data-open-file="scratch/mcp/paper.md"');

        const reloaded = makeEditor(html);
        expect(reloaded.getHTML()).toBe(html);
        expect(reloaded.getJSON().content?.map(node => node.type)).toEqual(['heading', 'callout', 'excerpt', 'callout']);

        const markdown = (reloaded.storage as any).markdown.getMarkdown();
        expect(markdown).toContain(':::excerpt{source="files/papers/self-refine.pdf" title="Madaan et al. 2023" page="4" url="https://arxiv.org/abs/2303.17651"}\nThe model **critiques** its own output.\n:::');
        expect(makeEditor(markdown).getHTML()).toBe(html);
        editor.destroy();
        reloaded.destroy();
    });

});

describe('front matter', () => {
    it('reads the genre (with aliases) and strips the block', () => {
        expect(splitFrontMatter('---\nstyle: research\n---\n# Title\n')).toEqual({ style: 'research', body: '# Title\n' });
        expect(splitFrontMatter('---\ngenre: "one-pager"\n---\nBody')).toEqual({ style: 'brief', body: 'Body' });
        expect(splitFrontMatter('---\nstyle: unknown\n---\nBody')).toEqual({ style: undefined, body: 'Body' });
        // Earlier genres still read: a business memo is an analysis, a story is notes.
        expect(splitFrontMatter('---\nstyle: business\n---\nB').style).toBe('analysis');
        expect(splitFrontMatter('---\nstyle: web\n---\nB').style).toBe('search');
        expect(splitFrontMatter('---\nstyle: story\n---\nB').style).toBe('notes');
    });

    it('withholds front matter still streaming, and leaves ordinary documents alone', () => {
        expect(splitFrontMatter('---\nsty')).toEqual({ body: '' });
        expect(splitFrontMatter('# Title\n\n---\n\nmore')).toEqual({ body: '# Title\n\n---\n\nmore' });
        expect(splitFrontMatter('---\n\nJust a rule then text\n\n---\n')).toEqual({ body: '---\n\nJust a rule then text\n\n---\n' });
    });
});

describe('resolveCitations', () => {
    it('numbers defined references by first use and lists them as references', () => {
        const out = resolveCitations([
            'Refinement helps[^b][^a]. Again[^b]. Unsourced[^x].',
            '',
            '[^a]: Alpha et al. (2024)',
            '[^b]: Beta, "Self-Refine" (2023),',
            '    https://arxiv.org/abs/2303.17651',
            '[^c]: Unused source',
        ].join('\n'));
        const cite = (n: number) => `<sup class="report-cite" data-cite="${n}">${n}</sup>`;
        expect(out).toBe(`Refinement helps${cite(1)}${cite(2)}. Again${cite(1)}. Unsourced<sup class="report-cite report-cite-missing">?</sup>.`
            + '\n\n:::references\n1. Beta, "Self-Refine" (2023), https://arxiv.org/abs/2303.17651\n2. Alpha et al. (2024)\n3. Unused source\n:::\n');
        expect(resolveCitations('No citations here.')).toBe('No citations here.');
    });

    it('finds the quoted line in a reference', () => {
        expect(quotedPassage('Madaan, [Self-Refine](files/a.md) (2023) — "Self-Refine improves all seven tasks"'))
            .toBe('Self-Refine improves all seven tasks');
        expect(quotedPassage('Alpha, “short” and “the longer quoted passage wins here”')).toBe('the longer quoted passage wins here');
        expect(quotedPassage('No quote (2024)')).toBeUndefined();
    });
});

describe('layout blocks in Tiptap', () => {
    const makeEditor = (content: string) => new Editor({
        element: document.createElement('div'),
        extensions: [StarterKit, ...reportBlockExtensions(DEFAULT_REPORT_BLOCK_LABELS), Markdown.configure({ html: true })],
        content,
    });

    it('round-trips summary, metrics, compare columns, references and citations', () => {
        const markdown = resolveCitations(`:::tldr
- Revenue grows.
:::

:::metrics
- **$7,200** Monthly revenue
- **35%** Contribution margin
:::

:::compare
:::column{title="Self-Refine"}
- Same model critiques.
:::
:::column{title="Reflexion"}
- Memory of failures.
:::
:::

A claim[^a].

[^a]: Alpha (2024)
`);
        const editor = makeEditor(markdown);
        const html = editor.getHTML();
        expect(editor.getJSON().content?.map(node => node.type)).toEqual(['callout', 'metrics', 'compare', 'paragraph', 'references']);
        expect(html).toContain('<aside data-type="callout" class="report-callout" data-kind="summary"><div class="report-callout-title" contenteditable="false">Summary</div>');
        expect(html).toContain('<div data-type="metrics" class="report-metrics"><ul class="tight" data-tight="true"><li><p><strong>$7,200</strong> Monthly revenue</p></li>');
        expect(html).toContain('<div data-type="column" class="report-column" data-title="Reflexion"><div class="report-column-title" contenteditable="false">Reflexion</div>');
        expect(html).toContain('A claim<sup class="report-cite" data-cite="1">1</sup>.');
        expect(html).toContain('<section data-type="references" class="report-references"><div class="report-references-title" contenteditable="false">References</div><div class="report-block-body"><ol class="tight" data-tight="true"><li><p>Alpha (2024)</p></li></ol>');
        expect(makeEditor(html).getHTML()).toBe(html);
        expect(makeEditor((makeEditor(html).storage as any).markdown.getMarkdown()).getHTML()).toBe(html);
    });

    it('shows details collapsed under their title, opens them on click, and keeps them in the document', () => {
        const editor = makeEditor(':::details{title="How this was computed"}\nGrouped by **region**.\n:::\n\nAfter.');
        const details = editor.view.dom.querySelector('.report-details')!;
        const toggle = details.querySelector('button.report-details-title') as HTMLButtonElement;
        expect(toggle.textContent).toBe('How this was computed');
        expect(details.classList.contains('is-open')).toBe(false);
        toggle.click();
        expect(details.classList.contains('is-open')).toBe(true);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        const html = editor.getHTML();
        expect(html).toContain('<div data-type="details" class="report-details" data-title="How this was computed"><div class="report-details-title" contenteditable="false">How this was computed</div><div class="report-block-body"><p>Grouped by <strong>region</strong>.</p></div></div>');
        expect(makeEditor(html).getHTML()).toBe(html);
        expect((editor.storage as any).markdown.getMarkdown()).toContain(':::details{title="How this was computed"}\nGrouped by **region**.\n:::');
    });
});

describe('reading settings', () => {
    it('default to a compact sans page', () => {
        expect(reportTypefaceFor(undefined)).toBe('sans');
        expect(reportTypefaceFor('serif')).toBe('serif');
        expect(reportTypefaceFor('academic')).toBe('serif');
        expect(reportTypefaceFor('corporate')).toBe('sans');
        expect(reportDensityFor(undefined)).toBe('compact');
        expect(reportDensityFor('comfortable')).toBe('comfortable');
    });

    it('layer typeface and density over one base', () => {
        const muiTheme = createTheme();
        const roomySerif = reportContentSx(muiTheme, { typeface: 'serif', density: 'comfortable' });
        const denseSerif = reportContentSx(muiTheme, { typeface: 'serif', density: 'compact' });
        const denseSans = reportContentSx(muiTheme, { typeface: 'sans', density: 'compact' });
        expect([roomySerif.fontSize, roomySerif.lineHeight]).toEqual(['1rem', 1.75]);
        expect([denseSerif.fontSize, denseSerif.lineHeight]).toEqual(['0.93rem', 1.58]);
        expect(denseSerif['& h1, & h2, & h3'].fontFamily).toContain('Source Serif');
        expect(denseSans.fontFamily).not.toContain('Serif');
        expect(denseSans['& li > p'].marginBottom).toBe('0.15em');
        expect(denseSans['& h2'].fontWeight).toBe(600);
    });

    it('override single properties without dropping the base rule', () => {
        expect(mergeStyles({ '& h1': { fontSize: 1, fontWeight: 700 }, color: 'a' }, { '& h1': { fontSize: 2 } }))
            .toEqual({ '& h1': { fontSize: 2, fontWeight: 700 }, color: 'a' });
    });
});


describe('opening a source near the quote', () => {
    it('hands a requested location to the file canvas once', () => {
        const seen: string[] = [];
        const stop = onSourceLocation(name => seen.push(name));
        requestSourceLocation('papers/x.pdf', { page: 4, text: 'quote' });
        stop();
        expect(seen).toEqual(['papers/x.pdf']);
        expect(takeSourceLocation('papers/x.pdf')).toEqual({ page: 4, text: 'quote' });
        expect(takeSourceLocation('papers/x.pdf')).toBeUndefined();
    });

    it('finds the quote across elements, ignoring Markdown, spacing and citation markers', () => {
        const root = document.createElement('div');
        root.innerHTML = '<h2>Method</h2><p>The model first <strong>generates</strong> an out-</p><p>put, then critiques it.</p>';
        const range = findQuoteRange(root, 'The model first **generates** an output[^a], then critiques it');
        expect(range?.toString()).toBe('The model first generates an out-put, then critiques it');
        // A quote that drifts from the source still lands on its opening words.
        root.insertAdjacentHTML('beforeend', '<p>Then it refines the draft.</p>');
        expect(findQuoteRange(root, 'The model first generates an output, then critiques it. Then it rewrites everything')?.toString())
            .toBe('The model first generates an out-put, then critiques it.The');
        expect(findQuoteRange(root, 'Something that is not in the text at all')).toBeNull();
        expect(findQuoteRange(root, 'short')).toBeNull();
    });
});

describe('source links in the report editor', () => {
    it('opens session files in a tab (excerpts near their page and words), leaving web links alone', async () => {
        const { render, fireEvent } = await import('@testing-library/react');
        const { TiptapReportEditor } = await import('../../../../src/views/TiptapReportEditor');
        const opened: [string, unknown][] = [];
        const content = ':::excerpt{source="files/papers/x.pdf" page=4 url="https://a.b/c"}\nThe exact words.\n:::\n\nSee [the notes](files/notes/plan.md) and https://example.com.';
        const { container } = render(<TiptapReportEditor content={content} editable={false}
            onOpenSource={(fileName, location) => opened.push([fileName, location])} />);
        const source = await new Promise<HTMLElement>(resolve => {
            const find = () => { const el = container.querySelector('a.report-excerpt-source') as HTMLElement | null; el ? resolve(el) : setTimeout(find, 10); };
            find();
        });
        fireEvent.click(source);
        fireEvent.click(container.querySelector('a[href="files/notes/plan.md"]')!);
        const web = container.querySelector('a[href="https://example.com"]') as HTMLElement;
        expect(web).not.toBeNull();
        expect(fireEvent.click(web)).toBe(true);
        expect(opened).toEqual([
            ['papers/x.pdf', { page: 4, text: 'The exact words.' }],
            ['notes/plan.md', { page: undefined, text: undefined }],
        ]);
    });
});

const scrollToIndex = vi.fn();
vi.mock('react-pdf', () => ({
    pdfjs: { GlobalWorkerOptions: {} },
    Document: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Page: () => <div />,
}));
vi.mock('react-pdf/dist/Page/AnnotationLayer.css', () => ({}));
vi.mock('react-pdf/dist/Page/TextLayer.css', () => ({}));
vi.mock('react-virtuoso', async () => {
    const React = await import('react');
    return {
        Virtuoso: React.forwardRef((_props: unknown, ref: React.Ref<unknown>) => {
            React.useImperativeHandle(ref, () => ({ scrollToIndex }));
            return <div />;
        }),
    };
});

describe('citations in the report editor', () => {
    it('preview their reference on hover and open its source at the quoted line on click', async () => {
        const { render, fireEvent, screen } = await import('@testing-library/react');
        const { TiptapReportEditor } = await import('../../../../src/views/TiptapReportEditor');
        const opened: [string, unknown][] = [];
        const content = resolveCitations('Refinement helps[^m].\n\n[^m]: Madaan, [Self-Refine](files/papers/sr.md) (2023) — "improves performance across all seven tasks"');
        const { container } = render(<TiptapReportEditor content={content} editable={false}
            onOpenSource={(fileName, location) => opened.push([fileName, location])} />);
        const cite = await new Promise<HTMLElement>(resolve => {
            const find = () => { const el = container.querySelector('sup.report-cite[data-cite="1"]') as HTMLElement | null; el ? resolve(el) : setTimeout(find, 10); };
            find();
        });
        fireEvent.mouseOver(cite);
        expect(await screen.findByText(/Madaan, Self-Refine \(2023\)/)).toBeTruthy();
        fireEvent.click(cite);
        expect(opened).toEqual([['papers/sr.md', { text: 'improves performance across all seven tasks' }]]);
    });
});

describe('PDF sources', () => {
    it('open at the cited page (clamped to the document)', async () => {
        vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
        vi.useFakeTimers();
        const { render } = await import('@testing-library/react');
        const { WorkspacePdfPreview } = await import('../../../../src/views/WorkspacePdfPreview');
        const props = { file: new Blob(), errorLabel: '', scale: 1, onPageCountChange: () => {}, onVisiblePageChange: () => {} };
        const { rerender } = render(<WorkspacePdfPreview {...props} pageCount={12} goTo={{ page: 5, nonce: 1 }} />);
        vi.advanceTimersByTime(100);
        expect(scrollToIndex).toHaveBeenLastCalledWith({ index: 4, align: 'start' });
        rerender(<WorkspacePdfPreview {...props} pageCount={12} goTo={{ page: 40, nonce: 2 }} />);
        vi.advanceTimersByTime(100);
        expect(scrollToIndex).toHaveBeenLastCalledWith({ index: 11, align: 'start' });
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });
});
