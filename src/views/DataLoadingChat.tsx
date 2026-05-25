// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as React from 'react';
import { useEffect, useRef, useState, useCallback } from 'react';
import Markdown from 'react-markdown';

import {
    Box, Button, Chip, CircularProgress, IconButton,
    Paper, Stack, Tooltip, Typography,
    alpha, useTheme, Collapse,
} from '@mui/material';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CheckIcon from '@mui/icons-material/Check';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import LanguageIcon from '@mui/icons-material/Language';
import ImageIcon from '@mui/icons-material/Image';
import TextFieldsIcon from '@mui/icons-material/TextFields';
import DatasetIcon from '@mui/icons-material/Dataset';
import TerminalIcon from '@mui/icons-material/Terminal';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';

import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch } from '../app/store';
import { DataFormulatorState, dfActions, dfSelectors } from '../app/dfSlice';
import { borderColor, transition, radius, shadow } from '../app/tokens';
import exampleImageTable from '../assets/example-image-table.png';
import { getUrls, fetchWithIdentity } from '../app/utils';
import { apiRequest, streamRequest } from '../app/apiClient';
import { ChatMessage, ChatAttachment, InlineTablePreview, CodeExecution, PendingTableLoad, LoadPlan, LoadPlanCandidate } from '../components/ComponentType';
import { createTableFromText } from '../data/utils';
import { loadTable } from '../app/tableThunks';
import { LoadPlanCard } from '../components/LoadPlanCard';
import { TablePreviewRow, TablePreviewData } from '../components/TablePreviewRow';
import { AgentChatInput } from './AgentChatInput';

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
const CODE_FONT = '"SF Mono", "Cascadia Code", "Fira Code", Menlo, Consolas, "Liberation Mono", monospace';

const MarkdownContent: React.FC<{ content: string }> = ({ content }) => {
    return (
        <Box sx={{ wordBreak: 'break-word' }}>
            <Markdown
                components={{
                    // Block elements
                    p: ({ children }) => (
                        <Typography variant="body2" sx={{ fontSize: 13, lineHeight: 1.7, mb: 0.75, '&:last-child': { mb: 0 } }}>
                            {children}
                        </Typography>
                    ),
                    h1: ({ children }) => (
                        <Typography variant="h6" sx={{ fontSize: 16, fontWeight: 600, mb: 0.5, mt: 1 }}>{children}</Typography>
                    ),
                    h2: ({ children }) => (
                        <Typography variant="h6" sx={{ fontSize: 15, fontWeight: 600, mb: 0.5, mt: 0.75 }}>{children}</Typography>
                    ),
                    h3: ({ children }) => (
                        <Typography variant="subtitle1" sx={{ fontSize: 14, fontWeight: 600, mb: 0.5, mt: 0.75 }}>{children}</Typography>
                    ),
                    h4: ({ children }) => (
                        <Typography variant="subtitle2" sx={{ fontSize: 13, fontWeight: 600, mb: 0.5, mt: 0.5 }}>{children}</Typography>
                    ),
                    // Lists
                    ul: ({ children }) => (
                        <Box component="ul" sx={{ m: 0, mb: 0.75, pl: 2.5, '&:last-child': { mb: 0 } }}>{children}</Box>
                    ),
                    ol: ({ children }) => (
                        <Box component="ol" sx={{ m: 0, mb: 0.75, pl: 2.5, '&:last-child': { mb: 0 } }}>{children}</Box>
                    ),
                    li: ({ children }) => (
                        <Typography component="li" variant="body2" sx={{ fontSize: 13, lineHeight: 1.7, mb: 0.25 }}>
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
                                    overflow: 'auto', maxHeight: 240,
                                    border: '1px solid', borderColor: 'divider',
                                }}>
                                    <Typography component="code" sx={{
                                        fontFamily: CODE_FONT, fontSize: 12,
                                        whiteSpace: 'pre-wrap', lineHeight: 1.5,
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
                        <Typography component="th" variant="caption" sx={{ fontWeight: 600, fontSize: 12 }}>{children}</Typography>
                    ),
                    td: ({ children }) => (
                        <Typography component="td" variant="caption" sx={{ fontSize: 12 }}>{children}</Typography>
                    ),
                }}
            >
                {content}
            </Markdown>
        </Box>
    );
};

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
                leading={confirmed ? <CheckIcon sx={{ fontSize: 16, color: 'success.main', mx: 0.25 }} /> : undefined}
                preview={{
                    state: 'ready',
                    columns: preview.columns,
                    rows: preview.sampleRows,
                    totalRows: preview.totalRows,
                }}
                expanded={expanded}
                onTogglePreview={preview.sampleRows.length > 0 ? () => setExpanded(!expanded) : undefined}
            />
            {/* Footer: matches LoadPlanCard — right-aligned contained
                Load button (unconfirmed) or quiet "Loaded" caption. */}
            {(onLoad || confirmed) && (
                <Box sx={{ mt: 0.75, display: 'flex', alignItems: 'center' }}>
                    <Box sx={{ flex: 1 }} />
                    {confirmed ? (
                        <Typography sx={{ fontSize: 11, color: 'success.main', fontWeight: 500 }}>
                            {t('dataLoading.loadPlan.loadedCount', { count: 1, defaultValue: '✓ Loaded' })}
                        </Typography>
                    ) : onLoad ? (
                        <Button size="small" variant="contained" onClick={onLoad}
                            sx={{
                                textTransform: 'none', fontSize: 12,
                                py: 0.5, px: 2, minHeight: 0,
                                borderRadius: 1.5, boxShadow: 'none',
                            }}>
                            {t('dataLoading.loadTable')}
                        </Button>
                    ) : null}
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
                <TerminalIcon sx={{ fontSize: 14, color: 'text.secondary', mr: 0.75 }} />
                <Typography variant="caption" sx={{ fontSize: 11, color: 'text.secondary', flex: 1 }}>
                    {t('dataLoading.ranPythonCode')}
                </Typography>
                {block.error && <Chip label={t('dataLoading.error')} size="small" color="error" sx={{ height: 18, fontSize: 9, mr: 0.5 }} />}
                {expanded ? <ExpandLessIcon sx={{ fontSize: 14 }} /> : <ExpandMoreIcon sx={{ fontSize: 14 }} />}
            </Box>
            <Collapse in={expanded}>
                <Box sx={{ px: 1.5, py: 1, bgcolor: '#f6f6f6', overflow: 'auto', maxHeight: 200, borderTop: '1px solid', borderColor: 'divider' }}>
                    <Typography component="pre" sx={{ fontFamily: CODE_FONT, fontSize: 12, m: 0, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                        {block.code}
                    </Typography>
                </Box>
            </Collapse>
            {block.stdout && (
                <Box sx={{ px: 1.5, py: 0.75, borderTop: '1px solid rgba(0,0,0,0.08)', bgcolor: 'rgba(0,0,0,0.02)' }}>
                    <Typography component="pre" sx={{
                        fontFamily: CODE_FONT, fontSize: 11, m: 0,
                        whiteSpace: 'pre-wrap', maxHeight: 150, overflow: 'auto', color: 'text.secondary', lineHeight: 1.5,
                    }}>
                        {block.stdout}
                    </Typography>
                </Box>
            )}
            {block.error && (
                <Box sx={{ px: 1.5, py: 0.75, borderTop: '1px solid rgba(0,0,0,0.08)', bgcolor: '#fff5f5' }}>
                    <Typography component="pre" sx={{
                        fontFamily: CODE_FONT, fontSize: 11, m: 0,
                        whiteSpace: 'pre-wrap', color: 'error.main', lineHeight: 1.5,
                    }}>
                        {block.error}
                    </Typography>
                </Box>
            )}
            {block.resultTable && <InlineTablePreviewView preview={block.resultTable} />}
        </Paper>
    );
};

// ---------------------------------------------------------------------------
// Single chat message bubble
// ---------------------------------------------------------------------------

const ChatBubble: React.FC<{
    message: ChatMessage;
    existingNames: Set<string>;
}> = ({ message, existingNames }) => {
    const theme = useTheme();
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();
    const isUser = message.role === 'user';
    const [hovered, setHovered] = useState(false);
    const [showDebug, setShowDebug] = useState(false);

    const handleLoadTable = async (pending: PendingTableLoad) => {
        const unique = getUniqueTableName(pending.name, existingNames);
        try {
            if (pending.csvScratchPath) {
                const scratchUrl = `${getUrls().SCRATCH_BASE_URL}/${pending.csvScratchPath.replace(/^scratch\//, '')}`;
                const res = await fetchWithIdentity(scratchUrl);
                if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
                const csvText = await res.text();
                const table = createTableFromText(unique, csvText);
                if (table) {
                    dispatch(loadTable({ table: { ...table, source: { type: 'extract' as const } } }));
                    dispatch(dfActions.confirmTableLoad({ messageId: message.id, tableName: pending.name }));
                }
            }
        } catch (err) {
            console.error('Failed to load table:', err);
        }
    };

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
                    {/* File attachments */}
                    {message.attachments?.filter(a => a.type !== 'image').map((att, i) => (
                        <Chip key={i} label={att.name} size="small" icon={<AttachFileIcon />}
                            sx={{ mb: 0.5, mr: 0.5, fontSize: 11 }} />
                    ))}
                    {message.content && (
                        <Typography sx={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {message.content}
                        </Typography>
                    )}
                    {/* Timestamp on hover */}
                    {hovered && (
                        <Typography sx={{
                            fontSize: 10, color: 'text.disabled', position: 'absolute',
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
                {message.pendingLoads?.map((pending, i) => (
                    <InlineTablePreviewView key={i} preview={pending.preview}
                        confirmed={pending.confirmed}
                        onLoad={pending.confirmed ? undefined : () => handleLoadTable(pending)} />
                ))}

                {/* Unified "Load all" — only when there are multiple
                    pending loads. Single-table uses the in-wrapper footer
                    for visual parity with LoadPlanCard. */}
                {message.pendingLoads && message.pendingLoads.length > 1
                    && message.pendingLoads.some(p => !p.confirmed) && (
                    <Box sx={{ mt: 1, display: 'flex' }}>
                        <Box sx={{ flex: 1 }} />
                        <Button size="small" variant="contained"
                            onClick={async () => {
                                for (const pending of message.pendingLoads || []) {
                                    if (!pending.confirmed) await handleLoadTable(pending);
                                }
                            }}
                            sx={{ textTransform: 'none', fontSize: 12, py: 0.5, px: 2, minHeight: 0, borderRadius: 1.5, boxShadow: 'none' }}>
                            {t('dataLoading.loadAllTables', { count: message.pendingLoads.filter(p => !p.confirmed).length })}
                        </Button>
                    </Box>
                )}

                {/* Load plan card — Agent-proposed multi-table import.
                    The plan's reasoning is rendered *above* the card as
                    plain assistant text so it reads as a continuation of
                    the agent's voice rather than a callout inside the
                    card's visual container. */}
                {message.loadPlan?.reasoning && (
                    <Box sx={{ mt: message.content ? 0.5 : 0 }}>
                        <MarkdownContent content={message.loadPlan.reasoning} />
                    </Box>
                )}
                {message.loadPlan && (
                    <LoadPlanCard
                        plan={message.loadPlan}
                        confirmed={message.loadPlan.candidates.every(c => c.selected === false)}
                        onConfirm={async (selected: LoadPlanCandidate[]) => {
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
                                    anchored: true,
                                    description: '',
                                    source: {
                                        type: 'database' as const,
                                        databaseTable: sourceTableName,
                                        canRefresh: true,
                                        lastRefreshed: Date.now(),
                                        connectorId: item.sourceId,
                                    },
                                };
                                await dispatch(loadTable({
                                    table,
                                    connectorId: item.sourceId,
                                    sourceTableRef: { id: item.sourceTable, name: item.displayName },
                                    importOptions: {
                                        source_filters: item.filters || [],
                                        sort_columns: item.sortBy ? [item.sortBy] : undefined,
                                        sort_order: item.sortOrder,
                                    },
                                }));
                            }
                            dispatch(dfActions.markLoadPlanConfirmed({ messageId: message.id }));
                        }}
                    />
                )}
                {/* Timestamp + debug — always reserves space, content visible on hover */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25, height: 18, opacity: hovered ? 1 : 0, transition: 'opacity 0.15s' }}>
                    <Typography sx={{ fontSize: 10, color: 'text.disabled' }}>
                        {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Typography>
                    <Tooltip title={t('dataLoading.showRawData')} placement="top">
                        <IconButton size="small" onClick={() => setShowDebug(!showDebug)}
                            sx={{ width: 16, height: 16, color: 'text.disabled', '&:hover': { color: 'text.secondary' } }}>
                            <TerminalIcon sx={{ fontSize: 12 }} />
                        </IconButton>
                    </Tooltip>
                </Box>
                {showDebug && (
                    <Paper variant="outlined" sx={{ mt: 0.5, p: 1, borderRadius: 1, bgcolor: 'rgba(0,0,0,0.02)', maxHeight: 200, overflow: 'auto' }}>
                        <Typography component="pre" sx={{ fontFamily: 'monospace', fontSize: 10, m: 0, whiteSpace: 'pre-wrap', color: 'text.secondary' }}>
                            {JSON.stringify(message, null, 2)}
                        </Typography>
                    </Paper>
                )}
            </Box>
        </Box>
    );
};

// ---------------------------------------------------------------------------
// Tool call label mapping
// ---------------------------------------------------------------------------

const TOOL_LABEL_KEYS: Record<string, string> = {
    read_file: 'dataLoading.toolLabels.readingFile',
    write_file: 'dataLoading.toolLabels.writingFile',
    list_directory: 'dataLoading.toolLabels.listingFiles',
    execute_python: 'dataLoading.toolLabels.runningPython',
    show_user_data_preview: 'dataLoading.toolLabels.preparingPreview',
};

// ---------------------------------------------------------------------------
// Streaming indicator — shows tool calls with shimmer + text
// ---------------------------------------------------------------------------

interface ToolStep {
    tool: string;
    status: 'running' | 'done';
    label: string;
}

const StreamingIndicator: React.FC<{ content: string; toolSteps: ToolStep[] }> = ({ content, toolSteps }) => {
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
                                <CheckCircleIcon sx={{ fontSize: 12, color: 'success.main' }} />
                            )}
                            <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                                {step.label}
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
};

// ---------------------------------------------------------------------------
// Sample task list item for empty state
// ---------------------------------------------------------------------------

const SampleTaskItem: React.FC<{
    icon: React.ReactElement;
    title?: string;
    example: string;
    onClickExample: () => void;
}> = ({ icon, title, example, onClickExample }) => {
    return (
        <Box
            role="button"
            tabIndex={0}
            onClick={onClickExample}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClickExample(); }
            }}
            title={title ? `${title} — ${example}` : example}
            sx={{
                display: 'flex', alignItems: 'center', gap: 1.25,
                px: 1, py: 0.625,
                mx: -1,
                borderRadius: 1,
                cursor: 'pointer',
                color: 'text.secondary',
                transition: 'background-color 120ms ease, color 120ms ease',
                '&:hover': {
                    backgroundColor: 'action.hover',
                    color: 'text.primary',
                },
                '&:focus-visible': {
                    outline: 'none',
                    backgroundColor: 'action.hover',
                    color: 'text.primary',
                },
            }}
        >
            <Box sx={{ display: 'flex', flexShrink: 0, color: 'text.secondary' }}>{icon}</Box>
            <Box sx={{
                minWidth: 0, flex: 1,
                display: 'flex', alignItems: 'baseline', gap: 0.75,
                overflow: 'hidden',
            }}>
                {title ? (
                    <Typography sx={{
                        fontSize: 12, lineHeight: 1.5,
                        color: 'text.secondary',
                        flexShrink: 0,
                    }}>
                        {title}
                    </Typography>
                ) : null}
                <Typography sx={{
                    fontSize: 12, lineHeight: 1.5,
                    color: 'inherit',
                    minWidth: 0, flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                }}>
                    {example}
                </Typography>
            </Box>
        </Box>
    );
};

// ---------------------------------------------------------------------------
// Main chat component
// ---------------------------------------------------------------------------

export interface DataLoadingChatProps {
    /**
     * Optional initial text to pre-fill the chat input when the component
     * mounts (or when the value changes). Used by external entry points
     * (e.g. landing page quick-chat box) that want to hand off a prompt
     * to the agent.
     */
    initialPrompt?: string;
    /**
     * Optional images (data URLs) to seed alongside `initialPrompt` —
     * used when an external surface (e.g. landing-page agent box) has
     * already collected pasted/attached images and is handing them off.
     */
    initialImages?: string[];
    /**
     * If true, automatically send the `initialPrompt` once on mount/change.
     * Otherwise the prompt is only pre-filled and the user presses Enter.
     */
    autoSendInitialPrompt?: boolean;
}

export const DataLoadingChat: React.FC<DataLoadingChatProps> = ({
    initialPrompt,
    initialImages,
    autoSendInitialPrompt,
}) => {
    const theme = useTheme();
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();

    const chatMessages = useSelector((state: DataFormulatorState) => state.dataLoadingChatMessages);
    const chatInProgress = useSelector((state: DataFormulatorState) => state.dataLoadingChatInProgress);
    // External reset signal — bumped by `clearChatMessages` (manual reset
    // button, new menu-level query, full session reset). When it changes
    // we abort any in-flight stream, drop partial UI state, and re-seed
    // from props if the parent provided a new prompt/images. Without
    // this, an in-flight stream's eventual dispatches would leak into
    // the freshly-cleared thread.
    const chatResetCounter = useSelector((state: DataFormulatorState) => state.dataLoadingChatResetCounter ?? 0);
    const existingTables = useSelector((state: DataFormulatorState) => state.tables);
    const activeModel = useSelector(dfSelectors.getActiveModel);
    const frontendRowLimit = useSelector((state: DataFormulatorState) => state.config?.frontendRowLimit ?? 2_000_000);
    const existingNames = new Set(existingTables.map(tbl => tbl.id));

    const [prompt, setPrompt] = useState('');
    const [userImages, setUserImages] = useState<string[]>([]);
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

    // Auto-scroll to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatMessages, streamingContent]);

    // Auto-focus input
    useEffect(() => { inputRef.current?.focus(); }, []);

    // ---- External initial prompt handling -------------------------------
    // Pre-fill the input (and optionally auto-send) when `initialPrompt`
    // is provided. Used by external surfaces (e.g. landing-page quick chat
    // box) to hand off text to the agent. Auto-send only fires for a
    // fresh conversation — we never auto-resend on remount mid-chat.
    const hasExistingMessages = chatMessages.length > 0;
    const [pendingAutoSend, setPendingAutoSend] = useState(false);
    useEffect(() => {
        // Detect external reset: abort, invalidate in-flight session,
        // and clear all local UI state before re-seeding. Including
        // `chatResetCounter` in the dep list also guarantees that an
        // identical-prompt re-submission (same `initialPrompt` string)
        // still triggers a fresh auto-send — otherwise the deps would
        // be unchanged and the effect would skip.
        const isReset = chatResetCounter !== lastResetRef.current;
        if (isReset) {
            lastResetRef.current = chatResetCounter;
            sessionRef.current += 1;
            abortControllerRef.current?.abort();
            abortControllerRef.current = null;
            setStreamingContent('');
            setStreamingToolSteps([]);
            setPrompt('');
            setUserImages([]);
            setPendingAutoSend(false);
        }

        const hasText = !!initialPrompt && initialPrompt.trim().length > 0;
        const hasImages = !!initialImages && initialImages.length > 0;
        if (hasText) setPrompt(initialPrompt!);
        if (hasImages) {
            // Always replace, never append. The prop is a "seed" — each
            // change represents a fresh handoff from the parent, not an
            // additive update. Appending caused the same image to stack
            // up every time the parent re-rendered with a new array ref.
            setUserImages([...initialImages!]);
        }
        // Auto-send when this is a fresh conversation. A reset always
        // produces a fresh conversation, so allow auto-send post-reset
        // even though `hasExistingMessages` may not have re-rendered to
        // `false` yet in this tick.
        if (autoSendInitialPrompt && (hasText || hasImages) && (isReset || !hasExistingMessages)) {
            setPendingAutoSend(true);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialPrompt, initialImages, autoSendInitialPrompt, chatResetCounter]);

    const stopGeneration = () => { abortControllerRef.current?.abort(); };

    // ---- Send message ----
    const sendMessage = useCallback(() => {
        const text = prompt.trim();
        if (!text && userImages.length === 0) return;
        if (chatInProgress) return;
        const attachments: ChatAttachment[] = userImages.map((url, i) => ({
            type: 'image' as const, name: `image-${i + 1}`, url,
        }));

        const userMsg: ChatMessage = {
            id: `msg-${Date.now()}-user`, role: 'user',
            content: text || (userImages.length > 0 ? t('dataLoading.defaultImageMessage') : ''),
            attachments: attachments.length > 0 ? attachments : undefined,
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
        setPrompt('');
        setUserImages([]);
        setStreamingContent('');
        setStreamingToolSteps([]);

        const allMessages = [...chatMessages, userMsg].map(m => ({
            role: m.role, content: m.content, attachments: m.attachments,
        }));

        const controller = new AbortController();
        abortControllerRef.current = controller;

        (async () => {
            try {
                let fullText = '';
                const codeBlocks: CodeExecution[] = [];
                const tables: InlineTablePreview[] = [];
                const pendingLoads: PendingTableLoad[] = [];
                let loadPlanRef: LoadPlan | undefined;
                const rawEvents: any[] = [];
                let streamingToolStepsRef: ToolStep[] = [];

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
                        loadPlanRef = {
                            candidates: (action.candidates || []).map((c: any) => ({
                                sourceId: c.source_id,
                                tableKey: c.table_key,
                                displayName: c.display_name,
                                sourceTable: c.source_table,
                                sourceTableName: c.source_table_name,
                                filters: c.filters,
                                sortBy: c.sort_by,
                                sortOrder: c.sort_order,
                                resolutionError: c.resolution_error,
                                selected: !c.resolution_error,
                            })),
                            reasoning: action.reasoning,
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
                        const newSteps = [...streamingToolStepsRef];
                        newSteps.push({ tool: (event as any).tool, status: 'running', label });
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
                content: fullText,
                codeBlocks: codeBlocks.length > 0 ? codeBlocks : undefined,
                tables: tables.length > 0 && pendingLoads.length === 0 ? tables : undefined,
                pendingLoads: pendingLoads.length > 0 ? pendingLoads : undefined,
                loadPlan: loadPlanRef,
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
    }, [prompt, userImages, chatInProgress, chatMessages, activeModel, existingTables, dispatch, streamingContent, t]);

    // Auto-send the initial prompt once it has been applied to state.
    useEffect(() => {
        if (!pendingAutoSend) return;
        if (chatInProgress) return;
        if (prompt.trim().length === 0 && userImages.length === 0) return;
        setPendingAutoSend(false);
        sendMessage();
    }, [pendingAutoSend, prompt, userImages, chatInProgress, sendMessage]);

    const sampleTasks = [
        {
            icon: <ImageIcon sx={{ fontSize: 16 }} />,
            title: t('dataLoading.examples.extractFromImage'),
            example: t('dataLoading.examples.extractFromImageExample'),
            action: () => {
                fetch(exampleImageTable)
                    .then(res => res.blob())
                    .then(blob => {
                        const reader = new FileReader();
                        reader.onload = () => {
                            if (reader.result) {
                                setUserImages([reader.result as string]);
                                setPrompt(t('dataLoading.examples.extractFromImageExample'));
                                setTimeout(() => inputRef.current?.focus(), 50);
                            }
                        };
                        reader.readAsDataURL(blob);
                    });
            },
        },
        {
            icon: <TextFieldsIcon sx={{ fontSize: 16 }} />,
            title: t('dataLoading.examples.extractFromText'),
            example: t('dataLoading.examples.extractFromTextExample'),
            action: () => { setPrompt(t('dataLoading.examples.extractFromTextPrompt')); setTimeout(() => inputRef.current?.focus(), 50); },
        },
        {
            icon: <DatasetIcon sx={{ fontSize: 16 }} />,
            title: t('dataLoading.examples.generateSynthetic'),
            example: t('dataLoading.examples.generateSyntheticExample'),
            action: () => { setPrompt(t('dataLoading.examples.generateSyntheticExample')); setTimeout(() => inputRef.current?.focus(), 50); },
        },
        {
            icon: <DatasetIcon sx={{ fontSize: 16 }} />,
            title: t('dataLoading.examples.browseSamples'),
            example: t('dataLoading.examples.browseSamplesExample'),
            action: () => { setPrompt(t('dataLoading.examples.browseSamplesExample')); setTimeout(() => inputRef.current?.focus(), 50); },
        },
    ];

    const isEmpty = chatMessages.length === 0 && !streamingContent;

    return (
        <Box sx={{
            display: 'flex', flexDirection: 'column',
            height: '100%', width: '100%', overflow: 'hidden',
        }}>
            {/* ── Messages area ─────────────────────────────────── */}
            <Box sx={{
                flex: 1, overflow: 'auto',
                display: 'flex', flexDirection: 'column', alignItems: 'center',
            }}>
              <Box sx={{
                width: '100%', maxWidth: 640,
                px: 2, py: 2,
                display: 'flex', flexDirection: 'column',
                ...(isEmpty ? { flex: 1, justifyContent: 'center', alignItems: 'center' } : {}),
              }}>
                {isEmpty ? (
                    <Box sx={{ maxWidth: 480, width: '100%' }}>
                        <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 0.75, textAlign: 'center' }}>
                            {t('dataLoading.title')}
                        </Typography>
                        <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 3.5, textAlign: 'center', lineHeight: 1.5 }}>
                            {t('dataLoading.subtitle')}
                        </Typography>

                        <Typography sx={{
                            fontSize: 11, fontWeight: 600, letterSpacing: 0.6,
                            textTransform: 'uppercase', color: 'text.secondary',
                            mb: 0.75,
                        }}>
                            {t('dataLoading.sectionTry')}
                        </Typography>
                        <Box sx={{ display: 'flex', flexDirection: 'column', mb: 3 }}>
                            {sampleTasks.map((task, i) => (
                                <SampleTaskItem key={i} icon={task.icon} title={task.title}
                                    example={task.example} onClickExample={task.action} />
                            ))}
                        </Box>

                        <Typography sx={{
                            fontSize: 11, fontWeight: 600, letterSpacing: 0.6,
                            textTransform: 'uppercase', color: 'text.secondary',
                            mb: 0.75,
                        }}>
                            {t('dataLoading.sectionChat')}
                        </Typography>
                        <SampleTaskItem
                            icon={<ChatBubbleOutlineIcon sx={{ fontSize: 16 }} />}
                            example={t('dataLoading.chatHintExample')}
                            onClickExample={() => {
                                setPrompt(t('dataLoading.chatHintExample'));
                                setTimeout(() => inputRef.current?.focus(), 50);
                            }}
                        />
                    </Box>
                ) : (
                    <>
                        {chatMessages.map((msg) => (
                            <ChatBubble key={msg.id} message={msg} existingNames={existingNames} />
                        ))}
                        {streamingContent !== '' && <StreamingIndicator content={streamingContent} toolSteps={streamingToolSteps} />}
                        {chatInProgress && !streamingContent && <StreamingIndicator content="" toolSteps={streamingToolSteps} />}
                        <div ref={messagesEndRef} />
                    </>
                )}
              </Box>
            </Box>

            {/* ── Input area ─────────────────────────────────────── */}
            <Box sx={{ display: 'flex', justifyContent: 'center', px: 2, pb: 1.5, pt: 0.75 }}>
              <Box sx={{ width: '100%', maxWidth: 640 }}>
                <Box sx={{
                    display: 'flex', flexDirection: 'column',
                    overflow: 'hidden',
                }}>
                    <AgentChatInput
                        value={prompt}
                        onChange={setPrompt}
                        images={userImages}
                        onImagesChange={setUserImages}
                        onSend={sendMessage}
                        onStop={stopGeneration}
                        inProgress={chatInProgress}
                        placeholder={t('dataLoading.placeholder')}
                        autoFocus
                        inputRef={inputRef}
                        onNonImageFile={(file) => {
                            const formData = new FormData();
                            formData.append('file', file);
                            apiRequest(getUrls().SCRATCH_UPLOAD_URL, {
                                method: 'POST', body: formData,
                            }).then(() => {
                                setPrompt(prev => prev + (prev ? '\n' : '') + t('dataLoading.uploaded', { name: file.name }));
                            }).catch(err => console.error('Upload failed:', err));
                        }}
                    />
                </Box>

                <Typography sx={{ fontSize: 10, color: 'text.disabled', textAlign: 'center', mt: 0.5 }}>
                    {t('dataLoading.shiftEnterHint')}
                </Typography>
              </Box>
            </Box>
        </Box>
    );
};
