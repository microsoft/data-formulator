// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useEffect, useMemo, useRef, useState, memo } from 'react';

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
import { batch, useDispatch, useSelector } from 'react-redux';
import { DataFormulatorState, dfActions, dfSelectors, SSEMessage } from '../app/dfSlice';
import { getTriggers, getUrls, fetchWithIdentity } from '../app/utils';
import { Chart, DictTable, Trigger } from "../components/ComponentType";

import DeleteIcon from '@mui/icons-material/Delete';
import StarIcon from '@mui/icons-material/Star';
import { TableIcon, AnchorIcon, InsightIcon, StreamIcon, AgentIcon } from '../icons';


import _ from 'lodash';
import { getChartTemplate } from '../components/ChartTemplates';

import 'prismjs/components/prism-python' // Language
import 'prismjs/components/prism-typescript' // Language
import 'prismjs/themes/prism.css'; //Example style, you can use another

import { checkChartAvailability, generateChartSkeleton, getDataTable } from './VisualizationView';

import AttachFileIcon from '@mui/icons-material/AttachFile';
import EditIcon from '@mui/icons-material/Edit';
import RefreshIcon from '@mui/icons-material/Refresh';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import AddIcon from '@mui/icons-material/Add';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

import { alpha } from '@mui/material/styles';

import { RefreshDataDialog } from './RefreshDataDialog';
import { AppDispatch } from '../app/store';
import StopIcon from '@mui/icons-material/Stop';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess';
import BarChartIcon from '@mui/icons-material/BarChart';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import ScatterPlotIcon from '@mui/icons-material/ScatterPlot';
import PieChartOutlineIcon from '@mui/icons-material/PieChartOutline';
import GridOnIcon from '@mui/icons-material/GridOn';
import { useDataRefresh } from '../app/useDataRefresh';
import { buildChartCard, buildTriggerCard, buildTableCard, BuildTableCardProps } from './DataThreadCards';
import { UnifiedDataUploadDialog } from './UnifiedDataUploadDialog';
import { AgentRulesDialog } from './AgentRulesDialog';
import RuleIcon from '@mui/icons-material/Rule';

import { ViewBorderStyle, transition, radius, borderColor } from '../app/tokens';
import { SimpleChartRecBox } from './SimpleChartRecBox';


export const ThinkingBanner = (message: string, sx?: SxProps) => (
    <Box sx={{ 
        display: 'flex', 
        position: 'relative',
        overflow: 'hidden',
        '&::before': {
            content: '""',
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: 'linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.8) 50%, transparent 100%)',
            animation: 'windowWipe 2s ease-in-out infinite',
            zIndex: 1,
            pointerEvents: 'none',
        },
        '@keyframes windowWipe': {
            '0%': {
                transform: 'translateX(-100%)',
            },
            '100%': {
                transform: 'translateX(100%)',
            },
        },
        ...sx
    }}>
        <Typography variant="body2" sx={{ 
            fontSize: 10, 
            color: 'rgba(0, 0, 0, 0.7) !important'
        }}>
            {message}
        </Typography>
    </Box>
);


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
                                        Watch for updates
                                    </Typography>
                                }
                                sx={{ mr: 0 }}
                            />
                            {autoRefresh && (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 100 }}>
                                    <Typography variant="body2" sx={{ fontSize: 11, color: 'text.secondary' }}>
                                        every
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
                                        <MenuItem value={1}>1s</MenuItem>
                                        <MenuItem value={10}>10s</MenuItem>
                                        <MenuItem value={30}>30s</MenuItem>
                                        <MenuItem value={60}>1m</MenuItem>
                                        <MenuItem value={300}>5m</MenuItem>
                                        <MenuItem value={600}>10m</MenuItem>
                                        <MenuItem value={1800}>30m</MenuItem>
                                        <MenuItem value={3600}>1h</MenuItem>
                                        <MenuItem value={86400}>24h</MenuItem>
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
                                    Refresh now
                                </Button>
                            )}
                        </Box>
                    </Box>
                </Paper>
            </ClickAwayListener>
        </Popper>
    );
});

// Metadata Popup Component
const MetadataPopup = memo<{
    open: boolean;
    anchorEl: HTMLElement | null;
    onClose: () => void;
    onSave: (metadata: string) => void;
    initialValue: string;
    tableName: string;
}>(({ open, anchorEl, onClose, onSave, initialValue, tableName }) => {
    const [metadata, setMetadata] = useState(initialValue);

    let hasChanges = metadata !== initialValue;

    useEffect(() => {
        setMetadata(initialValue);
    }, [initialValue, open]);

    const handleSave = () => {
        onSave(metadata);
        onClose();
    };

    const handleCancel = () => {
        setMetadata(initialValue);
        onClose();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            handleCancel();
        } else if (e.key === 'Enter' && e.ctrlKey) {
            handleSave();
        }
    };

    return (
        <Popper
            open={open}
            anchorEl={anchorEl}
            placement="bottom-start"
            style={{ zIndex: 1300 }}
        >
            <ClickAwayListener onClickAway={handleCancel}>
                <Paper
                    elevation={8}
                    sx={{
                        width: 480,
                        fontSize: 12,
                        p: 2,
                        mt: 1,
                        ...ViewBorderStyle,
                    }}
                >
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                        Attach metadata to <Typography component="span" sx={{ fontSize: 'inherit', color: 'primary.main'}}>{tableName}</Typography>
                    </Typography>
                    <TextField
                        autoFocus
                        label="metadata"
                        placeholder="Attach additional contexts or guidance so that AI agents can better understand and process the data."
                        fullWidth
                        multiline
                        slotProps={{
                            inputLabel: {shrink: true},
                        }}
                        minRows={3}
                        maxRows={20}
                        variant="outlined"
                        size="small"
                        value={metadata}
                        onChange={(e) => setMetadata(e.target.value)}
                        onKeyDown={handleKeyDown}
                        sx={{ my: 1, '& .MuiInputBase-input': { fontSize: 12 } }}
                    />
                    <Box sx={{ mt: 1, display: 'flex', gap: 1, alignItems: 'center' }}>
                        <Button size="small" sx={{ml: 'auto'}} onClick={handleCancel} color="primary">Cancel</Button>
                        <Button size="small" onClick={handleSave} color="primary" disabled={!hasChanges}>Save</Button>
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
                        Rename table
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
                        <Button size="small" onClick={onClose}>Cancel</Button>
                        <Button size="small" onClick={handleSave} color="primary" disabled={name.trim() === '' || name.trim() === initialValue}>Save</Button>
                    </Box>
                </Paper>
            </ClickAwayListener>
        </Popper>
    );
});

const WorkspacePanel: FC<{
    tables: DictTable[],
    chartElements: { tableId: string, chartId: string, element: any }[],
    suppressScrollRef?: React.MutableRefObject<boolean>,
    sx?: SxProps,
}> = function ({ tables, chartElements, suppressScrollRef, sx }) {
    const theme = useTheme();
    const dispatch = useDispatch();
    const charts = useSelector(dfSelectors.getAllCharts);
    const focusedId = useSelector((state: DataFormulatorState) => state.focusedId);
    const focusedTableId = React.useMemo(() => {
        if (!focusedId) return undefined;
        if (focusedId.type === 'table') return focusedId.tableId;
        const chartId = focusedId.chartId;
        const chart = charts.find(c => c.id === chartId);
        return chart?.tableRef;
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

    const getTableSourceName = (table: DictTable) => {
        // Get the source file name from table source
        if (table.source?.type === 'file' && table.source?.fileName) {
            return table.source.fileName;
        }
        if (table.source?.type === 'database' && table.source?.databaseTable) {
            return table.source.databaseTable;
        }
        if (table.source?.type === 'stream' && table.source?.url) {
            // Extract a meaningful name from URL
            try {
                const url = new URL(table.source.url);
                return url.hostname;
            } catch {
                return 'stream';
            }
        }
        return null;
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
                        Workspace
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
                    <Typography sx={{ fontSize: 11, fontWeight: 600 }}>add data</Typography>
                </Box>
            </Box>

            <Collapse in={workspaceExpanded} timeout={150}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px', mt: '2px', ml: '14px', py: 0.5 }}>
                    {tables.map((table, tableIndex) => {
                        const isTableActive = focusedTableId === table.id;
                        const tableCharts = chartElements.filter(ce => ce.tableId === table.id);
                        const sourceName = getTableSourceName(table);
                        const isLastTable = tableIndex === tables.length - 1;

                        const handleTableClick = () => {
                            if (suppressScrollRef) suppressScrollRef.current = true;
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
                                <Box
                                    sx={fileItemSx(isTableActive)}
                                    onClick={handleTableClick}
                                >
                                    {getTableIcon(table)}
                                    <Typography sx={{
                                        fontSize: 11,
                                        fontWeight: isTableActive ? 600 : 400,
                                        color: isTableActive ? 'primary.main' : 'text.primary',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                        flex: 1,
                                        minWidth: 0,
                                    }}>
                                        {table.displayId || table.id}
                                        {sourceName && (
                                            <Typography component="span" sx={{
                                                fontSize: 10,
                                                color: 'text.disabled',
                                                ml: 0.5,
                                            }}>
                                                ({sourceName})
                                            </Typography>
                                        )}
                                    </Typography>
                                    {table.attachedMetadata && (
                                        <AttachFileIcon sx={{ fontSize: 10, color: 'text.disabled', flexShrink: 0 }} />
                                    )}
                                </Box>

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
                                                if (suppressScrollRef) suppressScrollRef.current = true;
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
    scrollRef: any,
    threadIdx: number,
    threadLabel?: string, // Custom label like "thread 1.1" for split sub-threads
    isSplitThread?: boolean, // When true, truncate used tables to immediate parent + "..."
    hideLabel?: boolean, // When true, hide the thread label divider
    leafTables: DictTable[];
    chartElements: { tableId: string, chartId: string, element: any }[];
    usedIntermediateTableIds: string[],
    globalHighlightedTableIds: string[],
    focusedThreadLeafId?: string, // The leaf table ID of the thread containing the focused table
    chatboxFocused?: boolean, // Whether the chatbox input is focused
    sx?: SxProps
}> = function ({
    scrollRef,
    threadIdx,
    threadLabel,
    isSplitThread = false,
    hideLabel = false,
    leafTables,
    chartElements,
    usedIntermediateTableIds, // tables that have been used
    globalHighlightedTableIds,
    focusedThreadLeafId,
    chatboxFocused = false,
    sx
}) {

    let tables = useSelector((state: DataFormulatorState) => state.tables);
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
            const chainIds = [...trigs.map(t => t.tableId), lt.id];
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
        const chartId = focusedId.chartId;
        const chart = charts.find(c => c.id === chartId);
        return chart?.tableRef;
    }, [focusedId, charts]);
    let agentActions = useSelector((state: DataFormulatorState) => state.agentActions);

    // Pre-index running agent table IDs for O(1) lookup
    const runningAgentTableIds = useMemo(() => {
        const ids = new Set<string>();
        for (const a of agentActions) {
            if (!a.hidden && a.status === 'running') ids.add(a.tableId);
        }
        return ids;
    }, [agentActions]);

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

    const handleSaveMetadata = (metadata: string) => {
        if (selectedTableForMetadata) {
            dispatch(dfActions.updateTableAttachedMetadata({
                tableId: selectedTableForMetadata.id,
                attachedMetadata: metadata
            }));
        }
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
            .filter(dt => dt.derive && dt.derive.code)
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
                        output_variable: derivedTable.derive!.outputVariable || 'result_df',
                        virtual: !!derivedTable.virtual?.tableId,
                        output_table_name: derivedTable.virtual?.tableId
                    };
                    
                    const response = await fetchWithIdentity(getUrls().REFRESH_DERIVED_DATA, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(requestBody)
                    });

                    const result = await response.json();
                    if (result.status === 'ok' && result.rows) {
                        return { tableId: derivedTable.id, rows: result.rows } as { tableId: string, rows: any[] };
                    } else {
                        console.error(`Failed to refresh derived table ${derivedTable.id}:`, result.message);
                        dispatch(dfActions.addMessages({
                            timestamp: Date.now(),
                            type: 'error',
                            component: 'data refresh',
                            value: `Failed to refresh derived table "${derivedTable.displayId || derivedTable.id}": ${result.message || 'Unknown error'}`
                        }));
                        return null;
                    }
                } catch (error) {
                    console.error(`Error refreshing derived table ${derivedTable.id}:`, error);
                    dispatch(dfActions.addMessages({
                        timestamp: Date.now(),
                        type: 'error',
                        component: 'data refresh',
                        value: `Error refreshing derived table "${derivedTable.displayId || derivedTable.id}"`
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
                component: 'data refresh',
                value: `Successfully refreshed data for "${selectedTableForRefresh.displayId || selectedTableForRefresh.id}" and updated derived tables.`
            }));
        } catch (error) {
            console.error('Error during refresh:', error);
            dispatch(dfActions.addMessages({
                timestamp: Date.now(),
                type: 'error',
                component: 'data refresh',
                value: `Error refreshing data: ${error}`
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
    
    let triggers = parentTable ? getTriggers(parentTable, tables) : [];
    let tableIdList = parentTable ? [...triggers.map((trigger) => trigger.tableId), parentTable.id] : [];

    let usedTableIdsInThread = tableIdList.filter(id => usedIntermediateTableIds.includes(id));
    let newTableIds = tableIdList.filter(id => !usedTableIdsInThread.includes(id));
    let newTriggers = triggers.filter(tg => newTableIds.includes(tg.resultTableId));

    // Use the global highlighted table IDs (computed at DataThread level from the focused table's full ancestor chain)
    let highlightedTableIds = globalHighlightedTableIds;

    let _buildTriggerCard = (trigger: Trigger, highlighted: boolean = false) => {
        return buildTriggerCard(trigger, focusedChartId, highlighted);
    }

    // Shared props for buildTableCard calls
    let tableCardProps: Omit<BuildTableCardProps, 'tableId'> = {
        tables, charts, chartElements, usedIntermediateTableIds,
        highlightedTableIds, focusedTableId, focusedChartId, focusedChart,
        parentTable, tableIdList, collapsed, scrollRef, dispatch,
        handleOpenTableMenu, primaryBgColor: theme.palette.primary.bgcolor,
    };

    let _buildTableCard = (tableId: string) => {
        return buildTableCard({ tableId, ...tableCardProps });
    }

    let tableElementList = newTableIds.map((tableId, i) => _buildTableCard(tableId));
    let triggerCards = newTriggers.map((trigger) => {
        const triggerTableId = trigger.resultTableId;
        const isHL = triggerTableId ? highlightedTableIds.includes(triggerTableId) : false;
        return _buildTriggerCard(trigger, isHL);
    });

    // Build a flat sequence of timeline items: [trigger, table, charts, trigger, table, charts, ...]
    let timelineItems: { key: string; element: React.ReactNode; type: 'used-table' | 'trigger' | 'table' | 'chart' | 'leaf-trigger' | 'leaf-table'; highlighted: boolean; tableId?: string; chartType?: string; isRunning?: boolean }[] = [];

    // Add used (shared) tables at the top
    // Only show the immediate parent + "..." for further ancestors
    let displayedUsedTableIds = usedTableIdsInThread;
    if (usedTableIdsInThread.length > 1) {
        // Keep only the last (immediate parent), prepend "..." placeholder
        displayedUsedTableIds = usedTableIdsInThread.slice(-1);
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
    displayedUsedTableIds.forEach((tableId, i) => {
        let table = tableById.get(tableId) as DictTable;
        timelineItems.push({
            key: `used-table-${tableId}-${i}`,
            type: 'used-table',
            tableId: tableId,
            highlighted: highlightedTableIds.includes(tableId),
            element: (
                <Typography 
                    sx={{
                        fontSize: '10px',
                        cursor: 'pointer',
                        width: 'fit-content',
                        '&:hover': {
                            backgroundColor: alpha(theme.palette.primary.light, 0.1),
                        },
                    }} 
                    onClick={() => { dispatch(dfActions.setFocused({ type: 'table', tableId })) }}>
                    {table.displayId || tableId}
                </Typography>
            ),
        });
    });

    // Interleave triggers and tables for the main thread body
    newTableIds.forEach((tableId, i) => {
        const trigger = newTriggers.find(t => t.resultTableId === tableId);
        const isHighlighted = highlightedTableIds.includes(tableId);

        // Add trigger card if exists
        if (trigger) {
            const triggerCard = triggerCards[newTriggers.indexOf(trigger)];
            if (triggerCard) {
                timelineItems.push({
                    key: triggerCard?.key || `woven-trigger-${tableId}`,
                    type: 'trigger',
                    highlighted: isHighlighted,
                    element: triggerCard,
                });
            }
        }

        // Add table card and its charts
        const tableCard = tableElementList[i];
        if (Array.isArray(tableCard)) {
            tableCard.forEach((subItem: any, j: number) => {
                if (!subItem) return;
                const subKey = subItem?.key || `woven-${tableId}-${j}`;
                const isChart = subKey.includes('chart');
                // Extract chartType from the key (pattern: 'relevant-chart-{chartId}')
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
                    type: isChart ? 'chart' : 'table',
                    tableId: isChart ? undefined : tableId,
                    chartType: itemChartType,
                    highlighted: isHighlighted,
                    element: subItem,
                });
            });
        }

        // If an agent is running on this table, add a "working..." indicator
        if (runningAgentTableIds.has(tableId)) {
            const runningAction = agentActions.find(a => a.tableId === tableId && a.status === 'running' && !a.hidden);
            const message = runningAction?.description || 'working...';
            timelineItems.push({
                key: `agent-running-${tableId}`,
                type: 'chart',
                highlighted: isHighlighted,
                isRunning: true,
                element: ThinkingBanner(message, { px: 1, py: 0.5 }),
            });
        }
    });

    // Add leaf table components
    leafTables.forEach((lt, i) => {
        let leafTrigger = lt.derive?.trigger;
        if (leafTrigger) {
            timelineItems.push({
                key: `leaf-trigger-${lt.id}`,
                type: 'leaf-trigger',
                highlighted: highlightedTableIds.includes(lt.id),
                element: _buildTriggerCard(leafTrigger, highlightedTableIds.includes(lt.id)),
            });
        }
        let leafCards = _buildTableCard(lt.id);
        if (Array.isArray(leafCards)) {
            leafCards.forEach((subItem: any, j: number) => {
                if (!subItem) return;
                const subKey = subItem?.key || `leaf-card-${lt.id}-${j}`;
                const isChart = subKey.includes('chart');
                let leafChartType: string | undefined;
                if (isChart) {
                    const cIdMatch = subKey.match(/(?:chart)-(.+)$/);
                    if (cIdMatch) {
                        const cObj = charts.find(c => c.id === cIdMatch[1]);
                        leafChartType = cObj?.chartType;
                    }
                }
                timelineItems.push({
                    key: subKey,
                    type: isChart ? 'chart' : 'leaf-table',
                    tableId: isChart ? undefined : lt.id,
                    chartType: leafChartType,
                    highlighted: highlightedTableIds.includes(lt.id),
                    element: subItem,
                });
            });
        }

        // If an agent is running on this leaf table, add a "working..." indicator
        if (runningAgentTableIds.has(lt.id)) {
            const runningAction = agentActions.find(a => a.tableId === lt.id && a.status === 'running' && !a.hidden);
            const message = runningAction?.description || 'working...';
            timelineItems.push({
                key: `agent-running-${lt.id}`,
                type: 'chart',
                highlighted: highlightedTableIds.includes(lt.id),
                isRunning: true,
                element: ThinkingBanner(message, { px: 1, py: 0.5 }),
            });
        }
    });

    // Timeline rendering helper
    const TIMELINE_WIDTH = 14;
    const TIMELINE_GAP = '4px'; // gap between timeline and card content
    const DOT_SIZE = 6;
    const CARD_PY = '6px'; // vertical padding for each timeline row

    const getTimelineDot = (item: typeof timelineItems[0]) => {
        const isTable = item.type === 'table' || item.type === 'leaf-table' || item.type === 'used-table';
        const color = item.highlighted 
            ? theme.palette.primary.main
            : 'rgba(0,0,0,0.15)';

        // For running agent items, show a spinner instead of a dot
        if (item.isRunning) {
            return <CircularProgress size={12} thickness={5} sx={{ color: theme.palette.primary.main }} />;
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
        const dashedWidth = item.highlighted ? '2px' : '1px';
        const dashedStyle = 'solid';
        // Bottom connector uses unhighlighted style if next item isn't highlighted
        const bottomHighlighted = item.highlighted && nextHighlighted;
        const bottomDashedColor = bottomHighlighted ? alpha(theme.palette.primary.main, 0.6) : 'rgba(0,0,0,0.1)';
        const bottomDashedWidth = bottomHighlighted ? '2px' : '1px';
        const bottomDashedStyle = 'solid';
        const triggerColor = item.highlighted 
            ? theme.palette.custom.main
            : 'rgba(0,0,0,0.15)';
        // Dim non-highlighted cards when chatbox is focused
        const rowHighlightSx = (chatboxFocused && hasHighlighting && !item.highlighted) ? { opacity: 0.35 } : {};

        // Triggers: agent icon on the timeline
        if (isTrigger) {
            return (
                <Box key={`timeline-row-${item.key}`} sx={{ display: 'flex', flexDirection: 'row', position: 'relative', ...rowHighlightSx }}>
                    <Box sx={{ 
                        width: TIMELINE_WIDTH, flexShrink: 0, 
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                    }}>
                        <Box sx={{ width: 0, flex: '1 1 0', minHeight: 2, borderLeft: `${dashedWidth} ${dashedStyle} ${dashedColor}` }} />
                        <Box sx={{ flexShrink: 0, zIndex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <AgentIcon sx={{ width: 14, height: 14, color: triggerColor }} />
                        </Box>
                        {!isLast && <Box sx={{ width: 0, flex: '1 1 0', minHeight: 2, borderLeft: `${bottomDashedWidth} ${bottomDashedStyle} ${bottomDashedColor}` }} />}
                        {isLast && <Box sx={{ flex: '1 1 0', minHeight: 2 }} />}
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
                        {isLast && <Box sx={{ flex: '1 1 0', minHeight: 2 }} />}
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
                        const topWidth = useHeader ? (headerHL ? '2px' : '1px') : dashedWidth;
                        const topStyle = 'solid';
                        return <Box sx={{ width: 0, flex: '1 1 0', minHeight: 6, borderLeft: `${topWidth} ${topStyle} ${topColor}` }} />;
                    })()}
                    {index === 0 && hideLabel && <Box sx={{ flex: '1 1 0', minHeight: 6 }} />}
                    <Box sx={{ flexShrink: 0, zIndex: 1, backgroundColor: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {getTimelineDot(item)}
                    </Box>
                    {!isLast && (
                        <Box sx={{ width: 0, flex: '1 1 0', minHeight: 6, borderLeft: `${bottomDashedWidth} ${bottomDashedStyle} ${bottomDashedColor}` }} />
                    )}
                    {isLast && <Box sx={{ flex: '1 1 0', minHeight: 6 }} />}
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
            padding: '6px',
            ...(chatboxFocused && focusedThreadLeafId && !shouldHighlightThread ? { opacity: 0.35 } : {}),
        }}
        >
        <div style={{ padding: '2px 4px 2px 4px', marginTop: 0, direction: 'ltr' }}>
            {!hideLabel && (() => {
                const hlColor = theme.palette.primary.main;
                const nhColor = 'rgba(0,0,0,0.35)';
                const connColor = headerHL ? alpha(theme.palette.primary.main, 0.6) : 'rgba(0,0,0,0.1)';
                const connWidth = headerHL ? '2px' : '1px';
                const connStyle = 'solid';
                return (
                <Box sx={{ display: 'flex', flexDirection: 'row', ...(chatboxFocused && hasHighlighting && !headerHL ? { opacity: 0.35 } : {}) }}>
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
                    <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', pl: 0.5 }}>
                        <Typography sx={{ 
                            fontSize: '11px', fontWeight: 700, 
                            textTransform: 'uppercase', letterSpacing: '0.02em',
                            color: headerHL ? hlColor : 'rgba(0,0,0,0.55)', 
                        }}>
                            {threadLabel || (threadIdx === -1 ? 'Thread 0' : `Thread ${threadIdx + 1}`)}
                        </Typography>
                    </Box>
                </Box>
                );
            })()}
            {timelineItems.map((item, index) => renderTimelineItem(item, index, index === timelineItems.length - 1, timelineItems[index + 1]?.highlighted ?? false))}
        </div>
        <MetadataPopup
            open={metadataPopupOpen}
            anchorEl={metadataAnchorEl}
            onClose={handleCloseMetadataPopup}
            onSave={handleSaveMetadata}
            initialValue={selectedTableForMetadata?.attachedMetadata || ''}
            tableName={selectedTableForMetadata?.displayId || selectedTableForMetadata?.id || ''}
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
                Rename
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
                    {selectedTableForMenu?.anchored ? "Unpin table" : "Pin table"}
                </MenuItem>
            )}
            {/* Non-derived table options */}
            {selectedTableForMenu?.derive == undefined && (
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
                        color: selectedTableForMenu?.attachedMetadata ? 'secondary.main' : 'text.secondary',
                    }}/>
                    {selectedTableForMenu?.attachedMetadata ? "Edit metadata" : "Attach metadata"}
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
                    {selectedTableForMenu.source?.autoRefresh ? 'Refresh settings' : 'Watch for updates'}
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
                    Replace data
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
                Delete table
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

    let deleteButton = <Box className='data-thread-chart-card-action-button'
        sx={{ zIndex: 10, color: 'blue', position: "absolute", right: 1, background: 'rgba(255, 255, 255, 0.95)' }}>
        <Tooltip title="delete chart">
            <IconButton size="small" color="warning" onClick={(event) => {
                event.stopPropagation();
                onDelete(chart.id);
            }}><DeleteIcon fontSize="small" /></IconButton>
        </Tooltip>
    </Box>

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
                            alt={`${chart.chartType} chart`}
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
const LAYOUT_TRIGGER_HEIGHT = 43 + 8;   // trigger card (2 lines) + row padding
const LAYOUT_CHART_HEIGHT = 90 + 8;     // chart card (~70-110) + row padding
const LAYOUT_THREAD_OVERHEAD = 52;      // header divider + thread padding
const LAYOUT_THREAD_GAP = 8;            // my: 0.5 = 4px top + 4px bottom between threads

function estimateThreadHeight(
    tableCount: number, triggerCount: number, chartCount: number
): number {
    return LAYOUT_THREAD_OVERHEAD
        + tableCount * LAYOUT_TABLE_HEIGHT
        + triggerCount * LAYOUT_TRIGGER_HEIGHT
        + chartCount * LAYOUT_CHART_HEIGHT;
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
const SCROLL_TOLERANCE = 1.5; // allow up to 50% overflow before adding columns

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

    let tables = useSelector((state: DataFormulatorState) => state.tables);
    let focusedId = useSelector((state: DataFormulatorState) => state.focusedId);
    let charts = useSelector(dfSelectors.getAllCharts);

    // Derive focusedTableId from focusedId for scroll/highlight logic
    let focusedTableId = useMemo(() => {
        if (!focusedId) return undefined;
        if (focusedId.type === 'table') return focusedId.tableId;
        const chartId = focusedId.chartId;
        const chart = charts.find(c => c.id === chartId);
        return chart?.tableRef;
    }, [focusedId, charts]);

    let chartSynthesisInProgress = useSelector((state: DataFormulatorState) => state.chartSynthesisInProgress);

    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);

    const scrollRef = useRef<null | HTMLDivElement>(null)
    const containerRef = useRef<null | HTMLDivElement>(null)
    const suppressScrollRef = useRef(false);
    const [expandedColumns, setExpandedColumns] = useState(false);
    const [containerWidth, setContainerWidth] = useState(0);
    const [chatboxFocused, setChatboxFocused] = useState(false);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const ro = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setContainerWidth(entry.contentRect.width);
            }
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const theme = useTheme();

    const executeScroll = (smooth: boolean = true, block: ScrollLogicalPosition = 'center') => { 
        if (scrollRef.current != null) {
            scrollRef.current.scrollIntoView({ 
                behavior: smooth ? 'smooth' : 'auto', 
                block
            }) 
        }
    }

    const dispatch = useDispatch();

    // Track previous table/chart counts to detect agent additions
    const prevCountsRef = useRef({ tables: tables.length, charts: charts.length });

    useEffect(() => {
        // Only auto-scroll when new tables or charts are added (e.g., by the agent),
        // not when the user simply changes focus by clicking.
        const prevCounts = prevCountsRef.current;
        const isNewItem = tables.length > prevCounts.tables || charts.length > prevCounts.charts;
        prevCountsRef.current = { tables: tables.length, charts: charts.length };

        if (focusedTableId && isNewItem) {
            executeScroll(true);
        }
    }, [focusedTableId]);

    // When the chatbox panel expands, scroll the focused table above the overlay if needed
    useEffect(() => {
        if (chatboxFocused && focusedTableId && scrollRef.current && containerRef.current) {
            setTimeout(() => {
                if (!scrollRef.current || !containerRef.current) return;
                const container = containerRef.current;
                const el = scrollRef.current;
                const containerRect = container.getBoundingClientRect();
                const elRect = el.getBoundingClientRect();
                // The overlay panel is ~220px from bottom; ensure the focused element's bottom
                // is at least 240px above the container's bottom
                const safeZone = 400;
                const elBottomInContainer = elRect.bottom - containerRect.top;
                const visibleHeight = containerRect.height - safeZone;
                if (elBottomInContainer > visibleHeight) {
                    // Scroll so the element top is near the top of the container
                    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }, 100);
        }
    }, [chatboxFocused]);

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

    // Split long derivation chains by promoting intermediate tables as additional "leaves".
    // If a chain has more than MAX_CHAIN_TABLES tables, we add a split point every
    // MAX_CHAIN_TABLES steps. The sort (shorter chains first) ensures the intermediate
    // leaf is processed before the real leaf, so its tables get claimed — making the
    // real leaf's thread show only the remaining (new) tables.
    // When counting chain length, exclude "used" tables (already claimed by an earlier
    // chain) so that shared ancestors don't inflate the count. The first chain to
    // contain a table still counts it as owned.
    const MAX_CHAIN_TABLES = 5;

    // Process leaves in order, tracking claimed tables to simulate the later claim loop.
    // A table is "used" for a chain only if a *previous* chain already claimed it.
    const claimedForSplit = new Set<string>();
    const extraLeaves: DictTable[] = [];
    for (const lt of leafTables) {
        const triggers = getCachedTriggers(lt);
        const allChainIds = [lt.id, ...triggers.map(t => t.tableId)];
        // Tables not yet claimed by an earlier chain count as owned
        const ownedIds = allChainIds.filter(id => !claimedForSplit.has(id));
        if (ownedIds.length > MAX_CHAIN_TABLES) {
            // Walk only owned (unclaimed) triggers for split positions
            const ownedTriggers = triggers.filter(t => !claimedForSplit.has(t.tableId));
            for (let pos = MAX_CHAIN_TABLES - 1; pos < ownedTriggers.length; pos += MAX_CHAIN_TABLES) {
                const midId = ownedTriggers[pos].tableId;
                const midTable = tableById.get(midId);
                if (midTable && !leafTables.includes(midTable) && !extraLeaves.includes(midTable)) {
                    extraLeaves.push(midTable);
                }
            }
        }
        // Claim all tables in this chain for subsequent chains
        allChainIds.forEach(id => claimedForSplit.add(id));
    }
    if (extraLeaves.length > 0) {
        leafTables.push(...extraLeaves);
    }

    // we want to sort the leaf tables by the order of their ancestors
    // for example if ancestor of list a is [0, 3] and the ancestor of list b is [0, 2] then b should come before a
    // when tables are anchored, we want to give them a higher order (so that they are displayed after their peers)
    let tableOrder = Object.fromEntries(tables.map((table, index) => [table.id, index + (table.anchored ? 1 : 0) * tables.length]));
    let getAncestorOrders = (leafTable: DictTable) => {
        let triggers = getCachedTriggers(leafTable);
        return [...triggers.map(t => tableOrder[t.tableId]), tableOrder[leafTable.id]];
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
    let globalHighlightedTableIds: string[] = useMemo(() => {
        if (!focusedTableId) return [];
        let focusedTable = tableById.get(focusedTableId);
        if (!focusedTable) return [];
        // Walk up the trigger chain from the focused table to collect all ancestor IDs
        let ids: string[] = [focusedTableId];
        let current = focusedTable;
        while (current.derive && !current.anchored) {
            let parentId = current.derive.trigger.tableId;
            ids.unshift(parentId);
            let parent = tableById.get(parentId);
            if (!parent) break;
            current = parent;
        }
        return ids;
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
            const chainIds = [...triggers.map(t => t.tableId), lt.id];
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

    // Build thread entries and their estimated heights for layout
    type ThreadEntry = { key: string; groupId: string; leafTables: DictTable[]; threadIdx: number; threadLabel?: string; isSplitThread?: boolean; usedTableIds?: string[]; hideLabel?: boolean };
    let allThreadEntries: ThreadEntry[] = [];
    let allThreadHeights: number[] = [];

    // Track which leaf tables are promoted (split) vs real leaves
    const extraLeafIds = new Set(extraLeaves.map(t => t.id));

    // Track which table IDs have been claimed by earlier threads
    let claimedTableIds = new Set<string>();

    // Hanging tables: source tables with no children — displayed as a group before thread 1
    let hangingTables = leafTables.filter(lt => !lt.derive);
    if (hangingTables.length > 0) {
        hangingTables.forEach(lt => claimedTableIds.add(lt.id));
        let hangingChartCount = hangingTables.reduce((sum, lt) => sum + chartElements.filter(ce => ce.tableId === lt.id).length, 0);
        allThreadEntries.push({
            key: 'hanging-tables',
            groupId: 'hanging-tables',
            leafTables: hangingTables,
            threadIdx: -1,
            hideLabel: true,
        });
        allThreadHeights.push(estimateThreadHeight(hangingTables.length, 0, hangingChartCount));
    }

    // Regular threads: one per threaded leaf table
    // Assign sub-thread numbering: split (promoted) threads get the main index (1, 2, ...),
    // real leaf tables whose chain was split get a sub-index (1.1, 1.2, ...)
    let realThreadIdx = 0; // counter for main threads
    // Pre-scan: find which real leaf each extra leaf belongs to
    let extraLeafToRealLeaf = new Map<string, string>();
    // Also build reverse: real leaf -> list of extra leaves in its chain
    let realLeafToExtraLeaves = new Map<string, string[]>();
    for (const lt of threadedTables) {
        if (!extraLeafIds.has(lt.id)) {
            // This is a real leaf — find all extra leaves that are ancestors of it
            const triggers = getCachedTriggers(lt);
            const chainIds = triggers.map(t => t.tableId);
            const myExtras: string[] = [];
            for (const extraId of extraLeafIds) {
                if (chainIds.includes(extraId)) {
                    if (!extraLeafToRealLeaf.has(extraId)) {
                        extraLeafToRealLeaf.set(extraId, lt.id);
                    }
                    myExtras.push(extraId);
                }
            }
            if (myExtras.length > 0) {
                realLeafToExtraLeaves.set(lt.id, myExtras);
            }
        }
    }
    // Map from extra leaf id -> its assigned main thread index
    let extraLeafToThreadIdx = new Map<string, number>();
    // Track sub-index counters per chain (keyed by first extra leaf's thread idx)
    let subThreadCounters = new Map<number, number>();

    threadedTables.forEach((lt, i) => {
        const triggers = getCachedTriggers(lt);

        // Collect all table IDs in this thread's chain
        let threadTableIds = new Set<string>();
        triggers.forEach(t => threadTableIds.add(t.tableId));
        threadTableIds.add(lt.id);

        // Only new (unclaimed) tables contribute to this thread's height
        let newTableIds = [...threadTableIds].filter(id => !claimedTableIds.has(id));

        let newTriggerCount = triggers.filter(t => newTableIds.includes(t.resultTableId)).length;
        let chartCount = newTableIds.reduce((sum, tid) => sum + chartElements.filter(ce => ce.tableId === tid).length, 0);

        // +1 table and +1 trigger for the leaf table itself
        let totalTables = newTableIds.length + 1;
        let totalTriggers = newTriggerCount + 1;

        // Claim this thread's tables for subsequent threads
        threadTableIds.forEach(id => claimedTableIds.add(id));

        // Determine thread label and whether this is a split sub-thread
        const isSplit = extraLeafIds.has(lt.id);
        // A real leaf is a "continuation" if it has extra leaves in its chain
        const isContinuation = !isSplit && realLeafToExtraLeaves.has(lt.id);
        let threadLabel: string;
        let threadIdxForEntry: number;

        if (isSplit) {
            // Promoted intermediate — gets a main thread index
            realThreadIdx++;
            extraLeafToThreadIdx.set(lt.id, realThreadIdx);
            threadLabel = `thread - ${realThreadIdx}`;
            threadIdxForEntry = realThreadIdx - 1;
        } else if (isContinuation) {
            // Real leaf whose chain was split — gets sub-index under the last extra leaf's index
            const myExtras = realLeafToExtraLeaves.get(lt.id) || [];
            // Use the last extra leaf's thread index (the one closest to this leaf in the chain)
            const lastExtra = myExtras[myExtras.length - 1];
            const parentIdx = extraLeafToThreadIdx.get(lastExtra) ?? realThreadIdx;
            const subIdx = (subThreadCounters.get(parentIdx) || 0) + 1;
            subThreadCounters.set(parentIdx, subIdx);
            threadLabel = `thread - ${parentIdx}.${subIdx}`;
            threadIdxForEntry = i;
        } else {
            // Normal thread (no splitting involved)
            realThreadIdx++;
            threadLabel = `thread - ${realThreadIdx}`;
            threadIdxForEntry = realThreadIdx - 1;
        }

        allThreadEntries.push({
            key: `thread-${lt.id}-${i}`,
            groupId: lt.id,
            leafTables: [lt],
            threadIdx: threadIdxForEntry,
            threadLabel,
            isSplitThread: isContinuation,
        });
        allThreadHeights.push(estimateThreadHeight(totalTables, totalTriggers, chartCount));
    });

    // Pre-compute usedTableIds for each entry (avoids quadratic recomputation in renderThreadEntry)
    {
        let accumulated: string[] = [];
        for (const entry of allThreadEntries) {
            entry.usedTableIds = [...accumulated];
            for (const lt of entry.leafTables) {
                const triggers = getCachedTriggers(lt);
                accumulated.push(...triggers.map(t => t.tableId), lt.id);
            }
        }
    }

    // Pick the best column layout: dynamically based on container width.
    const availableHeight = containerRef.current?.clientHeight ?? 600;
    const hasMultipleThreads = allThreadEntries.length > 1;

    const CARD_WIDTH = 220;
    const CARD_GAP = 12; // padding + spacing between cards in a column
    const COLUMN_WIDTH = CARD_WIDTH + CARD_GAP;
    const PANEL_PADDING = 16;

    // Determine how many columns fit in the available container width (1-3)
    const fittableColumns = Math.max(1, Math.min(3, Math.floor((containerWidth - PANEL_PADDING) / COLUMN_WIDTH)));
    const MAX_COLUMNS = fittableColumns;
    const columnLayout: number[][] = chooseBestColumnLayout(
        allThreadHeights, MAX_COLUMNS, availableHeight, /* flexOrder */ false,
        /* minColumns */ Math.min(fittableColumns, hasMultipleThreads ? 2 : 1)
    );
    const actualColumns = columnLayout.length || 1;

    let renderThreadEntry = (entry: ThreadEntry) => {
        let usedTableIds = entry.usedTableIds || [];

        return <SingleThreadGroupView
            key={entry.key}
            scrollRef={scrollRef}
            threadIdx={entry.threadIdx}
            threadLabel={entry.threadLabel}
            isSplitThread={entry.isSplitThread}
            hideLabel={entry.hideLabel}
            leafTables={entry.leafTables}
            chartElements={chartElements}
            usedIntermediateTableIds={usedTableIds}
            globalHighlightedTableIds={globalHighlightedTableIds}
            focusedThreadLeafId={focusedThreadLeafId}
            chatboxFocused={chatboxFocused}
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
                pb: chatboxFocused ? '180px' : 1,
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
        <Box className="data-thread" sx={{ ...sx, position: 'relative', display: 'flex', flexDirection: 'column' }}>
            <Box ref={containerRef} sx={{
                    overflow: 'hidden', 
                    direction: 'rtl', 
                    display: 'block', 
                    flex: 1,
                    minHeight: 0,
                }}>
                {view}
            </Box>
            <SimpleChartRecBox onExpandedChange={setChatboxFocused} />
        </Box>
    );
}

