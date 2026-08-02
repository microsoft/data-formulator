// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useEffect, useCallback, useRef, useState as useStateReact } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditor, EditorContent, NodeViewWrapper, NodeViewProps, ReactNodeViewRenderer } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import { Markdown } from 'tiptap-markdown';
import { Box, IconButton, Tooltip, Divider, Typography, CircularProgress, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { WritingIndicator } from '../components/FunComponents';
import { getChartTemplate } from '../components/ChartTemplates';
import FormatBoldIcon from '@mui/icons-material/FormatBold';
import FormatItalicIcon from '@mui/icons-material/FormatItalic';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered';
import FormatQuoteIcon from '@mui/icons-material/FormatQuote';
import TitleIcon from '@mui/icons-material/Title';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

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
    onUpdate?: (html: string) => void;
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
            ? <CheckCircleIcon sx={{ fontSize: 13, color: 'success.main' }} />
            : <CircularProgress size={11} thickness={5} sx={{ color: 'text.secondary' }} />}
    </Box>
);

/** Spinner + gently pulsing label for "thinking…" / "still working" states. */
const ThinkingRow: FC<{ label: string }> = ({ label }) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, py: 0.25 }}>
        <StatusIcon />
        <Typography component="span" sx={{
            fontSize: 12, lineHeight: 1.4, color: 'text.secondary',
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
                    fontSize: 12, lineHeight: 1.4, color: 'text.primary',
                    whiteSpace: 'normal', wordBreak: 'break-word',
                }}>
                    {step.done && step.doneLabel ? step.doneLabel : step.label}
                </Typography>
                {step.done && step.durationMs != null && (
                    <Typography component="span" sx={{
                        fontSize: 11, lineHeight: 1.4, color: 'text.disabled',
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
                        '& svg': { fontSize: 14 },
                    }}>
                        {getChartTemplate(c.chartType)?.icon}
                    </Box>
                    <Typography component="span" sx={{
                        fontSize: 12, lineHeight: 1.4, color: 'text.secondary',
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
                fontSize: 11, fontWeight: 600, letterSpacing: '0.05em',
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

type ResolveChartImage = (chartId: string) => { url: string; width: number; height: number } | undefined;

/**
 * Lightweight, line-based render of the streamed markdown. Good enough to read
 * smoothly while text arrives; the real TipTap parse happens once on completion.
 */
const StreamingMarkdownLite: FC<{ text: string; caret?: React.ReactNode; resolveChartImage?: ResolveChartImage }> = ({ text, caret, resolveChartImage }) => {
    const lines = text.split('\n');
    const lastIdx = lines.length - 1;
    return (
        <>
            {lines.map((line, i) => {
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
                    const level = h[1].length;
                    return (
                        <Box key={i} component="div" sx={{
                            fontWeight: level === 1 ? 700 : 600,
                            fontSize: level === 1 ? '1.75rem' : level === 2 ? '1.4rem' : '1.15rem',
                            lineHeight: 1.3,
                            mt: i === 0 ? 0 : '1em', mb: '0.4em',
                        }}>
                            {stripInlineMarkers(h[2])}{tail}
                        </Box>
                    );
                }
                const li = line.match(/^[-*]\s+(.*)$/);
                if (li) {
                    return (
                        <Box key={i} component="div" sx={{ display: 'flex', gap: 1, mb: '0.25em' }}>
                            <Box component="span" sx={{ color: 'text.disabled' }}>•</Box>
                            <Box component="span">{stripInlineMarkers(li[1])}{tail}</Box>
                        </Box>
                    );
                }
                return (
                    <Box key={i} component="div" sx={{ minHeight: line === '' ? '0.5em' : undefined, mb: line === '' ? 0 : '0.2em' }}>
                        {stripInlineMarkers(line)}{tail}
                    </Box>
                );
            })}
        </>
    );
};

/**
 * Typewriter buffer: smoothly reveals `text` regardless of how bursty the
 * network deltas are. A rAF loop catches the displayed length up to the target,
 * revealing more per frame when the backlog is large so it never falls behind.
 */
const StreamingText: FC<{ text: string; resolveChartImage?: ResolveChartImage }> = ({ text, resolveChartImage }) => {
    const { t } = useTranslation();
    const textRef = useRef(text);
    textRef.current = text;
    const shownLenRef = useRef(0);
    const [shown, setShown] = useStateReact('');

    useEffect(() => {
        let raf = 0;
        let lastTime = performance.now();
        let lastTargetLen = 0;
        let lastChunkTime = lastTime;
        let fraction = 0;            // sub-character reveal accumulator

        // Reveal rate in chars/ms, smoothed across chunks. Each time a chunk
        // arrives we estimate the natural rate as (chunk size / time since the
        // previous chunk), so the chunk is spread out over roughly the gap until
        // the next one is expected — that feels like natural typing rather than
        // dumping. Clamped to a sane min/max and floored so it never stalls.
        const MIN_RATE = 0.012;     // ~12 chars/sec — slowest "typing" we allow
        const MAX_RATE = 0.20;      // ~200 chars/sec — cap so big bursts don't blur
        let rate = 0.03;            // initial guess until the first interval is known

        const tick = () => {
            const now = performance.now();
            const dt = Math.min(now - lastTime, 100); // clamp tab-switch gaps
            lastTime = now;

            const target = textRef.current;
            let len = shownLenRef.current;
            if (len > target.length) { len = 0; fraction = 0; } // report cleared/restarted

            // On each new chunk, re-estimate the natural typing rate from this
            // chunk's size and the interval since the previous chunk arrived.
            const arrived = target.length - lastTargetLen;
            if (arrived > 0) {
                const interval = Math.max(now - lastChunkTime, 1);
                lastChunkTime = now;
                lastTargetLen = target.length;
                const chunkRate = arrived / interval;
                rate = rate * 0.7 + chunkRate * 0.3; // EMA smoothing across chunks
            }

            const backlog = target.length - len;
            if (backlog > 0) {
                // Pace at the smoothed rate, but never below the min typing speed,
                // and lift slightly when the backlog is large so we don't drift
                // permanently behind a fast stream.
                const catchUp = backlog > 240 ? 1.6 : backlog > 80 ? 1.25 : 1;
                const effRate = Math.min(MAX_RATE, Math.max(MIN_RATE, rate) * catchUp);
                fraction += effRate * dt;
                const whole = Math.floor(fraction);
                if (whole >= 1) {
                    fraction -= whole;
                    len = Math.min(target.length, len + whole);
                    shownLenRef.current = len;
                    setShown(target.slice(0, len));
                }
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, []);

    return (
        <Box sx={{
            px: '24px', pt: '40px', pb: '64px',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
            fontSize: '0.95rem', lineHeight: 1.7, color: 'rgb(55, 53, 47)',
        }}>
            <StreamingMarkdownLite text={shown} resolveChartImage={resolveChartImage} caret={
                <Box component="span" sx={{
                    display: 'inline-block', width: '2px', height: '1.1em',
                    ml: '1px', verticalAlign: 'text-bottom', backgroundColor: 'text.primary',
                    animation: 'stream-caret 1s step-end infinite',
                    '@keyframes stream-caret': { '50%': { opacity: 0 } },
                }} />
            } />
            <Box sx={{ mt: shown.length === 0 ? 1 : 2 }}>
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
    onUpdate,
}) => {
    const theme = useTheme();
    const { t } = useTranslation();
    const isFocused = useRef(false);

    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                heading: { levels: [1, 2, 3] },
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
            Markdown.configure({
                html: true,
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
        if (generatingPhase === 'writing') return;
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
    }, [editor, content, generatingPhase]);

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

    const iconSx = { fontSize: 16 };

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
                        <TitleIcon sx={{ ...iconSx, fontSize: 14 }} />
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
            <Box sx={{
                flex: 1,
                overflow: 'visible',
                position: 'relative',
                '& .tiptap': {
                    outline: 'none',
                    padding: '16px 24px',
                    minHeight: '100%',
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
                    fontSize: '0.95rem',
                    lineHeight: 1.7,
                    color: 'rgb(55, 53, 47)',
                    '& h1': {
                        fontSize: '1.75rem',
                        fontWeight: 700,
                        lineHeight: 1.25,
                        letterSpacing: '-0.02em',
                        marginTop: '1.5em',
                        marginBottom: '0.5em',
                    },
                    '& h2': {
                        fontSize: '1.4rem',
                        fontWeight: 600,
                        lineHeight: 1.3,
                        marginTop: '1.25em',
                        marginBottom: '0.4em',
                    },
                    '& h3': {
                        fontSize: '1.15rem',
                        fontWeight: 600,
                        lineHeight: 1.4,
                        marginTop: '1em',
                        marginBottom: '0.3em',
                    },
                    '& p': {
                        marginBottom: '0.75em',
                    },
                    '& img': {
                        maxWidth: '100%',
                        height: 'auto',
                        borderRadius: '4px',
                        margin: '0.5em 0',
                    },
                    '& blockquote': {
                        borderLeft: '3px solid',
                        borderColor: alpha(theme.palette.text.disabled, 0.3),
                        paddingLeft: '1em',
                        margin: '0.75em 0',
                        fontStyle: 'italic',
                        color: 'rgb(73, 73, 73)',
                    },
                    '& ul, & ol': {
                        paddingLeft: '1.5em',
                        marginBottom: '0.75em',
                    },
                    '& li': {
                        marginBottom: '0.25em',
                    },
                    '& strong': {
                        fontWeight: 600,
                    },
                    '& code': {
                        backgroundColor: 'rgba(247, 246, 243, 1)',
                        padding: '0.15em 0.4em',
                        borderRadius: '3px',
                        fontSize: '0.85em',
                        fontFamily: '"SFMono-Regular", Menlo, Monaco, Consolas, monospace',
                    },
                    '& pre': {
                        backgroundColor: 'rgba(247, 246, 243, 1)',
                        padding: '0.75em 1em',
                        borderRadius: '4px',
                        overflow: 'auto',
                        '& code': {
                            backgroundColor: 'transparent',
                            padding: 0,
                        },
                    },
                    '& hr': {
                        border: 'none',
                        borderTop: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
                        margin: '1.5em 0',
                    },
                    '& table': {
                        borderCollapse: 'collapse',
                        margin: '0.75em 0',
                        width: 'auto',
                        tableLayout: 'auto',
                        fontSize: '0.82em',
                        lineHeight: 1.35,
                        color: 'rgb(73, 73, 73)',
                    },
                    '& table td, & table th': {
                        border: `1px solid ${alpha(theme.palette.divider, 0.55)}`,
                        padding: '4px 8px',
                        verticalAlign: 'top',
                        position: 'relative',
                        minWidth: '1em',
                    },
                    '& table th': {
                        backgroundColor: alpha(theme.palette.text.primary, 0.04),
                        fontWeight: 600,
                        textAlign: 'left',
                        color: 'rgb(55, 53, 47)',
                    },
                    '& .tableWrapper': {
                        overflowX: 'auto',
                        margin: '0.75em 0',
                    },
                    '& .column-resize-handle': {
                        position: 'absolute',
                        right: -2,
                        top: 0,
                        bottom: -2,
                        width: 4,
                        backgroundColor: alpha(theme.palette.primary.main, 0.35),
                        pointerEvents: 'none',
                    },
                },
            }}>
                {/* While inspecting, the report is still empty — show progress.
                    While writing, a typewriter view reveals the streamed text
                    smoothly; TipTap takes over (one parse) once it completes. */}
                {isGenerating && generatingPhase !== 'writing' ? (
                    <InspectingStatus steps={inspectionSteps} />
                ) : isGenerating && generatingPhase === 'writing' ? (
                    <StreamingText text={streamingText ?? ''} resolveChartImage={resolveChartImage} />
                ) : (
                    <EditorContent editor={editor} />
                )}
            </Box>
        </Box>
    );
};
