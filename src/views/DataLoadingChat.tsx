// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as React from 'react';
import { useEffect, useRef, useState, useCallback } from 'react';
import Markdown from 'react-markdown';

import {
    Box, Button, Chip, CircularProgress, IconButton,
    Paper, Stack, Tooltip, Typography,
    alpha, useTheme, Collapse, InputBase,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import StopIcon from '@mui/icons-material/Stop';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CloseIcon from '@mui/icons-material/Close';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import LanguageIcon from '@mui/icons-material/Language';
import ImageIcon from '@mui/icons-material/Image';
import TextFieldsIcon from '@mui/icons-material/TextFields';
import DatasetIcon from '@mui/icons-material/Dataset';
import TerminalIcon from '@mui/icons-material/Terminal';
import AddIcon from '@mui/icons-material/Add';

import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch } from '../app/store';
import { DataFormulatorState, dfActions, dfSelectors } from '../app/dfSlice';
import type { ModelConfig } from '../app/dfSlice';
import { borderColor, transition, radius, shadow } from '../app/tokens';
import exampleImageTable from '../assets/example-image-table.png';
import { getUrls, fetchWithIdentity } from '../app/utils';
import { ChatMessage, ChatAttachment, InlineTablePreview, CodeExecution, PendingTableLoad } from '../components/ComponentType';
import { createTableFromText } from '../data/utils';
import { createTableFromFromObjectArray } from '../data/utils';
import { loadTable } from '../app/tableThunks';
import { TableIcon } from '../icons';
import { DataFrameTable } from './DataFrameTable';

/** Returns true when the model name suggests it does not support image input. */
export function checkIsLikelyTextOnlyModel(modelName: string | undefined): boolean {
    return (modelName || '').toLowerCase().includes('deepseek-chat');
}

export function checkModelSupportsImageInput(model: Pick<ModelConfig, 'model' | 'supports_vision'> | undefined): boolean {
    if (!model) return false;
    if (model.supports_vision === false) return false;
    return !checkIsLikelyTextOnlyModel(model.model);
}

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

    const allCols = preview.columns;

    const rowLabel = preview.totalRows > preview.sampleRows.length
        ? `${preview.totalRows.toLocaleString()} ${t('dataLoading.rows')}`
        : '';
    const meta = [rowLabel, `${allCols.length} ${t('dataLoading.cols')}`].filter(Boolean).join(' · ');

    // Pill colors
    const pillBg = confirmed
        ? alpha(theme.palette.success.main, 0.08)
        : alpha(theme.palette.primary.main, 0.07);
    const pillColor = confirmed
        ? theme.palette.success.main
        : theme.palette.text.primary;

    return (
        <Box sx={{ my: 0.75 }}>
            {/* Pill row: pill + Load button inline */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                {/* Soft pill — click to expand/collapse */}
                <Box
                    onClick={() => setExpanded(!expanded)}
                    sx={{
                        display: 'inline-flex', alignItems: 'center', gap: 0.6,
                        px: 1.25, py: 0.4,
                        borderRadius: '99px',
                        bgcolor: pillBg,
                        cursor: 'pointer',
                        transition: transition.fast,
                        '&:hover': { bgcolor: confirmed
                            ? alpha(theme.palette.success.main, 0.14)
                            : alpha(theme.palette.primary.main, 0.12),
                        },
                        userSelect: 'none',
                    }}
                >
                    {confirmed
                        ? <CheckCircleIcon sx={{ fontSize: 13, color: 'success.main' }} />
                        : <TableIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                    }
                    <Typography sx={{ fontSize: 12, fontWeight: 600, color: pillColor, lineHeight: 1 }}>
                        {preview.name}
                    </Typography>
                    {meta && (
                        <Typography sx={{ fontSize: 10, color: 'text.disabled', lineHeight: 1 }}>
                            {meta}
                        </Typography>
                    )}
                    {preview.sampleRows.length > 0 && (
                        expanded
                            ? <ExpandLessIcon sx={{ fontSize: 14, color: 'text.disabled', ml: -0.25 }} />
                            : <ExpandMoreIcon sx={{ fontSize: 14, color: 'text.disabled', ml: -0.25 }} />
                    )}
                </Box>

                {/* Load button next to pill */}
                {onLoad && !confirmed && (
                    <Button size="small" variant="text" onClick={onLoad}
                        sx={{ textTransform: 'none', fontSize: 11, py: 0, px: 1, minHeight: 0, color: 'primary.main' }}>
                        {t('dataLoading.load')}
                    </Button>
                )}
            </Box>

            {/* Collapsible table rows */}
            <Collapse in={expanded}>
                {preview.sampleRows.length > 0 && (
                    <Box sx={{ mt: 0.75, mb: 0.5 }}>
                        <DataFrameTable
                            columns={allCols}
                            rows={preview.sampleRows}
                            totalRows={preview.totalRows}
                            maxRows={5}
                            maxColumns={6}
                            maxCellLength={18}
                        />
                    </Box>
                )}
            </Collapse>
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
            if (pending.sampleDataset) {
                const ds = pending.sampleDataset;
                for (const tableInfo of ds.tables) {
                    const res = await fetch(tableInfo.tableUrl);
                    const textData = await res.text();
                    const tableName = tableInfo.tableUrl.split('/').pop()?.split('.')[0]?.split('?')[0] || unique;
                    let dictTable;
                    if (tableInfo.format === 'csv' || tableInfo.format === 'tsv') {
                        dictTable = createTableFromText(tableName, textData);
                    } else {
                        dictTable = createTableFromFromObjectArray(tableName, JSON.parse(textData), true);
                    }
                    if (dictTable) {
                        if (ds.live) {
                            dictTable.source = {
                                type: 'stream', url: tableInfo.tableUrl,
                                autoRefresh: true, refreshIntervalSeconds: ds.refreshIntervalSeconds || 60,
                                lastRefreshed: Date.now(),
                            };
                        } else {
                            dictTable.source = { type: 'example', url: tableInfo.tableUrl };
                        }
                        await dispatch(loadTable({ table: dictTable }));
                    }
                }
                dispatch(dfActions.confirmTableLoad({ messageId: message.id, tableName: pending.name }));
            } else if (pending.csvScratchPath) {
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
                        onLoad={(message.pendingLoads && message.pendingLoads.length > 1) ? (() => handleLoadTable(pending)) : undefined} />
                ))}

                {/* Prominent load button at bottom — always shown when there are unloaded tables */}
                {message.pendingLoads && message.pendingLoads.some(p => !p.confirmed) && (
                    <Box sx={{ mt: 1 }}>
                        <Button size="small" variant="contained"
                            onClick={async () => {
                                for (const pending of message.pendingLoads || []) {
                                    if (!pending.confirmed) await handleLoadTable(pending);
                                }
                            }}
                            sx={{ textTransform: 'none', fontSize: 12, py: 0.5, px: 2, minHeight: 0, borderRadius: 1.5, boxShadow: 'none' }}>
                            {message.pendingLoads.length === 1
                                ? t('dataLoading.loadTable')
                                : t('dataLoading.loadAllTables', { count: message.pendingLoads.filter(p => !p.confirmed).length })}
                        </Button>
                    </Box>
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
            {content ? <MarkdownContent content={content} /> : null}

            {/* Tool call steps */}
            {toolSteps.length > 0 && (
                <Box sx={{ mt: content ? 0.75 : 0, mb: 0.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
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
    title: string;
    example: string;
    onClickExample: () => void;
}> = ({ icon, title, example, onClickExample }) => {
    const theme = useTheme();
    return (
        <Box sx={{
            display: 'flex', alignItems: 'flex-start', gap: 1.25,
            py: 0.75,
        }}>
            <Box sx={{ color: 'text.secondary', mt: 0.125 }}>{icon}</Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography component="span" sx={{ fontSize: 12, lineHeight: 1.5, color: 'text.secondary' }}>
                    {title}
                    {' — '}
                </Typography>
                <Typography component="span" onClick={onClickExample} sx={{
                    fontSize: 12, lineHeight: 1.5,
                    color: theme.palette.primary.main,
                    cursor: 'pointer',
                    '&:hover': { textDecoration: 'underline' },
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

export const DataLoadingChat: React.FC = () => {
    const theme = useTheme();
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();

    const chatMessages = useSelector((state: DataFormulatorState) => state.dataLoadingChatMessages);
    const chatInProgress = useSelector((state: DataFormulatorState) => state.dataLoadingChatInProgress);
    const existingTables = useSelector((state: DataFormulatorState) => state.tables);
    const activeModel = useSelector(dfSelectors.getActiveModel);
    const existingNames = new Set(existingTables.map(tbl => tbl.id));

    const [prompt, setPrompt] = useState('');
    const [userImages, setUserImages] = useState<string[]>([]);
    const [streamingContent, setStreamingContent] = useState('');
    const [streamingToolSteps, setStreamingToolSteps] = useState<ToolStep[]>([]);
    const [debugEvents, setDebugEvents] = useState<any[]>([]);
    const [showDebugPanel] = useState(false);
    const abortControllerRef = useRef<AbortController | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // Auto-scroll to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatMessages, streamingContent]);

    // Auto-focus input
    useEffect(() => { inputRef.current?.focus(); }, []);

    const canSend = (prompt.trim().length > 0 || userImages.length > 0) && !chatInProgress;

    // ---- Paste handler (images + text) ----
    const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
        if (e.clipboardData?.files?.length) {
            const imageFiles = Array.from(e.clipboardData.files).filter(f => f.type.startsWith('image/'));
            if (imageFiles.length > 0) {
                e.preventDefault();
                imageFiles.forEach(file => {
                    const reader = new FileReader();
                    reader.onload = () => {
                        if (reader.result) setUserImages(prev => [...prev, reader.result as string]);
                    };
                    reader.readAsDataURL(file);
                });
            }
        }
    };

    // ---- File upload handler ----
    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = () => {
                if (reader.result) setUserImages(prev => [...prev, reader.result as string]);
            };
            reader.readAsDataURL(file);
        } else {
            const formData = new FormData();
            formData.append('file', file);
            fetchWithIdentity(getUrls().SCRATCH_UPLOAD_URL, {
                method: 'POST', body: formData,
            }).then(res => res.json()).then(data => {
                if (data.status === 'ok') {
                    setPrompt(prev => prev + (prev ? '\n' : '') + t('dataLoading.uploaded', { name: file.name }));
                }
            }).catch(err => console.error('Upload failed:', err));
        }
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const stopGeneration = () => { abortControllerRef.current?.abort(); };

    // ---- Send message ----
    const sendMessage = useCallback(() => {
        const text = prompt.trim();
        if (!text && userImages.length === 0) return;
        if (chatInProgress) return;
        if (userImages.length > 0 && !checkModelSupportsImageInput(activeModel)) {
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                type: 'warning',
                component: t('dataLoading.title'),
                value: t('dataLoading.imageModelUnsupported'),
            }));
            return;
        }

        const attachments: ChatAttachment[] = userImages.map((url, i) => ({
            type: 'image' as const, name: `image-${i + 1}`, url,
        }));

        const userMsg: ChatMessage = {
            id: `msg-${Date.now()}-user`, role: 'user',
            content: text || (userImages.length > 0 ? t('dataLoading.defaultImageMessage') : ''),
            attachments: attachments.length > 0 ? attachments : undefined,
            timestamp: Date.now(),
        };

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

        fetchWithIdentity(getUrls().DATA_LOADING_CHAT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: activeModel,
                messages: allMessages,
                workspace_tables: existingTables.map(tbl => tbl.id),
            }),
            signal: controller.signal,
        })
        .then(async (response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                const body = await response.json();
                if (body.status === 'error') {
                    throw new Error(body.error?.message || body.message || t('dataLoading.error'));
                }
            }
            const reader = response.body?.getReader();
            if (!reader) throw new Error('No reader');

            const decoder = new TextDecoder();
            let buffer = '';
            let fullText = '';
            const codeBlocks: CodeExecution[] = [];
            const tables: InlineTablePreview[] = [];
            const pendingLoads: PendingTableLoad[] = [];
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
                    } else if (action.type === 'load_sample_dataset') {
                        const dsLive = action.live;
                        const dsRefresh = action.refreshIntervalSeconds;
                        for (const tbl of (action.tables || [])) {
                            const tableName = tbl.table_url?.split('/').pop()?.split('.')[0]?.split('?')[0] || action.name || 'table';
                            const cols = tbl.columns || (tbl.sample_rows?.[0] ? Object.keys(tbl.sample_rows[0]) : []);
                            const sampleRows = tbl.sample_rows || [];
                            const preview: InlineTablePreview = {
                                name: tableName, columns: cols,
                                sampleRows: sampleRows.slice(0, 5),
                                totalRows: sampleRows.length,
                            };
                            tables.push(preview);
                            pendingLoads.push({
                                name: tableName, csvScratchPath: '', preview, confirmed: false,
                                sampleDataset: {
                                    datasetName: action.name || tableName,
                                    tables: [{ tableUrl: tbl.table_url, format: tbl.format || 'json' }],
                                    live: dsLive, refreshIntervalSeconds: dsRefresh,
                                },
                            });
                        }
                    }
                }
            };

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (!line.trim()) continue;
                        try {
                            const event = JSON.parse(line);
                            // Log all events for debug panel
                            if (event.type !== 'text_delta') {
                                rawEvents.push(event);
                                setDebugEvents([...rawEvents]);
                            }
                            switch (event.type) {
                                case 'text_delta':
                                    fullText += event.content;
                                    setStreamingContent(fullText);
                                    break;
                                case 'tool_start': {
                                    const label = TOOL_LABEL_KEYS[event.tool] ? t(TOOL_LABEL_KEYS[event.tool]) : event.tool;
                                    const newSteps = [...streamingToolStepsRef];
                                    newSteps.push({ tool: event.tool, status: 'running', label });
                                    streamingToolStepsRef = newSteps;
                                    setStreamingToolSteps(newSteps);
                                    if (event.tool === 'execute_python' && event.code) {
                                        codeBlocks.push({ code: event.code });
                                    }
                                    break;
                                }
                                case 'tool_result': {
                                    // Mark the tool as done
                                    const updatedSteps = streamingToolStepsRef.map(s =>
                                        s.tool === event.tool && s.status === 'running'
                                            ? { ...s, status: 'done' as const } : s
                                    );
                                    streamingToolStepsRef = updatedSteps;
                                    setStreamingToolSteps(updatedSteps);
                                    if (event.tool === 'execute_python' && codeBlocks.length > 0) {
                                        const last = codeBlocks[codeBlocks.length - 1];
                                        last.stdout = event.stdout || '';
                                        last.error = event.error || undefined;
                                        if (event.table) last.resultTable = event.table;
                                    }
                                    // Also capture actions from tool_result (e.g. show_user_data_preview)
                                    if (event.actions) {
                                        console.log('[DataLoadingChat] actions from tool_result:', event.tool, event.actions.length);
                                        processActions(event.actions);
                                    }
                                    break;
                                }
                                case 'actions':
                                    // Only process if we haven't already captured from tool_result
                                    if (pendingLoads.length === 0) {
                                        console.log('[DataLoadingChat] actions event:', (event.actions || []).length, 'actions');
                                        processActions(event.actions || []);
                                    }
                                    break;
                                case 'done':
                                    fullText = event.full_text || fullText;
                                    break;
                                case 'error':
                                    fullText += `\n\n**${t('dataLoading.error')}:** ${event.error?.message || event.error || t('dataLoading.error')}`;
                                    break;
                            }
                        } catch { /* skip unparseable */ }
                    }
                }
            } finally { reader.releaseLock(); }

            // Process any remaining data in the buffer after stream ends
            if (buffer.trim()) {
                for (const line of buffer.split('\n')) {
                    if (!line.trim()) continue;
                    try {
                        const event = JSON.parse(line);
                        if (event.type !== 'text_delta') {
                            rawEvents.push(event);
                            setDebugEvents([...rawEvents]);
                        }
                        if (event.type === 'actions' && pendingLoads.length === 0) processActions(event.actions || []);
                        if (event.type === 'tool_result' && event.actions) processActions(event.actions);
                        if (event.type === 'done') fullText = event.full_text || fullText;
                        if (event.type === 'text_delta') fullText += event.content;
                    } catch { /* skip */ }
                }
            }

            const assistantMsg: ChatMessage = {
                id: `msg-${Date.now()}-assistant`, role: 'assistant',
                content: fullText,
                codeBlocks: codeBlocks.length > 0 ? codeBlocks : undefined,
                tables: tables.length > 0 && pendingLoads.length === 0 ? tables : undefined,
                pendingLoads: pendingLoads.length > 0 ? pendingLoads : undefined,
                timestamp: Date.now(),
            };
            dispatch(dfActions.addChatMessage(assistantMsg));
            setStreamingContent('');
            setStreamingToolSteps([]);
        })
        .catch((error) => {
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
        })
        .finally(() => {
            dispatch(dfActions.setDataLoadingChatInProgress(false));
            abortControllerRef.current = null;
        });
    }, [prompt, userImages, chatInProgress, chatMessages, activeModel, existingTables, dispatch, streamingContent, t]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (canSend) sendMessage();
        }
    };

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
                        <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 0.5, textAlign: 'center' }}>
                            {t('dataLoading.title')}
                        </Typography>
                        <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 2, textAlign: 'center', lineHeight: 1.5 }}>
                            {t('dataLoading.subtitle')}
                        </Typography>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                            {sampleTasks.map((task, i) => (
                                <SampleTaskItem key={i} icon={task.icon} title={task.title}
                                    example={task.example} onClickExample={task.action} />
                            ))}
                        </Box>
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
                    border: `1px solid ${borderColor.divider}`,
                    borderRadius: '12px',
                    bgcolor: theme.palette.background.paper,
                    transition: transition.fast,
                    '&:focus-within': {
                        borderColor: theme.palette.primary.main,
                        boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.15)}`,
                    },
                    display: 'flex', flexDirection: 'column',
                    overflow: 'hidden',
                }}>
                    {/* Image previews inside the input box */}
                    {userImages.length > 0 && (
                        <Box sx={{ display: 'flex', gap: 0.75, p: 1, pb: 0, flexWrap: 'wrap' }}>
                            {userImages.map((img, i) => (
                                <Box key={i} sx={{ position: 'relative', flexShrink: 0 }}>
                                    <Box component="img" src={img}
                                        sx={{
                                            width: 56, height: 56, objectFit: 'cover',
                                            borderRadius: 1, border: `1px solid ${borderColor.component}`,
                                        }} />
                                    <IconButton size="small"
                                        onClick={() => setUserImages(prev => prev.filter((_, idx) => idx !== i))}
                                        sx={{
                                            position: 'absolute', top: -4, right: -4,
                                            width: 18, height: 18,
                                            bgcolor: 'rgba(0,0,0,0.55)', color: 'white',
                                            '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' },
                                        }}>
                                        <CloseIcon sx={{ fontSize: 12 }} />
                                    </IconButton>
                                </Box>
                            ))}
                        </Box>
                    )}

                    {/* Text input row */}
                    <Box sx={{ display: 'flex', alignItems: 'flex-end', px: 1, py: 0.5 }}>
                        <input type="file" ref={fileInputRef} style={{ display: 'none' }}
                            accept="image/*,.csv,.json,.xlsx,.xls,.txt,.tsv"
                            onChange={handleFileUpload} />
                        <Tooltip title={t('dataLoading.attachTooltip')} placement="top">
                            <IconButton size="small" onClick={() => fileInputRef.current?.click()}
                                disabled={chatInProgress}
                                sx={{ mb: 0.25, color: 'text.secondary' }}>
                                <AddIcon sx={{ fontSize: 20 }} />
                            </IconButton>
                        </Tooltip>

                        <InputBase
                            inputRef={inputRef}
                            multiline
                            maxRows={8}
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            onKeyDown={handleKeyDown}
                            onPaste={handlePaste}
                            placeholder={t('dataLoading.placeholder')}
                            disabled={chatInProgress}
                            sx={{ flex: 1, px: 1, py: 0.75, fontSize: 13, lineHeight: 1.5 }}
                        />

                        {chatInProgress ? (
                            <Tooltip title={t('dataLoading.stopTooltip')} placement="top">
                                <IconButton size="small" onClick={stopGeneration}
                                    sx={{
                                        mb: 0.25, bgcolor: 'error.main', color: 'white',
                                        width: 28, height: 28,
                                        '&:hover': { bgcolor: 'error.dark' },
                                    }}>
                                    <StopIcon sx={{ fontSize: 16 }} />
                                </IconButton>
                            </Tooltip>
                        ) : (
                            <Tooltip title={t('dataLoading.sendTooltip')} placement="top">
                                <span>
                                    <IconButton size="small" onClick={sendMessage} disabled={!canSend}
                                        sx={{
                                            mb: 0.25, width: 28, height: 28,
                                            bgcolor: canSend ? 'primary.main' : 'transparent',
                                            color: canSend ? 'white' : 'text.disabled',
                                            '&:hover': { bgcolor: canSend ? 'primary.dark' : 'transparent' },
                                            '&.Mui-disabled': { bgcolor: 'transparent', color: 'text.disabled' },
                                        }}>
                                        <SendIcon sx={{ fontSize: 16 }} />
                                    </IconButton>
                                </span>
                            </Tooltip>
                        )}
                    </Box>
                </Box>

                <Typography sx={{ fontSize: 10, color: 'text.disabled', textAlign: 'center', mt: 0.5 }}>
                    {t('dataLoading.shiftEnterHint')}
                </Typography>
              </Box>
            </Box>
        </Box>
    );
};
