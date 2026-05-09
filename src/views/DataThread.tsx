// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';

import {
    Box,
    Typography,
    LinearProgress,
    ListItemIcon,
    IconButton,
    Tooltip,

    useTheme,
    SxProps,
    Button,
    TextField,
    CircularProgress,
    Popper,
    Paper,
    ClickAwayListener,
    Badge,
    Menu,
    MenuItem,
    Switch,
    FormControlLabel,
    Collapse,
    Card,
} from '@mui/material';


import '../scss/VisualizationView.scss';
import { useTranslation } from 'react-i18next';
import { batch, useDispatch, useSelector } from 'react-redux';
import { DataFormulatorState, dfActions, dfSelectors, SSEMessage, GeneratedReport } from '../app/dfSlice';
import { getTriggers, getUrls, fetchWithIdentity } from '../app/utils';
import { apiRequest } from '../app/apiClient';
import { extractErrorMessage } from '../app/errorHandler';
import { Chart, DictTable, Trigger, InteractionEntry } from "../components/ComponentType";
import { CATALOG_TABLE_ITEM } from '../components/DndTypes';
import type { CatalogTableDragItem } from '../components/DndTypes';
import { loadTable } from '../app/tableThunks';
import { AppDispatch } from '../app/store';

import DeleteIcon from '@mui/icons-material/Delete';
import StarIcon from '@mui/icons-material/Star';
import PersonIcon from '@mui/icons-material/Person';
import { TableIcon, AnchorIcon, InsightIcon, StreamIcon, AgentIcon } from '../icons';


import _ from 'lodash';
import { getChartTemplate } from '../components/ChartTemplates';

import 'prismjs/components/prism-python' // Language
import 'prismjs/components/prism-typescript' // Language
import 'prismjs/themes/prism.css'; //Example style, you can use another

import { checkChartAvailability, generateChartSkeleton, getDataTable } from './ChartUtils';

import AttachFileIcon from '@mui/icons-material/AttachFile';
import EditIcon from '@mui/icons-material/Edit';
import RefreshIcon from '@mui/icons-material/Refresh';
import AddIcon from '@mui/icons-material/Add';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

import { alpha } from '@mui/material/styles';

import { RefreshDataDialog } from './RefreshDataDialog';
import BarChartIcon from '@mui/icons-material/BarChart';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import ScatterPlotIcon from '@mui/icons-material/ScatterPlot';
import PieChartOutlineIcon from '@mui/icons-material/PieChartOutline';
import GridOnIcon from '@mui/icons-material/GridOn';
import { useDataRefresh } from '../app/useDataRefresh';
import { buildTriggerCard, buildTableCard, BuildTableCardProps } from './DataThreadCards';
import { UnifiedDataUploadDialog } from './UnifiedDataUploadDialog';
import { AgentRulesDialog } from './AgentRulesDialog';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';

import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ArticleIcon from '@mui/icons-material/Article';
import TerminalIcon from '@mui/icons-material/Terminal';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import SearchIcon from '@mui/icons-material/Search';
import AutoGraphIcon from '@mui/icons-material/AutoGraph';

import { ViewBorderStyle, ComponentBorderStyle, transition, radius, borderColor } from '../app/tokens';

import { SimpleChartRecBox } from './SimpleChartRecBox';
import { InteractionEntryCard, getEntryGutterIcon, getDefaultGutterIcon, PlanStepsView } from './InteractionEntryCard';

/** Pick the icon component for a step line based on known prefixes. */
// Re-exported from InteractionEntryCard — kept here for backward compat with gutter icon logic

/** Render a multi-step thinking banner as a single block with sectioned steps. */
export const ThinkingStepsBanner = (steps: string[], sx?: SxProps) => {
    return (
        <Box sx={sx}>
            <PlanStepsView steps={steps} activeLastStep />
        </Box>
    );
};

/** Simple single-message thinking banner (used when no step breakdown is available). */
export const ThinkingBanner = (message: string, sx?: SxProps, active: boolean = true) => {
    return (
        <Box sx={{
            display: 'flex', alignItems: 'center', gap: '4px',
            position: 'relative', overflow: 'hidden',
            ...(active ? {
                '&::before': {
                    content: '""',
                    position: 'absolute',
                    top: 0, left: 0, width: '100%', height: '100%',
                    background: 'linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.8) 50%, transparent 100%)',
                    animation: 'windowWipe 2s ease-in-out infinite',
                    zIndex: 1, pointerEvents: 'none',
                },
                '@keyframes windowWipe': {
                    '0%': { transform: 'translateX(-100%)' },
                    '100%': { transform: 'translateX(100%)' },
                },
            } : {}),
            ...sx,
        }}>
            <Typography variant="body2" sx={{ fontSize: 10, color: 'text.secondary' }}>
                {message}
            </Typography>
        </Box>
    );
};



/** Seconds options for stream/database auto-refresh interval (labels in i18n: dataThread.refreshInterval.*). */
const STREAM_REFRESH_INTERVAL_SECONDS = [1, 10, 30, 60, 300, 600, 1800, 3600, 86400] as const;

// Streaming Settings Popup Component
const StreamingSettingsPopup = memo<{
    open: boolean;
    anchorEl: HTMLElement | null;
    onClose: () => void;
    table: DictTable;
    onUpdateSettings: (autoRefresh: boolean, refreshIntervalSeconds?: number) => void;
    onRefreshNow?: () => void;
}>(({ open, anchorEl, onClose, table, onUpdateSettings, onRefreshNow }) => {
    const [refreshInterval, setRefreshInterval] = useState<number>(
        table.source?.refreshIntervalSeconds || 60
    );
    const [autoRefresh, setAutoRefresh] = useState<boolean>(
        table.source?.autoRefresh || false
    );
    const [selectMenuOpen, setSelectMenuOpen] = useState<boolean>(false);
    const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
    const { t } = useTranslation();

    useEffect(() => {
        if (open) {
            setRefreshInterval(table.source?.refreshIntervalSeconds || 60);
            setAutoRefresh(table.source?.autoRefresh || false);
        }
    }, [open, table.source]);

    const handleAutoRefreshChange = (enabled: boolean) => {
        setAutoRefresh(enabled);
        onUpdateSettings(enabled, enabled ? refreshInterval : undefined);
        if (!enabled) {
            onClose();
        }
    };

    const handleIntervalChange = (interval: number) => {
        setRefreshInterval(interval);
        if (autoRefresh) {
            onUpdateSettings(true, interval);
        }
    };

    const handleRefreshNow = async () => {
        if (onRefreshNow && !isRefreshing) {
            setIsRefreshing(true);
            try {
                await onRefreshNow();
            } finally {
                setIsRefreshing(false);
            }
        }
    };

    const handleClickAway = (event: MouseEvent | TouchEvent) => {
        // Don't close if the select menu is open
        if (selectMenuOpen) {
            return;
        }
        // Don't close if clicking on the select menu or menu items
        const target = event.target as HTMLElement;
        if (
            target.closest('.MuiMenu-root') ||
            target.closest('.MuiPaper-root')?.classList.contains('MuiMenu-paper') ||
            target.closest('[role="menuitem"]') ||
            target.closest('[role="listbox"]')
        ) {
            return;
        }
        onClose();
    };

    return (
        <Popper
            open={open}
            anchorEl={anchorEl}
            placement="bottom-start"
            style={{ zIndex: 1300 }}
        >
            <ClickAwayListener onClickAway={handleClickAway} mouseEvent="onMouseDown">
                <Paper
                    elevation={8}
                    sx={{
                        fontSize: 12,
                        p: 1.5,
                        mt: 1,
                        ...ViewBorderStyle,
                    }}
                >
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'nowrap' }}>
                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={autoRefresh}
                                        onChange={(e) => handleAutoRefreshChange(e.target.checked)}
                                        size="small"
                                    />
                                }
                                label={
                                    <Typography variant="body2" sx={{ fontSize: 11 }}>
                                        {t('dataThread.watchForUpdates')}
                                    </Typography>
                                }
                                sx={{ mr: 0 }}
                            />
                            {autoRefresh && (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 100 }}>
                                    <Typography variant="body2" sx={{ fontSize: 11, color: 'text.secondary' }}>
                                        {t('dataThread.every')}
                                    </Typography>
                                    <TextField
                                        select
                                        size="small"
                                        value={refreshInterval}
                                        onChange={(e) => handleIntervalChange(Number(e.target.value))}
                                        slotProps={{
                                            select: {
                                                open: selectMenuOpen,
                                                onOpen: () => setSelectMenuOpen(true),
                                                onClose: () => setSelectMenuOpen(false)
                                            }
                                        }}
                                        sx={{ 
                                            minWidth: 70,
                                            '& .MuiInputBase-root': { fontSize: 11, height: 28 },
                                            '& .MuiSelect-select': { py: 0.5 }
                                        }}
                                    >
                                        {STREAM_REFRESH_INTERVAL_SECONDS.map((sec) => (
                                            <MenuItem key={sec} value={sec}>
                                                {t(`dataThread.refreshInterval.${sec}`)}
                                            </MenuItem>
                                        ))}
                                    </TextField>
                                </Box>
                            )}
                            {onRefreshNow && (
                                <Button
                                    variant="outlined"
                                    size="small"
                                    onClick={handleRefreshNow}
                                    disabled={isRefreshing}
                                    startIcon={isRefreshing ? <CircularProgress size={14} /> : <RefreshIcon sx={{ fontSize: 14 }} />}
                                    sx={{
                                        fontSize: 11,
                                        textTransform: 'none',
                                        height: 28,
                                        alignSelf: 'flex-start'
                                    }}
                                >
                                    {t('dataThread.refreshNow')}
                                </Button>
                            )}
                        </Box>
                    </Box>
                </Paper>
            </ClickAwayListener>
        </Popper>
    );
});

// Table Metadata Viewer (read-only)
// Renders the source-supplied table description for connector/upload
// tables, or the agent-produced code explanation for derived tables.
// Per-column metadata is exposed elsewhere as header tooltips on the
// data preview, not here. Strictly read-only and strictly textual.
// See design-docs/23-table-description-unification.md.
const MetadataPopup = memo<{
    open: boolean;
    anchorEl: HTMLElement | null;
    onClose: () => void;
    table: DictTable | null;
}>(({ open, anchorEl, onClose, table }) => {
    const { t } = useTranslation();

    const tableName = table?.displayId || table?.id || '';
    const description = (table?.description || '').trim();
    const codeExplanation = (table?.derive?.explanation?.code || '').trim();

    return (
        <Popper
            open={open}
            anchorEl={anchorEl}
            placement="bottom-start"
            style={{ zIndex: 1300 }}
        >
            <ClickAwayListener onClickAway={onClose}>
                <Paper
                    elevation={8}
                    sx={{
                        width: 480,
                        maxHeight: '70vh',
                        overflow: 'auto',
                        fontSize: 12,
                        p: 2,
                        mt: 1,
                        ...ViewBorderStyle,
                    }}
                >
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                        {t('dataThread.metadataFor', { table: tableName, defaultValue: `Metadata for ${tableName}` })}
                    </Typography>

                    {description && (
                        <Typography sx={{ fontSize: 11.5, color: 'text.primary', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {description}
                        </Typography>
                    )}

                    {!description && codeExplanation && (
                        <Box>
                            <Typography sx={{ fontSize: 11, fontWeight: 600, color: 'text.secondary', mb: 0.5 }}>
                                {t('dataThread.derivationSummary', { defaultValue: 'Derivation summary' })}
                            </Typography>
                            <Typography sx={{ fontSize: 11.5, color: 'text.primary', whiteSpace: 'pre-wrap' }}>
                                {codeExplanation}
                            </Typography>
                        </Box>
                    )}

                    {!description && !codeExplanation && (
                        <Typography sx={{ fontSize: 11.5, color: 'text.disabled', fontStyle: 'italic' }}>
                            {t('dataThread.noMetadata', { defaultValue: 'No description available for this table.' })}
                        </Typography>
                    )}

                    <Box sx={{ mt: 1.5, display: 'flex' }}>
                        <Button size="small" sx={{ ml: 'auto' }} onClick={onClose} color="primary">{t('app.close', { defaultValue: 'Close' })}</Button>
                    </Box>
                </Paper>
            </ClickAwayListener>
        </Popper>
    );
});



// Rename table popup - opens as a small popper with a text field
const RenameTablePopup = memo<{
    open: boolean;
    anchorEl: HTMLElement | null;
    onClose: () => void;
    onSave: (newName: string) => void;
    initialValue: string;
    tableName: string;
}>(({ open, anchorEl, onClose, onSave, initialValue, tableName }) => {
    const [name, setName] = useState(initialValue);
    const { t } = useTranslation();

    useEffect(() => {
        setName(initialValue);
    }, [initialValue, open]);

    const handleSave = () => {
        if (name.trim() !== '') {
            onSave(name.trim());
            onClose();
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
            handleSave();
        } else if (e.key === 'Escape') {
            onClose();
        }
    };

    return (
        <Popper
            open={open}
            anchorEl={anchorEl}
            placement="bottom-start"
            style={{ zIndex: 1300 }}
        >
            <ClickAwayListener onClickAway={onClose}>
                <Paper
                    elevation={8}
                    sx={{ width: 240, fontSize: 12, p: 1.5, mt: 1, ...ViewBorderStyle }}
                >
                    <Typography variant="subtitle2" sx={{ mb: 0.5, fontSize: 12 }}>
                        {t('dataThread.renameTable')}
                    </Typography>
                    <TextField
                        autoFocus
                        fullWidth
                        variant="outlined"
                        size="small"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={handleKeyDown}
                        sx={{ my: 0.5, '& .MuiInputBase-input': { fontSize: 12 } }}
                    />
                    <Box sx={{ mt: 0.5, display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                        <Button size="small" onClick={onClose}>{t('app.cancel')}</Button>
                        <Button size="small" onClick={handleSave} color="primary" disabled={name.trim() === '' || name.trim() === initialValue}>{t('app.save')}</Button>
                    </Box>
                </Paper>
            </ClickAwayListener>
        </Popper>
    );
});

const WorkspacePanel: FC<{
    tables: DictTable[],
    chartElements: { tableId: string, chartId: string, element: any }[],
    sx?: SxProps,
}> = function ({ tables, chartElements, sx }) {
    const theme = useTheme();
    const { t } = useTranslation();
    const dispatch = useDispatch();
    const charts = useSelector(dfSelectors.getAllCharts);
    const focusedId = useSelector((state: DataFormulatorState) => state.focusedId);
    const focusedTableId = React.useMemo(() => {
        if (!focusedId) return undefined;
        if (focusedId.type === 'table') return focusedId.tableId;
        if (focusedId.type === 'chart') {
            const chart = charts.find(c => c.id === focusedId.chartId);
            return chart?.tableRef;
        }
        return undefined;
    }, [focusedId, charts]);
    const focusedChartId = focusedId?.type === 'chart' ? focusedId.chartId : undefined;
    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);
    const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
    const [agentRulesOpen, setAgentRulesOpen] = useState(false);
    const [workspaceExpanded, setWorkspaceExpanded] = useState(false);

    const fileItemSx = (isActive: boolean, isNested: boolean = false) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        px: 0.75,
        py: '3px',
        borderRadius: '3px',
        cursor: 'pointer',
        fontSize: 11,
        transition: transition.fast,
        backgroundColor: isActive ? alpha(theme.palette.primary.main, 0.08) : 'transparent',
        '&:hover': {
            backgroundColor: isActive ? alpha(theme.palette.primary.main, 0.12) : 'rgba(0,0,0,0.04)',
        },
    });

    const getTableIcon = (table: DictTable) => {
        const isStreaming = (table.source?.type === 'stream' || table.source?.type === 'database') && table.source?.autoRefresh;
        const iconSx = { width: 14, height: 14, color: 'text.secondary', flexShrink: 0 };
        if (isStreaming) return <StreamIcon sx={{ ...iconSx, color: theme.palette.success.main, animation: 'pulse 2s infinite', '@keyframes pulse': { '0%': { opacity: 1 }, '50%': { opacity: 0.4 }, '100%': { opacity: 1 } } }} />;
        if (table.virtual) return <TableIcon sx={{ ...iconSx, width: 14, height: 14 }} />;
        return <TableIcon sx={iconSx} />;
    };

    const getChartIcon = (chartType: string) => {
        const template = getChartTemplate(chartType);
        if (template && template.icon) {
            // Use chart template icon (it's an image path)
            if (typeof template.icon === 'string') {
                return <Box component="img" src={template.icon} sx={{ width: 14, height: 14, objectFit: 'contain' }} />;
            }
            // Or it could be a React component
            return <Box sx={{ width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.secondary' }}>{template.icon}</Box>;
        }
        // Fallback to generic chart icon
        return <InsightIcon sx={{ fontSize: 14, color: 'text.secondary' }} />;
    };

    const getChartFields = (chart: Chart) => {
        const encodings = Object.entries(chart.encodingMap)
            .filter(([_, encoding]) => encoding.fieldID)
            .map(([channel, encoding]) => {
                const field = conceptShelfItems.find(f => f.id === encoding.fieldID);
                return field?.name || encoding.fieldID;
            })
            .filter(Boolean);
        return encodings.slice(0, 3).join(', ') + (encodings.length > 3 ? '...' : '');
    };

    const getOriginalTableName = (table: DictTable): string | null => {
        if (table.derive) return null;
        const name = table.source?.originalTableName;
        if (!name || name === (table.displayId || table.id)) return null;
        return name;
    };

    const getSourceTooltip = (table: DictTable): string | null => {
        if (table.derive) return null;
        const src = table.source;
        if (!src) return null;
        switch (src.type) {
            case 'file': return src.fileName || t('dataThread.sourceFile');
            case 'paste': return t('dataThread.sourcePaste');
            case 'url': return src.url || t('dataThread.sourceUrl');
            case 'stream': {
                if (src.url) {
                    try { return new URL(src.url).hostname; } catch { /* fall through */ }
                }
                return t('dataThread.sourceStream');
            }
            case 'database': return src.databaseTable || t('dataThread.sourceDatabase');
            case 'example': return t('dataThread.sourceExample');
            case 'extract': return t('dataThread.sourceExtract');
            default: return null;
        }
    };

    return (
        <Box sx={{ ...sx,
            py: 0,
            mb: 0.5,
            backgroundColor: 'rgba(0,0,0,0.02)',
            borderBottom: `1px solid ${borderColor.divider}`,
            userSelect: 'none',
        }}>
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    px: 0.75,
                    py: '4px',
                    borderRadius: '3px',
                }}
            >
                <Box
                    sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', borderRadius: '3px',
                        '&:hover': { backgroundColor: 'rgba(0,0,0,0.04)' },
                        pr: 0.5, py: 0.5,
                    }}
                    onClick={() => setWorkspaceExpanded(!workspaceExpanded)}
                >
                    {workspaceExpanded ?
                        <ExpandMoreIcon sx={{ fontSize: 14, color: 'rgba(0,0,0,0.5)' }} /> :
                        <ChevronRightIcon sx={{ fontSize: 14, color: 'rgba(0,0,0,0.5)' }} />
                    }
                    <Typography sx={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.55)', textTransform: 'uppercase', letterSpacing: '0.5px', ml: 0.5 }}>
                        {t('dataThread.workspace')}
                    </Typography>
                </Box>
                <Box
                    onClick={(e) => { e.stopPropagation(); setUploadDialogOpen(true); }}
                    sx={{
                        display: 'flex', alignItems: 'center', gap: '2px',
                        ml: 'auto', px: '5px', py: '2px', borderRadius: '3px',
                        cursor: 'pointer', 
                        color: theme.palette.primary.textColor || theme.palette.primary.main,
                        '&:hover': { backgroundColor: alpha(theme.palette.primary.main, 0.08) },
                    }}
                >
                    <AddIcon sx={{ fontSize: 14 }} />
                    <Typography sx={{ fontSize: 11, fontWeight: 600 }}>{t('dataThread.addData')}</Typography>
                </Box>
            </Box>

            <Collapse in={workspaceExpanded} timeout={150}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px', mt: '2px', ml: '14px', py: 0.5 }}>
                    {tables.map((table, tableIndex) => {
                        const isTableActive = focusedTableId === table.id;
                        const tableCharts = chartElements.filter(ce => ce.tableId === table.id);
                        const originalName = getOriginalTableName(table);
                        const sourceTooltipText = getSourceTooltip(table);
                        const isLastTable = tableIndex === tables.length - 1;

                        const handleTableClick = () => {
                            dispatch(dfActions.setFocused({ type: 'table', tableId: table.id }));
                        };

                        return (
                            <Box
                                key={table.id}
                                sx={{
                                    position: 'relative',
                                    pl: 1.5,
                                    '&::before': {
                                        content: '""',
                                        position: 'absolute',
                                        left: 0,
                                        top: 0,
                                        bottom: isLastTable ? 'calc(100% - 10px)' : 0,
                                        width: '1px',
                                        backgroundColor: 'rgba(0,0,0,0.1)',
                                    },
                                    '&::after': {
                                        content: '""',
                                        position: 'absolute',
                                        left: 0,
                                        top: '10px',
                                        width: '8px',
                                        height: '1px',
                                        backgroundColor: 'rgba(0,0,0,0.1)',
                                    }
                                }}
                            >
                                <Tooltip title={sourceTooltipText || ''} placement="right" arrow disableHoverListener={!sourceTooltipText}>
                                    <Box
                                        sx={fileItemSx(isTableActive)}
                                        onClick={handleTableClick}
                                    >
                                        {getTableIcon(table)}
                                        <Box sx={{ flex: 1, minWidth: 0 }}>
                                            <Typography sx={{
                                                fontSize: 11,
                                                fontWeight: isTableActive ? 600 : 400,
                                                color: isTableActive ? 'primary.main' : 'text.primary',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                            }}>
                                                {table.displayId || table.id}
                                            </Typography>
                                            {originalName && (
                                                <Typography sx={{
                                                    fontSize: 9,
                                                    color: 'text.disabled',
                                                    lineHeight: 1.2,
                                                    mt: '2px',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                }}>
                                                    {originalName}
                                                </Typography>
                                            )}
                                        </Box>
                                        {table.description && (
                                            <AttachFileIcon sx={{ fontSize: 10, color: 'text.disabled', flexShrink: 0 }} />
                                        )}
                                    </Box>
                                </Tooltip>

                                {/* Show all charts for this table with vertical guide line */}
                                {tableCharts.length > 0 && (
                                    <Box sx={{
                                        position: 'relative',
                                        ml: '14px',
                                        mt: '2px',
                                    }}>
                                        {tableCharts.map((chartElement, idx) => {
                                            const chart = charts.find(c => c.id === chartElement.chartId);
                                            if (!chart) return null;

                                            const isChartActive = focusedChartId === chart.id;
                                            const isLast = idx === tableCharts.length - 1;

                                            const handleChartClick = () => {
                                                dispatch(dfActions.setFocused({ type: 'chart', chartId: chart.id }));
                                            };

                                            return (
                                                <Box
                                                    key={chart.id}
                                                    sx={{
                                                        position: 'relative',
                                                        pl: 1.5, // Connector area
                                                        '&::before': {
                                                            content: '""',
                                                            position: 'absolute',
                                                            left: 0,
                                                            top: 0,
                                                            bottom: isLast ? '50%' : 0,
                                                            width: '1px',
                                                            backgroundColor: 'rgba(0,0,0,0.1)',
                                                        },
                                                        '&::after': {
                                                            content: '""',
                                                            position: 'absolute',
                                                            left: 0,
                                                            top: '50%',
                                                            width: '8px',
                                                            height: '1px',
                                                            backgroundColor: 'rgba(0,0,0,0.1)',
                                                        }
                                                    }}
                                                >
                                                <Box
                                                    sx={fileItemSx(isChartActive, true)}
                                                    onClick={handleChartClick}
                                                >
                                                    {getChartIcon(chart.chartType)}
                                                    <Typography sx={{
                                                        fontSize: 11,
                                                        fontWeight: isChartActive ? 600 : 400,
                                                        color: isChartActive ? 'primary.main' : 'text.primary',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap',
                                                        flex: 1,
                                                        minWidth: 0,
                                                    }}>
                                                        {chart.chartType}
                                                    </Typography>
                                                </Box>
                                                </Box>
                                            );
                                        })}
                                    </Box>
                                )}
                            </Box>
                        );
                    })}
                </Box>
            </Collapse>

            <UnifiedDataUploadDialog
                open={uploadDialogOpen}
                onClose={() => setUploadDialogOpen(false)}
                initialTab="menu"
            />
            <AgentRulesDialog
                externalOpen={agentRulesOpen}
                onExternalClose={() => setAgentRulesOpen(false)}
            />
        </Box>
    );
};

let SingleThreadGroupView: FC<{
    threadIdx: number,
    threadLabel?: string, // Custom label; absent on continuation segments
    isSplitThread?: boolean, // When true, this is a continuation: truncate used tables to immediate parent + render "↑ continued" header
    hasContinuationBelow?: boolean, // When true, render "↓ continues below" footer
    hideLabel?: boolean, // When true, hide the thread label divider
    leafTables: DictTable[];
    chartElements: { tableId: string, chartId: string, element: any }[];
    usedIntermediateTableIds: string[],
    globalHighlightedTableIds: string[],
    focusedThreadLeafId?: string, // The leaf table ID of the thread containing the focused table
    sx?: SxProps
}> = function ({
    threadIdx,
    threadLabel,
    isSplitThread = false,
    hasContinuationBelow = false,
    hideLabel = false,
    leafTables,
    chartElements,
    usedIntermediateTableIds,
    globalHighlightedTableIds,
    focusedThreadLeafId,
    sx
}) {

    let tables = useSelector((state: DataFormulatorState) => state.tables);
    const { t } = useTranslation();
    const { manualRefresh } = useDataRefresh();
    const tableById = useMemo(() => new Map(tables.map(t => [t.id, t])), [tables]);

    let leafTableIds = leafTables.map(lt => lt.id);
    // Thread is highlighted only if this thread's leaf tables include the focused thread's leaf
    const threadHighlighted = focusedThreadLeafId 
        ? leafTableIds.includes(focusedThreadLeafId) 
        : false;
    // Ancestor thread: not the focused thread, but *owns* some highlighted tables
    // (tables that only appear as used/shared references don't count)
    const isAncestorThread = !threadHighlighted && globalHighlightedTableIds.length > 0
        && leafTables.some(lt => {
            const trigs = getTriggers(lt, tables);
            const chainIds = [...trigs.map(tp => tp.tableId), lt.id];
            const ownedIds = chainIds.filter(id => !usedIntermediateTableIds.includes(id));
            return ownedIds.some(id => globalHighlightedTableIds.includes(id));
        });
    const shouldHighlightThread = threadHighlighted || isAncestorThread;
    let parentTableId = leafTables[0].derive?.trigger.tableId || undefined;
    let parentTable = (parentTableId ? tableById.get(parentTableId) : undefined) as DictTable;

    let charts = useSelector(dfSelectors.getAllCharts);
    let focusedId = useSelector((state: DataFormulatorState) => state.focusedId);
    let focusedChartId = focusedId?.type === 'chart' ? focusedId.chartId : undefined;
    let focusedTableId = useMemo(() => {
        if (!focusedId) return undefined;
        if (focusedId.type === 'table') return focusedId.tableId;
        if (focusedId.type === 'chart') {
            const chart = charts.find(c => c.id === focusedId.chartId);
            return chart?.tableRef;
        }
        return undefined;
    }, [focusedId, charts]);
    let draftNodes = useSelector((state: DataFormulatorState) => state.draftNodes);
    let generatedReports = useSelector(dfSelectors.getAllGeneratedReports);

    // Build a map from tableId → reports triggered from that table
    const reportsByTriggerTable = useMemo(() => {
        const map = new Map<string, GeneratedReport[]>();
        for (const report of generatedReports) {
            const triggerId = report.triggerTableId;
            if (!triggerId) continue;
            const list = map.get(triggerId) || [];
            list.push(report);
            map.set(triggerId, list);
        }
        return map;
    }, [generatedReports]);

    // Pre-index running/clarifying/completed status from DraftNodes
    const runningAgentTableIds = useMemo(() => {
        const ids = new Map<string, { description: string }>();
        for (const d of draftNodes) {
            if (d.derive?.status === 'running') {
                ids.set(d.derive.trigger.tableId, { description: d.derive.runningPlan || '' });
            }
        }
        return ids;
    }, [draftNodes]);

    const clarifyAgentTableIds = useMemo(() => {
        const ids = new Map<string, { question: string }>();
        for (const d of draftNodes) {
            if (d.derive?.status === 'clarifying') {
                // The pause entry is either 'clarify' or 'explain'; both shape
                // the timeline the same way.
                const pauseEntry = d.derive.trigger.interaction
                    ?.filter(e => e.role === 'clarify' || e.role === 'explain').pop();
                ids.set(d.derive.trigger.tableId, { question: pauseEntry?.content || '' });
            }
        }
        return ids;
    }, [draftNodes]);

    // Metadata popup state
    const [metadataPopupOpen, setMetadataPopupOpen] = useState(false);
    const [selectedTableForMetadata, setSelectedTableForMetadata] = useState<DictTable | null>(null);
    const [metadataAnchorEl, setMetadataAnchorEl] = useState<HTMLElement | null>(null);

    // Table menu state
    const [tableMenuAnchorEl, setTableMenuAnchorEl] = useState<HTMLElement | null>(null);
    const [selectedTableForMenu, setSelectedTableForMenu] = useState<DictTable | null>(null);

    // Refresh data dialog state
    const [refreshDialogOpen, setRefreshDialogOpen] = useState(false);
    const [selectedTableForRefresh, setSelectedTableForRefresh] = useState<DictTable | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);

    // Streaming settings popup state
    const [streamingSettingsPopupOpen, setStreamingSettingsPopupOpen] = useState(false);
    const [selectedTableForStreamingSettings, setSelectedTableForStreamingSettings] = useState<DictTable | null>(null);
    const [streamingSettingsAnchorEl, setStreamingSettingsAnchorEl] = useState<HTMLElement | null>(null);

    let handleUpdateTableDisplayId = (tableId: string, displayId: string) => {
        dispatch(dfActions.updateTableDisplayId({
            tableId: tableId,
            displayId: displayId
        }));
    }

    // Rename popup state
    const [renamePopupOpen, setRenamePopupOpen] = useState(false);
    const [selectedTableForRename, setSelectedTableForRename] = useState<DictTable | null>(null);
    const [renameAnchorEl, setRenameAnchorEl] = useState<HTMLElement | null>(null);

    const handleOpenRenamePopup = (table: DictTable, anchorEl: HTMLElement) => {
        setSelectedTableForRename(table);
        setRenameAnchorEl(anchorEl);
        setRenamePopupOpen(true);
    };

    const handleCloseRenamePopup = () => {
        setRenamePopupOpen(false);
        setSelectedTableForRename(null);
        setRenameAnchorEl(null);
    };

    const handleSaveRename = (newName: string) => {
        if (selectedTableForRename) {
            handleUpdateTableDisplayId(selectedTableForRename.id, newName);
        }
    };

    const handleOpenMetadataPopup = (table: DictTable, anchorEl: HTMLElement) => {
        setSelectedTableForMetadata(table);
        setMetadataAnchorEl(anchorEl);
        setMetadataPopupOpen(true);
    };

    const handleCloseMetadataPopup = () => {
        setMetadataPopupOpen(false);
        setSelectedTableForMetadata(null);
        setMetadataAnchorEl(null);
    };

    // Table menu handlers
    const handleOpenTableMenu = (table: DictTable, anchorEl: HTMLElement) => {
        setSelectedTableForMenu(table);
        setTableMenuAnchorEl(anchorEl);
    };

    const handleCloseTableMenu = () => {
        setTableMenuAnchorEl(null);
        setSelectedTableForMenu(null);
    };

    // Refresh data handlers
    const handleOpenRefreshDialog = (table: DictTable) => {
        setSelectedTableForRefresh(table);
        setRefreshDialogOpen(true);
        handleCloseTableMenu();
    };

    const handleCloseRefreshDialog = () => {
        setRefreshDialogOpen(false);
        setSelectedTableForRefresh(null);
    };

    // Streaming settings handlers
    const handleOpenStreamingSettingsPopup = (table: DictTable, anchorEl: HTMLElement) => {
        setSelectedTableForStreamingSettings(table);
        setStreamingSettingsAnchorEl(anchorEl);
        setStreamingSettingsPopupOpen(true);
    };

    const handleCloseStreamingSettingsPopup = () => {
        setStreamingSettingsPopupOpen(false);
        setSelectedTableForStreamingSettings(null);
        setStreamingSettingsAnchorEl(null);
    };

    const handleUpdateStreamingSettings = (autoRefresh: boolean, refreshIntervalSeconds?: number) => {
        if (selectedTableForStreamingSettings) {
            dispatch(dfActions.updateTableSourceRefreshSettings({
                tableId: selectedTableForStreamingSettings.id,
                autoRefresh,
                refreshIntervalSeconds
            }));
        }
    };

    // Function to refresh derived tables in batch.
    // Collects all results first, then dispatches a single updateMultipleTableRows.
    const refreshDerivedTables = async (sourceTableId: string, newRows: any[]) => {
        const derivedTables = tables.filter(t => t.derive?.source?.includes(sourceTableId));
        if (derivedTables.length === 0) return;
        
        const refreshPromises = derivedTables
            .filter(dt => dt.derive && dt.derive.code && dt.derive.codeSignature)
            .map(async (derivedTable) => {
                const parentTableData = derivedTable.derive!.source.map(sourceId => {
                    const sourceTable = tables.find(t => t.id === sourceId);
                    if (sourceTable) {
                        const rows = sourceId === sourceTableId ? newRows : sourceTable.rows;
                        const tableName = sourceTable.virtual?.tableId || sourceTable.id.replace(/\.[^/.]+$/, "");
                        return { name: tableName, rows };
                    }
                    return null;
                }).filter(t => t !== null);

                if (parentTableData.length === 0) return null;

                try {
                    const requestBody: any = {
                        input_tables: parentTableData,
                        code: derivedTable.derive!.code,
                        code_signature: derivedTable.derive!.codeSignature, // HMAC proof
                        output_variable: derivedTable.derive!.outputVariable || 'result_df',
                        virtual: !!derivedTable.virtual?.tableId,
                        output_table_name: derivedTable.virtual?.tableId
                    };
                    
                    const { data: result } = await apiRequest<any>(getUrls().REFRESH_DERIVED_DATA, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(requestBody)
                    });

                    if (result.rows) {
                        return { tableId: derivedTable.id, rows: result.rows } as { tableId: string, rows: any[] };
                    } else {
                        console.error(`Failed to refresh derived table ${derivedTable.id}:`, result.message);
                        dispatch(dfActions.addMessages({
                            timestamp: Date.now(),
                            type: 'error',
                            component: t('messages.dataRefresh.component'),
                            value: t('messages.dataRefresh.failedDerivedTable', {
                                table: derivedTable.displayId || derivedTable.id,
                                detail: result.message || t('messages.dataRefresh.unknownError'),
                            }),
                        }));
                        return null;
                    }
                } catch (error) {
                    console.error(`Error refreshing derived table ${derivedTable.id}:`, error);
                    dispatch(dfActions.addMessages({
                        timestamp: Date.now(),
                        type: 'error',
                        component: t('messages.dataRefresh.component'),
                        value: t('messages.dataRefresh.errorRefreshingDerivedTable', {
                            table: derivedTable.displayId || derivedTable.id,
                        }),
                    }));
                    return null;
                }
            });

        const results = await Promise.all(refreshPromises);
        const successfulUpdates = results.filter((r): r is { tableId: string, rows: any[] } => r !== null);
        
        if (successfulUpdates.length > 0) {
            // Single batch dispatch instead of N individual dispatches
            dispatch(dfActions.updateMultipleTableRows(successfulUpdates));
        }
    };

    const handleRefreshComplete = async (newRows: any[]) => {
        if (!selectedTableForRefresh) return;

        setIsRefreshing(true);
        try {
            // Update the source table with new rows
            dispatch(dfActions.updateTableRows({
                tableId: selectedTableForRefresh.id,
                rows: newRows
            }));

            // Refresh all derived tables
            await refreshDerivedTables(selectedTableForRefresh.id, newRows);

            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                type: 'success',
                component: t('messages.dataRefresh.component'),
                value: t('messages.dataRefresh.successRefreshedWithDerived', {
                    table: selectedTableForRefresh.displayId || selectedTableForRefresh.id,
                }),
            }));
        } catch (error) {
            console.error('Error during refresh:', error);
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                type: 'error',
                component: t('messages.dataRefresh.component'),
                value: t('messages.dataRefresh.errorRefreshingData', { error: String(error) }),
            }));
        } finally {
            setIsRefreshing(false);
        }
    };

    const theme = useTheme();

    let focusedChart = useSelector((state: DataFormulatorState) => charts.find(c => c.id == focusedChartId));

    const dispatch = useDispatch();

    let [collapsed, setCollapsed] = useState<boolean>(false);

    const w: any = (a: any[], b: any[], spaceElement?: any) => a.length ? [a[0], b.length == 0 ? "" : (spaceElement || ""), ...w(b, a.slice(1), spaceElement)] : b;
    
    let triggerPairs = parentTable ? getTriggers(parentTable, tables) : [];
    let tableIdList = parentTable ? [...triggerPairs.map((tp) => tp.tableId), parentTable.id] : [];

    let usedTableIdsInThread = tableIdList.filter(id => usedIntermediateTableIds.includes(id));
    let newTableIds = tableIdList.filter(id => !usedTableIdsInThread.includes(id));
    let newTriggerPairs = triggerPairs.filter(tp => newTableIds.includes(tp.resultTableId));

    // Use the global highlighted table IDs (computed at DataThread level from the focused table's full ancestor chain)
    let highlightedTableIds = globalHighlightedTableIds;

    let _buildTriggerCard = (trigger: Trigger, highlighted: boolean = false) => {
        return buildTriggerCard(trigger, focusedChartId, highlighted);
    }

    // Shared props for buildTableCard calls
    let tableCardProps: Omit<BuildTableCardProps, 'tableId'> = {
        tables, charts, chartElements, usedIntermediateTableIds,
        highlightedTableIds, focusedTableId, focusedChartId, focusedChart,
        parentTable, tableIdList, collapsed, dispatch,
        handleOpenTableMenu, primaryBgColor: theme.palette.primary.bgcolor,
        t,
        showOriginalName: threadIdx === -1,
    };

    let _buildTableCard = (tableId: string, opts?: { ghost?: boolean }) => {
        return buildTableCard({ tableId, ...tableCardProps, ...(opts || {}) });
    }

    let tableElementList = newTableIds.map((tableId, i) => _buildTableCard(tableId));
    let triggerCards = newTriggerPairs.map((tp) => {
        const isHL = highlightedTableIds.includes(tp.resultTableId);
        return _buildTriggerCard(tp, isHL);
    });

    // Build a flat sequence of timeline items: [trigger, table, charts, trigger, table, charts, ...]
    type TimelineItem = { key: string; element: React.ReactNode; type: 'used-table' | 'trigger' | 'table' | 'chart' | 'leaf-trigger' | 'leaf-table' | 'report'; highlighted: boolean; tableId?: string; chartType?: string; isRunning?: boolean; isClarifying?: boolean; isCompleted?: boolean; interactionEntry?: InteractionEntry; reportId?: string; stepLabel?: string };
    let timelineItems: TimelineItem[] = [];

    // ── Shared helpers for building timeline items from interaction entries ──

    /** Push visible interaction entries as timeline items.
     *  Adaptively collapses: when a data-agent summary is immediately followed
     *  by an instruction, the summary text is folded into the instruction's
     *  `plan` (expandable) rather than shown as a separate entry. */
    const pushInteractionEntries = (
        entries: InteractionEntry[],
        tableId: string,
        triggerType: 'trigger' | 'leaf-trigger',
        highlighted: boolean,
        keyPrefix: string,
        extraProps?: Partial<TimelineItem>,
    ) => {
        // Enrich instruction entries with inputTableNames from derive.source if not already set
        const derivedTable = tableById.get(tableId);
        const deriveSourceNames = derivedTable?.derive?.source
            ? (derivedTable.derive.source as string[]).map(sid => {
                const st = tableById.get(sid);
                return st?.displayId || sid.replace(/\.[^/.]+$/, "");
            })
            : undefined;

        for (let ei = 0; ei < entries.length; ei++) {
            const entry = entries[ei];
            const nextEntry = ei + 1 < entries.length ? entries[ei + 1] : null;

            // Collapse: summary from data-agent followed by instruction → fold into instruction's plan
            if (entry.role === 'summary' && entry.from === 'data-agent'
                && nextEntry?.role === 'instruction') {
                // Merge: use the summary content as the plan on the next instruction
                // (only if the instruction doesn't already have a plan)
                if (!nextEntry.plan) {
                    nextEntry.plan = entry.content;
                }
                continue; // skip rendering this summary entry
            }

            // Enrich instruction entries with source table names
            const enrichedEntry = (entry.role === 'instruction' && !entry.inputTableNames && deriveSourceNames)
                ? { ...entry, inputTableNames: deriveSourceNames }
                : entry;

            const isResolved = (entry.role === 'clarify' || entry.role === 'explain')
                && entries.slice(ei + 1).some(e => e.from === 'user');
            timelineItems.push({
                key: `${keyPrefix}-${entry.role}-${tableId}-${ei}`,
                type: triggerType,
                highlighted,
                element: <InteractionEntryCard entry={enrichedEntry} highlighted={highlighted} resolved={isResolved} />,
                interactionEntry: entry,
                ...extraProps,
            });
        }
    };

    /** Split interaction at the last instruction boundary: entries before → rendered before table, after → rendered after. */
    const splitAtLastInstruction = (interaction: InteractionEntry[]): [InteractionEntry[], InteractionEntry[]] => {
        const lastInstrIdx = (() => { for (let i = interaction.length - 1; i >= 0; i--) { if (interaction[i].role === 'instruction') return i; } return -1; })();
        return [
            interaction.slice(0, lastInstrIdx + 1),
            lastInstrIdx >= 0 ? interaction.slice(lastInstrIdx + 1) : [],
        ];
    };

    /** Append timeline items for a running, clarifying, or explaining agent draft.
     *
     *  When the interaction contains a clarify/explain entry (with a `plan`
     *  snapshot of the first-round thinking steps), the rendering is split:
     *    1. Entries before the pause (user prompt)
     *    2. ThinkingStepsBanner for first-round steps (from pause entry's plan)
     *    3. Pause entry + user response entries
     *    4. ThinkingStepsBanner for second-round steps (from runningPlan)
     */
    const pushAgentDraftItems = (
        tableId: string,
        triggerType: 'trigger' | 'leaf-trigger',
        highlighted: boolean,
    ) => {
        const renderSplitByClarity = (
            interaction: InteractionEntry[],
            runningPlan: string | undefined,
            isRunning: boolean,
            keyPrefix: string,
        ) => {
            const pauseIdx = interaction.findIndex(e => e.role === 'clarify' || e.role === 'explain');
            if (pauseIdx < 0) {
                // No pause — render all entries then ThinkingStepsBanner
                pushInteractionEntries(interaction, tableId, triggerType, highlighted, keyPrefix);
                const planLines = (runningPlan || t('dataThread.thinking')).split('\x1E').filter((l: string) => l.trim());
                timelineItems.push({
                    key: `agent-thinking-${tableId}`,
                    type: triggerType,
                    highlighted,
                    isRunning,
                    element: ThinkingStepsBanner(planLines, { px: 1, py: 0.5 }),
                });
                return;
            }

            // Split at the pause entry
            const beforePause = interaction.slice(0, pauseIdx);
            const pauseAndAfter = interaction.slice(pauseIdx);
            const pauseEntry = interaction[pauseIdx];

            // 1. Entries before the pause (user prompt etc.)
            if (beforePause.length > 0) {
                pushInteractionEntries(beforePause, tableId, triggerType, highlighted, `${keyPrefix}-pre`);
            }

            // 2. First-round thinking steps (snapshotted in pause entry's plan)
            if (pauseEntry.plan) {
                const priorLines = (pauseEntry.plan.includes('\x1E') ? pauseEntry.plan.split('\x1E') : pauseEntry.plan.split('\n')).filter((l: string) => l.trim());
                if (priorLines.length > 0) {
                    timelineItems.push({
                        key: `agent-thinking-prior-${tableId}`,
                        type: triggerType,
                        highlighted,
                        isRunning: false,
                        element: ThinkingStepsBanner(priorLines, { px: 1, py: 0.5 }),
                    });
                }
            }

            // 3. Pause + response entries
            pushInteractionEntries(pauseAndAfter, tableId, triggerType, highlighted, `${keyPrefix}-post`, { isClarifying: false, tableId });

            // 4. Second-round thinking steps (current runningPlan)
            if (isRunning) {
                const planLines = (runningPlan || t('dataThread.thinking')).split('\x1E').filter((l: string) => l.trim());
                timelineItems.push({
                    key: `agent-thinking-${tableId}`,
                    type: triggerType,
                    highlighted,
                    isRunning: true,
                    element: ThinkingStepsBanner(planLines, { px: 1, py: 0.5 }),
                });
            }
        };

        if (runningAgentTableIds.has(tableId)) {
            const runningDraft = draftNodes.find(d => d.derive?.status === 'running' && d.derive.trigger.tableId === tableId);
            const draftInteraction = runningDraft?.derive?.trigger?.interaction;
            if (draftInteraction && draftInteraction.length > 0) {
                renderSplitByClarity(
                    draftInteraction,
                    runningDraft?.derive?.runningPlan,
                    true,
                    'agent-running-entry',
                );
            } else {
                const runningAction = runningAgentTableIds.get(tableId);
                const message = runningAction?.description || t('dataThread.working');
                timelineItems.push({
                    key: `agent-running-${tableId}`,
                    type: 'chart',
                    highlighted,
                    isRunning: true,
                    element: ThinkingBanner(message, { px: 1, py: 0.5 }),
                });
            }
        } else if (clarifyAgentTableIds.has(tableId)) {
            const clarifyDraft = draftNodes.find(d => d.derive?.status === 'clarifying' && d.derive.trigger.tableId === tableId);
            const clarifyInteraction = clarifyDraft?.derive?.trigger?.interaction;
            if (clarifyInteraction && clarifyInteraction.length > 0) {
                renderSplitByClarity(
                    clarifyInteraction,
                    undefined,
                    false,
                    'agent-clarify-entry',
                );
                const lastItem = timelineItems[timelineItems.length - 1];
                if (lastItem?.interactionEntry?.role === 'clarify' || lastItem?.interactionEntry?.role === 'explain') {
                    lastItem.isClarifying = true;
                }
            } else {
                timelineItems.push({
                    key: `agent-clarify-${tableId}`,
                    type: 'chart',
                    highlighted,
                    isClarifying: true,
                    tableId,
                    element: <Typography variant="body2" sx={{ fontSize: 10, color: theme.palette.warning.main, px: 1, py: 0.5 }}>{t('dataThread.waitingForClarification')}</Typography>,
                });
            }
        }
    };

    /** Push table card and its chart elements as timeline items. */
    const pushTableAndChartItems = (
        tableId: string,
        tableCard: any,
        tableType: 'table' | 'leaf-table',
        highlighted: boolean,
    ) => {
        if (Array.isArray(tableCard)) {
            tableCard.forEach((subItem: any, j: number) => {
                if (!subItem) return;
                const subKey = subItem?.key || `card-${tableId}-${j}`;
                const isChart = subKey.includes('chart');
                let itemChartType: string | undefined;
                if (isChart) {
                    const cIdMatch = subKey.match(/(?:chart)-(.+)$/);
                    if (cIdMatch) {
                        const cObj = charts.find(c => c.id === cIdMatch[1]);
                        itemChartType = cObj?.chartType;
                    }
                }
                timelineItems.push({
                    key: subKey,
                    type: isChart ? 'chart' : tableType,
                    tableId: isChart ? undefined : tableId,
                    chartType: itemChartType,
                    highlighted,
                    element: subItem,
                });
            });
        }
    };

    // Push report cards triggered from the given table
    const pushReportItems = (tableId: string, highlighted: boolean) => {
        const reports = reportsByTriggerTable.get(tableId);
        if (!reports) return;
        for (const report of reports) {
                const isFocused = focusedId?.type === 'report' && focusedId.reportId === report.id;
                const isGenerating = report.status === 'generating';
                const selectedClassName = isFocused ? 'selected-report-card' : '';
                timelineItems.push({
                    key: `report-${report.id}`,
                    type: 'report',
                    reportId: report.id,
                    highlighted: highlighted || isFocused,
                    element: (
                        <Card className={`data-thread-card ${selectedClassName}`} elevation={0}
                            sx={{
                                width: '100%',
                                backgroundColor: theme.palette.secondary.bgcolor,
                                ...ComponentBorderStyle,
                                ...(highlighted ? { borderLeft: '2px solid', borderLeftColor: 'secondary.main' } : {}),
                                borderRadius: '6px',
                                cursor: 'pointer',
                            }}
                            onClick={() => {
                                dispatch(dfActions.setFocused({ type: 'report', reportId: report.id }));
                            }}
                        >
                            <Box sx={{ margin: '0px', display: 'flex', minWidth: 0, alignItems: 'center',
                                '& .report-delete-btn': { opacity: 0, transition: 'opacity 0.15s' },
                                '&:hover .report-delete-btn': { opacity: 1 },
                            }}>
                                <Box sx={{ margin: '4px 8px 4px 6px', minWidth: 0, flex: 1 }}>
                                    <Typography sx={{
                                        fontSize: 11,
                                        fontWeight: 500,
                                        color: 'text.primary',
                                        display: '-webkit-box',
                                        WebkitLineClamp: 2,
                                        WebkitBoxOrient: 'vertical',
                                        overflow: 'hidden',
                                        wordBreak: 'break-all',
                                    }}>
                                        {report.title || t('report.untitled')}
                                    </Typography>
                                    {isGenerating && (
                                        <Typography sx={{
                                            fontSize: 9,
                                            color: 'text.disabled',
                                            lineHeight: 1.3,
                                            mt: 0.25,
                                        }}>
                                            {t('report.composing')}
                                        </Typography>
                                    )}
                                </Box>
                                <Tooltip title={t('dataThread.deleteReport')}>
                                    <IconButton
                                        className="report-delete-btn"
                                        size="small"
                                        color="error"
                                        sx={{ p: 0.5, mr: 0.5, '&:hover': { transform: 'scale(1.15)' } }}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            dispatch(dfActions.deleteGeneratedReport(report.id));
                                        }}
                                    >
                                        <DeleteIcon sx={{ fontSize: 16 }} />
                                    </IconButton>
                                </Tooltip>
                            </Box>
                        </Card>
                    ),
                });
        }
    };

    // Add used (shared) tables at the top
    // Show the immediate parent as a full table card, with "..." for further ancestors.
    // On a continuation segment (isSplitThread), suppress the "..." — the
    // continuation header already signals carry-over and the ghost table card
    // names the parent explicitly.
    let displayedUsedTableIds = usedTableIdsInThread;
    if (usedTableIdsInThread.length > 1) {
        displayedUsedTableIds = usedTableIdsInThread.slice(-1);
        if (!isSplitThread) {
            timelineItems.push({
                key: 'used-table-ellipsis',
                type: 'used-table',
                highlighted: false,
                element: (
                    <Typography sx={{ fontSize: '10px', color: 'text.disabled' }}>
                        …
                    </Typography>
                ),
            });
        }
    }
    displayedUsedTableIds.forEach((tableId, i) => {
        const isHighlighted = highlightedTableIds.includes(tableId);
        // On a continuation segment, render the carry-over parent as a
        // non-interactive "ghost" so it's clearly an orientation aid, not a
        // fresh table — no background color, dashed border, no actions.
        pushTableAndChartItems(
            tableId,
            _buildTableCard(tableId, { ghost: isSplitThread }),
            'table',
            isHighlighted,
        );
    });

    // Interleave triggers and tables for the main thread body
    const afterTableMap = new Map<string, InteractionEntry[]>();
    newTableIds.forEach((tableId, i) => {
        const triggerPair = newTriggerPairs.find(tp => tp.resultTableId === tableId);
        const isHighlighted = highlightedTableIds.includes(tableId);

        // Add trigger card (or interaction log entries) if exists
        if (triggerPair) {
            const interaction = triggerPair.interaction;
            if (interaction && interaction.length > 0) {
                const [beforeTable, afterTable] = splitAtLastInstruction(interaction);
                pushInteractionEntries(beforeTable, tableId, 'trigger', isHighlighted, 'interaction');
                if (afterTable.length > 0) afterTableMap.set(tableId, afterTable);
            } else {
                // No interaction log, use trigger card directly
                const triggerCard = triggerCards[newTriggerPairs.indexOf(triggerPair)];
                if (triggerCard) {
                    timelineItems.push({
                        key: triggerCard?.key || `woven-trigger-${tableId}`,
                        type: 'trigger',
                        highlighted: isHighlighted,
                        element: triggerCard,
                    });
                }
            }
        }

        // Add table card and its charts
        pushTableAndChartItems(tableId, tableElementList[i], 'table', isHighlighted);

        // Add report cards anchored to charts of this table
        pushReportItems(tableId, isHighlighted);

        // After-table entries (e.g. summary)
        const afterTable = afterTableMap.get(tableId);
        if (afterTable && afterTable.length > 0) {
            pushInteractionEntries(afterTable, tableId, 'trigger', isHighlighted, 'interaction-after');
        }

        // Running or clarifying agent state
        pushAgentDraftItems(tableId, 'trigger', isHighlighted);
    });

    // Add leaf table components
    const leafAfterTableMap = new Map<string, InteractionEntry[]>();
    leafTables.forEach((lt, i) => {
        let leafTrigger = lt.derive?.trigger;
        const isHL = highlightedTableIds.includes(lt.id);

        if (leafTrigger) {
            const interaction = leafTrigger.interaction;
            if (interaction && interaction.length > 0) {
                const [leafBefore, leafAfter] = splitAtLastInstruction(interaction);
                pushInteractionEntries(leafBefore, lt.id, 'leaf-trigger', isHL, 'leaf-interaction');
                if (leafAfter.length > 0) leafAfterTableMap.set(lt.id, leafAfter);
            } else {
                timelineItems.push({
                    key: `leaf-trigger-${lt.id}`,
                    type: 'leaf-trigger',
                    highlighted: isHL,
                    element: _buildTriggerCard(leafTrigger, isHL),
                });
            }
        }

        pushTableAndChartItems(lt.id, _buildTableCard(lt.id), 'leaf-table', isHL);

        // Add report cards anchored to charts of this leaf table
        pushReportItems(lt.id, isHL);

        // After-table entries (e.g. summary)
        const leafAfterEntries = leafAfterTableMap.get(lt.id);
        if (leafAfterEntries && leafAfterEntries.length > 0) {
            pushInteractionEntries(leafAfterEntries, lt.id, 'leaf-trigger', isHL, 'leaf-after');
        }

        // Running or clarifying agent state
        pushAgentDraftItems(lt.id, 'leaf-trigger', isHL);
    });

    // Timeline rendering helper
    const TIMELINE_WIDTH = 14;
    const TIMELINE_GAP = '4px'; // gap between timeline and card content
    const DOT_SIZE = 6;
    const CARD_PY = '6px'; // vertical padding for each timeline row

    // CSS `border-style: dashed` stretches dashes to fit each element's
    // height, so stacked segments end up with mismatched dash lengths.  A
    // fixed-size background pattern keeps every dash the same regardless of
    // the segment's height — the line reads as one continuous stroke even
    // when split across multiple boxes.
    const DASH_COLOR = 'rgba(0,0,0,0.22)';
    const dashedLineSx = {
        width: '2px',
        backgroundImage: `linear-gradient(to bottom, ${DASH_COLOR} 50%, transparent 50%)`,
        backgroundSize: '2px 6px',
        backgroundRepeat: 'repeat-y',
        backgroundPosition: 'top center',
    } as const;

    // Gutter icon for clarify/explain pause entries.
    // Both share the SmartToy bouncing pulse to call attention; only the
    // color differs (clarify = warning, explain = info) so they match the
    // entry card's palette.
    const getClarifyIcon = (item: typeof timelineItems[0]) => {
        const role = item.interactionEntry?.role;
        const color = role === 'explain' ? theme.palette.info.main : theme.palette.warning.main;
        return <SmartToyOutlinedIcon sx={{
            width: 14, height: 14, color,
            animation: 'df-clarify-bounce 1.4s ease-in-out infinite',
            '@keyframes df-clarify-bounce': {
                '0%, 100%': { transform: 'scale(1) translateY(0)' },
                '30%':      { transform: 'scale(1.25) translateY(-2px)' },
                '60%':      { transform: 'scale(0.95) translateY(1px)' },
            },
        }} />;
    };

    const getTimelineDot = (item: typeof timelineItems[0]) => {
        const isTable = item.type === 'table' || item.type === 'leaf-table' || item.type === 'used-table';
        const color = item.highlighted 
            ? theme.palette.primary.main
            : 'rgba(0,0,0,0.15)';

        // For report items, show an article icon or spinner if generating
        if (item.type === 'report') {
            const report = item.reportId ? generatedReports.find(r => r.id === item.reportId) : undefined;
            if (report?.status === 'generating') {
                return <CircularProgress size={12} thickness={5} sx={{ color: theme.palette.secondary.main }} />;
            }
            return <ArticleIcon sx={{ width: 14, height: 14, color: item.highlighted ? theme.palette.secondary.main : 'rgba(0,0,0,0.3)' }} />;
        }

        // For running agent items, show a spinner instead of a dot
        if (item.isRunning) {
            return <CircularProgress size={12} thickness={5} sx={{ color: theme.palette.primary.main }} />;
        }

        // For clarification / explanation items, show an attention icon
        if (item.isClarifying) {
            return getClarifyIcon(item);
        }

        // For completed items, show a checkmark icon
        if (item.isCompleted) {
            return <CheckCircleOutlineIcon sx={{ width: 12, height: 12, color: theme.palette.success.main }} />;
        }

        // For table items, show a type-specific icon instead of a dot
        if (isTable && item.tableId) {
            const tableForDot = tableById.get(item.tableId);
            const iconSx = { width: 14, height: 14, color };
            const isStreaming = tableForDot && (tableForDot.source?.type === 'stream' || tableForDot.source?.type === 'database') && tableForDot.source?.autoRefresh;

            if (isStreaming) {
                return <StreamIcon sx={{ 
                    ...iconSx, 
                    color: item.highlighted ? theme.palette.success.main : 'rgba(0,0,0,0.15)',
                    animation: 'pulse 2s infinite',
                    '@keyframes pulse': {
                        '0%': { opacity: 1 },
                        '50%': { opacity: 0.4 },
                        '100%': { opacity: 1 },
                    },
                }} />;
            }
            if (tableForDot?.virtual) {
                return <TableIcon sx={{ ...iconSx, width: 14, height: 14 }} />;
            }
            return <TableIcon sx={iconSx} />;
        }

        // For chart items, show a chart-type-specific icon
        if (item.type === 'chart' && item.chartType) {
            const iconSx = { width: 14, height: 14, color };
            const ct = item.chartType.toLowerCase();
            if (ct.includes('scatter') || ct.includes('point') || ct.includes('dot') || ct.includes('boxplot')) {
                return <ScatterPlotIcon sx={iconSx} />;
            }
            if (ct.includes('line') || ct.includes('regression')) {
                return <ShowChartIcon sx={iconSx} />;
            }
            if (ct.includes('pie')) {
                return <PieChartOutlineIcon sx={iconSx} />;
            }
            if (ct.includes('heatmap')) {
                return <GridOnIcon sx={iconSx} />;
            }
            if (ct.includes('table')) {
                return <TableIcon sx={iconSx} />;
            }
            // Bar, histogram, stacked, grouped, pyramid, and default
            return <BarChartIcon sx={iconSx} />;
        }

        return <Box sx={{ 
            width: DOT_SIZE, height: DOT_SIZE, borderRadius: '50%', 
            backgroundColor: color,
        }} />;
    };

    const hasHighlighting = highlightedTableIds.length > 0;
    // Whether the thread header is highlighted (any non-used-table item in this thread is highlighted)
    const headerHL = timelineItems.some(item => item.highlighted && item.type !== 'used-table');

    const renderTimelineItem = (item: typeof timelineItems[0], index: number, isLast: boolean, nextHighlighted: boolean) => {
        const isTrigger = item.type === 'trigger' || item.type === 'leaf-trigger';
        const isTable = item.type === 'table' || item.type === 'leaf-table' || item.type === 'used-table';
        const isChart = item.type === 'chart';
        const dashedColor = item.highlighted ? alpha(theme.palette.primary.main, 0.6) : 'rgba(0,0,0,0.1)';
        const dashedWidth = '2px';
        const dashedStyle = 'solid';
        // Bottom connector uses unhighlighted style if next item isn't highlighted
        const bottomHighlighted = item.highlighted && nextHighlighted;
        const bottomDashedColor = bottomHighlighted ? alpha(theme.palette.primary.main, 0.6) : 'rgba(0,0,0,0.1)';
        const bottomDashedWidth = '2px';
        const bottomDashedStyle = 'solid';
        // No dimming or background — rely on timeline color + card border for highlighting
        const rowHighlightSx = {};

        // Triggers: icon based on interaction entry's `from` actor
        if (isTrigger) {
            const entry = item.interactionEntry;
            const isFromUser = entry ? entry.from === 'user' : false;
            // User → custom (orange), Agent → secondary when highlighted, muted when not
            const iconColor = item.highlighted
                ? (isFromUser ? theme.palette.custom.main : theme.palette.text.secondary)
                : 'rgba(0,0,0,0.15)';
            // Pick step-specific icon for completed thinking steps
            const getStepIcon = (label: string, color: string) => {
                const iconSx = { width: 12, height: 12, color };
                if (label.startsWith('✗')) return <ErrorOutlineIcon sx={{ ...iconSx, color: theme.palette.error.main }} />;
                if (label.startsWith('⚠')) return <WarningAmberIcon sx={{ ...iconSx, color: theme.palette.warning.main }} />;
                if (label.startsWith('📋')) return <InfoOutlinedIcon sx={{ ...iconSx, color: theme.palette.info.main }} />;
                const stripped = label.startsWith('✓') ? label.slice(2) : label;
                const lbl = stripped.toLowerCase();
                if (lbl.startsWith('running code') || lbl.startsWith('运行')) return <TerminalIcon sx={iconSx} />;
                if (lbl.startsWith('inspecting') || lbl.startsWith('检查')) return <SearchIcon sx={iconSx} />;
                if (lbl.startsWith('searching') || lbl.startsWith('搜索')) return <SearchIcon sx={iconSx} />;
                if (lbl.startsWith('creating chart') || lbl.startsWith('图表') || lbl.startsWith('生成图表')) return <AutoGraphIcon sx={iconSx} />;
                return <AutoAwesomeIcon sx={iconSx} />;
            };
            const gutterIcon = item.isRunning
                ? <CircularProgress size={12} thickness={5} sx={{ color: theme.palette.primary.main }} />
                : item.isClarifying
                    ? getClarifyIcon(item)
                    : item.isCompleted && item.stepLabel
                        ? getStepIcon(item.stepLabel, iconColor)
                        : entry
                            ? getEntryGutterIcon(entry, iconColor)
                            : getDefaultGutterIcon(iconColor);

            // Clarification rows are clickable to bring the agent's pause
            // back into focus. Prefer the latest chart on the associated
            // table (so users keep seeing the chart they were working on);
            // fall back to focusing the table itself if no chart exists.
            const clarifyClickHandler = (item.isClarifying && item.tableId)
                ? () => {
                    const tableId = item.tableId!;
                    const chartsForTable = charts.filter(c => c.tableRef === tableId);
                    const lastChart = chartsForTable[chartsForTable.length - 1];
                    if (lastChart) {
                        dispatch(dfActions.setFocused({ type: 'chart', chartId: lastChart.id }));
                    } else {
                        dispatch(dfActions.setFocused({ type: 'table', tableId }));
                    }
                }
                : undefined;

            return (
                <Box key={`timeline-row-${item.key}`}
                    {...(item.isClarifying ? { 'data-clarifying': 'true' } : {})}
                    sx={{ display: 'flex', flexDirection: 'row', position: 'relative', ...rowHighlightSx,
                    ...(clarifyClickHandler ? { cursor: 'pointer', '&:hover': { backgroundColor: 'rgba(0,0,0,0.02)' } } : {}),
                }} onClick={clarifyClickHandler}>
                    <Box sx={{ 
                        width: TIMELINE_WIDTH, flexShrink: 0, 
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                    }}>
                        <Box sx={{ width: 0, flex: '1 1 0', minHeight: 2, borderLeft: `${dashedWidth} ${dashedStyle} ${dashedColor}` }} />
                        <Box sx={{ flexShrink: 0, zIndex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {gutterIcon}
                        </Box>
                        {!isLast && <Box sx={{ width: 0, flex: '1 1 0', minHeight: 2, borderLeft: `${bottomDashedWidth} ${bottomDashedStyle} ${bottomDashedColor}` }} />}
                        {isLast && hasContinuationBelow && <Box sx={{ flex: '1 1 0', minHeight: 2, ...dashedLineSx }} />}
                        {isLast && !hasContinuationBelow && <Box sx={{ flex: '1 1 0', minHeight: 2 }} />}
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0, py: CARD_PY, pl: TIMELINE_GAP }}>
                        {item.element}
                    </Box>
                </Box>
            );
        }

        // Charts: chart-type icon on the timeline
        if (isChart) {
            return (
                <Box key={`timeline-row-${item.key}`} sx={{ display: 'flex', flexDirection: 'row', position: 'relative', ...rowHighlightSx }}>
                    <Box sx={{
                        width: TIMELINE_WIDTH, flexShrink: 0,
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                    }}>
                        <Box sx={{ width: 0, flex: '1 1 0', borderLeft: `${dashedWidth} ${dashedStyle} ${dashedColor}` }} />
                        <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {getTimelineDot(item)}
                        </Box>
                        {!isLast && <Box sx={{ width: 0, flex: '1 1 0', minHeight: 2, borderLeft: `${bottomDashedWidth} ${bottomDashedStyle} ${bottomDashedColor}` }} />}
                        {isLast && hasContinuationBelow && <Box sx={{ flex: '1 1 0', minHeight: 2, ...dashedLineSx }} />}
                        {isLast && !hasContinuationBelow && <Box sx={{ flex: '1 1 0', minHeight: 2 }} />}
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0, py: CARD_PY, pl: TIMELINE_GAP }}>
                        {item.element}
                    </Box>
                </Box>
            );
        }

        // Tables (primary nodes): settings icon on the timeline, more vertical spacing
        const tableForItem = item.tableId ? tableById.get(item.tableId) : undefined;
        return (
            <Box key={`timeline-row-${item.key}`} sx={{ display: 'flex', flexDirection: 'row', position: 'relative', ...rowHighlightSx }}>
                <Box sx={{ 
                    width: TIMELINE_WIDTH, flexShrink: 0, 
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    position: 'relative',
                }}>
                    {(index > 0 || !hideLabel) && (() => {
                        // When connecting to the header (index 0, label visible), match the header's highlight state
                        const useHeader = index === 0 && !hideLabel;
                        const topColor = useHeader ? (headerHL ? alpha(theme.palette.primary.main, 0.6) : 'rgba(0,0,0,0.1)') : dashedColor;
                        const topWidth = '2px';
                        const topStyle = 'solid';
                        return <Box sx={{ width: 0, flex: '1 1 0', minHeight: 6, borderLeft: `${topWidth} ${topStyle} ${topColor}` }} />;
                    })()}
                    {index === 0 && hideLabel && isSplitThread && (
                        // Continuation segment: extend the dashed gutter from the
                        // "↑ continued" header above down through the ghost row
                        // so the timeline reads as a single unbroken path.
                        <Box sx={{ flex: '1 1 0', minHeight: 6, ...dashedLineSx }} />
                    )}
                    {index === 0 && hideLabel && !isSplitThread && <Box sx={{ flex: '1 1 0', minHeight: 6 }} />}
                    <Box sx={{ flexShrink: 0, zIndex: 1, backgroundColor: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        // Ghost row: dim the gutter icon to match the muted card.
                        ...(item.type === 'used-table' && isSplitThread ? { opacity: 0.45 } : {}),
                    }}>
                        {getTimelineDot(item)}
                    </Box>
                    {!isLast && (
                        <Box sx={{ width: 0, flex: '1 1 0', minHeight: 6, borderLeft: `${bottomDashedWidth} ${bottomDashedStyle} ${bottomDashedColor}` }} />
                    )}
                    {isLast && hasContinuationBelow && (
                        // Continuation segment tail: extend the dashed gutter
                        // down into the "↓ continues below" footer so the
                        // timeline reads as a single unbroken path.
                        <Box sx={{ flex: '1 1 0', minHeight: 6, ...dashedLineSx }} />
                    )}
                    {isLast && !hasContinuationBelow && <Box sx={{ flex: '1 1 0', minHeight: 6 }} />}
                </Box>
                <Box sx={{ flex: 1, minWidth: 0, py: item.type === 'used-table' ? '1px' : CARD_PY, pl: TIMELINE_GAP,
                    ...(item.type === 'used-table' && { display: 'flex', alignItems: 'center' }),
                }}>
                    {item.element}
                </Box>
            </Box>
        );
    };


    return <Box sx={{ ...sx, 
            '& .selected-card': { 
                boxShadow: `0 0 0 2px ${theme.palette.primary.light}`,
                borderColor: 'transparent',
                margin: '1px 0',
            },
            '& .selected-report-card': { 
                boxShadow: `0 0 0 2px ${theme.palette.secondary.light}`,
                borderColor: 'transparent',
                margin: '1px 0',
            },
            padding: '6px',
        }}
        >
        <div style={{ padding: '2px 4px 2px 4px', marginTop: 0, direction: 'ltr' }}>
            {!hideLabel && (() => {
                const hlColor = theme.palette.primary.main;
                const nhColor = 'rgba(0,0,0,0.35)';
                const connColor = headerHL ? alpha(theme.palette.primary.main, 0.6) : 'rgba(0,0,0,0.1)';
                const connWidth = '2px';
                const connStyle = 'solid';
                return (
                <Box sx={{ display: 'flex', flexDirection: 'row' }}>
                    <Box sx={{ 
                        width: TIMELINE_WIDTH, flexShrink: 0, 
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                    }}>
                        <Box sx={{ flex: '1 1 0', minHeight: 6 }} />
                        <Box sx={{ 
                            width: 8, height: 8, borderRadius: '50%', 
                            border: `1.5px solid ${headerHL ? alpha(hlColor, 0.6) : 'rgba(0,0,0,0.15)'}`,
                            backgroundColor: 'transparent',
                            flexShrink: 0,
                        }} />
                        <Box sx={{ width: 0, flex: '1 1 0', minHeight: 10, borderLeft: `${connWidth} ${connStyle} ${connColor}` }} />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', pl: 0.5, gap: 0.5 }}>
                        <Typography sx={{ 
                            fontSize: '11px', fontWeight: 700, 
                            textTransform: 'uppercase', letterSpacing: '0.02em',
                            color: headerHL ? hlColor : 'rgba(0,0,0,0.55)', 
                        }}>
                            {threadLabel || (threadIdx === -1 ? t('dataThread.threadZero') : t('dataThread.threadIndex', { index: threadIdx + 1 }))}
                        </Typography>
                    </Box>
                </Box>
                );
            })()}
            {isSplitThread && (() => {
                // Continuation header: a small "↑ continued" chip on a dashed
                // gutter.  The ghost parent table card immediately below
                // identifies the carry-over table, and the segment's first
                // real content is the next instruction — so we don't echo the
                // previous instruction here (it would duplicate either the
                // ghost's name or the upcoming instruction card).
                return (
                    <Box sx={{ display: 'flex', flexDirection: 'row' }}>
                        <Box sx={{
                            width: TIMELINE_WIDTH, flexShrink: 0,
                            display: 'flex', flexDirection: 'column', alignItems: 'center',
                        }}>
                            <Box sx={{ flex: '1 1 0', minHeight: 4 }} />
                            <KeyboardArrowUpIcon sx={{ fontSize: 12, color: 'text.disabled' }} />
                            <Box sx={{ flex: '1 1 0', minHeight: 6, ...dashedLineSx }} />
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 0, pl: 0.5, py: 0.25, display: 'flex', alignItems: 'center' }}>
                            <Typography sx={{
                                fontSize: '10px', color: 'text.disabled',
                                textTransform: 'uppercase', letterSpacing: '0.04em',
                            }}>
                                {t('dataThread.continuedFromAbove')}
                            </Typography>
                        </Box>
                    </Box>
                );
            })()}
            {timelineItems.map((item, index) => renderTimelineItem(item, index, index === timelineItems.length - 1, timelineItems[index + 1]?.highlighted ?? false))}
            {hasContinuationBelow && (() => {
                return (
                    <Box sx={{ display: 'flex', flexDirection: 'row' }}>
                        <Box sx={{
                            width: TIMELINE_WIDTH, flexShrink: 0,
                            display: 'flex', flexDirection: 'column', alignItems: 'center',
                        }}>
                            <Box sx={{ flex: '1 1 0', minHeight: 6, ...dashedLineSx }} />
                            <KeyboardArrowDownIcon sx={{ fontSize: 12, color: 'text.disabled' }} />
                            <Box sx={{ flex: '1 1 0', minHeight: 4 }} />
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 0, pl: 0.5, py: 0.25, display: 'flex', alignItems: 'center' }}>
                            <Typography sx={{
                                fontSize: '10px', color: 'text.disabled',
                                textTransform: 'uppercase', letterSpacing: '0.04em',
                            }}>
                                {t('dataThread.continuesBelow')}
                            </Typography>
                        </Box>
                    </Box>
                );
            })()}
        </div>
        <MetadataPopup
            open={metadataPopupOpen}
            anchorEl={metadataAnchorEl}
            onClose={handleCloseMetadataPopup}
            table={selectedTableForMetadata}
        />
        <RenameTablePopup
            open={renamePopupOpen}
            anchorEl={renameAnchorEl}
            onClose={handleCloseRenamePopup}
            onSave={handleSaveRename}
            initialValue={selectedTableForRename?.displayId || selectedTableForRename?.id || ''}
            tableName={selectedTableForRename?.displayId || selectedTableForRename?.id || ''}
        />

        {/* Table actions menu */}
        <Menu
            anchorEl={tableMenuAnchorEl}
            open={Boolean(tableMenuAnchorEl)}
            onClose={handleCloseTableMenu}
            onClick={(e) => e.stopPropagation()}
        >
            <MenuItem 
                onClick={(e) => {
                    e.stopPropagation();
                    if (selectedTableForMenu) {
                        handleOpenRenamePopup(selectedTableForMenu, tableMenuAnchorEl!);
                    }
                    handleCloseTableMenu();
                }}
                sx={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: 1 }}
            >
                <EditIcon sx={{ fontSize: 16, color: 'text.secondary' }}/>
                {t('dataThread.rename')}
            </MenuItem>
            {/* Pin option - only for derived tables */}
            {selectedTableForMenu?.derive != undefined && (
                <MenuItem 
                    onClick={(e) => {
                        e.stopPropagation();
                        if (selectedTableForMenu) {
                            dispatch(dfActions.updateTableAnchored({tableId: selectedTableForMenu.id, anchored: !selectedTableForMenu.anchored}));
                        }
                        handleCloseTableMenu();
                    }}
                    sx={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: 1 }}
                >
                    <AnchorIcon sx={{ fontSize: 16, color: selectedTableForMenu?.anchored ? 'primary.main' : 'text.secondary' }}/>
                    {selectedTableForMenu?.anchored ? t('dataThread.unpinTable') : t('dataThread.pinTable')}
                </MenuItem>
            )}
            {/* View metadata - available for every table; read-only viewer of
                source description + per-column descriptions (or derivation summary) */}
            {selectedTableForMenu && (
                <MenuItem 
                    onClick={(e) => {
                        e.stopPropagation();
                        if (selectedTableForMenu) {
                            handleOpenMetadataPopup(selectedTableForMenu, tableMenuAnchorEl!);
                        }
                        handleCloseTableMenu();
                    }}
                    sx={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: 1 }}
                >
                    <AttachFileIcon sx={{ 
                        fontSize: 16,
                        color: selectedTableForMenu?.description ? 'secondary.main' : 'text.secondary',
                    }}/>
                    {t('dataThread.viewMetadata', { defaultValue: 'View metadata' })}
                </MenuItem>
            )}
            {/* Refresh settings - shown for stream/database sources to configure auto-refresh interval */}
            {selectedTableForMenu && 
             selectedTableForMenu.derive == undefined &&
             (selectedTableForMenu.source?.type === 'stream' || selectedTableForMenu.source?.type === 'database') && (
                <MenuItem 
                    onClick={(e) => {
                        e.stopPropagation();
                        if (selectedTableForMenu) {
                            handleOpenStreamingSettingsPopup(selectedTableForMenu, tableMenuAnchorEl!);
                        }
                        handleCloseTableMenu();
                    }}
                    sx={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: 1 }}
                >
                    <StreamIcon sx={{ fontSize: 16, color: selectedTableForMenu.source?.autoRefresh ? 'success.main' : 'text.secondary' }}/>
                    {selectedTableForMenu.source?.autoRefresh ? t('dataThread.refreshSettings') : t('dataThread.watchForUpdates')}
                </MenuItem>
            )}
            {/* Refresh data - hidden for database tables and derived tables */}
            {selectedTableForMenu?.derive == undefined && selectedTableForMenu?.source?.type !== 'database' && (
                <MenuItem 
                    onClick={(e) => {
                        e.stopPropagation();
                        if (selectedTableForMenu) {
                            handleOpenRefreshDialog(selectedTableForMenu);
                        }
                    }}
                    sx={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: 1 }}
                >
                    <RefreshIcon sx={{ fontSize: 16, color: 'primary.main' }}/>
                    {t('dataThread.replaceData')}
                </MenuItem>
            )}
            <MenuItem 
                onClick={(e) => {
                    e.stopPropagation();
                    if (selectedTableForMenu) {
                        dispatch(dfActions.deleteTable(selectedTableForMenu.id));
                    }
                    handleCloseTableMenu();
                }}
                disabled={selectedTableForMenu 
                    ? (!selectedTableForMenu.derive && tables.some(t => t.derive?.trigger.tableId === selectedTableForMenu.id)) 
                    : true}
                sx={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: 1, color: 'warning.main' }}
            >
                <DeleteIcon sx={{ fontSize: 16 }} color='warning'/>
                {t('dataThread.deleteTable')}
            </MenuItem>
        </Menu>

        {/* Refresh data dialog */}
        {selectedTableForRefresh && (
            <RefreshDataDialog
                open={refreshDialogOpen}
                onClose={handleCloseRefreshDialog}
                table={selectedTableForRefresh}
                onRefreshComplete={handleRefreshComplete}
            />
        )}

        {/* Streaming settings popup */}
        {selectedTableForStreamingSettings && (
            <StreamingSettingsPopup
                open={streamingSettingsPopupOpen}
                anchorEl={streamingSettingsAnchorEl}
                onClose={handleCloseStreamingSettingsPopup}
                table={selectedTableForStreamingSettings}
                onUpdateSettings={handleUpdateStreamingSettings}
                onRefreshNow={() => manualRefresh(selectedTableForStreamingSettings.id)}
            />
        )}
    </Box>
    }

/** Lightweight chart thumbnail — shows cached PNG, skeleton, or status icon. */
const ChartThumbnail: FC<{
    chart: Chart;
    table: DictTable;
    status: 'available' | 'pending' | 'unavailable';
    onChartClick: (chartId: string, tableId: string) => void;
    onDelete: (chartId: string) => void;
}> = ({ chart, table, status, onChartClick, onDelete }) => {
    const { t } = useTranslation();

    let deleteButton = <Tooltip title={t('dataThread.deleteChart')}>
        <IconButton className='data-thread-chart-delete-btn' size="small" color="error"
            aria-label={t('dataThread.deleteChart')}
            sx={{ 
                zIndex: 10, position: "absolute", right: 1, top: 1,
                p: 0.5,
                opacity: 0, transition: 'opacity 0.15s',
                backgroundColor: 'rgba(255,255,255,0.85)',
                '&:hover': { transform: 'scale(1.15)', backgroundColor: 'rgba(255,255,255,0.95)' },
                '.vega-thumbnail-box:hover &': { opacity: 1 },
            }}
            onClick={(event) => { event.stopPropagation(); onDelete(chart.id); }}>
            <DeleteIcon sx={{ fontSize: 16 }} />
        </IconButton>
    </Tooltip>

    const pendingOverlay = status == 'pending' ? <Box sx={{
        position: "absolute", top: 0, left: -8, right: -8, bottom: 0, zIndex: 20,
        backgroundColor: "rgba(243, 243, 243, 0.8)", cursor: "pointer",
        borderRadius: '6px', display: 'flex', flexDirection: 'column',
    }}>
        <LinearProgress sx={{ width: "100%", height: "100%", opacity: 0.05 }} />
    </Box> : null;

    if (['Auto', '?'].includes(chart.chartType)) {
        return <Box 
            className="vega-thumbnail-box"
            onClick={() => onChartClick(chart.id, table.id)}
            sx={{ width: "100%", color: 'text.secondary', height: 48, display: "flex", backgroundColor: "white", position: 'relative', flexDirection: "column" }}>
            {pendingOverlay}
            <InsightIcon sx={{ margin: 'auto', color: 'darkgray' }}  fontSize="medium" />
            {deleteButton}
        </Box>;
    }

    if (status == 'unavailable' || chart.chartType == "Table") {
        let chartTemplate = getChartTemplate(chart.chartType);
        return <Box key={`unavailable-${chart.id}`} width={"100%"}
            className={"vega-thumbnail vega-thumbnail-box"}
            onClick={() => onChartClick(chart.id, table.id)}
            sx={{ display: "flex", backgroundColor: "white", position: 'relative', flexDirection: "column" }}>
            {pendingOverlay}
            <Box sx={{ display: "flex", flexDirection: "column", margin: "auto", height: 48}}>
                <Box sx={{ margin: "auto", transform: chart.chartType == 'Table' ? "rotate(15deg)" : undefined }} >
                    {generateChartSkeleton(chartTemplate?.icon, 32, 32, chart.chartType == 'Table' ? 1 : 0.5)} 
                </Box>
                {deleteButton}
            </Box>
        </Box>;
    }

    // ---- Thumbnail path: use cached PNG from ChartRenderService ----
    if (chart.thumbnail) {
        return (
            <Box
                onClick={() => onChartClick(chart.id, table.id)}
                className="vega-thumbnail-box"
                style={{ width: "100%", position: "relative", cursor: "pointer" }}
            >
                <Box sx={{ margin: "auto" }}>
                    {chart.saved && <Typography sx={{ position: "absolute", margin: "5px", zIndex: 2 }}>
                        <StarIcon sx={{ color: "gold" }} fontSize="small" />
                    </Typography>}
                    {pendingOverlay}
                    {deleteButton}
                    <Box className={"vega-thumbnail"}
                        sx={{
                            display: "flex",
                            backgroundColor: chart.saved ? "rgba(255,215,0,0.05)" : "white",
                            justifyContent: 'center',
                            alignItems: 'center',
                            minHeight: 48,
                            minWidth: 60,
                        }}
                    >
                        <img 
                            src={chart.thumbnail} 
                            alt={t('dataThread.chartAlt', { type: chart.chartType })}
                            style={{ maxWidth: 120, maxHeight: 100, objectFit: 'contain' }} 
                        />
                    </Box>
                </Box>
            </Box>
        );
    }

    // ---- Fallback: skeleton while ChartRenderService is still processing ----
    let chartTemplate = getChartTemplate(chart.chartType);
    return (
        <Box
            onClick={() => onChartClick(chart.id, table.id)}
            className="vega-thumbnail-box"
            style={{ width: "100%", position: "relative", cursor: "pointer" }}
        >
            <Box sx={{ margin: "auto" }}>
                {chart.saved && <Typography sx={{ position: "absolute", margin: "5px", zIndex: 2 }}>
                    <StarIcon sx={{ color: "gold" }} fontSize="small" />
                </Typography>}
                {pendingOverlay}
                {deleteButton}
                <Box className={"vega-thumbnail"}
                    sx={{
                        display: "flex",
                        backgroundColor: chart.saved ? "rgba(255,215,0,0.05)" : "white",
                        justifyContent: 'center',
                        alignItems: 'center',
                        minHeight: 60,
                    }}
                >
                    {generateChartSkeleton(chartTemplate?.icon, 48, 48, 0.3)}
                </Box>
            </Box>
        </Box>
    );
};

// Height estimation constants (px) – per-type heights + py:4px (8px) gap per row
const LAYOUT_TABLE_HEIGHT = 28 + 8;     // table card + row padding
const LAYOUT_ENTRY_HEIGHT = 38;         // interaction entry — empirical ~1.5-line average incl. row padding
const LAYOUT_CHART_HEIGHT = 90 + 8;     // chart card (~70-110) + row padding
const LAYOUT_THREAD_OVERHEAD = 52;      // header divider + thread padding
const LAYOUT_THREAD_GAP = 8;            // my: 0.5 = 4px top + 4px bottom between threads
const SCROLL_TOLERANCE = 1.5;           // a column / segment may extend up to 1.5 × vh before we add another

function estimateThreadHeight(
    tableCount: number, entryCount: number, chartCount: number
): number {
    return LAYOUT_THREAD_OVERHEAD
        + tableCount * LAYOUT_TABLE_HEIGHT
        + entryCount * LAYOUT_ENTRY_HEIGHT
        + chartCount * LAYOUT_CHART_HEIGHT;
}

/** Effective rendered row count for an interaction list: data-agent
 *  `summary` entries that are immediately followed by an `instruction` get
 *  folded into that instruction (see `pushInteractionEntries`), so they
 *  shouldn't be double-counted in height estimation. */
function effectiveEntryCount(interaction: InteractionEntry[] | undefined): number {
    if (!interaction || interaction.length === 0) return 1;
    let n = 0;
    for (let i = 0; i < interaction.length; i++) {
        const e = interaction[i];
        const next = interaction[i + 1];
        if (e.role === 'summary' && e.from === 'data-agent' && next?.role === 'instruction') continue;
        n++;
    }
    return Math.max(1, n);
}

/** Estimated height of one trigger block: interaction entries + result table + its charts. */
function estimateTriggerBlockHeight(
    tableId: string,
    interaction: InteractionEntry[] | undefined,
    chartElements: { tableId: string }[],
): number {
    const charts = chartElements.filter(ce => ce.tableId === tableId).length;
    return effectiveEntryCount(interaction) * LAYOUT_ENTRY_HEIGHT
        + LAYOUT_TABLE_HEIGHT
        + charts * LAYOUT_CHART_HEIGHT;
}

/**
 * For each long thread, identify intermediate tables to "promote" as extra
 * leaves so the thread renders as multiple stacked segments.
 *
 * Walk the chain accumulating estimated height; whenever the running total
 * would exceed `SCROLL_TOLERANCE × vh` (≈ 1.5 × viewport), cut at the
 * previous trigger boundary.  The promoted table is two steps back so the
 * new segment opens on an instruction (with the carry-over table shown only
 * as a dimmed ghost).  Pure / deterministic for given inputs — new content
 * lands in the trailing segment without shifting earlier cuts.
 */
function computeSplitExtraLeaves(
    leafTables: DictTable[],
    allTables: DictTable[],
    chartElements: { tableId: string }[],
    viewportHeight: number,
): DictTable[] {
    const tableById = new Map(allTables.map(t => [t.id, t]));
    const target = viewportHeight * SCROLL_TOLERANCE;
    const extras: DictTable[] = [];

    for (const lt of leafTables) {
        if (!lt.derive) continue;
        const triggers = getTriggers(lt, allTables);
        if (triggers.length < 3) continue; // need ≥ 1 trigger on each side of the cut + the promoted middle

        const triggerH = triggers.map(tp =>
            estimateTriggerBlockHeight(tp.resultTableId, tp.interaction, chartElements));

        let acc = LAYOUT_THREAD_OVERHEAD;
        let segmentStart = 0;

        for (let i = 0; i < triggers.length; i++) {
            // Cut just before trigger i: promote triggers[i-2] as a ghost so
            // the new segment opens on triggers[i-1]'s instruction.  Requires
            // the current segment to contain ≥ 2 triggers (segmentStart ≤ i-2).
            if (acc + triggerH[i] > target && i - 1 > segmentStart) {
                const promoted = tableById.get(triggers[i - 2].resultTableId);
                if (promoted) extras.push(promoted);
                acc = LAYOUT_THREAD_OVERHEAD + LAYOUT_TABLE_HEIGHT + triggerH[i - 1] + triggerH[i];
                segmentStart = i - 1;
            } else {
                acc += triggerH[i];
            }
        }
    }
    return extras;
}

/**
 * Pack thread entries into columns while respecting "lock keys".  Lock semantics:
 *
 *   - Free entries (no lock) pack greedily up to `1.5 × vh`.
 *   - A locked entry *may* join the current column if (a) the column has no
 *     lock yet and (b) the combined height still fits within tolerance.  This
 *     lets a small "thread 0" / source-tables block tag along with the head
 *     of a locked thread instead of wasting a whole column on it.
 *   - Once a column has a lock set, no further entries (free or locked) can
 *     join — sibling segments with the same lock would visually duplicate the
 *     header, and free entries appended below would push the locked head out
 *     of view.
 *
 * Order is preserved.
 *
 * `maxColumns` is a soft upper bound: if the natural packing at
 * `viewportHeight × SCROLL_TOLERANCE` would produce more columns, the target
 * height is grown progressively until the result fits.  Locks may force the
 * result to exceed `maxColumns` (e.g. N distinct locks always need ≥ N
 * columns); in that case we return the best (smallest column-count) layout
 * we found.
 */
function packColumnsWithLocks(
    heights: number[],
    lockKeys: (string | undefined)[],
    viewportHeight: number,
    maxColumns: number = Infinity,
): number[][] {
    const baseTarget = viewportHeight * SCROLL_TOLERANCE;

    const packAt = (target: number): number[][] => {
        const cols: number[][] = [];
        let cur: number[] = [];
        let curH = 0;
        let curLock: string | undefined = undefined;
        const flush = () => {
            if (cur.length > 0) { cols.push(cur); cur = []; curH = 0; curLock = undefined; }
        };
        for (let i = 0; i < heights.length; i++) {
            const h = heights[i];
            const lock = lockKeys[i];
            // Once the current column has a lock, it's sealed — anything new
            // (free or locked) starts a fresh column.
            if (curLock !== undefined) {
                flush();
                cur.push(i); curH = h; curLock = lock;
                continue;
            }
            // Empty column: just start it.
            if (cur.length === 0) {
                cur.push(i); curH = h; curLock = lock;
                continue;
            }
            // Try to append.  A locked entry can join an unlocked column as
            // long as the combined height still fits — lets a small source-
            // tables block share a column with the next thread's head.
            const projected = curH + LAYOUT_THREAD_GAP + h;
            if (projected <= target) {
                cur.push(i); curH = projected; curLock = lock;
            } else {
                flush();
                cur.push(i); curH = h; curLock = lock;
            }
        }
        flush();
        return cols;
    };

    let layout = packAt(baseTarget);
    if (layout.length <= maxColumns) return layout;

    // Overflow: grow the target until the packing fits within maxColumns.
    // Cap the search to avoid pathological cases — if locks force more
    // columns than maxColumns, return the smallest-column layout we found.
    const totalH = heights.reduce((s, h) => s + h, 0)
        + Math.max(0, heights.length - 1) * LAYOUT_THREAD_GAP;
    let best = layout;
    let target = baseTarget;
    while (target < totalH) {
        target = target * 1.25;
        const candidate = packAt(target);
        if (candidate.length < best.length) best = candidate;
        if (candidate.length <= maxColumns) return candidate;
    }
    return best;
}

/**
 * Compute a balanced column layout for threads.
 *
 * @param heights  – Estimated pixel height for each thread (in display order).
 * @param numColumns – Maximum number of columns to distribute into.
 * @param flexOrder – When true, threads may be reordered across columns for
 *                    better balance (LPT heuristic). When false, the original
 *                    order is preserved (optimal contiguous partitioning via
 *                    binary-search on the maximum column height).
 * @returns An array of columns, where each column is an array of original
 *          thread indices.  Empty columns are omitted.
 */
function computeThreadColumnLayout(
    heights: number[],
    numColumns: number,
    flexOrder: boolean = false,
): number[][] {
    if (heights.length === 0) return [];
    if (heights.length === 1) return [[0]];

    const cols = Math.min(numColumns, heights.length);
    if (cols <= 1) return [heights.map((_, i) => i)];

    return flexOrder
        ? layoutFlexOrder(heights, cols)
        : layoutPreserveOrder(heights, cols);
}

/**
 * Balanced layout *with* reordering (LPT – Longest Processing Time first).
 * Assigns the tallest unplaced thread to whichever column is currently shortest.
 */
function layoutFlexOrder(heights: number[], numColumns: number): number[][] {
    const indexed = heights.map((h, i) => ({ idx: i, h }));
    indexed.sort((a, b) => b.h - a.h);                // tallest first

    const columns: number[][] = Array.from({ length: numColumns }, () => []);
    const colH: number[] = new Array(numColumns).fill(0);

    for (const item of indexed) {
        let minCol = 0;
        for (let c = 1; c < numColumns; c++) {
            if (colH[c] < colH[minCol]) minCol = c;
        }
        columns[minCol].push(item.idx);
        colH[minCol] += item.h;
    }

    return columns.filter(c => c.length > 0);
}

/**
 * Balanced layout *preserving* thread order.
 *
 * Uses binary-search on the maximum column height to find the tightest
 * contiguous partitioning of threads into ≤ numColumns groups.
 */
function layoutPreserveOrder(heights: number[], numColumns: number): number[][] {
    const maxH = Math.max(...heights);
    const totalH = heights.reduce((s, h) => s + h, 0);

    // Can we fit all threads into `numColumns` columns with no column > target?
    const canPartition = (target: number): boolean => {
        let cols = 1, cur = 0;
        for (const h of heights) {
            if (cur + h > target && cur > 0) {
                cols++;
                cur = h;
                if (cols > numColumns) return false;
            } else {
                cur += h;
            }
        }
        return true;
    };

    // Binary-search for the minimum feasible max-column height
    let lo = maxH, hi = totalH;
    while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (canPartition(mid)) hi = mid; else lo = mid + 1;
    }

    // Build the actual partition with the optimal target
    const target = lo;
    const columns: number[][] = [[]];
    let cur = 0;
    for (let i = 0; i < heights.length; i++) {
        if (cur + heights[i] > target && columns[columns.length - 1].length > 0) {
            columns.push([]);
            cur = 0;
        }
        columns[columns.length - 1].push(i);
        cur += heights[i];
    }

    return columns;
}

/**
 * Choose the best column layout that balances scroll burden vs whitespace.
 *
 * 1. If a single column fits within SCROLL_TOLERANCE × viewportHeight,
 *    use one column — the small scroll is preferable to the whitespace
 *    of an extra column (e.g. one long thread + one tiny thread).
 * 2. Otherwise, evaluate layouts for 1 … maxColumns and pick the smallest
 *    column count whose tallest column fits within viewportHeight.
 * 3. If nothing eliminates scrolling, pick the layout that minimises the
 *    tallest column (least scrolling).
 */

function chooseBestColumnLayout(
    heights: number[],
    maxColumns: number,
    viewportHeight: number,
    flexOrder: boolean = false,
    minColumns: number = 1,
): number[][] {
    if (heights.length === 0) return [];

    const cap = Math.min(maxColumns, heights.length);
    const start = Math.min(Math.max(minColumns, 1), cap);
    const tolerantHeight = viewportHeight * SCROLL_TOLERANCE;

    // Compute effective column height including gaps between threads
    const columnEffectiveHeight = (col: number[]) => {
        const contentH = col.reduce((sum, idx) => sum + heights[idx], 0);
        const gapH = Math.max(0, col.length - 1) * LAYOUT_THREAD_GAP;
        return contentH + gapH;
    };

    // Evaluate every candidate column count (start … cap).
    // Pick the smallest n whose tallest column fits within tolerance.
    // If none fits, pick the one with the shortest tallest column.
    let bestLayout: number[][] = [];
    let bestMaxH = Infinity;

    for (let n = start; n <= cap; n++) {
        const layout = computeThreadColumnLayout(heights, n, flexOrder);
        const maxH = Math.max(...layout.map(columnEffectiveHeight));

        // Smallest n that fits within tolerance → least whitespace
        if (maxH <= tolerantHeight) {
            return layout;
        }

        // Otherwise track the layout with the shortest tallest column
        if (maxH < bestMaxH) {
            bestMaxH = maxH;
            bestLayout = layout;
        }
    }

    return bestLayout;
}

export const DataThread: FC<{sx?: SxProps}> = function ({ sx }) {
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();

    let tables = useSelector((state: DataFormulatorState) => state.tables);
    let focusedId = useSelector((state: DataFormulatorState) => state.focusedId);
    let charts = useSelector(dfSelectors.getAllCharts);

    let generatedReports = useSelector(dfSelectors.getAllGeneratedReports);

    // Derive focusedTableId from focusedId for scroll/highlight logic
    let focusedTableId = useMemo(() => {
        if (!focusedId) return undefined;
        if (focusedId.type === 'table') return focusedId.tableId;
        if (focusedId.type === 'chart') {
            const chart = charts.find(c => c.id === focusedId.chartId);
            return chart?.tableRef;
        }
        if (focusedId.type === 'report') {
            const report = generatedReports.find(r => r.id === focusedId.reportId);
            return report?.triggerTableId;
        }
        return undefined;
    }, [focusedId, charts, generatedReports]);

    let chartSynthesisInProgress = useSelector((state: DataFormulatorState) => state.chartSynthesisInProgress);

    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);

    // Subscribe to draftNodes so the scroll-to-target effect re-runs when an
    // active clarify/explain entry appears or resolves.
    const draftNodes = useSelector((state: DataFormulatorState) => state.draftNodes);

    const containerRef = useRef<null | HTMLDivElement>(null)
    // Outer wrapper containing both the thread area and the chatbox.
    // Its height is governed by the parent Allotment pane and stays constant
    // when the chatbox grows/shrinks during clarification or explanation.
    // Used to derive a stable viewportHeight for split decisions so that
    // chatbox resizing doesn't trigger re-splitting of long threads.
    const outerRef = useRef<null | HTMLDivElement>(null)
    const [expandedColumns, setExpandedColumns] = useState(false);
    const [containerWidth, setContainerWidth] = useState(0);
    // Track container height so we can detect when the chatbox grows/shrinks
    // (which compresses/expands containerRef as a flex sibling).  Used to
    // trigger the scroll-to-target effect below.
    const [containerHeight, setContainerHeight] = useState(0);
    // Increments every time the chat input is focused.  Used to retrigger the
    // scroll-to-target effect even when neither focusedId nor containerHeight
    // changes (e.g. user just clicks into the input without typing).
    const [chatboxFocusTick, setChatboxFocusTick] = useState(0);
    const [isDragOver, setIsDragOver] = useState(false);

    // ── Drop handler for catalog table items from DataSourceSidebar ──────
    const handleDragOver = useCallback((e: React.DragEvent) => {
        if (e.dataTransfer.types.includes('application/json')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            setIsDragOver(true);
        }
    }, []);
    const handleDragLeave = useCallback(() => setIsDragOver(false), []);
    const handleDrop = useCallback((e: React.DragEvent) => {
        setIsDragOver(false);
        try {
            const raw = e.dataTransfer.getData('application/json');
            if (!raw) return;
            const item: CatalogTableDragItem = JSON.parse(raw);
            if (item.type !== CATALOG_TABLE_ITEM) return;
            e.preventDefault();

            const tableObj: DictTable = {
                kind: 'table' as const,
                id: item.tableName,
                displayId: item.tableName,
                names: [],
                metadata: {},
                rows: [],
                virtual: { tableId: item.tableName, rowCount: 0 },
                anchored: true,
                description: '',
                source: {
                    type: 'database' as const,
                    databaseTable: item.tablePath.join('/'),
                    canRefresh: true,
                    lastRefreshed: Date.now(),
                    connectorId: item.connectorId,
                },
            };

            dispatch(loadTable({
                table: tableObj,
                connectorId: item.connectorId,
                sourceTableRef: { id: item.tableId || item.tableName, name: item.tableName },
                importOptions: {},
            })).unwrap()
                .then(() => {
                    dispatch(dfActions.addMessages({
                        timestamp: Date.now(), type: 'success',
                        component: 'data thread', value: `Loaded table "${item.tableName}"`,
                    }));
                })
                .catch((err) => {
                    dispatch(dfActions.addMessages({
                        timestamp: Date.now(), type: 'error',
                        component: 'data thread', value: `Failed to load "${item.tableName}": ${extractErrorMessage(err)}`,
                    }));
                });
        } catch { /* ignore bad data */ }
    }, [dispatch]);
    // Re-attach ResizeObserver when containerRef changes
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const ro = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setContainerWidth(entry.contentRect.width);
                setContainerHeight(entry.contentRect.height);
            }
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const theme = useTheme();

    // Keep the relevant element fully visible above the chatbox.
    //
    // Triggered whenever:
    //   - focusedId changes (user clicked a different chart/table)
    //   - containerHeight changes (chatbox grew/shrank, e.g. when an
    //     explain/clarify panel appears or the input expands)
    //
    // Three target priorities:
    //   1. Active clarify/explain inline block (data-clarifying="true")
    //   2. Focused chart card (data-chart-id)
    //   3. Focused table card (data-table-id)
    //
    // "Fully visible" means the target's top..bottom fits within
    // containerRef's rect (which already shrinks as the chatbox grows below
    // it).  If already in view, don't scroll.  If too tall, align top.
    useEffect(() => {
        if (!containerRef.current) return;
        const t = setTimeout(() => {
            const container = containerRef.current;
            if (!container) return;
            const scroller = container.firstElementChild as HTMLElement | null;
            if (!scroller) return;

            // Find the target element in priority order.
            let target: HTMLElement | null = null;

            // 1. Active clarify/explain inline block (most recent)
            const clarifyEls = container.querySelectorAll<HTMLElement>('[data-clarifying="true"]');
            if (clarifyEls.length > 0) {
                target = clarifyEls[clarifyEls.length - 1];
            }

            // 2. Focused chart
            if (!target && focusedId?.type === 'chart') {
                target = container.querySelector<HTMLElement>(`[data-chart-id="${focusedId.chartId}"]`);
            }

            // 3. Focused table
            if (!target && focusedId?.type === 'table') {
                target = container.querySelector<HTMLElement>(`[data-table-id="${focusedId.tableId}"]`);
            }

            if (!target) return;

            const containerRect = container.getBoundingClientRect();
            const scrollerRect = scroller.getBoundingClientRect();
            const targetRect = target.getBoundingClientRect();
            const TOP_MARGIN = 16;
            const BOTTOM_MARGIN = 16;
            const visibleTop = containerRect.top + TOP_MARGIN;
            const visibleBottom = containerRect.bottom - BOTTOM_MARGIN;
            const visibleHeight = visibleBottom - visibleTop;

            // Already fully visible? Don't scroll — don't bother the user.
            if (targetRect.top >= visibleTop && targetRect.bottom <= visibleBottom) return;

            // When we do need to scroll, leave generous breathing room above
            // the target so the user has context (the prior thread items
            // remain visible).  We aim to place the target's top about 60%
            // of the way down the visible area — this feels natural since
            // the user is usually interacting at the bottom and the target
            // is most often a leaf chart/table near the end.  Clamped so
            // the target's bottom never gets pushed below the visible area.
            //
            // If the target is taller than the visible area, just align its
            // top with TOP_MARGIN so the start is in view (bottom may be
            // cut off — preferable to hiding the start).
            const targetTopInScroller = targetRect.top - scrollerRect.top + scroller.scrollTop;
            const targetHeight = targetRect.height;
            const tooTall = targetHeight + TOP_MARGIN + BOTTOM_MARGIN > visibleHeight + TOP_MARGIN + BOTTOM_MARGIN;
            const desiredOffsetFromTop = tooTall
                ? TOP_MARGIN
                : Math.max(TOP_MARGIN, Math.min(visibleHeight * 0.6, visibleHeight - targetHeight - BOTTOM_MARGIN));
            const newScrollTop = targetTopInScroller - desiredOffsetFromTop;

            // Only scroll if it would meaningfully change position.
            if (Math.abs(newScrollTop - scroller.scrollTop) > 4) {
                scroller.scrollTo({ top: Math.max(0, newScrollTop), behavior: 'smooth' });
            }
        }, 100);
        return () => clearTimeout(t);
    }, [containerHeight, focusedId, draftNodes, chatboxFocusTick]);

    // O(1) table lookup by ID
    const tableById = useMemo(() => new Map(tables.map(t => [t.id, t])), [tables]);

    // Cached getTriggers — avoids repeated chain walks within a single render
    const _tCache = new Map<string, Trigger[]>();
    const getCachedTriggers = (lt: DictTable): Trigger[] => {
        if (_tCache.has(lt.id)) return _tCache.get(lt.id)!;
        const triggers = getTriggers(lt, tables);
        _tCache.set(lt.id, triggers);
        return triggers;
    };

    // Now use useMemo to memoize the chartElements array
    let chartElements = useMemo(() => {
        return charts.filter(c => c.source == "user").map((chart) => {
            const table = getDataTable(chart, tables, charts, conceptShelfItems);
            let status: 'available' | 'pending' | 'unavailable' = chartSynthesisInProgress.includes(chart.id) ? 'pending' : 
                checkChartAvailability(chart, conceptShelfItems, table.rows) ? 'available' : 'unavailable';
            let element = <ChartThumbnail
                chart={chart}
                table={table}
                status={status}
                onChartClick={() => {
                    dispatch(dfActions.setFocused({ type: 'chart', chartId: chart.id }));
                }}
                onDelete={() => {dispatch(dfActions.deleteChartById(chart.id))}}
            />;
            return { chartId: chart.id, tableId: table.id, element };
        });
    }, [charts, tables, conceptShelfItems, chartSynthesisInProgress]);

    // anchors are considered leaf tables to simplify the view

    let isLeafTable = (table: DictTable) => {
        let children = tables.filter(t => t.derive?.trigger.tableId == table.id);
        if (children.length == 0 || children.every(t => t.anchored)) {
            return true;
        }
        return false;
    }
    let leafTables = [ ...tables.filter(t => isLeafTable(t)) ];

    // Stable viewport estimate for split decisions.  We measure the OUTER
    // wrapper (thread area + chatbox) and subtract a fixed baseline for the
    // collapsed chatbox footprint.  This keeps the split threshold stable
    // when the chatbox expands during clarification/explanation, avoiding
    // re-splitting of threads as the chatbox grows or shrinks.
    const CHATBOX_BASELINE_HEIGHT = 120; // approximate collapsed-chatbox footprint in px
    const outerHeight = outerRef.current?.clientHeight ?? 0;
    const viewportHeight = outerHeight > CHATBOX_BASELINE_HEIGHT
        ? outerHeight - CHATBOX_BASELINE_HEIGHT
        : (containerRef.current?.clientHeight
            || (typeof window !== 'undefined' ? window.innerHeight : 800));
    // Determine how many columns can fit in the current container width.  When
    // only one column fits, splitting a long thread into segments adds visual
    // overhead (continuation headers + ghost parents) without any layout
    // benefit, since the segments would just stack in the same single column.
    const CARD_GAP = 12; // padding + spacing between cards in a column
    const PANEL_PADDING = 16;
    const CARD_WIDTH = 220;
    const COLUMN_WIDTH = CARD_WIDTH + CARD_GAP;
    // n columns need: n*CARD_WIDTH + (n-1)*CARD_GAP + PANEL_PADDING
    // Solving for n: n <= (containerWidth - PANEL_PADDING + CARD_GAP) / COLUMN_WIDTH
    const fittableColumns = Math.max(1, Math.min(3, Math.floor((containerWidth - PANEL_PADDING + CARD_GAP) / COLUMN_WIDTH)));

    // Split long derivation chains at trigger boundaries so each segment ≈ 1.5×vh.
    // Promoted intermediate tables become "extra leaves"; the existing thread-
    // grouping logic below renders them as the heads of split sub-threads, while
    // the real leaf becomes a continuation segment with a ghost parent + a
    // "↑ continued" header.  Skip splitting in single-column mode — segments
    // would only stack in the same column and the continuation chrome is wasted.
    const computedExtras = fittableColumns <= 1
        ? []
        : computeSplitExtraLeaves(
            leafTables, tables, chartElements, viewportHeight,
        );
    // Avoid duplicating tables that are already leaves (e.g. anchored mids).
    const existingLeafIds = new Set(leafTables.map(t => t.id));
    const extraLeaves: DictTable[] = computedExtras.filter(t => !existingLeafIds.has(t.id));
    if (extraLeaves.length > 0) {
        leafTables = [...leafTables, ...extraLeaves];
    }

    // we want to sort the leaf tables by the order of their ancestors
    // for example if ancestor of list a is [0, 3] and the ancestor of list b is [0, 2] then b should come before a
    // when tables are anchored, we want to give them a higher order (so that they are displayed after their peers)
    let tableOrder = Object.fromEntries(tables.map((table, index) => [table.id, index + (table.anchored ? 1 : 0) * tables.length]));
    let getAncestorOrders = (leafTable: DictTable) => {
        let triggers = getCachedTriggers(leafTable);
        return [...triggers.map(t => tableOrder[t.resultTableId]), tableOrder[leafTable.id]];
    }

    leafTables.sort((a, b) => {
        let aOrders = getAncestorOrders(a);
        let bOrders = getAncestorOrders(b);
        
        // If lengths are equal, compare orders in order
        for (let i = 0; i < Math.min(aOrders.length, bOrders.length); i++) {
            if (aOrders[i] !== bOrders[i]) {
                return aOrders[i] - bOrders[i];
            }
        }
        
        // If all orders are equal, compare the leaf tables themselves
        return aOrders.length - bOrders.length;
    });

    // Compute global highlighted table IDs from the focused table's full ancestor chain
    // Also includes derive.source tables (all input tables used in computation)
    let globalHighlightedTableIds: string[] = useMemo(() => {
        if (!focusedTableId) return [];
        let focusedTable = tableById.get(focusedTableId);
        if (!focusedTable) return [];
        // Walk up the trigger chain from the focused table to collect all ancestor IDs
        let ids = new Set<string>([focusedTableId]);
        let current = focusedTable;
        // Add derive.source tables for the focused table itself
        if (current.derive?.source) {
            for (const sid of current.derive.source as string[]) {
                ids.add(sid);
            }
        }
        while (current.derive && !current.anchored) {
            let parentId = current.derive.trigger.tableId;
            ids.add(parentId);
            // Add derive.source tables for each ancestor
            if (current.derive.source) {
                for (const sid of current.derive.source as string[]) {
                    ids.add(sid);
                }
            }
            let parent = tableById.get(parentId);
            if (!parent) break;
            current = parent;
        }
        return [...ids];
    }, [focusedTableId, tableById]);

    // Determine which leaf table's thread the focused table belongs to
    let focusedThreadLeafId: string | undefined = useMemo(() => {
        if (!focusedTableId) return undefined;
        // Check if focused table IS a leaf table
        let directLeaf = leafTables.find(lt => lt.id === focusedTableId);
        if (directLeaf) return directLeaf.id;
        // Otherwise, find the leaf table whose ancestor chain includes the focused table
        for (const lt of leafTables) {
            const triggers = getCachedTriggers(lt);
            const chainIds = [...triggers.map(t => t.resultTableId), lt.id];
            if (chainIds.includes(focusedTableId)) {
                return lt.id;
            }
        }
        return undefined;
    }, [focusedTableId, leafTables, tables]);

    let hasContent = leafTables.length > 0 || tables.length > 0;

    // Collect all tables (including derived ones) for the workspace panel.
    let baseTables = tables;
    // Threaded tables: leaf tables that have a derivation chain
    let threadedTables = leafTables.filter(lt => {
        const triggers = getTriggers(lt, tables);
        return triggers.length + 1 > 1;
    });

    // Build thread entries and their estimated heights for layout.
    // `lockKey` (when set) forces this entry to occupy its own column, no
    // co-packing with other threads — used for split-thread continuation segments.
    type ThreadEntry = {
        key: string;
        groupId: string;
        leafTables: DictTable[];
        threadIdx: number;
        threadLabel?: string;
        isSplitThread?: boolean;          // true → render "↑ continued from above" header + ghost parent
        hasContinuationBelow?: boolean;   // true → render "↓ continues below" footer
        usedTableIds?: string[];
        hideLabel?: boolean;
        lockKey?: string;                 // entries sharing a lockKey can't share a column
    };
    let allThreadEntries: ThreadEntry[] = [];
    let allThreadHeights: number[] = [];

    // Track which leaf tables are promoted (split) vs real leaves
    const extraLeafIds = new Set(extraLeaves.map(t => t.id));

    // Track which table IDs have been claimed by earlier threads
    let claimedTableIds = new Set<string>();

    // Source tables: always displayed as a group at the top, showing all non-derived tables
    let sourceTables = tables.filter(t => !t.derive);
    if (sourceTables.length > 0) {
        sourceTables.forEach(lt => claimedTableIds.add(lt.id));
        let sourceChartCount = sourceTables.reduce((sum, lt) => sum + chartElements.filter(ce => ce.tableId === lt.id).length, 0);
        allThreadEntries.push({
            key: 'source-tables',
            groupId: 'source-tables',
            leafTables: sourceTables,
            threadIdx: -1,
            hideLabel: true,
        });
        allThreadHeights.push(estimateThreadHeight(sourceTables.length, 0, sourceChartCount));
    }

    // Pre-scan: group every threaded leaf (extras + real leaves) by the *real
    // leaf* whose chain it belongs to.  Extras inherit their real leaf's id.
    let extraLeafToRealLeaf = new Map<string, string>();
    for (const lt of threadedTables) {
        if (extraLeafIds.has(lt.id)) continue;
        const triggers = getCachedTriggers(lt);
        const chainIds = new Set(triggers.map(t => t.resultTableId));
        for (const extraId of extraLeafIds) {
            if (chainIds.has(extraId) && !extraLeafToRealLeaf.has(extraId)) {
                extraLeafToRealLeaf.set(extraId, lt.id);
            }
        }
    }
    const groupIdOf = (lt: DictTable) =>
        extraLeafIds.has(lt.id) ? (extraLeafToRealLeaf.get(lt.id) || lt.id) : lt.id;

    // For each group, capture the ordered list of segments (using current
    // threadedTables iteration order, which has already been ancestor-sorted).
    const segmentsByGroup = new Map<string, string[]>();
    for (const lt of threadedTables) {
        const gid = groupIdOf(lt);
        const arr = segmentsByGroup.get(gid) || [];
        arr.push(lt.id);
        segmentsByGroup.set(gid, arr);
    }

    // Numbering: only the *first* segment of each group bumps the counter and
    // gets a visible label.  Continuation segments are unlabelled — they rely
    // on the "↑ continued" header chip + ghost parent for visual continuity.
    let realThreadIdx = 0;

    threadedTables.forEach((lt, i) => {
        const triggers = getCachedTriggers(lt);

        let threadTableIds = new Set<string>();
        triggers.forEach(t => threadTableIds.add(t.resultTableId));
        threadTableIds.add(lt.id);

        let newTableIds = [...threadTableIds].filter(id => !claimedTableIds.has(id));
        let newTriggerPairs = triggers.filter(tp => newTableIds.includes(tp.resultTableId));
        let chartCount = newTableIds.reduce((sum, tid) => sum + chartElements.filter(ce => ce.tableId === tid).length, 0);
        let entryCount = newTriggerPairs.reduce((sum, tp) => sum + (tp.interaction?.length || 1), 0);
        entryCount += lt.derive?.trigger?.interaction?.length || 1;
        let totalTables = newTableIds.length + 1;

        threadTableIds.forEach(id => claimedTableIds.add(id));

        const gid = groupIdOf(lt);
        const groupSegs = segmentsByGroup.get(gid)!;
        const posInGroup = groupSegs.indexOf(lt.id);
        const isFirst = posInGroup === 0;
        const isLast = posInGroup === groupSegs.length - 1;
        const isMultiSegment = groupSegs.length > 1;

        let threadLabel: string | undefined;
        let threadIdxForEntry: number;
        if (isFirst) {
            realThreadIdx++;
            threadLabel = t('dataThread.threadIndex', { index: String(realThreadIdx) });
            threadIdxForEntry = realThreadIdx - 1;
        } else {
            threadLabel = undefined;
            threadIdxForEntry = realThreadIdx - 1; // inherit head's idx
        }

        allThreadEntries.push({
            key: `thread-${lt.id}-${i}`,
            groupId: lt.id,
            leafTables: [lt],
            threadIdx: threadIdxForEntry,
            threadLabel,
            isSplitThread: !isFirst,             // continuation → ghost parent + header
            hideLabel: !isFirst,                 // continuation → no own label divider
            hasContinuationBelow: !isLast,       // not the tail → "↓ continues below" footer
            lockKey: isMultiSegment ? gid : undefined,
        });
        allThreadHeights.push(estimateThreadHeight(totalTables, entryCount, chartCount));
    });

    // Pre-compute usedTableIds for each entry (avoids quadratic recomputation in renderThreadEntry)
    {
        let accumulated: string[] = [];
        for (const entry of allThreadEntries) {
            entry.usedTableIds = [...accumulated];
            for (const lt of entry.leafTables) {
                const triggers = getCachedTriggers(lt);
                // Include both source (tableId) and result (resultTableId) IDs from the chain
                for (const tp of triggers) {
                    accumulated.push(tp.tableId, tp.resultTableId);
                }
                accumulated.push(lt.id);
            }
        }
    }

    // Pick the best column layout: dynamically based on container width.
    // Use the same stable viewportHeight (derived from the outer wrapper) for
    // packing as we do for split decisions — so the column count doesn't shift
    // when the chatbox grows during clarification/explanation.
    const availableHeight = viewportHeight;
    const hasMultipleThreads = allThreadEntries.length > 1;

    const MAX_COLUMNS = fittableColumns;
    // Use the lock-aware packer when any thread has been split into segments;
    // otherwise fall back to the height-balanced multi-column packer.
    const hasLockedEntries = allThreadEntries.some(e => !!e.lockKey);
    const columnLayout: number[][] = hasLockedEntries
        ? packColumnsWithLocks(
            allThreadHeights,
            allThreadEntries.map(e => e.lockKey),
            availableHeight,
            MAX_COLUMNS,
        )
        : chooseBestColumnLayout(
            allThreadHeights, MAX_COLUMNS, availableHeight, /* flexOrder */ false,
            /* minColumns */ fittableColumns
        );

    let renderThreadEntry = (entry: ThreadEntry) => {
        let usedTableIds = entry.usedTableIds || [];

        return <SingleThreadGroupView
            key={entry.key}
            threadIdx={entry.threadIdx}
            threadLabel={entry.threadLabel}
            isSplitThread={entry.isSplitThread}
            hasContinuationBelow={entry.hasContinuationBelow}
            hideLabel={entry.hideLabel}
            leafTables={entry.leafTables}
            chartElements={chartElements}
            usedIntermediateTableIds={usedTableIds}
            globalHighlightedTableIds={globalHighlightedTableIds}
            focusedThreadLeafId={focusedThreadLeafId}
            sx={{
                backgroundColor: 'white',
                borderRadius: radius.md,
                padding: 1,
                my: 0.5,
                flex: 'none',
                display: 'flex',
                flexDirection: 'column',
                height: 'fit-content',
                width: CARD_WIDTH,
                transition: transition.fast,
            }} />;
    };

    // Let content fill available width; column count driven by container size
    const panelWidth = '100%';

    let view = hasContent ? (
        <Box sx={{ 
            overflowY: 'auto',
            overflowX: 'hidden',
            position: 'relative',
            direction: 'ltr',
            height: 'calc(100% - 16px)',
            width: panelWidth,
        }}>
            <Box sx={{
                display: 'flex',
                flexDirection: 'row',
                flexWrap: 'nowrap',
                justifyContent: 'center',
                gap: `${CARD_GAP}px`,
                py: 1,
                // Bottom padding leaves room so the scroll handler can position
                // the focused element above the chatbox even when it expands.
                pb: '180px',
                pl: `${PANEL_PADDING / 2}px`,
                pr: 0,
            }}>
                {/* First column: workspace panel + first batch of threads */}
                <Box key="thread-column-0" sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 0,
                    width: CARD_WIDTH,
                    flexShrink: 0,
                }}>
                    {(columnLayout[0] || []).map((idx: number) => {
                        const entry = allThreadEntries[idx];
                        return entry ? renderThreadEntry(entry) : null;
                    })}
                </Box>
                {/* Remaining columns */}
                {columnLayout.slice(1).map((columnIndices: number[], colIdx: number) => (
                    <Box key={`thread-column-${colIdx + 1}`} sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 0,
                        width: CARD_WIDTH,
                        flexShrink: 0,
                    }}>
                        {columnIndices.map((idx: number) => {
                            const entry = allThreadEntries[idx];
                            return entry ? renderThreadEntry(entry) : null;
                        })}
                    </Box>
                ))}
            </Box>
        </Box>
    ) : null;

    return (
        <Box
            ref={outerRef}
            className="data-thread"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            sx={{
                ...sx,
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                ...(isDragOver && {
                    outline: '2px dashed',
                    outlineColor: 'primary.main',
                    outlineOffset: -2,
                    backgroundColor: 'action.hover',
                }),
            }}
        >
            <Box ref={containerRef} sx={{
                    overflow: 'hidden', 
                    direction: 'rtl', 
                    display: 'block', 
                    flex: 1,
                    minHeight: 0,
                }}>
                {view}
            </Box>
            <SimpleChartRecBox onInputFocus={() => setChatboxFocusTick(t => t + 1)} />
        </Box>
    );
}

