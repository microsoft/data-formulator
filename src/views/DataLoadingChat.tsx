// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as React from 'react';
import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import Markdown from 'react-markdown';

import {
    Box, Button, Chip, CircularProgress, IconButton,
    Paper, Stack, Tooltip, Typography,
    alpha, useTheme, Collapse, Divider,
} from '@mui/material';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import CheckIcon from '@mui/icons-material/Check';
import BoltOutlinedIcon from '@mui/icons-material/BoltOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import LanguageIcon from '@mui/icons-material/Language';
import TerminalIcon from '@mui/icons-material/Terminal';
import QuestionAnswerOutlinedIcon from '@mui/icons-material/QuestionAnswerOutlined';
import SearchIcon from '@mui/icons-material/Search';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';

import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch } from '../app/store';
import { DataFormulatorState, dfActions, dfSelectors } from '../app/dfSlice';
import { borderColor, transition, radius, shadow } from '../app/tokens';
import { buildDataLoadingSuggestions, buildDataLoadingQuickActions } from './dataLoadingSuggestions';
import { getUrls, fetchWithIdentity } from '../app/utils';
import { apiRequest, streamRequest } from '../app/apiClient';
import { ChatMessage, ChatAttachment, InlineTablePreview, CodeExecution, PendingTableLoad, LoadPlan, LoadPlanCandidate, ConnectorFormPrompt } from '../components/ComponentType';
import { createTableFromText } from '../data/utils';
import { loadTable } from '../app/tableThunks';
import { buildLoadQueryImportOptions, LoadPlanCard, PresentedLoadCandidate } from '../components/LoadPlanCard';
import { ConnectorFormCard } from '../components/ConnectorFormCard';
import { getConnectorIcon, TableIcon } from '../icons';
import { TablePreviewRow, TablePreviewData } from '../components/TablePreviewRow';
import { formatFilterChipLabel } from '../components/filterFormat';
import { AgentChatInput } from './AgentChatInput';
import { useScrollFade, ScrollFadeEdge } from '../components/ScrollFade';
import { generateUUID } from '../app/identity';
import { iconVar, textVar } from '../app/layout';
import { parseDataOperation, type DataOperation } from '../dataOperations/models';
import { DataOperationCard } from '../components/DataOperationCard';

// ---------------------------------------------------------------------------
// Helper: fresh workspace session id (mirrors DataSourceSidebar's scheme)
// ---------------------------------------------------------------------------

const newWorkspaceSessionId = (): string => {
    const now = new Date();
    const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    return `session_${date}_${time}_${generateUUID().slice(0, 4)}`;
};

// ---------------------------------------------------------------------------
// Helper: generate table name
// ---------------------------------------------------------------------------

const getUniqueTableName = (baseName: string, existingNames: Set<string>): string => {
    let uniqueName = baseName;
    let counter = 1;
    while (existingNames.has(uniqueName)) {
        uniqueName = `${baseName}_${counter}`;
        counter += 1;
    }
    return uniqueName;
};

// ---------------------------------------------------------------------------
// Markdown renderer for assistant messages — uses MUI Typography
// ---------------------------------------------------------------------------

// Modern monospace font stack for code blocks
const CODE_FONT = 'var(--df-font-mono)';

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
// Single source of truth for the conversation / canvas split. Pane minimums,
// the auto-size clamp and the column gutters all read from here, so the
// conversation keeps the same measure whether the canvas is open or not.
const LAYOUT = {
    /** Reading width of the conversation column. */
    readingWidth: 640,
    /** Horizontal breathing room around it (MUI spacing units). */
    gutter: 3,
    /** Narrowest the conversation may become — the sash stops here. */
    minChatWidth: 520,
    /** Canvas bounds; its preferred width depends on what it hosts. */
    minCanvasWidth: 320,
    canvasWidth: {
        connector: 440,
        loadPlan: (tables: number) => Math.min(720, 460 + tables * 40),
    },
} as const;

// Memoized so typing in the chat input (which re-renders the parent
// `DataLoadingChat` on every keystroke) doesn't re-parse every assistant
// message through react-markdown. `content` is a stable string per
// committed message, so the default shallow equality is sufficient.
const MarkdownContent = React.memo(({ content }: { content: string }) => {
    return (
        <Box sx={{ minWidth: 0, maxWidth: '100%', wordBreak: 'break-word' }}>
            <Markdown
                components={{
                    // Block elements
                    p: ({ children }) => (
                        <Typography variant="body2" sx={{ fontSize: textVar.md, lineHeight: 1.7, mb: 0.75, '&:last-child': { mb: 0 } }}>
                            {children}
                        </Typography>
                    ),
                    h1: ({ children }) => (
                        <Typography variant="h6" sx={{ fontSize: textVar.xl, fontWeight: 600, mb: 0.5, mt: 1 }}>{children}</Typography>
                    ),
                    h2: ({ children }) => (
                        <Typography variant="h6" sx={{ fontSize: textVar.xl, fontWeight: 600, mb: 0.5, mt: 0.75 }}>{children}</Typography>
                    ),
                    h3: ({ children }) => (
                        <Typography variant="subtitle1" sx={{ fontSize: textVar.lg, fontWeight: 600, mb: 0.5, mt: 0.75 }}>{children}</Typography>
                    ),
                    h4: ({ children }) => (
                        <Typography variant="subtitle2" sx={{ fontSize: textVar.md, fontWeight: 600, mb: 0.5, mt: 0.5 }}>{children}</Typography>
                    ),
                    // Lists
                    ul: ({ children }) => (
                        <Box component="ul" sx={{ m: 0, mb: 0.75, pl: 2.5, '&:last-child': { mb: 0 } }}>{children}</Box>
                    ),
                    ol: ({ children }) => (
                        <Box component="ol" sx={{ m: 0, mb: 0.75, pl: 2.5, '&:last-child': { mb: 0 } }}>{children}</Box>
                    ),
                    li: ({ children }) => (
                        <Typography component="li" variant="body2" sx={{ fontSize: textVar.md, lineHeight: 1.7, mb: 0.25 }}>
                            {children}
                        </Typography>
                    ),
                    // Inline
                    strong: ({ children }) => (
                        <Typography component="span" variant="body2" sx={{ fontWeight: 600, fontSize: 'inherit' }}>{children}</Typography>
                    ),
                    em: ({ children }) => (
                        <Typography component="span" variant="body2" sx={{ fontStyle: 'italic', fontSize: 'inherit' }}>{children}</Typography>
                    ),
                    a: ({ href, children }) => (
                        <Typography component="a" variant="body2"
                            href={href} target="_blank" rel="noopener noreferrer"
                            sx={{ color: 'primary.main', fontSize: 'inherit', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>
                            {children}
                        </Typography>
                    ),
                    // Code
                    code: ({ className, children }) => {
                        const isBlock = className?.startsWith('language-');
                        if (isBlock) {
                            return (
                                <Box component="pre" sx={{
                                    m: 0, my: 0.75, p: 1.5, borderRadius: 1.5,
                                    bgcolor: '#f6f6f6', color: '#1a1a1a',
                                    overflowX: 'hidden', overflowY: 'auto', maxHeight: 240,
                                    border: '1px solid', borderColor: 'divider',
                                }}>
                                    <Typography component="code" sx={{
                                        fontFamily: CODE_FONT, fontSize: textVar.sm,
                                        whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.5,
                                    }}>
                                        {children}
                                    </Typography>
                                </Box>
                            );
                        }
                        // Inline code: keep body font, just a subtle background
                        return (
                            <Typography component="code" sx={{
                                fontSize: 'inherit', fontFamily: 'inherit',
                                bgcolor: 'rgba(0,0,0,0.04)',
                                px: 0.4, py: 0.1,
                                borderRadius: 0.4,
                            }}>
                                {children}
                            </Typography>
                        );
                    },
                    pre: ({ children }) => <>{children}</>,
                    // Divider
                    hr: () => (
                        <Box sx={{ border: 'none', borderTop: '1px solid', borderColor: 'divider', my: 1 }} />
                    ),
                    // Table
                    table: ({ children }) => (
                        <Box component="table" sx={{
                            borderCollapse: 'collapse', width: '100%', my: 0.75,
                            '& th, & td': { border: '1px solid', borderColor: 'divider', px: 1, py: 0.5, textAlign: 'left' },
                            '& th': { bgcolor: 'action.hover', fontWeight: 600 },
                        }}>
                            {children}
                        </Box>
                    ),
                    th: ({ children }) => (
                        <Typography component="th" variant="caption" sx={{ fontWeight: 600, fontSize: textVar.sm }}>{children}</Typography>
                    ),
                    td: ({ children }) => (
                        <Typography component="td" variant="caption" sx={{ fontSize: textVar.sm }}>{children}</Typography>
                    ),
                }}
            >
                {content}
            </Markdown>
        </Box>
    );
});

// ---------------------------------------------------------------------------
// Inline table preview — compact notebook-style
// ---------------------------------------------------------------------------

const InlineTablePreviewView: React.FC<{
    preview: InlineTablePreview;
    onLoad?: () => void;
    confirmed?: boolean;
}> = ({ preview, onLoad, confirmed }) => {
    const theme = useTheme();
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(true);

    const rowLabel = preview.totalRows > preview.sampleRows.length
        ? `${preview.totalRows.toLocaleString()} ${t('dataLoading.rows')}`
        : '';
    const meta = [rowLabel, `${preview.columns.length} ${t('dataLoading.cols')}`].filter(Boolean).join(' · ');

    const isDark = theme.palette.mode === 'dark';
    const borderColorBase = confirmed
        ? alpha(theme.palette.success.main, 0.3)
        : alpha(theme.palette.primary.main, isDark ? 0.25 : 0.15);
    const borderColorHover = confirmed
        ? alpha(theme.palette.success.main, 0.45)
        : alpha(theme.palette.primary.main, isDark ? 0.4 : 0.3);
    const shadowBase = isDark
        ? '0 1px 2px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.2)'
        : '0 1px 2px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.03)';
    const shadowHover = isDark
        ? '0 2px 4px rgba(0,0,0,0.5), 0 2px 6px rgba(0,0,0,0.3)'
        : '0 2px 4px rgba(0,0,0,0.06), 0 2px 6px rgba(0,0,0,0.04)';

    return (
        <Box sx={{
            my: 0.75,
            p: 1,
            border: `1px solid ${borderColorBase}`,
            borderRadius: 1.5,
            boxShadow: shadowBase,
            transition: 'box-shadow 0.15s ease, border-color 0.15s ease',
            '&:hover': {
                borderColor: borderColorHover,
                boxShadow: shadowHover,
            },
        }}>
            <TablePreviewRow
                name={preview.name}
                meta={meta}
                leading={confirmed ? <CheckIcon sx={{ fontSize: iconVar.md, color: 'success.main', mx: 0.25 }} /> : undefined}
                preview={{
                    state: 'ready',
                    columns: preview.columns,
                    rows: preview.sampleRows,
                    totalRows: preview.totalRows,
                }}
                expanded={expanded}
                onTogglePreview={preview.sampleRows.length > 0 ? () => setExpanded(!expanded) : undefined}
            />
            {/* Footer: keep the load action available after loading and show
                the prior-load status immediately to its left. */}
            {(onLoad || confirmed) && (
                <Box sx={{ mt: 0.75, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ flex: 1 }} />
                    {confirmed && (
                        <Typography sx={{ fontSize: textVar.xs, color: 'success.main', fontWeight: 500 }}>
                            {t('dataLoading.loadPlan.loadedCount', { count: 1, defaultValue: '✓ Loaded' })}
                        </Typography>
                    )}
                    {onLoad && (
                        <Button size="small" variant="contained" onClick={onLoad}
                            sx={{
                                textTransform: 'none', fontSize: textVar.sm,
                                py: 0.5, px: 2, minHeight: 0,
                                borderRadius: 1.5, boxShadow: 'none',
                            }}>
                            {t('dataLoading.loadTable')}
                        </Button>
                    )}
                </Box>
            )}
        </Box>
    );
};

// ---------------------------------------------------------------------------
// Code execution block
// ---------------------------------------------------------------------------

const CodeBlockView: React.FC<{ block: CodeExecution }> = ({ block }) => {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(false);
    return (
        <Paper variant="outlined" sx={{ my: 1, borderRadius: radius.md, overflow: 'hidden' }}>
            <Box
                sx={{
                    display: 'flex', alignItems: 'center', px: 1.5, py: 0.5,
                    cursor: 'pointer', bgcolor: 'rgba(0,0,0,0.03)',
                    '&:hover': { bgcolor: 'rgba(0,0,0,0.05)' },
                    transition: transition.fast,
                }}
                onClick={() => setExpanded(!expanded)}
            >
                <TerminalIcon sx={{ fontSize: iconVar.sm, color: 'text.secondary', mr: 0.75 }} />
                <Typography variant="caption" sx={{ fontSize: textVar.xs, color: 'text.secondary', flex: 1 }}>
                    {t('dataLoading.ranPythonCode')}
                </Typography>
                {block.error
                    ? <ErrorOutlineIcon sx={{ fontSize: iconVar.sm, color: 'text.disabled', mr: 0.5 }} />
                    : <CheckCircleIcon sx={{ fontSize: iconVar.sm, color: 'success.main', opacity: 0.7, mr: 0.5 }} />
                }
                {expanded ? <ExpandLessIcon sx={{ fontSize: iconVar.sm }} /> : <ExpandMoreIcon sx={{ fontSize: iconVar.sm }} />}
            </Box>
            <Collapse in={expanded}>
                <Box sx={{ px: 1.5, py: 1, bgcolor: '#f6f6f6', overflow: 'auto', maxHeight: 200, borderTop: '1px solid', borderColor: 'divider' }}>
                    <Typography component="pre" sx={{ fontFamily: CODE_FONT, fontSize: textVar.sm, m: 0, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                        {block.code}
                    </Typography>
                </Box>
                {block.stdout && (
                    <Box sx={{ px: 1.5, py: 0.75, borderTop: '1px solid rgba(0,0,0,0.08)', bgcolor: 'rgba(0,0,0,0.02)' }}>
                        <Typography component="pre" sx={{
                            fontFamily: CODE_FONT, fontSize: textVar.xs, m: 0,
                            whiteSpace: 'pre-wrap', maxHeight: 150, overflow: 'auto', color: 'text.secondary', lineHeight: 1.5,
                        }}>
                            {block.stdout}
                        </Typography>
                    </Box>
                )}
                {block.error && (
                    <Box sx={{ px: 1.5, py: 0.75, borderTop: '1px solid rgba(0,0,0,0.08)', bgcolor: 'rgba(0,0,0,0.02)' }}>
                        <Typography component="pre" sx={{
                            fontFamily: CODE_FONT, fontSize: textVar.xs, m: 0,
                            whiteSpace: 'pre-wrap', color: 'text.secondary', lineHeight: 1.5,
                        }}>
                            {block.error}
                        </Typography>
                    </Box>
                )}
                {block.resultTable && (
                    <Box sx={{ px: 1 }}>
                        <InlineTablePreviewView preview={block.resultTable} />
                    </Box>
                )}
            </Collapse>
        </Paper>
    );
};

// ---------------------------------------------------------------------------
// New-request divider
// ---------------------------------------------------------------------------

// Rendered between the previous conversation and a freshly-started task
// (agent delegate, a new query from the menu, or a sample-task click).
// Preserving history keeps prior extractions recoverable; this separator
// makes the boundary between tasks obvious. Excluded from the agent history
// payload (see `sendMessage`).
const TaskDivider: React.FC = () => {
    const { t } = useTranslation();
    return (
        <Box sx={{ my: 1.5 }}>
            <Divider>
                <Typography variant="caption" sx={{ fontSize: textVar.xxs, color: 'text.disabled', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {t('dataLoading.newRequestDivider', 'New request')}
                </Typography>
            </Divider>
        </Box>
    );
};

// ---------------------------------------------------------------------------
// "Continue from this section" affordance
// ---------------------------------------------------------------------------

// Rendered at the end of each older (non-latest) section. Between sections the
// "New request" separator is hidden to keep history uncluttered; this button
// is the only visible boundary, and clicking it promotes that section back to
// the latest position so the user can continue the conversation from there
// (non-destructive — nothing is deleted).
const ContinueSectionButton: React.FC<{ onClick: () => void }> = ({ onClick }) => {
    const { t } = useTranslation();
    return (
        <Box sx={{ display: 'flex', justifyContent: 'center', my: 1.25 }}>
            <Button
                size="small"
                variant="text"
                onClick={onClick}
                startIcon={<QuestionAnswerOutlinedIcon sx={{ fontSize: iconVar.sm }} />}
                sx={{
                    fontSize: textVar.xs, textTransform: 'none', color: 'text.secondary',
                    py: 0.25, px: 1, minHeight: 0, borderRadius: radius.pill,
                    '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
                }}
            >
                {t('dataLoading.continueFromSection', 'Continue from this section')}
            </Button>
        </Box>
    );
};


// ---------------------------------------------------------------------------
// Canvas widgets
// ---------------------------------------------------------------------------

/** Long interaction widgets the chat hands off to the canvas. */
type CanvasKind = 'connector' | 'loadPlan';

// Every plan opens on the canvas, whatever its size, so the interaction is the
// same every time. Only a *resolved* connection collapses back into the chat,
// where it is a status chip rather than a widget.
const isShortConnectorForm = (form: ConnectorFormPrompt) => form.status === 'connected';
const loadPlanTables = (plan?: LoadPlan) => plan?.options.flatMap(option => option.tables) ?? [];
const loadPlanCandidateCount = (message: ChatMessage) =>
    loadPlanTables(message.loadPlan).length + (message.pendingLoads?.length ?? 0);
const hasLoadPlan = (message: ChatMessage) => loadPlanCandidateCount(message) > 0;
const isLoadPlanComplete = (message: ChatMessage) => hasLoadPlan(message)
    && (!message.loadPlan || message.loadPlan.confirmed === true)
    && (!message.pendingLoads || message.pendingLoads.every(p => p.confirmed || !p.csvScratchPath));
interface CanvasInviteDetail {
    source: string;
    table: string;
    rows?: string;
}
const formatInviteRowCount = (count: number, t: TFunction) => t(
    count === 1 ? 'dataLoading.canvasRow' : 'dataLoading.canvasRows',
    {
        formatted: count.toLocaleString(),
        defaultValue: `${count.toLocaleString()} ${count === 1 ? 'row' : 'rows'}`,
    },
);
const loadPlanInviteDetails = (message: ChatMessage, t: TFunction): CanvasInviteDetail[] => [
    ...loadPlanTables(message.loadPlan).map(candidate => ({
        source: candidate.sourceId,
        table: candidate.displayName,
    })),
    ...(message.pendingLoads || []).map(pending => ({
        source: message.codeBlocks?.length
            ? t('dataLoading.canvasPythonSource', { defaultValue: 'Python' })
            : t('dataLoading.canvasExtractedSource', { defaultValue: 'Extracted' }),
        table: pending.name,
        rows: formatInviteRowCount(pending.preview.totalRows, t),
    })),
];
/** Width the widget wants on open: plans grow with the number of tables. */
const canvasWidthFor = (kind: CanvasKind, message: ChatMessage) =>
    kind === 'connector'
        ? LAYOUT.canvasWidth.connector
        : LAYOUT.canvasWidth.loadPlan(loadPlanCandidateCount(message));

/**
 * Chat-side stand-in for a canvas widget: one compact line that says what is
 * waiting and opens it on the right.
 */
const CanvasInvite: React.FC<{
    icon: React.ReactNode;
    title: string;
    caption?: string;
    details?: CanvasInviteDetail[];
    moreCount?: number;
    action: string;
    active?: boolean;
    onClick: () => void;
}> = ({ icon, title, caption, details, moreCount = 0, action, active, onClick }) => {
    const theme = useTheme();
    const { t } = useTranslation();
    return (
        <Box
            role="button"
            tabIndex={0}
            onClick={onClick}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
            sx={{
                mt: 1, width: '100%', maxWidth: 420, minWidth: 0,
                display: 'flex', alignItems: 'flex-start', gap: 1,
                px: 1.25, py: 1,
                border: '1px solid',
                borderColor: active
                    ? alpha(theme.palette.primary.main, 0.55)
                    : alpha(theme.palette.text.primary, 0.14),
                borderRadius: radius.md,
                cursor: 'pointer',
                bgcolor: active
                    ? alpha(theme.palette.primary.main, 0.05)
                    : alpha(theme.palette.text.primary, 0.025),
                transition: transition.normal,
                '&:hover': {
                    bgcolor: alpha(theme.palette.text.primary, 0.045),
                    borderColor: alpha(theme.palette.primary.main, 0.55),
                    '& .canvas-invite-action': { color: 'primary.main' },
                },
                '&:focus-visible': {
                    outline: `2px solid ${alpha(theme.palette.primary.main, 0.65)}`,
                    outlineOffset: 2,
                },
            }}
        >
            <Box sx={{ display: 'flex', flexShrink: 0, color: 'text.disabled', mt: 0.15 }}>{icon}</Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography noWrap sx={{ fontSize: textVar.sm, fontWeight: 600, lineHeight: 1.35 }}>{title}</Typography>
                {details?.length ? (
                    <Box sx={{ mt: 0.35, display: 'flex', flexDirection: 'column', gap: 0.15 }}>
                        {details.map((detail, index) => {
                            const source = `${t('dataLoading.canvasSourceLabel', { defaultValue: 'source' })}: ${detail.source}`;
                            const metadata = [source, detail.rows].filter(Boolean).join(', ');
                            const label = `${detail.table} (${metadata})`;
                            return (
                                <Typography key={`${detail.source}:${detail.table}:${index}`} noWrap title={label}
                                    sx={{ fontSize: textVar.xs, color: 'text.secondary', lineHeight: 1.4 }}>
                                    <Box component="span" sx={{ color: 'text.primary', fontWeight: 500 }}>{detail.table}</Box>
                                    {' ('}{metadata}{')'}
                                </Typography>
                            );
                        })}
                        {moreCount > 0 && (
                            <Typography sx={{ fontSize: textVar.xxs, color: 'text.disabled', lineHeight: 1.4 }}>
                                {t('dataLoading.canvasMoreTables', {
                                    count: moreCount,
                                    defaultValue: `+${moreCount} more`,
                                })}
                            </Typography>
                        )}
                    </Box>
                ) : caption ? (
                    <Typography noWrap sx={{ fontSize: textVar.xs, color: 'text.secondary', lineHeight: 1.4 }}>{caption}</Typography>
                ) : null}
            </Box>
            <Box className="canvas-invite-action" sx={{
                display: 'flex', alignItems: 'center', flexShrink: 0, mt: 0.1,
                color: active ? 'primary.main' : 'text.disabled',
                transition: transition.fast,
            }}>
                <Typography sx={{ fontSize: textVar.xs, fontWeight: 500 }}>{action}</Typography>
                <ChevronRightIcon sx={{ fontSize: iconVar.sm, ml: 0.15 }} />
            </Box>
        </Box>
    );
};

// ---------------------------------------------------------------------------
// Single chat message bubble
// ---------------------------------------------------------------------------

// Memoized so typing in the chat input doesn't re-render every prior
// bubble (each one renders MarkdownContent + potentially code blocks /
// table previews, which is expensive on long threads). The parent
// stabilises `existingNames` via useMemo so memo equality holds across
// keystrokes.
const ChatBubble = React.memo<{
    message: ChatMessage;
    onContinue?: () => void;
    /** Opens this message's long widget on the canvas. */
    onOpenCanvas?: (kind: CanvasKind, messageId: string) => void;
    /** Message whose widget the canvas currently shows. */
    canvasMessageId?: string;
}>(({ message, onContinue, onOpenCanvas, canvasMessageId }) => {
    const theme = useTheme();
    const { t } = useTranslation();
    const isUser = message.role === 'user';
    const [hovered, setHovered] = useState(false);
    const [showDebug, setShowDebug] = useState(false);

    // User messages: compact right-aligned bubble
    if (isUser) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1.5 }}
                onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
                <Box sx={{
                    maxWidth: '80%',
                    px: 1.75, py: 1,
                    borderRadius: '16px 16px 4px 16px',
                    bgcolor: alpha(theme.palette.primary.main, 0.10),
                    position: 'relative',
                }}>
                    {/* Image attachments */}
                    {message.attachments?.filter(a => a.type === 'image').map((att, i) => (
                        <Box key={i} sx={{ mb: 0.75 }}>
                            <Box component="img" src={att.url} alt={att.name}
                                sx={{ maxWidth: '100%', maxHeight: 160, borderRadius: 1, objectFit: 'contain' }} />
                        </Box>
                    ))}
                    {/* File attachments — match the muted chip style used
                        in the input area before send, so visual identity
                        carries through from compose to history. */}
                    {message.attachments?.filter(a => a.type !== 'image').map((att, i) => (
                        <Box key={i} sx={{
                            display: 'inline-flex', alignItems: 'center', gap: 0.5,
                            px: 0.75, py: 0.25, mb: 0.5, mr: 0.5,
                            color: 'text.secondary',
                            bgcolor: alpha(theme.palette.text.primary, 0.04),
                            border: `1px solid ${alpha(theme.palette.text.primary, 0.12)}`,
                            borderRadius: 1,
                            maxWidth: 220,
                        }}>
                            <InsertDriveFileOutlinedIcon sx={{ fontSize: iconVar.sm, color: 'text.disabled', flexShrink: 0 }} />
                            <Typography variant="caption" title={att.name}
                                sx={{ fontSize: textVar.xs, lineHeight: 1.4,
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {att.name}
                            </Typography>
                        </Box>
                    ))}
                    {message.content && (
                        <Typography sx={{ fontSize: textVar.md, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {message.content}
                        </Typography>
                    )}
                    {/* Timestamp on hover */}
                    {hovered && (
                        <Typography sx={{
                            fontSize: textVar.xxs, color: 'text.disabled', position: 'absolute',
                            bottom: -16, right: 4, whiteSpace: 'nowrap',
                        }}>
                            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </Typography>
                    )}
                </Box>
            </Box>
        );
    }

    // Assistant messages: full-width, markdown rendered, no bubble border
    return (
        <Box sx={{ display: 'flex', mb: 2, position: 'relative' }}
            onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
            <Box sx={{ flex: 1, maxWidth: '100%', minWidth: 0 }}>
                {message.content && <MarkdownContent content={message.content} />}
                {message.codeBlocks?.map((block, i) => <CodeBlockView key={i} block={block} />)}
                {message.tables?.map((table, i) => <InlineTablePreviewView key={i} preview={table} />)}
                {/* Load plan — the agent's reasoning stays in its own voice
                    above the plan; the plan itself always opens on the canvas. */}
                {hasLoadPlan(message) && (() => {
                    const complete = isLoadPlanComplete(message);
                    const details = loadPlanInviteDetails(message, t);
                    return (
                        <CanvasInvite
                            icon={<TableIcon sx={{ fontSize: 17 }} />}
                            title={t('dataLoading.canvasLoadPlan', { defaultValue: 'Table loading plan' })}
                            details={details.slice(0, 3)}
                            moreCount={Math.max(0, details.length - 3)}
                            action={complete
                                ? t('dataLoading.canvasView', { defaultValue: 'View' })
                                : t('dataLoading.canvasReview', { defaultValue: 'Review' })}
                            active={canvasMessageId === message.id}
                            onClick={() => onOpenCanvas?.('loadPlan', message.id)}
                        />
                    );
                })()}
                {message.dataOperation && (
                    <DataOperationCard operation={message.dataOperation} />
                )}
                {/* Connection form — Agent-proposed via propose_connection. The
                    form opens on the canvas; once connected it collapses to an
                    inline status chip. */}
                {message.connectorForm && (isShortConnectorForm(message.connectorForm) ? (
                    <ConnectorFormCard
                        messageId={message.id}
                        prompt={message.connectorForm}
                    />
                ) : (
                    <CanvasInvite
                        icon={getConnectorIcon(message.connectorForm.sourceType, { sx: { fontSize: 17 } })}
                        title={t('chatConnector.connectTo', {
                            name: message.connectorForm.connectionName || message.connectorForm.sourceType,
                            defaultValue: 'Connect to {{name}}',
                        })}
                        caption={t('dataLoading.canvasConnectCaption', { defaultValue: 'Fill in the connection details' })}
                        action={t('dataLoading.canvasOpen', { defaultValue: 'Open' })}
                        active={canvasMessageId === message.id}
                        onClick={() => onOpenCanvas?.('connector', message.id)}
                    />
                ))}
                {/* Continue affordance — agent paused at the tool-call limit and
                    asked whether to keep going. Clicking resumes the task. */}
                {message.canContinue && onContinue && (
                    <Box sx={{ mt: 1 }}>
                        <Button
                            size="small"
                            variant="outlined"
                            onClick={onContinue}
                            sx={{ textTransform: 'none', fontSize: textVar.sm, borderRadius: radius.pill, py: 0.25 }}
                        >
                            {t('dataLoading.continueTask', 'Continue')}
                        </Button>
                    </Box>
                )}
                {/* Timestamp + debug — always reserves space, content visible on hover */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25, height: 18, opacity: hovered ? 1 : 0, transition: 'opacity 0.15s' }}>
                    <Typography sx={{ fontSize: textVar.xxs, color: 'text.disabled' }}>
                        {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Typography>
                    <Tooltip title={t('dataLoading.showRawData')} placement="top">
                        <IconButton size="small" onClick={() => setShowDebug(!showDebug)}
                            sx={{ width: 16, height: 16, color: 'text.disabled', '&:hover': { color: 'text.secondary' } }}>
                            <TerminalIcon sx={{ fontSize: iconVar.xs }} />
                        </IconButton>
                    </Tooltip>
                </Box>
                {showDebug && (
                    <Paper variant="outlined" sx={{ mt: 0.5, p: 1, borderRadius: 1, bgcolor: 'rgba(0,0,0,0.02)', maxHeight: 200, overflow: 'auto' }}>
                        <Typography component="pre" sx={{ fontFamily: CODE_FONT, fontSize: textVar.xxs, m: 0, whiteSpace: 'pre-wrap', color: 'text.secondary' }}>
                            {JSON.stringify(message, null, 2)}
                        </Typography>
                    </Paper>
                )}
            </Box>
        </Box>
    );
});

// ---------------------------------------------------------------------------
// Tool call label mapping
// ---------------------------------------------------------------------------

const TOOL_LABEL_KEYS: Record<string, string> = {
    read_file: 'dataLoading.toolLabels.readingFile',
    write_file: 'dataLoading.toolLabels.writingFile',
    list_directory: 'dataLoading.toolLabels.listingFiles',
    execute_python: 'dataLoading.toolLabels.runningPython',
    show_user_data_preview: 'dataLoading.toolLabels.preparingPreview',
    list_data: 'dataLoading.toolLabels.browsingCatalog',
    find_data: 'dataLoading.toolLabels.searchingData',
    describe_data: 'dataLoading.toolLabels.describingData',
    probe_data: 'dataLoading.toolLabels.probingData',
    propose_load_plan: 'dataLoading.toolLabels.proposingLoadPlan',
};

// Build a short, human-readable summary of a probe SPJQ query so the user
// can see what the agent is actually asking for (e.g. "sum(revenue) by region").
const summarizeProbeQuery = (q: any): string => {
    if (!q || typeof q !== 'object') return '';
    const parts: string[] = [];
    if (Array.isArray(q.aggregates) && q.aggregates.length) {
        parts.push(q.aggregates
            .map((a: any) => (a.op === 'count' && !a.column) ? 'count' : `${a.op}(${a.column ?? ''})`)
            .join(', '));
    }
    if (Array.isArray(q.group_by) && q.group_by.length) {
        parts.push(`by ${q.group_by.join(', ')}`);
    }
    if (Array.isArray(q.filters) && q.filters.length) {
        parts.push('where ' + q.filters
            .map((f: any) => formatFilterChipLabel(f.column, f.op ?? f.operator, f.value))
            .join(' & '));
    }
    if (q.limit) parts.push(`limit ${q.limit}`);
    return parts.join(' ');
};

const truncateDetail = (s: string, n = 72): string =>
    s.length > n ? `${s.slice(0, n - 1)}…` : s;

// Extract the key parameter(s) of a tool call as a compact string, shown next
// to the tool label so users can follow what each step is actually doing.
const summarizeToolArgs = (tool: string, args: any): string => {
    if (!args || typeof args !== 'object') return '';
    let detail = '';
    switch (tool) {
        case 'read_file':
        case 'write_file':
        case 'list_directory':
            detail = args.path ? String(args.path) : '';
            break;
        case 'list_data': {
            const pathStr = Array.isArray(args.path) ? args.path.join('/') : args.path;
            detail = [args.source_id, pathStr, args.filter && `“${args.filter}”`]
                .filter(Boolean).join(' / ');
            break;
        }
        case 'find_data': {
            const scope = args.scope && args.scope !== 'all' ? ` in ${args.scope}` : '';
            detail = args.query ? `“${args.query}”${scope}` : '';
            break;
        }
        case 'describe_data':
            detail = [args.source_id, args.table_key].filter(Boolean).join(' · ');
            break;
        case 'probe_data':
            detail = [args.table_key, summarizeProbeQuery(args.query)]
                .filter(Boolean).join(' · ');
            break;
        case 'show_user_data_preview':
            if (Array.isArray(args.saved_dfs) && args.saved_dfs.length) {
                detail = args.saved_dfs.join(', ');
            } else if (Array.isArray(args.tables) && args.tables.length) {
                detail = args.tables.map((tb: any) => tb?.name).filter(Boolean).join(', ');
            }
            break;
        case 'propose_load_plan':
            if (Array.isArray(args.options)) {
                detail = args.options
                    .flatMap((option: any) => option?.tables || [])
                    .map((table: any) => table?.table_key)
                    .filter(Boolean).join(', ');
            }
            break;
        case 'execute_python':
            // Code is rendered in its own block below — no inline detail.
            detail = '';
            break;
        default: {
            const firstStr = Object.values(args).find(
                (v) => typeof v === 'string' && v.length > 0,
            );
            detail = firstStr ? String(firstStr) : '';
        }
    }
    return detail ? truncateDetail(detail) : '';
};

// ---------------------------------------------------------------------------
// Streaming indicator — shows tool calls with shimmer + text
// ---------------------------------------------------------------------------

interface ToolStep {
    tool: string;
    status: 'running' | 'done';
    label: string;
    detail?: string;
}

// Memoized so an unrelated parent re-render (e.g. typing) doesn't
// reflow the shimmer animation. Props are state values that only change
// during an active stream.
const StreamingIndicator = React.memo<{ content: string; toolSteps: ToolStep[] }>(({ content, toolSteps }) => {
    const theme = useTheme();
    return (
        <Box sx={{ mb: 2 }}>
            {/* Tool call steps are rendered FIRST. Tool calls always
                happen before the agent's final text, so showing them
                above the text matches actual temporal order and avoids
                a confusing "text first, then checkmarks below" layout. */}
            {toolSteps.length > 0 && (
                <Box sx={{ mb: content ? 0.75 : 0.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    {toolSteps.map((step, i) => (
                        <Box key={i} sx={{
                            display: 'inline-flex', alignItems: 'center', gap: 0.75,
                            position: 'relative', overflow: 'hidden',
                            py: 0.25, pr: 1,
                            ...(step.status === 'running' ? {
                                '&::after': {
                                    content: '""', position: 'absolute',
                                    top: 0, left: 0, width: '100%', height: '100%',
                                    background: `linear-gradient(90deg, transparent 0%, ${alpha(theme.palette.primary.main, 0.06)} 50%, transparent 100%)`,
                                    animation: 'shimmer 2s ease-in-out infinite',
                                    pointerEvents: 'none',
                                },
                                '@keyframes shimmer': {
                                    '0%': { transform: 'translateX(-100%)' },
                                    '100%': { transform: 'translateX(100%)' },
                                },
                            } : {}),
                        }}>
                            {step.status === 'running' ? (
                                <CircularProgress size={10} thickness={5} sx={{ color: 'text.disabled' }} />
                            ) : (
                                <CheckCircleIcon sx={{ fontSize: iconVar.xs, color: 'success.main' }} />
                            )}
                            <Typography sx={{ fontSize: textVar.xs, color: 'text.secondary' }}>
                                {step.label}
                                {step.detail ? (
                                    <Box component="span" sx={{
                                        ml: 0.75,
                                        color: 'text.disabled',
                                        fontFamily: CODE_FONT,
                                        fontSize: textVar.xs,
                                    }}>
                                        {step.detail}
                                    </Box>
                                ) : null}
                            </Typography>
                        </Box>
                    ))}
                </Box>
            )}

            {content ? <MarkdownContent content={content} /> : null}

            {/* Bouncing dots when no tool is running and no text yet */}
            {toolSteps.every(s => s.status === 'done') && (
                <Box sx={{
                    display: 'inline-flex', gap: '3px', alignItems: 'center',
                    mt: (content || toolSteps.length > 0) ? 0.5 : 0,
                    '@keyframes blink': { '0%, 100%': { opacity: 0.3 }, '50%': { opacity: 1 } },
                }}>
                    {[0, 1, 2].map(i => (
                        <Box key={i} sx={{
                            width: 4, height: 4, borderRadius: '50%', bgcolor: 'text.disabled',
                            animation: 'blink 1.2s ease-in-out infinite',
                            animationDelay: `${i * 0.2}s`,
                        }} />
                    ))}
                </Box>
            )}
        </Box>
    );
});

// ---------------------------------------------------------------------------
// Main chat component
// ---------------------------------------------------------------------------

interface DataLoadingChatProps {
    /** Called after a table is successfully loaded into the app. The
     *  upload dialog wires this to its close handler so loading data
     *  returns the user to the canvas. */
    onTableLoaded?: () => void;
}

export const DataLoadingChat: React.FC<DataLoadingChatProps> = ({ onTableLoaded }) => {
    const theme = useTheme();
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();

    // Keep the latest callback in a ref so the stable `handleTableLoaded`
    // identity below doesn't bust `ChatBubble`'s memoization even when the
    // parent passes a fresh closure each render.
    const onTableLoadedRef = useRef(onTableLoaded);
    onTableLoadedRef.current = onTableLoaded;
    const handleTableLoaded = useCallback(() => {
        onTableLoadedRef.current?.();
    }, []);

    // "Continue from this section": move an older task section back to the end
    // so it becomes the active one, then focus the input. Non-destructive — the
    // whole thread is preserved; the top-pin effect scrolls the promoted
    // section into view once the reordered messages render.
    const handleContinueSection = useCallback((anchorId: string) => {
        dispatch(dfActions.promoteDataLoadingChatSection({ anchorId }));
        requestAnimationFrame(() => inputRef.current?.focus());
    }, [dispatch]);

    const chatMessages = useSelector((state: DataFormulatorState) => state.dataLoadingChatMessages);
    const chatInProgress = useSelector((state: DataFormulatorState) => state.dataLoadingChatInProgress);
    // External reset signal — bumped by `clearChatMessages` (manual
    // reset button, fresh menu submission, full session reset). Used
    // here only to abort an in-flight stream and invalidate any
    // late-arriving dispatches from that stream via `sessionRef`.
    const chatResetCounter = useSelector((state: DataFormulatorState) => state.dataLoadingChatResetCounter ?? 0);
    // Pending submission queued by an external surface (menu agent
    // box, suggestion auto-run, external dialog caller). When set, we
    // consume it in a useEffect: clear the slot first, then send the
    // carried payload as a fresh user message via `sendMessage`.
    // Single redux signal = no prop race.
    const pendingSubmission = useSelector((state: DataFormulatorState) => state.dataLoadingChatPending);
    const existingTables = useSelector(dfSelectors.getAllTables);
    const activeModel = useSelector(dfSelectors.getActiveModel);
    const frontendRowLimit = useSelector((state: DataFormulatorState) => state.config?.frontendRowLimit ?? 2_000_000);
    const workspaceReadOnly = useSelector((state: DataFormulatorState) => state.activeWorkspace?.readOnly === true);
    // Stable reference across renders that don't actually change the
    // table list — without this, every keystroke in the chat input
    // would rebuild the Set and bust `ChatBubble`'s memo equality.
    const existingNames = React.useMemo(
        () => new Set(existingTables.map(tbl => tbl.id)),
        [existingTables],
    );

    // ── Canvas ────────────────────────────────────────────────────
    // Long widgets render beside the conversation, not inside it. The split is
    // a plain flex row: the conversation flexes, the canvas keeps an explicit
    // width, and the drag handle only ever moves that one number.
    const [canvasWidget, setCanvasWidget] = useState<{ kind: CanvasKind; messageId: string } | null>(null);
    const [canvasWidth, setCanvasWidth] = useState<number>(LAYOUT.canvasWidth.connector);
    const splitContainerRef = useRef<HTMLDivElement>(null);
    const sizedForRef = useRef<string>('');

    /** Keeps the conversation above its minimum whatever the container size. */
    const clampCanvasWidth = useCallback((width: number) => {
        const total = splitContainerRef.current?.clientWidth ?? 0;
        const max = Math.max(LAYOUT.minCanvasWidth, total - LAYOUT.minChatWidth);
        return Math.round(Math.min(Math.max(width, LAYOUT.minCanvasWidth), max));
    }, []);

    const handleOpenCanvas = useCallback((kind: CanvasKind, messageId: string) => {
        setCanvasWidget(prev =>
            prev && prev.kind === kind && prev.messageId === messageId ? null : { kind, messageId });
    }, []);

    const startCanvasResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        const container = splitContainerRef.current;
        if (!container) return;
        const right = container.getBoundingClientRect().right;
        const handle = event.currentTarget;
        handle.setPointerCapture(event.pointerId);
        // Suppress selection while dragging — otherwise the drag selects chat text.
        const previousSelect = document.body.style.userSelect;
        document.body.style.userSelect = 'none';
        const onMove = (e: PointerEvent) => setCanvasWidth(clampCanvasWidth(right - e.clientX));
        const onUp = (e: PointerEvent) => {
            handle.releasePointerCapture(e.pointerId);
            document.body.style.userSelect = previousSelect;
            handle.removeEventListener('pointermove', onMove);
            handle.removeEventListener('pointerup', onUp);
        };
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
    }, [clampCanvasWidth]);

    // The active task section: everything after the last "new request" divider.
    // The canvas belongs to the task in progress, so both the auto-open scan and
    // the collapse-on-new-task rule are scoped to it.
    const activeSection = React.useMemo(() => {
        let start = 0;
        for (let i = chatMessages.length - 1; i >= 0; i--) {
            if (chatMessages[i].divider) { start = i; break; }
        }
        return { anchorId: chatMessages[start]?.id ?? '', items: chatMessages.slice(start) };
    }, [chatMessages]);

    // Starting (or promoting) a task collapses whatever the previous one left
    // open. Declared before the auto-open effect so a new task that proposes a
    // widget of its own still ends up showing it.
    useEffect(() => {
        setCanvasWidget(null);
    }, [activeSection.anchorId]);

    // Newest widget in the active task still waiting on the user — the canvas
    // follows it. Widgets that render inline never steal the canvas.
    const pendingWidget = React.useMemo(() => {
        for (let i = activeSection.items.length - 1; i >= 0; i--) {
            const msg = activeSection.items[i];
            if (msg.connectorForm && !isShortConnectorForm(msg.connectorForm)) {
                return { kind: 'connector' as CanvasKind, messageId: msg.id };
            }
            if (hasLoadPlan(msg) && !isLoadPlanComplete(msg)) {
                return { kind: 'loadPlan' as CanvasKind, messageId: msg.id };
            }
        }
        return null;
    }, [activeSection]);
    const pendingWidgetKey = pendingWidget ? `${pendingWidget.kind}:${pendingWidget.messageId}` : '';
    useEffect(() => {
        if (pendingWidget) setCanvasWidget(pendingWidget);
    }, [pendingWidgetKey]);

    const canvasMessage = React.useMemo(
        () => (canvasWidget ? chatMessages.find(m => m.id === canvasWidget.messageId) : undefined),
        [canvasWidget, chatMessages],
    );
    // Close if the widget's message disappears (chat reset / new session).
    useEffect(() => {
        if (canvasWidget && !canvasMessage) setCanvasWidget(null);
    }, [canvasWidget, canvasMessage]);

    // Size the canvas to what it hosts, once per widget kind. Drags in between
    // are the user's and are left alone.
    useEffect(() => {
        if (!canvasWidget || !canvasMessage) { sizedForRef.current = ''; return; }
        if (sizedForRef.current === canvasWidget.kind) return;
        sizedForRef.current = canvasWidget.kind;
        setCanvasWidth(clampCanvasWidth(canvasWidthFor(canvasWidget.kind, canvasMessage)));
    }, [canvasWidget, canvasMessage, clampCanvasWidth]);

    // A shrinking dialog must not push the conversation under its minimum.
    useEffect(() => {
        const container = splitContainerRef.current;
        if (!container || !canvasWidget) return;
        const observer = new ResizeObserver(() => setCanvasWidth(w => clampCanvasWidth(w)));
        observer.observe(container);
        return () => observer.disconnect();
    }, [canvasWidget, clampCanvasWidth]);

    // Connector loading strategy used by the unified canvas plan.
    const handleConfirmPlan = useCallback(async (
        messageId: string,
        selected: LoadPlanCandidate[],
    ) => {
        try {
            for (const item of selected) {
                const sourceTableName = item.sourceTableName || item.displayName;
                const table = {
                    kind: 'table' as const,
                    id: item.displayName,
                    displayId: item.displayName,
                    names: [] as string[],
                    metadata: {},
                    rows: [] as any[],
                    virtual: { tableId: item.displayName, rowCount: 0 },
                    description: '',
                    source: {
                        type: 'database' as const,
                        databaseTable: sourceTableName,
                        canRefresh: true,
                        lastRefreshed: Date.now(),
                        connectorId: item.sourceId,
                    },
                };
                // `.unwrap()` rethrows if the ingest thunk rejects, so a failed
                // load skips markLoadPlanConfirmed below — the plan stays
                // actionable instead of falsely showing "Loaded".
                await dispatch(loadTable({
                    table,
                    connectorId: item.sourceId,
                    sourceTableRef: { id: item.sourceTable, name: item.displayName },
                    importOptions: buildLoadQueryImportOptions(item),
                })).unwrap();
            }
        } catch (err: any) {
            console.error('Failed to load plan:', err);
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                type: 'error',
                component: 'data loader',
                value: `Failed to load data: ${err?.message || err}`,
            }));
            // Leave the plan unconfirmed so the user can retry.
            return false;
        }
        dispatch(dfActions.markLoadPlanConfirmed({ messageId }));
        return selected.length > 0;
    }, [dispatch]);

    const handleLoadPending = useCallback(async (messageId: string, pending: PendingTableLoad) => {
        const unique = getUniqueTableName(pending.name, existingNames);
        try {
            if (!pending.csvScratchPath) return false;
            const scratchUrl = `${getUrls().SCRATCH_BASE_URL}/${pending.csvScratchPath.replace(/^scratch\//, '')}`;
            const res = await fetchWithIdentity(scratchUrl);
            if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
            const csvText = await res.text();
            const table = createTableFromText(unique, csvText);
            if (!table) return false;
            await dispatch(loadTable({ table: { ...table, source: { type: 'extract' as const } } })).unwrap();
            dispatch(dfActions.confirmTableLoad({ messageId, tableName: pending.name }));
            return true;
        } catch (err: any) {
            console.error('Failed to load table:', err);
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                type: 'error',
                component: 'data loader',
                value: `Failed to load "${pending.name}": ${err?.message || err}`,
            }));
            return false;
        }
    }, [dispatch, existingNames]);

    const handleConfirmPresentedPlan = useCallback(async (
        messageId: string,
        selected: PresentedLoadCandidate[],
        opts?: { newWorkspace?: boolean },
    ) => {
        if (opts?.newWorkspace) {
            const first = selected[0];
            const displayName = first?.kind === 'connector'
                ? first.candidate.displayName
                : first?.candidate.name;
            dispatch(dfActions.resetForNewWorkspace({
                id: newWorkspaceSessionId(),
                displayName: displayName || 'Untitled Session',
            }));
        }

        const connectors = selected.flatMap(item =>
            item.kind === 'connector' ? [item.candidate] : []
        );
        const scratch = selected.flatMap(item =>
            item.kind === 'scratch' ? [item.candidate] : []
        );
        let loadedAny = connectors.length > 0
            ? await handleConfirmPlan(messageId, connectors)
            : false;
        for (const pending of scratch) {
            loadedAny = await handleLoadPending(messageId, pending) || loadedAny;
        }
        if (loadedAny) handleTableLoaded();
    }, [dispatch, handleConfirmPlan, handleLoadPending, handleTableLoaded]);

    // Group the flat message list into task "sections" split on the "new
    // request" dividers. Each section is anchored by the id of its first
    // message (the divider for tasks after the first, else the opening bubble).
    // The last section is the active one; older sections can be promoted back
    // to latest via their "Continue from this section" button.
    const sections = React.useMemo(() => {
        const result: { anchorId: string; dividerId: string | null; items: ChatMessage[] }[] = [];
        let current: { anchorId: string; dividerId: string | null; items: ChatMessage[] } | null = null;
        for (const msg of chatMessages) {
            if (msg.divider) {
                current = { anchorId: msg.id, dividerId: msg.id, items: [] };
                result.push(current);
            } else {
                if (!current) {
                    current = { anchorId: msg.id, dividerId: null, items: [] };
                    result.push(current);
                }
                current.items.push(msg);
            }
        }
        return result;
    }, [chatMessages]);

    const [prompt, setPrompt] = useState('');
    const [userImages, setUserImages] = useState<string[]>([]);
    const [userAttachments, setUserAttachments] = useState<string[]>([]);
    const [streamingContent, setStreamingContent] = useState('');
    const [streamingToolSteps, setStreamingToolSteps] = useState<ToolStep[]>([]);
    const [debugEvents, setDebugEvents] = useState<any[]>([]);
    const [showDebugPanel] = useState(false);
    const abortControllerRef = useRef<AbortController | null>(null);
    // Monotonic session token. Bumped on every external reset; the
    // currently-running `sendMessage` captures the value at the time
    // it started and discards any state/dispatch updates if the token
    // has moved on (i.e. the user reset / restarted the chat mid-stream).
    const sessionRef = useRef(0);
    const lastResetRef = useRef(chatResetCounter);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    // The scrollable messages viewport and its inner content. Load-plan rows
    // reserve a stable spinner area while fetching, then resize once to the
    // result's natural height (compact for short tables; five preview rows plus
    // a count caption when truncated). Track whether the view is "pinned" so
    // that resize follows the bottom without yanking users who scrolled up.
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const messagesContentRef = useRef<HTMLDivElement>(null);
    const pinnedToBottomRef = useRef(true);
    // Refs for the "scroll new section to top" behaviour. When a task section
    // becomes the active (latest) one — either a fresh request or an older
    // section promoted back via "Continue from this section" — we align its top
    // with the viewport top and let the answer stream downward, ChatGPT-style.
    // A bottom spacer reserves just enough space so a short section can still
    // reach the top; it's sized imperatively (no React state churn per frame).
    const latestSectionRef = useRef<HTMLDivElement>(null);
    const bottomSpacerRef = useRef<HTMLDivElement>(null);
    const latestHasDividerRef = useRef(false);
    const lastPinnedAnchorRef = useRef<string | null>(null);
    const TOP_GAP = 8;

    // Keep the "does the latest section start with a divider" flag in sync so
    // the imperative spacer/scroll helpers (invoked from observers) never read
    // stale section state.
    const latestSection = sections[sections.length - 1];
    latestHasDividerRef.current = !!latestSection?.dividerId;

    const { moreAbove, moreBelow, update: updateScrollFade } = useScrollFade(scrollContainerRef, chatMessages.length);

    const scrollToBottom = () => {
        const el = scrollContainerRef.current;
        if (!el) return;
        // Keep follow-mode synchronous. Smooth scrolling emits intermediate
        // positions that can look user-initiated and incorrectly clear the
        // pinned state while other dynamic content is still settling.
        el.scrollTop = el.scrollHeight;
    };
    // Size the bottom spacer so the active section can sit flush against the
    // top of the viewport (spacer = viewport height − section height). Only
    // sections that begin with a divider get a spacer; the very first task
    // keeps the original bottom-follow behaviour and needs none.
    const syncBottomSpacer = () => {
        const scrollEl = scrollContainerRef.current;
        const spacerEl = bottomSpacerRef.current;
        if (!scrollEl || !spacerEl) return;
        if (!latestHasDividerRef.current) { spacerEl.style.height = '0px'; return; }
        const secEl = latestSectionRef.current;
        if (!secEl) { spacerEl.style.height = '0px'; return; }
        const h = Math.max(0, scrollEl.clientHeight - secEl.offsetHeight - TOP_GAP);
        spacerEl.style.height = `${h}px`;
    };
    const scrollLatestSectionToTop = () => {
        const scrollEl = scrollContainerRef.current;
        const secEl = latestSectionRef.current;
        if (!scrollEl || !secEl) return;
        const delta = secEl.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top - TOP_GAP;
        scrollEl.scrollTop += delta;
    };
    const updatePinned = () => {
        const el = scrollContainerRef.current;
        if (!el) return;
        // Treat "within 80px of the bottom" as pinned so a slightly-short
        // scroll still counts and content growth keeps following.
        pinnedToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        updateScrollFade();
    };

    // Auto-scroll to bottom on new messages / streaming text — but only when
    // the user is pinned to the bottom.
    useEffect(() => {
        if (pinnedToBottomRef.current) scrollToBottom();
    }, [chatMessages, streamingContent]);

    // When a section with a divider becomes the active one, pin its top to the
    // viewport top instead of following the bottom. Keyed on the latest
    // section's anchor id so it fires once per new/promoted section (not on
    // every streaming delta), and skips the opening (divider-less) task.
    useLayoutEffect(() => {
        const latest = sections[sections.length - 1];
        if (!latest || !latest.dividerId) {
            lastPinnedAnchorRef.current = latest?.anchorId ?? null;
            return;
        }
        if (lastPinnedAnchorRef.current === latest.anchorId) return;
        lastPinnedAnchorRef.current = latest.anchorId;
        pinnedToBottomRef.current = false;
        syncBottomSpacer();
        scrollLatestSectionToTop();
        // A second pass after paint catches async height (markdown, previews).
        const id = requestAnimationFrame(() => {
            syncBottomSpacer();
            scrollLatestSectionToTop();
        });
        return () => cancelAnimationFrame(id);
    }, [sections]);


    // On mount (this component remounts each time the chat surface opens),
    // jump straight to the latest message with no animation so landing on an
    // existing conversation starts at the bottom.
    useLayoutEffect(() => {
        pinnedToBottomRef.current = true;
        scrollToBottom();
        // A second pass after paint catches content that measures its height
        // asynchronously (markdown, table previews).
        const id = requestAnimationFrame(() => {
            if (pinnedToBottomRef.current) scrollToBottom();
        });
        return () => cancelAnimationFrame(id);
    }, []);

    // Follow content that changes size AFTER paint: load-plan previews settling
    // from their fixed loading slot to natural result height, uploaded images,
    // and inline extraction tables. The synchronous scroll avoids a smooth-
    // scroll race, and the pinned guard preserves deliberate upward scrolling.
    // Also re-sizes the top-pin spacer so a growing active section stays flush
    // against the viewport top.
    useEffect(() => {
        const content = messagesContentRef.current;
        const scrollEl = scrollContainerRef.current;
        if (!content || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(() => {
            syncBottomSpacer();
            if (pinnedToBottomRef.current) scrollToBottom();
        });
        ro.observe(content);
        if (scrollEl) ro.observe(scrollEl);
        return () => ro.disconnect();
    }, []);

    // Auto-focus input
    useEffect(() => { inputRef.current?.focus(); }, []);

    // ---- Reset handling -------------------------------------------------
    // On external reset (counter bump from `clearChatMessages`): abort
    // any in-flight stream, invalidate the current session token, and
    // clear local input/streaming UI state. We deliberately do NOT
    // re-seed anything here — a reset means "clean slate"; any new
    // submission arrives separately via `pendingSubmission`.
    useEffect(() => {
        if (chatResetCounter === lastResetRef.current) return;
        lastResetRef.current = chatResetCounter;
        sessionRef.current += 1;
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        setStreamingContent('');
        setStreamingToolSteps([]);
        setPrompt('');
        setUserImages([]);
        setUserAttachments([]);
    }, [chatResetCounter]);

    const stopGeneration = () => { abortControllerRef.current?.abort(); };

    // ---- Send message ----
    // Accepts an optional explicit payload so callers (suggestion
    // auto-run, pending-submission consume) can submit the exact
    // values they just chose without waiting for React state to flush.
    // Reading via the `prompt`/`userImages`/`userAttachments` closures
    // alone would be racy with batching and could submit the previous
    // round's values on a fresh handoff.
    const sendMessage = useCallback((explicit?: { text: string; images: string[]; attachments: string[]; hidden?: boolean }) => {
        const text = (explicit?.text ?? prompt).trim();
        const imgs = explicit?.images ?? userImages;
        const atts = explicit?.attachments ?? userAttachments;
        if (!text && imgs.length === 0 && atts.length === 0) return;
        if (chatInProgress) return;
        // A hidden trigger (e.g. a post-connect continuation) is sent to the
        // agent as context but never rendered as a user bubble, and it must
        // not disturb whatever the user may be typing in the input box.
        const hidden = explicit?.hidden ?? false;
        const imageAttachments: ChatAttachment[] = imgs.map((url, i) => ({
            type: 'image' as const, name: `image-${i + 1}`, url,
        }));
        const fileAttachments: ChatAttachment[] = atts.map(name => ({
            type: 'file' as const, name,
        }));
        const attachments: ChatAttachment[] = [...imageAttachments, ...fileAttachments];

        // The visible bubble keeps the user's original text plus file
        // chips (rendered from `attachments`). The agent payload below
        // re-injects `[Uploaded: name]` mentions so the backend still
        // sees the file references inline.
        const displayText = text || (imgs.length > 0 ? t('dataLoading.defaultImageMessage') : '');

        const userMsg: ChatMessage = {
            id: `msg-${Date.now()}-user`, role: 'user',
            content: displayText,
            attachments: attachments.length > 0 ? attachments : undefined,
            hidden: hidden || undefined,
            timestamp: Date.now(),
        };

        // Capture the session token at send-time so that, if the user
        // resets the chat mid-stream, post-await dispatches below can
        // detect they are stale and bail without polluting the fresh
        // (now-cleared) thread.
        const mySession = sessionRef.current;
        const isCurrent = () => mySession === sessionRef.current;

        dispatch(dfActions.addChatMessage(userMsg));
        dispatch(dfActions.setDataLoadingChatInProgress(true));
        if (!hidden) {
            setPrompt('');
            setUserImages([]);
            setUserAttachments([]);
        }
        setStreamingContent('');
        setStreamingToolSteps([]);

        const allMessages = [...chatMessages, userMsg].filter(m => !m.divider).map(m => {
            // Re-hydrate `[Uploaded: name]` mentions from file attachments
            // so the backend still sees them as text references, while
            // the chat UI shows clean text + chips.
            const fileNames = (m.attachments || [])
                .filter(a => a.type === 'file' || a.type === 'text_file')
                .map(a => a.name);
            const mentions = fileNames.map(name => t('dataLoading.uploaded', { name })).join('\n');
            const augmented = mentions
                ? (m.content ? `${m.content}\n${mentions}` : mentions)
                : m.content;
            return { role: m.role, content: augmented, attachments: m.attachments };
        });

        const controller = new AbortController();
        abortControllerRef.current = controller;

        (async () => {
            try {
                let fullText = '';
                const codeBlocks: CodeExecution[] = [];
                const tables: InlineTablePreview[] = [];
                const pendingLoads: PendingTableLoad[] = [];
                let loadPlanRef: LoadPlan | undefined;
                let dataOperationRef: DataOperation | undefined;
                let connectorFormRef: ConnectorFormPrompt | undefined;
                const rawEvents: any[] = [];
                let streamingToolStepsRef: ToolStep[] = [];
                let continueOffered = false;

            // Helper: process action objects (used in both tool_result and actions events)
            const processActions = (actionList: any[]) => {
                for (const action of actionList) {
                    console.log('[DataLoadingChat] processing action:', action.type, action.name);
                    if (action.type === 'preview_table') {
                        const preview: InlineTablePreview = {
                            name: action.name,
                            columns: action.columns || [],
                            sampleRows: action.sample_rows || [],
                            totalRows: action.total_rows || 0,
                            csvScratchPath: action.csv_scratch_path,
                        };
                        tables.push(preview);
                        pendingLoads.push({
                            name: action.name,
                            csvScratchPath: action.csv_scratch_path || '',
                            preview, confirmed: false,
                        });
                    } else if (action.type === 'load_plan') {
                        const parseCandidate = (c: any): LoadPlanCandidate => ({
                            sourceId: c.source_id,
                            tableKey: c.table_key,
                            displayName: c.display_name,
                            sourceTable: c.source_table,
                            sourceTableName: c.source_table_name,
                            query: c.query ? {
                                filters: c.query.filters,
                                columns: c.query.columns,
                                orderBy: c.query.order_by?.map((item: any) => ({
                                    column: item.column,
                                    direction: item.dir || 'asc',
                                })),
                                limit: c.query.limit,
                            } : undefined,
                            resolutionError: c.resolution_error,
                        });
                        loadPlanRef = {
                            response: action.response || '',
                            options: (action.options || []).map((option: any) => ({
                                label: option.label,
                                tables: (option.tables || []).map(parseCandidate),
                            })),
                        };
                    } else if (action.type === 'data_operation') {
                        dataOperationRef = parseDataOperation(action.operation);
                    } else if (action.type === 'connect_form') {
                        connectorFormRef = {
                            sourceType: action.source_type,
                            prefilled: action.prefilled || undefined,
                            status: 'pending',
                        };
                    }
                }
            };

            for await (const event of streamRequest(getUrls().DATA_LOADING_CHAT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: activeModel,
                    messages: allMessages,
                    workspace_tables: existingTables.map(tbl => tbl.id),
                    row_limit: frontendRowLimit,
                }),
            }, controller.signal)) {
                // If a reset has happened while we were awaiting, drop
                // all further events on the floor. We avoid `break` so
                // the underlying iterator gets a chance to clean up.
                if (!isCurrent()) continue;
                // Log all events for debug panel
                if (event.type !== 'text_delta') {
                    rawEvents.push(event);
                    setDebugEvents([...rawEvents]);
                }
                switch (event.type) {
                    case 'text_delta':
                        fullText += (event as any).content;
                        setStreamingContent(fullText);
                        break;
                    case 'tool_start': {
                        const label = TOOL_LABEL_KEYS[(event as any).tool] ? t(TOOL_LABEL_KEYS[(event as any).tool]) : (event as any).tool;
                        const detail = summarizeToolArgs((event as any).tool, (event as any).args);
                        const newSteps = [...streamingToolStepsRef];
                        newSteps.push({ tool: (event as any).tool, status: 'running', label, detail });
                        streamingToolStepsRef = newSteps;
                        setStreamingToolSteps(newSteps);
                        if ((event as any).tool === 'execute_python' && (event as any).code) {
                            codeBlocks.push({ code: (event as any).code });
                        }
                        break;
                    }
                    case 'tool_result': {
                        // Mark the tool as done
                        const updatedSteps = streamingToolStepsRef.map(s =>
                            s.tool === (event as any).tool && s.status === 'running'
                                ? { ...s, status: 'done' as const } : s
                        );
                        streamingToolStepsRef = updatedSteps;
                        setStreamingToolSteps(updatedSteps);
                        if ((event as any).tool === 'execute_python' && codeBlocks.length > 0) {
                            const last = codeBlocks[codeBlocks.length - 1];
                            last.stdout = (event as any).stdout || '';
                            last.error = (event as any).error || undefined;
                            if ((event as any).table) last.resultTable = (event as any).table;
                        }
                        // Also capture actions from tool_result (e.g. show_user_data_preview)
                        if ((event as any).actions) {
                            console.log('[DataLoadingChat] actions from tool_result:', (event as any).tool, (event as any).actions.length);
                            processActions((event as any).actions);
                        }
                        break;
                    }
                    case 'actions':
                        // Only process if we haven't already captured from tool_result
                        if (pendingLoads.length === 0) {
                            console.log('[DataLoadingChat] actions event:', ((event as any).actions || []).length, 'actions');
                            processActions((event as any).actions || []);
                        }
                        break;
                    case 'done':
                        fullText = (event as any).full_text || fullText;
                        break;
                    case 'continue_prompt':
                        continueOffered = true;
                        break;
                    case 'error':
                        fullText += `\n\n**${t('dataLoading.error')}:** ${event.error?.message || t('dataLoading.error')}`;
                        break;
                }
            }

            // Stream finished. If a reset happened in the meantime, don't
            // commit a final assistant message into the new thread.
            if (!isCurrent()) return;

            const assistantMsg: ChatMessage = {
                id: `msg-${Date.now()}-assistant`, role: 'assistant',
                content: loadPlanRef?.response || fullText,
                codeBlocks: codeBlocks.length > 0 ? codeBlocks : undefined,
                tables: tables.length > 0 && pendingLoads.length === 0 ? tables : undefined,
                pendingLoads: pendingLoads.length > 0 ? pendingLoads : undefined,
                loadPlan: loadPlanRef,
                dataOperation: dataOperationRef,
                connectorForm: connectorFormRef,
                canContinue: continueOffered || undefined,
                timestamp: Date.now(),
            };
            dispatch(dfActions.addChatMessage(assistantMsg));
            setStreamingContent('');
            setStreamingToolSteps([]);
            } catch (error: any) {
                // A reset (which calls controller.abort()) will trigger
                // AbortError here. Discard everything in that case — the
                // user wants a fresh thread, not the dying gasps of the
                // previous one.
                if (!isCurrent()) return;
                const partialContent = streamingContent;
                if (error.name === 'AbortError') {
                    if (partialContent) {
                        dispatch(dfActions.addChatMessage({
                            id: `msg-${Date.now()}-assistant`, role: 'assistant',
                            content: partialContent + `\n\n*${t('dataLoading.stopped')}*`,
                            timestamp: Date.now(),
                        }));
                    }
                } else {
                    dispatch(dfActions.addChatMessage({
                        id: `msg-${Date.now()}-assistant`, role: 'assistant',
                        content: partialContent
                            ? partialContent + `\n\n**${t('dataLoading.error')}:** ${error.message}`
                            : `**${t('dataLoading.error')}:** ${error.message}`,
                        timestamp: Date.now(),
                    }));
                }
                setStreamingContent('');
                setStreamingToolSteps([]);
            } finally {
                // Only clear the in-progress flag if we still own the
                // session. The reset reducer already cleared it; a stale
                // dispatch here would flip it back to false after a
                // legitimate new stream had set it true.
                if (isCurrent()) {
                    dispatch(dfActions.setDataLoadingChatInProgress(false));
                }
                if (abortControllerRef.current === controller) {
                    abortControllerRef.current = null;
                }
            }
        })();
    }, [prompt, userImages, userAttachments, chatInProgress, chatMessages, activeModel, existingTables, dispatch, streamingContent, t]);

    // Consume a queued submission from any external surface (menu
    // agent input, suggestion auto-run, or a cross-component handoff
    // routed through `startDataLoadingChat`). Single redux signal,
    // single consumer — no prop race.
    //
    // Idempotency note: under React.StrictMode (dev), effects are
    // intentionally double-invoked on mount with the *same* closure,
    // so the `clearDataLoadingChatPending` dispatch in the first run
    // isn't visible to the second run. `lastConsumedRef` tracks the
    // exact payload object we've already sent, so the second
    // invocation short-circuits before calling `sendMessage` again.
    const lastConsumedRef = useRef<typeof pendingSubmission>(null);
    useEffect(() => {
        if (!pendingSubmission) return;
        if (pendingSubmission === lastConsumedRef.current) return;
        if (chatInProgress) return;
        lastConsumedRef.current = pendingSubmission;
        const payload = pendingSubmission;
        dispatch(dfActions.clearDataLoadingChatPending());
        sendMessage(payload);
    }, [pendingSubmission, chatInProgress, sendMessage, dispatch]);

    // Reuse the shared sample-task list so this in-session panel stays in
    // sync with the upload-dialog entry point (`UnifiedDataUploadDialog`).
    // Auto-run is wired through the redux pending slot so the click —
    // even on a chat with prior history — preserves the thread, appends a
    // "new request" divider, and queues the new submission.
    const focusSuggestions = React.useMemo(() => buildDataLoadingSuggestions({
        t,
        setInput: setPrompt,
        setImages: setUserImages,
        setAttachments: setUserAttachments,
        requestAutoSend: (payload) => {
            // Preserve prior history (Option A): a sample-task click on a chat
            // with existing messages appends a "new request" divider and queues
            // the submission rather than wiping the thread.
            dispatch(dfActions.queueDataLoadingTask(payload));
        },
    }), [t, dispatch]);

    const quickActions = React.useMemo(() => buildDataLoadingQuickActions({
        t,
        setInput: setPrompt,
        setImages: setUserImages,
        setAttachments: setUserAttachments,
        requestAutoSend: (payload) => {
            dispatch(dfActions.queueDataLoadingTask(payload));
        },
    }), [t, dispatch]);

    const isEmpty = chatMessages.length === 0 && !streamingContent;

    const capabilities = [
        { icon: <QuestionAnswerOutlinedIcon sx={{ fontSize: iconVar.sm }} />, text: t('dataLoading.capabilityAsk') },
        { icon: <SearchIcon sx={{ fontSize: iconVar.sm }} />, text: t('dataLoading.capabilitySearch') },
        { icon: <ImageOutlinedIcon sx={{ fontSize: iconVar.sm }} />, text: t('dataLoading.capabilityExtractImage') },
        { icon: <DescriptionOutlinedIcon sx={{ fontSize: iconVar.sm }} />, text: t('dataLoading.capabilityExtractFile') },
    ];

    return (
        <Box
            ref={splitContainerRef}
            sx={{ display: 'flex', height: '100%', minHeight: 0, width: '100%', overflow: 'hidden' }}
        >
        <Box sx={{
            display: 'flex', flexDirection: 'column',
            flex: 1, height: '100%', minHeight: 0, minWidth: 0, overflow: 'hidden',
        }}>
            {/* ── Messages area ─────────────────────────────────── */}
            <Box sx={{ position: 'relative', flex: 1, minHeight: 0, minWidth: 0, display: 'flex' }}>
            <Box
                ref={scrollContainerRef}
                onScroll={updatePinned}
                tabIndex={0}
                role="region"
                aria-label={t('dataLoading.title')}
                sx={{
                    flex: 1, minHeight: 0, minWidth: 0,
                    // Plain block, not a flex column: a flex line sizes itself to
                    // its widest item, which would let one wide message stretch
                    // the conversation past its pane. Capped and centred with
                    // auto margins instead, so it always fits and never scrolls
                    // sideways.
                    display: 'block',
                    overflowY: 'auto', overflowX: 'hidden',
                }}
            >
              <Box
                ref={messagesContentRef}
                sx={{
                    width: '100%', minWidth: 0, maxWidth: LAYOUT.readingWidth, mx: 'auto',
                    px: LAYOUT.gutter, py: 2,
                    boxSizing: 'border-box',
                    display: 'flex', flexDirection: 'column',
                    ...(isEmpty ? { minHeight: '100%', justifyContent: 'center', alignItems: 'center' } : {}),
                }}
              >
                {isEmpty ? (
                    <Box sx={{ maxWidth: 520, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <Typography sx={{ fontSize: textVar.lg, fontWeight: 600, mb: 0.5, textAlign: 'center' }}>
                            {t('dataLoading.title')}
                        </Typography>
                        <Typography sx={{ fontSize: textVar.sm, color: 'text.secondary', lineHeight: 1.5, textAlign: 'center', mb: 1.5 }}>
                            {t('dataLoading.subtitle')}
                        </Typography>
                        <Box component="ul" sx={{
                            listStyle: 'none', p: 0, m: 0, mb: 1,
                            display: 'flex', flexDirection: 'column', gap: 0.25,
                        }}>
                            {capabilities.map((cap, i) => (
                                <Box component="li" key={i} sx={{
                                    display: 'flex', alignItems: 'center', gap: 0.75,
                                }}>
                                    <Box sx={{
                                        flexShrink: 0, color: 'text.disabled',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    }}>
                                        {cap.icon}
                                    </Box>
                                    <Typography sx={{ fontSize: textVar.sm, color: 'text.secondary', lineHeight: 1.5 }}>
                                        {cap.text}
                                    </Typography>
                                </Box>
                            ))}
                        </Box>
                        <Typography sx={{ fontSize: textVar.xs, color: 'text.disabled', textAlign: 'center', fontStyle: 'italic', mt: 0.5 }}>
                            {t('dataLoading.capabilityHint')}
                        </Typography>
                    </Box>
                ) : (
                    <>
                        {sections.map((section, idx) => {
                            const isLatest = idx === sections.length - 1;
                            const bubbles = section.items.map((msg) => (
                                msg.hidden
                                    ? null
                                    : <ChatBubble
                                        key={msg.id}
                                        message={msg}
                                        onOpenCanvas={handleOpenCanvas}
                                        canvasMessageId={canvasWidget?.messageId}
                                        onContinue={() => sendMessage({ text: 'Please continue.', images: [], attachments: [] })}
                                    />
                            ));
                            if (isLatest) {
                                // Active section: wrapped so its height/top can be
                                // measured for the "scroll to top" behaviour. Only
                                // this section shows its "New request" boundary.
                                return (
                                    <Box
                                        key={section.anchorId}
                                        ref={latestSectionRef}
                                        sx={{ display: 'flex', flexDirection: 'column' }}
                                    >
                                        {section.dividerId && <TaskDivider />}
                                        {bubbles}
                                        {streamingContent !== '' && <StreamingIndicator content={streamingContent} toolSteps={streamingToolSteps} />}
                                        {chatInProgress && !streamingContent && <StreamingIndicator content="" toolSteps={streamingToolSteps} />}
                                    </Box>
                                );
                            }
                            // Older section: no divider; a "Continue from this
                            // section" button marks the boundary and promotes it.
                            const hasVisible = section.items.some((m) => !m.hidden);
                            return (
                                <React.Fragment key={section.anchorId}>
                                    {bubbles}
                                    {hasVisible && (
                                        <ContinueSectionButton onClick={() => handleContinueSection(section.anchorId)} />
                                    )}
                                </React.Fragment>
                            );
                        })}
                        <div ref={bottomSpacerRef} style={{ flexShrink: 0 }} />
                        <div ref={messagesEndRef} />
                    </>
                )}
              </Box>
            </Box>
            <ScrollFadeEdge visible={moreAbove} edge="top" />
            <ScrollFadeEdge visible={moreBelow} />
            </Box>

            {/* ── Input area ─────────────────────────────────────── */}
            <Box sx={{ minWidth: 0, px: LAYOUT.gutter, pb: 1.5, pt: 0.75 }}>
                <Box sx={{ width: '100%', minWidth: 0, maxWidth: LAYOUT.readingWidth, mx: 'auto' }}>
                    {isEmpty && quickActions.length > 0 && (
                        <Box sx={{ mb: 1, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.75, rowGap: 0.75 }}>
                            {quickActions.map((qa) => (
                                <Chip
                                    key={qa.kind}
                                    icon={<BoltOutlinedIcon />}
                                    label={qa.label}
                                    onClick={qa.onClick}
                                    disabled={workspaceReadOnly}
                                    variant="outlined"
                                    size="small"
                                    sx={{
                                        fontSize: textVar.xs, height: 26, borderRadius: 2,
                                        color: 'text.secondary',
                                        borderColor: alpha(theme.palette.text.primary, 0.12),
                                        '& .MuiChip-icon': { fontSize: textVar.lg, ml: 0.5, color: 'text.disabled' },
                                        '&:hover': {
                                            bgcolor: 'action.hover',
                                            borderColor: alpha(theme.palette.text.primary, 0.2),
                                        },
                                    }}
                                />
                            ))}
                        </Box>
                    )}
                    <AgentChatInput
                        value={prompt}
                        onChange={setPrompt}
                        images={userImages}
                        onImagesChange={setUserImages}
                        onSend={() => sendMessage()}
                        onStop={stopGeneration}
                        inProgress={chatInProgress}
                        disabled={workspaceReadOnly}
                        placeholder={t('dataLoading.placeholder')}
                        autoFocus
                        inputRef={inputRef}
                        onNonImageFile={(file) => {
                            const formData = new FormData();
                            formData.append('file', file);
                            apiRequest(getUrls().SCRATCH_UPLOAD_URL, {
                                method: 'POST', body: formData,
                            }).then(({ data }) => {
                                // The backend hash-suffixes the filename
                                // (e.g. `name_a1b2c3d4.xlsx`). Store the
                                // server-assigned name so the `[Uploaded:]`
                                // mention points to the real scratch file.
                                const scratchName = (data?.path || `scratch/${file.name}`).replace(/^scratch\//, '');
                                setUserAttachments(prev => [...prev, scratchName]);
                            }).catch(err => console.error('Upload failed:', err));
                        }}
                        attachments={userAttachments}
                        onAttachmentsChange={setUserAttachments}
                        focusSuggestions={isEmpty ? focusSuggestions : undefined}
                        focusSuggestionsLabel={t('dataLoading.sectionTry')}
                        focusSuggestionsPlacement="top"
                    />
                    <Typography sx={{ fontSize: textVar.xxs, color: 'text.disabled', textAlign: 'center', mt: 0.5 }}>
                        {t('dataLoading.shiftEnterHint')}
                    </Typography>
                </Box>
            </Box>
        </Box>

        {/* ── Canvas ─────────────────────────────────────────────
            Holds the long interaction widgets the agent proposes (connection
            form, multi-table loading plan) so the conversation stays prose.
            Resizable, and sized on open to what the widget needs. */}
        {canvasWidget && canvasMessage && (
            <Box sx={{
                width: canvasWidth, flexShrink: 0,
                height: '100%', minHeight: 0,
                boxSizing: 'border-box', py: 1, pr: 1, ml: 1.5,
                position: 'relative',
            }}>
                <Box sx={{
                    height: '100%', minHeight: 0, minWidth: 0,
                    display: 'flex', flexDirection: 'column',
                    // Same surface as the visualization pane.
                    border: `1px solid ${borderColor.view}`,
                    borderRadius: radius.pill,
                    overflow: 'hidden',
                    boxSizing: 'border-box',
                    bgcolor: 'background.paper',
                }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0, px: 2, py: 1 }}>
                        <Typography sx={{ fontSize: textVar.md, fontWeight: 600, flex: 1, minWidth: 0 }} noWrap>
                            {canvasWidget.kind === 'connector'
                                ? t('dataLoading.canvasConnection', { defaultValue: 'Connection setup' })
                                : t('dataLoading.canvasLoadPlan', { defaultValue: 'Table loading plan' })}
                        </Typography>
                        <Tooltip title={t('dataLoading.canvasClose', { defaultValue: 'Close' })}>
                            <IconButton size="small" onClick={() => setCanvasWidget(null)}>
                                <CloseIcon sx={{ fontSize: iconVar.md }} />
                            </IconButton>
                        </Tooltip>
                    </Box>
                    <Box sx={{
                        flex: 1, minHeight: 0, minWidth: 0, px: 2, pb: 1.5,
                        // The plan scrolls itself (its actions stay pinned); the
                        // form is a plain document. Never two scrollers deep.
                        ...(canvasWidget.kind === 'loadPlan'
                            // Its scrollbar sits near the edge; the list keeps
                            // its own inset so the tables stay clear of it.
                            ? { overflow: 'hidden', display: 'flex', pr: 1 }
                            : { overflowY: 'auto', overflowX: 'hidden' }),
                    }}>
                        {canvasWidget.kind === 'connector' && canvasMessage.connectorForm && (
                            <ConnectorFormCard
                                messageId={canvasMessage.id}
                                prompt={canvasMessage.connectorForm}
                                variant="bare"
                            />
                        )}
                        {canvasWidget.kind === 'loadPlan' && hasLoadPlan(canvasMessage) && (
                            <LoadPlanCard
                                key={canvasMessage.id}
                                plan={canvasMessage.loadPlan}
                                pendingLoads={canvasMessage.pendingLoads}
                                connectorConfirmed={canvasMessage.loadPlan?.confirmed === true}
                                canLoadInNewWorkspace={existingNames.size > 0}
                                onConfirm={(selected, opts) => handleConfirmPresentedPlan(canvasMessage.id, selected, opts)}
                            />
                        )}
                    </Box>
                </Box>
                {/* Wide hit target centered on the panel border. The border is
                    the sash; a compact midpoint grip makes resizing discoverable. */}
                <Box
                    onPointerDown={startCanvasResize}
                    sx={{
                        position: 'absolute', zIndex: 2,
                        // 8px wrapper inset + 16px panel radius: keep the sash
                        // entirely on the straight border between the corners.
                        top: 24, bottom: 24, left: -6, width: 12,
                        cursor: 'col-resize', touchAction: 'none',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        '&::before': {
                            content: '""', position: 'absolute',
                            top: 0, bottom: 0, left: '50%', width: 2,
                            transform: 'translateX(-50%)',
                            bgcolor: 'transparent',
                        },
                        '&:hover::before, &:active::before': { bgcolor: 'primary.main' },
                        '&:hover .canvas-resize-grip, &:active .canvas-resize-grip': {
                            borderColor: 'primary.main', color: 'primary.main',
                        },
                    }}
                >
                    <Box className="canvas-resize-grip" sx={{
                        position: 'relative', zIndex: 1,
                        width: 10, height: 24,
                        display: 'grid', gridTemplateColumns: 'repeat(2, 2px)',
                        gridAutoRows: '2px', placeContent: 'center', gap: '3px',
                        bgcolor: 'background.paper',
                        color: 'text.disabled',
                        transition: transition.fast,
                    }}>
                        {[0, 1, 2, 3, 4, 5].map(index => (
                            <Box key={index} sx={{ width: 2, height: 2, bgcolor: 'currentColor', borderRadius: '50%' }} />
                        ))}
                    </Box>
                </Box>
            </Box>
        )}
        </Box>
    );
};
