// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useEffect, useCallback, useMemo, useRef, useState as useStateReact } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditor, EditorContent, NodeViewWrapper, NodeViewProps, ReactNodeViewRenderer } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import { Markdown } from 'tiptap-markdown';
import { Box, IconButton, Tooltip, Divider, Typography, CircularProgress, Paper, Popper, useTheme } from '@mui/material';
import { alpha, Theme } from '@mui/material/styles';
import { WritingIndicator } from '../components/FunComponents';
import { getChartTemplate } from '../components/ChartTemplates';
import FormatBoldIcon from '@mui/icons-material/FormatBold';
import FormatItalicIcon from '@mui/icons-material/FormatItalic';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered';
import FormatQuoteIcon from '@mui/icons-material/FormatQuote';
import TitleIcon from '@mui/icons-material/Title';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { iconVar, textVar } from '../app/layout';
import { CalloutKind, StreamSegment, excerptCitation, quotedPassage, safeHttpUrl, segmentStreamingLines, sessionFileName } from './reportBlocks';
import { ReportBlockLabels, reportBlockExtensions } from './reportBlockNodes';
import type { SourceLocation } from '../app/sourceLocation';
import { ReportLook, reportContentSx } from './reportThemes';

/** Compact "1.2s" / "850ms" style duration for inspection steps. */
function formatStepDuration(ms: number): string {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

export interface TiptapReportEditorProps {
    content: string;           // HTML content (from processReport)
    streamingText?: string;    // raw markdown, shown via typewriter while writing-phase streams
    resolveChartImage?: (chartId: string) => { url: string; width: number; height: number } | undefined; // for streaming chart embeds
    editable?: boolean;        // edit mode on/off (formatting toolbar visible, content editable)
    isGenerating?: boolean;    // report is still streaming; suppress export actions, show status
    generatingPhase?: 'inspecting' | 'writing'; // which phase the agent is in while generating
    // accumulated inspect steps so the user sees what's happening; `charts`
    // carries chart-type + display name so we can show a type icon next to it
    inspectionSteps?: InspectStep[];
    reportId?: string;         // triggers re-focus when switching reports
    reportLook?: ReportLook;       // the reader's typeface and density
    // a link to a session file was clicked (an excerpt's source: near its page / quoted words)
    onOpenSource?: (fileName: string, location: SourceLocation) => void;
    onUpdate?: (html: string) => void;
}

/** Report block labels in the user's language. */
function useReportBlockLabels(): ReportBlockLabels {
    const { t } = useTranslation();
    return useMemo(() => ({
        page: (page: string) => t('report.blocks.page', { page }),
        callout: {
            summary: t('report.blocks.summary'),
            note: t('report.blocks.note'),
            finding: t('report.blocks.finding'),
            caveat: t('report.blocks.caveat'),
            definition: t('report.blocks.definition'),
        },
        references: t('report.blocks.references'),
        details: t('report.blocks.details'),
        openWebSource: t('report.blocks.openWebSource'),
    }), [t]);
}

// ── Generating-status UI ───────────────────────────────────────────────────
// While a report streams, the canvas shows (in order): a "thinking…" spinner
// before anything arrives → a list of inspection steps (each flips to a ✓ with
// a duration) → a trailing "thinking…" once all steps resolve → and finally a
// pencil "writing…" overlay glued to the bottom of the growing text.

export interface InspectStep {
    label: string;
    doneLabel?: string;   // past-tense label shown once the step completes
    done: boolean;
    charts?: { chartType: string; name: string }[];
    startedAt?: number;   // epoch ms when the tool call started
    durationMs?: number;  // wall time once the step is done
}

/** Small fixed-size slot holding either a spinner or a ✓, aligned to text.
 *  Text stays uniformly muted; the icon carries the one bit of state color —
 *  a soft spinner while running, a green check once done (matching the data
 *  load chat's convention). */
const StatusIcon: FC<{ done?: boolean }> = ({ done }) => (
    <Box sx={{ flexShrink: 0, mt: '2px', display: 'flex', alignItems: 'center' }}>
        {done
            ? <CheckCircleIcon sx={{ fontSize: iconVar.sm, color: 'success.main' }} />
            : <CircularProgress size={11} thickness={5} sx={{ color: 'text.secondary' }} />}
    </Box>
);

/** Spinner + gently pulsing label for "thinking…" / "still working" states. */
const ThinkingRow: FC<{ label: string }> = ({ label }) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, py: 0.25 }}>
        <StatusIcon />
        <Typography component="span" sx={{
            fontSize: textVar.sm, lineHeight: 1.4, color: 'text.secondary',
            animation: 'thinking-pulse 1.6s ease-in-out infinite',
            '@keyframes thinking-pulse': {
                '0%, 100%': { opacity: 0.6 },
                '50%': { opacity: 1 },
            },
        }}>
            {label}
        </Typography>
    </Box>
);

/** A single inspection step: status icon, label + duration, then chart chips. */
const InspectionStepRow: FC<{ step: InspectStep }> = ({ step }) => (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, py: 0.25 }}>
        <StatusIcon done={step.done} />
        <Box sx={{ display: 'flex', flexDirection: 'column', rowGap: 0.25, minWidth: 0 }}>
            {/* Label and elapsed time sit together on the first line. */}
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, flexWrap: 'wrap' }}>
                <Typography component="span" sx={{
                    fontSize: textVar.sm, lineHeight: 1.4, color: 'text.primary',
                    whiteSpace: 'normal', wordBreak: 'break-word',
                }}>
                    {step.done && step.doneLabel ? step.doneLabel : step.label}
                </Typography>
                {step.done && step.durationMs != null && (
                    <Typography component="span" sx={{
                        fontSize: textVar.xs, lineHeight: 1.4, color: 'text.disabled',
                        fontVariantNumeric: 'tabular-nums',
                    }}>
                        {formatStepDuration(step.durationMs)}
                    </Typography>
                )}
            </Box>
            {/* Each inspected chart gets its own line, even when there's only one. */}
            {step.charts?.map((c, j) => (
                <Box key={j} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, minWidth: 0 }}>
                    <Box sx={{
                        width: 14, height: 14, flexShrink: 0, opacity: 0.85,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        '& svg': { fontSize: textVar.lg },
                    }}>
                        {getChartTemplate(c.chartType)?.icon}
                    </Box>
                    <Typography component="span" sx={{
                        fontSize: textVar.sm, lineHeight: 1.4, color: 'text.secondary',
                        whiteSpace: 'normal', wordBreak: 'break-word',
                    }}>
                        {c.name}
                    </Typography>
                </Box>
            ))}
        </Box>
    </Box>
);

/**
 * The in-flow status shown before the report text starts streaming: a muted
 * title, then either a lone "thinking…" (nothing happening yet) or the
 * accumulated inspection steps followed by a trailing "thinking…" once they
 * all resolve.
 */
const InspectingStatus: FC<{ steps?: InspectStep[] }> = ({ steps }) => {
    const { t } = useTranslation();
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, px: '24px', pt: '40px', pb: '16px' }}>
            <Typography sx={{
                fontSize: textVar.xs, fontWeight: 600, letterSpacing: '0.05em',
                textTransform: 'uppercase', color: 'text.secondary', mb: 0.5,
            }}>
                {t('editor.workingTitle')}
            </Typography>
            {steps?.length
                ? steps.map((step, i) => <InspectionStepRow key={i} step={step} />)
                : null}
            {(!steps?.length || steps.every(s => s.done)) && (
                <ThinkingRow label={t('dataThread.thinking')} />
            )}
        </Box>
    );
};

/** Strip inline markdown emphasis markers for the lightweight streaming view. */
function stripInlineMarkers(line: string): string {
    return line
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/(^|[^*])\*([^*]+)\*/g, '$1$2')
        .replace(/`([^`]+)`/g, '$1');
}

/** Detect a chart-image line: ![caption](chart://id) or legacy [IMAGE(id)]. */
function matchChartImageLine(line: string): { chartId: string; caption?: string } | null {
    const md = line.match(/^!\[([^\]]*)\]\(chart:\/\/([^)]+)\)\s*$/);
    if (md) return { caption: md[1] || undefined, chartId: md[2] };
    const legacy = line.match(/^\[IMAGE\(([^)]+)\)\]\s*$/);
    if (legacy) return { chartId: legacy[1] };
    return null;
}

const DEFAULT_LOOK: ReportLook = { typeface: 'sans', density: 'compact' };

/** Space above a report's first line, in the editor and the streaming view alike. */
const REPORT_TOP_SPACE = '48px';

type ResolveChartImage = (chartId: string) => { url: string; width: number; height: number } | undefined;

/**
 * Lightweight, line-based render of the streamed markdown. Good enough to read
 * smoothly while text arrives; the real TipTap parse happens once on completion.
 * Report blocks are drawn as their boxes (open ones grow as they stream), with the
 * same class names as the editor's nodes so the report theme styles both alike.
 */
const StreamingMarkdownLite: FC<{ text: string; caret?: React.ReactNode; resolveChartImage?: ResolveChartImage }> = ({ text, caret, resolveChartImage }) => {
    const segments = useMemo(() => segmentStreamingLines(
        text.split('\n').filter(line => !/^\[\^[^\]\s]+\]:/.test(line)).map(line => line.replace(/\[\^[^\]\s]+\]/g, '')),
    ), [text]);
    return <StreamingSegments segments={segments} caret={caret} resolveChartImage={resolveChartImage} />;
};

const StreamingSegments: FC<{ segments: StreamSegment[]; caret?: React.ReactNode; resolveChartImage?: ResolveChartImage }> = ({ segments, caret, resolveChartImage }) => {
    const labels = useReportBlockLabels();
    return (
        <>
            {segments.map((segment, i) => {
                const tail = i === segments.length - 1 ? caret : null;
                if (segment.type === 'lines') {
                    return <StreamingLines key={i} lines={segment.lines} caret={tail} resolveChartImage={resolveChartImage} />;
                }
                const children = (
                    <StreamingSegments segments={segment.children} caret={segment.closed ? null : tail} resolveChartImage={resolveChartImage} />
                );
                const body = <div className="report-block-body">{children}</div>;
                let block: React.ReactNode;
                switch (segment.block) {
                    case 'excerpt': {
                        const { label, locator } = excerptCitation(segment.attrs, labels.page);
                        block = (
                            <figure className="report-excerpt">
                                {body}
                                {(label || locator) && (
                                    <figcaption>
                                        {label && <span className="report-excerpt-source">{label}</span>}
                                        {locator && <span className="report-excerpt-locator">{locator}</span>}
                                    </figcaption>
                                )}
                            </figure>
                        );
                        break;
                    }
                    case 'callout': {
                        const kind = segment.attrs.kind as CalloutKind;
                        block = (
                            <aside className="report-callout" data-kind={kind}>
                                <div className="report-callout-title">{segment.attrs.title || labels.callout[kind]}</div>
                                {body}
                            </aside>
                        );
                        break;
                    }
                    case 'metrics':
                        block = <div className="report-metrics">{children}</div>;
                        break;
                    case 'compare':
                        block = <div className="report-compare">{children}</div>;
                        break;
                    case 'column':
                        block = (
                            <div className="report-column">
                                {segment.attrs.title && <div className="report-column-title">{segment.attrs.title}</div>}
                                {body}
                            </div>
                        );
                        break;
                    case 'details':
                        block = (
                            <div className="report-details is-open">
                                <div className="report-details-title">{segment.attrs.title || labels.details}</div>
                                {body}
                            </div>
                        );
                        break;
                    case 'references':
                        block = (
                            <section className="report-references">
                                <div className="report-references-title">{labels.references}</div>
                                {body}
                            </section>
                        );
                        break;
                }
                return (
                    <React.Fragment key={i}>
                        {block}
                        {segment.closed ? tail : null}
                    </React.Fragment>
                );
            })}
        </>
    );
};

/** `**bold**` and `*italic*` as elements; other inline Markdown markers dropped. */
function renderInline(text: string): React.ReactNode[] {
    return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
        const bold = part.match(/^\*\*([^*]+)\*\*$/);
        return bold ? <strong key={i}>{bold[1]}</strong> : <React.Fragment key={i}>{stripInlineMarkers(part)}</React.Fragment>;
    });
}

const StreamingLines: FC<{ lines: string[]; caret?: React.ReactNode; resolveChartImage?: ResolveChartImage }> = ({ lines, caret, resolveChartImage }) => {
    const lastIdx = lines.length - 1;
    // Consecutive list items render as one list (so blocks like metrics can lay them out).
    const groups: { start: number; items: string[]; ordered?: boolean }[] = [];
    lines.forEach((line, i) => {
        const item = line.match(/^\s*(?:([-*])|(\d+)[.)])\s+(.*)$/);
        const last = groups[groups.length - 1];
        if (item && last?.items.length && last.start + last.items.length === i && last.ordered === !item[1]) {
            last.items.push(item[3]);
        } else if (item) {
            groups.push({ start: i, items: [item[3]], ordered: !item[1] });
        } else {
            groups.push({ start: i, items: [] });
        }
    });
    return (
        <>
            {groups.map(group => {
                const i = group.start;
                if (group.items.length) {
                    const end = group.start + group.items.length - 1;
                    const List = group.ordered ? 'ol' : 'ul';
                    return (
                        <List key={i}>
                            {group.items.map((item, j) => (
                                <li key={j}><p>{renderInline(item)}{group.start + j === lastIdx && end === lastIdx ? caret : null}</p></li>
                            ))}
                        </List>
                    );
                }
                const line = lines[i];
                const tail = i === lastIdx ? caret : null;
                const img = matchChartImageLine(line);
                if (img) {
                    const cached = resolveChartImage?.(img.chartId);
                    if (cached) {
                        return (
                            <Box key={i} component="div" sx={{ textAlign: 'center', my: '0.5em' }}>
                                <Box component="img" src={cached.url} alt={img.caption ?? ''}
                                    width={cached.width} height={cached.height}
                                    sx={{ maxWidth: '100%', height: 'auto', borderRadius: '4px' }} />
                                {tail}
                            </Box>
                        );
                    }
                    return (
                        <Box key={i} component="div" sx={{ textAlign: 'center', color: 'text.disabled', py: '16px' }}>
                            📊 {img.caption || img.chartId}{tail}
                        </Box>
                    );
                }
                const h = line.match(/^(#{1,3})\s+(.*)$/);
                if (h) {
                    const Heading = `h${h[1].length}` as 'h1' | 'h2' | 'h3';
                    return <Heading key={i} style={i === 0 ? { marginTop: 0 } : undefined}>{renderInline(h[2])}{tail}</Heading>;
                }
                if (line.trim() === '') {
                    return tail ? <React.Fragment key={i}>{tail}</React.Fragment> : null;
                }
                return <p key={i}>{renderInline(line)}{tail}</p>;
            })}
        </>
    );
};

const StreamingText: FC<{ text: string; reportLook: ReportLook; resolveChartImage?: ResolveChartImage }> = ({ text, reportLook, resolveChartImage }) => {
    const { t } = useTranslation();
    const theme = useTheme();

    return (
        <Box sx={{
            ...reportContentSx(theme, reportLook),
            px: '24px', pt: REPORT_TOP_SPACE, pb: '64px',
        }}>
            <StreamingMarkdownLite text={text} resolveChartImage={resolveChartImage} />
            <Box sx={{ mt: text.length === 0 ? 1 : 2 }}>
                <WritingIndicator label={t('editor.writingReport')} fontSize="0.85rem" />
            </Box>
        </Box>
    );
};

/** Resizable image node view — drag bottom-right corner to resize */
const ResizableImageView: FC<NodeViewProps> = ({ node, updateAttributes, selected }) => {
    const { src, alt, width, height } = node.attrs;
    const containerRef = useRef<HTMLDivElement>(null);
    const [isResizing, setIsResizing] = useStateReact(false);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startWidth = containerRef.current?.offsetWidth || width || 300;
        const aspectRatio = (height && width) ? height / width : undefined;

        const onMouseMove = (moveEvent: MouseEvent) => {
            const newWidth = Math.max(100, startWidth + (moveEvent.clientX - startX));
            const attrs: Record<string, any> = { width: Math.round(newWidth) };
            if (aspectRatio) {
                attrs.height = Math.round(newWidth * aspectRatio);
            }
            updateAttributes(attrs);
        };

        const onMouseUp = () => {
            setIsResizing(false);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        setIsResizing(true);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }, [width, height, updateAttributes]);

    return (
        <NodeViewWrapper style={{ display: 'block', margin: '0.5em 0' }}>
            <Box
                ref={containerRef}
                sx={{
                    display: 'inline-block',
                    position: 'relative',
                    maxWidth: '100%',
                    border: selected ? '2px solid' : '2px solid transparent',
                    borderColor: selected ? 'primary.main' : 'transparent',
                    borderRadius: '4px',
                    '&:hover .resize-handle': { opacity: 1 },
                }}
            >
                <img
                    src={src}
                    alt={alt || ''}
                    width={width || undefined}
                    height={height || undefined}
                    style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
                    draggable={false}
                />
                <Box
                    className="resize-handle"
                    onMouseDown={handleMouseDown}
                    sx={{
                        position: 'absolute',
                        bottom: 0,
                        right: 0,
                        width: 14,
                        height: 14,
                        cursor: 'nwse-resize',
                        opacity: 0,
                        transition: 'opacity 0.15s',
                        '&::after': {
                            content: '""',
                            position: 'absolute',
                            bottom: 2,
                            right: 2,
                            width: 8,
                            height: 8,
                            borderRight: '2px solid rgba(0,0,0,0.4)',
                            borderBottom: '2px solid rgba(0,0,0,0.4)',
                        },
                    }}
                />
            </Box>
        </NodeViewWrapper>
    );
};

/** Custom Image extension with resizable node view */
const ResizableImage = Image.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            width: { default: null, parseHTML: el => el.getAttribute('width') },
            height: { default: null, parseHTML: el => el.getAttribute('height') },
            'data-chart-id': { 
                default: null, 
                parseHTML: el => el.getAttribute('data-chart-id'),
                renderHTML: (attributes) => {
                    if (!attributes['data-chart-id']) return {};
                    return { 'data-chart-id': attributes['data-chart-id'] };
                },
            },
        };
    },
    addNodeView() {
        return ReactNodeViewRenderer(ResizableImageView);
    },
});

const ToolbarButton: FC<{
    onClick: () => void;
    isActive?: boolean;
    title: string;
    children: React.ReactNode;
}> = ({ onClick, isActive, title, children }) => {
    const theme = useTheme();
    return (
        <Tooltip title={title} placement="top">
            <IconButton
                size="small"
                onClick={onClick}
                sx={{
                    p: '3px',
                    borderRadius: '4px',
                    color: isActive ? theme.palette.primary.main : 'text.secondary',
                    backgroundColor: isActive ? alpha(theme.palette.primary.main, 0.08) : 'transparent',
                    '&:hover': {
                        backgroundColor: alpha(theme.palette.primary.main, 0.12),
                    },
                }}
            >
                {children}
            </IconButton>
        </Tooltip>
    );
};

export const TiptapReportEditor: FC<TiptapReportEditorProps> = ({
    content,
    streamingText,
    resolveChartImage,
    editable = true,
    isGenerating = false,
    generatingPhase,
    inspectionSteps,
    reportId,
    reportLook = DEFAULT_LOOK,
    onOpenSource,
    onUpdate,
}) => {
    const theme = useTheme();
    const { t } = useTranslation();
    const isFocused = useRef(false);
    const blockLabels = useReportBlockLabels();

    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                heading: { levels: [1, 2, 3] },
                // Links open on a plain click only when reading (session files in a canvas tab).
                link: { openOnClick: false },
            }),
            ResizableImage.configure({
                inline: false,
            }),
            Table.configure({
                resizable: true,
                HTMLAttributes: { class: 'report-table' },
            }),
            TableRow,
            TableHeader,
            TableCell,
            ...reportBlockExtensions(blockLabels),
            Markdown.configure({
                html: true,
                linkify: true,
                transformPastedText: true,
            }),
        ],
        content,
        editable,
        onUpdate: ({ editor }) => {
            if (isFocused.current) {
                onUpdate?.(editor.getHTML());
            }
        },
        onFocus: () => {
            isFocused.current = true;
        },
        onBlur: () => {
            isFocused.current = false;
        },
    });

    // Sync editable prop
    useEffect(() => {
        if (editor) {
            editor.setEditable(editable);
        }
    }, [editor, editable]);

    // Auto-focus the editor when it becomes editable or when the viewed report changes
    useEffect(() => {
        if (editor && editable) {
            // Small delay to let the DOM settle after content streaming finishes
            const timer = setTimeout(() => {
                editor.commands.focus('start');
            }, 100);
            return () => clearTimeout(timer);
        }
    }, [editor, editable, reportId]);

    // Sync content when it changes externally (streaming or loading a different report)
    // Always sync if the content contains new images (img tags) that aren't in the editor yet
    useEffect(() => {
        if (!editor) return;
        // While the writing phase streams, the lightweight typewriter view owns the
        // display — defer the (expensive) markdown parse until the stream completes.
        if (isGenerating && generatingPhase === 'writing') return;
        if (!isFocused.current) {
            editor.commands.setContent(content, { emitUpdate: false });
        } else {
            // Even when focused, sync if new images arrived (user isn't typing image tags)
            const currentHtml = editor.getHTML();
            const newImgCount = (content.match(/<img /g) || []).length;
            const currentImgCount = (currentHtml.match(/<img /g) || []).length;
            if (newImgCount > currentImgCount) {
                editor.commands.setContent(content, { emitUpdate: false });
            }
        }
    }, [editor, content, generatingPhase, isGenerating]);

    // A citation number's reference entry (entry n of the references list).
    const contentRef = useRef<HTMLDivElement>(null);
    const referenceOf = useCallback((cite: Element): HTMLElement | undefined => {
        const number = Number(cite.getAttribute('data-cite'));
        const entries = contentRef.current?.querySelectorAll<HTMLElement>('.report-references li');
        return number && entries ? entries[number - 1] : undefined;
    }, []);

    // Opening a reference: its session file in a canvas tab (at the quoted words), else its web page,
    // else the entry itself in the references list.
    const openReference = useCallback((entry: HTMLElement) => {
        const href = entry.querySelector('a[href]')?.getAttribute('href');
        const fileName = sessionFileName(href);
        if (fileName) {
            onOpenSource?.(fileName, { text: quotedPassage(entry.textContent || '') });
            return;
        }
        const web = safeHttpUrl(href) ?? safeHttpUrl(entry.textContent?.match(/https?:\/\/\S+/)?.[0]?.replace(/[).,;]+$/, ''));
        if (web) {
            window.open(web, '_blank', 'noopener,noreferrer');
            return;
        }
        entry.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, [onOpenSource]);

    // Hovering a citation previews its reference.
    const [citePreview, setCitePreview] = useStateReact<{ anchor: HTMLElement; text: string } | null>(null);
    const handleCiteHover = useCallback((event: React.MouseEvent) => {
        const cite = (event.target as HTMLElement).closest?.('sup.report-cite[data-cite]') as HTMLElement | null;
        if (!cite) return;
        const entry = referenceOf(cite);
        if (entry) setCitePreview({ anchor: cite, text: entry.textContent || '' });
    }, [referenceOf]);
    const handleCiteLeave = useCallback((event: React.MouseEvent) => {
        if ((event.target as HTMLElement).closest?.('sup.report-cite')) setCitePreview(null);
    }, []);

    // A link to a session file (an excerpt's source, or a files/… link in the text) opens it in a
    // canvas tab — an excerpt's near its page and quoted words. Web links open normally. A citation
    // number opens its reference's source.
    const handleSourceClick = useCallback((event: React.MouseEvent) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
        const cite = (event.target as HTMLElement).closest?.('sup.report-cite[data-cite]') as HTMLElement | null;
        if (cite && !editable) {
            const entry = referenceOf(cite);
            if (entry) {
                event.preventDefault();
                setCitePreview(null);
                openReference(entry);
            }
            return;
        }
        const link = (event.target as HTMLElement).closest?.('a') as HTMLAnchorElement | null;
        if (!link) return;
        const fromExcerpt = link.getAttribute('data-open-file');
        if (editable && !fromExcerpt) return;
        const fileName = fromExcerpt || sessionFileName(link.getAttribute('href'));
        if (!fileName) return;
        event.preventDefault();
        const page = Number(link.getAttribute('data-page')?.match(/\d+/)?.[0]) || undefined;
        const text = fromExcerpt
            ? link.closest('figure')?.querySelector('.report-block-body')?.textContent ?? undefined
            : undefined;
        onOpenSource?.(fileName, { page, text });
    }, [editable, onOpenSource, referenceOf, openReference]);

    const copyAsRichText = useCallback(async () => {
        if (!editor) return;
        const html = editor.getHTML();
        try {
            await navigator.clipboard.write([
                new ClipboardItem({
                    'text/html': new Blob([html], { type: 'text/html' }),
                    'text/plain': new Blob([editor.getText()], { type: 'text/plain' }),
                }),
            ]);
        } catch (e) {
            console.warn('Failed to copy as rich text:', e);
        }
    }, [editor]);

    if (!editor) return null;

    const iconSx = { fontSize: textVar.xl };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100%', position: 'relative' }}>
            {/* Toolbar — only in edit mode (formatting); hidden when reading or generating */}
            {editable && (
            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                gap: '2px',
                px: 1,
                py: 2,
                minHeight: 26,
                borderBottom: `1px solid ${alpha(theme.palette.divider, 0.3)}`,
                flexShrink: 0,
                position: 'sticky',
                top: 0,
                zIndex: 5,
                backgroundColor: 'background.paper',
            }}
                data-report-toolbar
            >
                {editable && (
                <Box sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '2px',
                }}>
                    <ToolbarButton
                        onClick={() => editor.chain().focus().toggleBold().run()}
                        isActive={editor.isActive('bold')}
                        title={t('editor.bold')}
                    >
                        <FormatBoldIcon sx={iconSx} />
                    </ToolbarButton>
                    <ToolbarButton
                        onClick={() => editor.chain().focus().toggleItalic().run()}
                        isActive={editor.isActive('italic')}
                        title={t('editor.italic')}
                    >
                        <FormatItalicIcon sx={iconSx} />
                    </ToolbarButton>
                    <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
                    <ToolbarButton
                        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                        isActive={editor.isActive('heading', { level: 1 })}
                        title={t('editor.heading1')}
                    >
                        <TitleIcon sx={iconSx} />
                    </ToolbarButton>
                    <ToolbarButton
                        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                        isActive={editor.isActive('heading', { level: 2 })}
                        title={t('editor.heading2')}
                    >
                        <TitleIcon sx={{ ...iconSx, fontSize: iconVar.sm }} />
                    </ToolbarButton>
                    <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
                    <ToolbarButton
                        onClick={() => editor.chain().focus().toggleBulletList().run()}
                        isActive={editor.isActive('bulletList')}
                        title={t('editor.bulletList')}
                    >
                        <FormatListBulletedIcon sx={iconSx} />
                    </ToolbarButton>
                    <ToolbarButton
                        onClick={() => editor.chain().focus().toggleOrderedList().run()}
                        isActive={editor.isActive('orderedList')}
                        title={t('editor.numberedList')}
                    >
                        <FormatListNumberedIcon sx={iconSx} />
                    </ToolbarButton>
                    <ToolbarButton
                        onClick={() => editor.chain().focus().toggleBlockquote().run()}
                        isActive={editor.isActive('blockquote')}
                        title={t('editor.quote')}
                    >
                        <FormatQuoteIcon sx={iconSx} />
                    </ToolbarButton>
                </Box>
                )}
            </Box>
            )}
            {/* Editor */}
            <Box ref={contentRef} onClick={handleSourceClick} onMouseOver={handleCiteHover} onMouseOut={handleCiteLeave} sx={{
                flex: 1,
                overflow: 'visible',
                position: 'relative',
                '& .tiptap': {
                    ...reportContentSx(theme, reportLook),
                    outline: 'none',
                    // The page's own top space: the first block (usually the title) has no top margin.
                    padding: `${REPORT_TOP_SPACE} 24px 16px`,
                    minHeight: '100%',
                },
            }}>
                {/* While inspecting, the report is still empty — show progress.
                    While writing, a typewriter view reveals the streamed text
                    smoothly; TipTap takes over (one parse) once it completes. */}
                {isGenerating && generatingPhase !== 'writing' ? (
                    <InspectingStatus steps={inspectionSteps} />
                ) : isGenerating && generatingPhase === 'writing' ? (
                    <StreamingText text={streamingText ?? ''} reportLook={reportLook} resolveChartImage={resolveChartImage} />
                ) : (
                    <EditorContent editor={editor} />
                )}
            </Box>
            <Popper open={!!citePreview} anchorEl={citePreview?.anchor} placement="top" sx={{ zIndex: 1300, pointerEvents: 'none' }}
                modifiers={[{ name: 'offset', options: { offset: [0, 6] } }]}>
                <Paper elevation={3} sx={{ maxWidth: 380, px: 1.25, py: 0.9, borderRadius: '6px' }}>
                    <Typography sx={{ fontSize: textVar.sm, lineHeight: 1.45, color: 'text.primary', overflowWrap: 'anywhere' }}>
                        {citePreview?.text}
                    </Typography>
                    {!editable && (
                        <Typography sx={{ mt: 0.5, fontSize: textVar.xs, color: 'text.disabled' }}>
                            {t('report.blocks.openCite')}
                        </Typography>
                    )}
                </Paper>
            </Popper>
        </Box>
    );
};
