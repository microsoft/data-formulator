// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useEffect, useMemo, useRef, useState, useCallback, memo } from 'react';

import {
    Box,
    Divider,
    Typography,
    LinearProgress,
    Stack,
    ListItemIcon,
    Card,
    IconButton,
    Tooltip,
    ButtonGroup,
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
} from '@mui/material';

import { VegaLite } from 'react-vega'

import '../scss/VisualizationView.scss';
import { batch, useDispatch, useSelector } from 'react-redux';
import { DataFormulatorState, dfActions, SSEMessage } from '../app/dfSlice';
import { assembleVegaChart, getTriggers, prepVisTable } from '../app/utils';
import { Chart, DictTable, EncodingItem, FieldItem, Trigger } from "../components/ComponentType";

import DeleteIcon from '@mui/icons-material/Delete';
import AddchartIcon from '@mui/icons-material/Addchart';
import StarIcon from '@mui/icons-material/Star';
import SouthIcon from '@mui/icons-material/South';
import TableRowsIcon from '@mui/icons-material/TableRowsOutlined';
import AnchorIcon from '@mui/icons-material/Anchor';
import PanoramaFishEyeIcon from '@mui/icons-material/PanoramaFishEye';
import InsightsIcon from '@mui/icons-material/Insights';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';

import _ from 'lodash';
import { getChartTemplate } from '../components/ChartTemplates';

import 'prismjs/components/prism-python' // Language
import 'prismjs/components/prism-typescript' // Language
import 'prismjs/themes/prism.css'; //Example style, you can use another

import { checkChartAvailability, generateChartSkeleton, getDataTable } from './VisualizationView';
import { TriggerCard } from './EncodingShelfCard';

import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloudQueueIcon from '@mui/icons-material/CloudQueue';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import RefreshIcon from '@mui/icons-material/Refresh';
import StreamIcon from '@mui/icons-material/Stream';

import { alpha } from '@mui/material/styles';

import { dfSelectors } from '../app/dfSlice';
import { RefreshDataDialog } from './RefreshDataDialog';
import { getUrls, fetchWithIdentity } from '../app/utils';
import { AppDispatch } from '../app/store';
import StopIcon from '@mui/icons-material/Stop';
import { useDataRefresh } from '../app/useDataRefresh';

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
        <Box sx={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'left',
        }}>
            <CircularProgress size={10} sx={{ color: 'text.secondary' }} />
            <Typography variant="body2" sx={{ 
                ml: 1, 
                fontSize: 10, 
                color: 'rgba(0, 0, 0, 0.7) !important'
            }}>
                {message}
            </Typography>
        </Box>
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
                        border: '1px solid',
                        borderColor: 'divider'
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
                        border: '1px solid',
                        borderColor: 'divider'
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

// Agent Status Box Component
const AgentStatusBox = memo<{
    tableId: string;
    relevantAgentActions: any[];
    dispatch: any;
}>(({ tableId, relevantAgentActions, dispatch }) => {

    let theme = useTheme();

    let agentStatus = undefined;

    let getAgentStatusColor = (status: string) => {
        switch (status) {
            case 'running':
                return `${theme.palette.text.secondary} !important`;
            case 'completed':
                return `${theme.palette.success.main} !important`;
            case 'failed':
                return `${theme.palette.error.main} !important`;
            case 'warning':
                return `${theme.palette.warning.main} !important`;
            default:
                return `${theme.palette.text.secondary} !important`;
        }
    }

    let currentActions = relevantAgentActions;

    if (currentActions.some(a => a.status == 'running')) {
        agentStatus = 'running';
    } else if (currentActions.every(a => a.status == 'completed')) {
        agentStatus = 'completed';
    } else if (currentActions.every(a => a.status == 'failed')) {
        agentStatus = 'failed';
    } else {
        agentStatus = 'warning';
    }
    
    if (currentActions.length === 0) {
        return null;
    }

    return (
        <Box sx={{ padding: '0px 8px' }}>
            {(
                <Box sx={{ 
                    py: 1, 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'left',
                    '& .MuiSvgIcon-root, .MuiTypography-root': {
                        fontSize: 10,
                        color: getAgentStatusColor(agentStatus)
                    },
                }}>
                    {agentStatus === 'running' && ThinkingBanner('thinking...', { py: 0.5 })}
                    {agentStatus === 'completed' && <CheckCircleOutlineIcon />}
                    {agentStatus === 'failed' && <CancelOutlinedIcon />}
                    {agentStatus === 'warning' && <HelpOutlineIcon />}
                    <Typography variant="body2" sx={{ 
                        ml: 0.5, 
                        fontSize: 10,
                    }}>
                        {agentStatus === 'warning' && 'hmm...'}
                        {agentStatus === 'failed' && 'oops...'}
                        {agentStatus === 'completed' && 'completed'}
                        {agentStatus === 'running' && ''}
                    </Typography>
                    <Tooltip title="Delete message">
                        <IconButton
                            className="delete-button"
                            size="small"
                            sx={{
                                padding: '2px',
                                ml: 'auto',
                                transition: 'opacity 0.2s ease-in-out',
                                '& .MuiSvgIcon-root': { fontSize: 12, color: 'darkgray !important' }
                            }}
                            onClick={(event) => {
                                event.stopPropagation();
                                dispatch(dfActions.deleteAgentWorkInProgress(relevantAgentActions[0].actionId));
                            }}
                        >
                            <CloseIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Box>
            )}
            {currentActions.map((a, index, array) => {
                let descriptions = String(a.description).split('\n');
                return (
                    <React.Fragment key={a.actionId + "-" + index}>
                        <Box sx={{ 
                            position: 'relative',
                        }}>
                            {descriptions.map((line: string, lineIndex: number) => (
                                <React.Fragment key={lineIndex}>
                                    <Typography variant="body2" sx={{ 
                                        fontSize: 10, 
                                        color: getAgentStatusColor(a.status),
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-word'
                                    }}>
                                        {line}
                                    </Typography>
                                    {lineIndex < descriptions.length - 1 && <Divider sx={{ my: 0.5, }} />}
                                </React.Fragment>
                            ))}
                        </Box>
                        {index < array.length - 1 && array.length > 1 && (
                            <Box sx={{ 
                                ml: 1, 
                                height: '1px', 
                                backgroundColor: 'rgba(0, 0, 0, 0.2)', 
                                my: 0.5 
                            }} />
                        )}
                    </React.Fragment>
                )
            })}
        </Box>
    );
});

let buildChartCard = (
    chartElement: { tableId: string, chartId: string, element: any },
    focusedChartId?: string,
    unread?: boolean
) => {
    let selectedClassName = focusedChartId == chartElement.chartId ? 'selected-card' : '';
    return <Card className={`data-thread-card ${selectedClassName}`} variant="outlined"
        sx={{
            width: '100%',
            display: 'flex',
            position: 'relative',
            ...(unread && {
                boxShadow: '0 0 6px rgba(255, 152, 0, 0.15), 0 0 12px rgba(255, 152, 0, 0.15)',
            })
        }}>
        {chartElement.element}
    </Card>
}

const EditableTableName: FC<{
    initialValue: string,
    tableId: string,
    handleUpdateTableDisplayId: (tableId: string, displayId: string) => void,
    nonEditingSx?: SxProps
}> = ({ initialValue, tableId, handleUpdateTableDisplayId, nonEditingSx }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [inputValue, setInputValue] = useState(initialValue);
    
    const handleSubmit = (e?: React.MouseEvent | React.KeyboardEvent) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        
        if (inputValue.trim() !== '') {  // Only update if input is not empty
            handleUpdateTableDisplayId(tableId, inputValue);
            setIsEditing(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSubmit(e);
        } else if (e.key === 'Escape') {
            setInputValue(initialValue);
            setIsEditing(false);
        }
    };

    if (!isEditing) {
        return (
            <Tooltip title="edit table name">
                <Typography
                    onClick={(event) => {
                        event.stopPropagation();
                        setIsEditing(true);
                    }}
                    sx={{
                        ...nonEditingSx,
                        fontSize: 'inherit',
                        minWidth: '60px',
                        maxWidth: '90px',
                        wordWrap: 'break-word',
                        whiteSpace: 'normal',
                        ml: 0.25,
                        padding: '2px',
                        '&:hover': {
                            backgroundColor: 'rgba(0,0,0,0.04)',
                            borderRadius: '2px',
                            cursor: 'pointer'
                        }
                    }}
                >
                    {initialValue}
                </Typography>
            </Tooltip>
        );
    }

    return (
        <Box
            component="span"
            onClick={(event) => event.stopPropagation()}
            sx={{
                display: 'flex',
                alignItems: 'center',
                position: 'relative',
                ml: 0.25,
            }}
        >
            <TextField
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                autoFocus
                variant="filled"
                size="small"
                onBlur={(e) => {
                    // Only reset if click is not on the submit button
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                        setInputValue(initialValue);
                        setIsEditing(false);
                    }
                }}
                sx={{
                    '& .MuiFilledInput-root': {
                        fontSize: 'inherit',
                        padding: 0,
                        '& input': {
                            padding: '2px 24px 2px 8px',
                            width: '64px',
                        }
                    }
                }}
            />
            <IconButton
                size="small"
                onMouseDown={(e) => {
                    e.preventDefault(); // Prevent blur from firing before click
                }}
                onClick={(e) => handleSubmit(e)}
                sx={{
                    position: 'absolute',
                    right: 2,
                    padding: '2px',
                    minWidth: 'unset',
                    zIndex: 1,
                    '& .MuiSvgIcon-root': {
                        fontSize: '0.8rem'
                    }
                }}
            >
                <CheckIcon />
            </IconButton>
        </Box>
    );
};

// Compact view for thread0 - displays table cards with charts in a simple grid
// Reuses SingleThreadGroupView with compact mode
let CompactThread0View: FC<{
    scrollRef: any,
    leafTables: DictTable[];
    chartElements: { tableId: string, chartId: string, element: any }[];
    sx?: SxProps
}> = function ({
    scrollRef,
    leafTables,
    chartElements,
    sx
}) {
    const theme = useTheme();
    
    return (
        <Box sx={{ ...sx, 
            '& .selected-card': { 
                border: `2px solid ${theme.palette.primary.light}`,
            },
            transition: "box-shadow 0.1s linear",
        }}
        data-thread-index={-1}>
            <Box sx={{ display: 'flex', direction: 'ltr', margin: '2px 2px 8px 2px' }}>
                <Divider flexItem sx={{
                    margin: 'auto',
                    "& .MuiDivider-wrapper": { display: 'flex', flexDirection: 'row' },
                    "&::before, &::after": { borderColor: alpha(theme.palette.custom.main, 0.2), borderWidth: '2px', width: 60 },
                }}>
                    <Typography sx={{ fontSize: "10px",  color: 'text.secondary', textTransform: 'none' }}>
                        workspace
                    </Typography>
                </Divider>
            </Box>
            <Box sx={{ padding: '2px 4px 2px 4px', marginTop: 0, direction: 'ltr' }}>
                <SingleThreadGroupView
                    scrollRef={scrollRef}
                    threadIdx={-1}
                    leafTables={leafTables}
                    chartElements={chartElements}
                    usedIntermediateTableIds={[]}
                    compact={true}
                    sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}
                />
            </Box>
        </Box>
    );
}

let SingleThreadGroupView: FC<{
    scrollRef: any,
    threadIdx: number,
    leafTables: DictTable[];
    chartElements: { tableId: string, chartId: string, element: any }[];
    usedIntermediateTableIds: string[],
    compact?: boolean, // When true, only show table cards in a simple column (for thread0)
    sx?: SxProps
}> = function ({
    scrollRef,
    threadIdx,
    leafTables,
    chartElements,
    usedIntermediateTableIds, // tables that have been used
    compact = false,
    sx
}) {

    let tables = useSelector((state: DataFormulatorState) => state.tables);
    const { manualRefresh } = useDataRefresh();

    let leafTableIds = leafTables.map(lt => lt.id);
    let parentTableId = leafTables[0].derive?.trigger.tableId || undefined;
    let parentTable = tables.find(t => t.id == parentTableId) as DictTable;

    let charts = useSelector(dfSelectors.getAllCharts);
    let focusedChartId = useSelector((state: DataFormulatorState) => state.focusedChartId);
    let focusedTableId = useSelector((state: DataFormulatorState) => state.focusedTableId);
    let agentActions = useSelector((state: DataFormulatorState) => state.agentActions);

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

    // Function to refresh derived tables
    const refreshDerivedTables = async (sourceTableId: string, newRows: any[]) => {
        // Find all tables that are derived from this source table
        const derivedTables = tables.filter(t => t.derive?.source?.includes(sourceTableId));
        
        for (const derivedTable of derivedTables) {
            if (derivedTable.derive && derivedTable.derive.code) {
                // Gather all parent tables for this derived table
                const parentTableData = derivedTable.derive.source.map(sourceId => {
                    const sourceTable = tables.find(t => t.id === sourceId);
                    if (sourceTable) {
                        // Use the new rows if this is the table being refreshed
                        const rows = sourceId === sourceTableId ? newRows : sourceTable.rows;
                        return {
                            name: sourceTable.id,
                            rows: rows
                        };
                    }
                    return null;
                }).filter(t => t !== null);

                if (parentTableData.length > 0) {
                    try {
                        const response = await fetchWithIdentity(getUrls().REFRESH_DERIVED_DATA, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                input_tables: parentTableData,
                                code: derivedTable.derive.code
                            })
                        });

                        const result = await response.json();
                        if (result.status === 'ok' && result.rows) {
                            // Update the derived table with new rows
                            dispatch(dfActions.updateTableRows({
                                tableId: derivedTable.id,
                                rows: result.rows
                            }));

                            // Recursively refresh tables derived from this one
                            await refreshDerivedTables(derivedTable.id, result.rows);
                        } else {
                            console.error(`Failed to refresh derived table ${derivedTable.id}:`, result.message);
                            dispatch(dfActions.addMessages({
                                timestamp: Date.now(),
                                type: 'error',
                                component: 'data refresh',
                                value: `Failed to refresh derived table "${derivedTable.displayId || derivedTable.id}": ${result.message || 'Unknown error'}`
                            }));
                        }
                    } catch (error) {
                        console.error(`Error refreshing derived table ${derivedTable.id}:`, error);
                        dispatch(dfActions.addMessages({
                            timestamp: Date.now(),
                            type: 'error',
                            component: 'data refresh',
                            value: `Error refreshing derived table "${derivedTable.displayId || derivedTable.id}"`
                        }));
                    }
                }
            }
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

    let buildTriggerCard = (trigger: Trigger) => {
        let selectedClassName = trigger.chart?.id == focusedChartId ? 'selected-card' : '';
        
        let triggerCard = <div key={'thread-card-trigger-box'}>
            <Box sx={{ flex: 1 }} >
                <TriggerCard className={selectedClassName} trigger={trigger} 
                    hideFields={trigger.instruction != ""} 
                    sx={highlightedTableIds.includes(trigger.resultTableId) ? {borderLeft: '3px solid', borderLeftColor: alpha(theme.palette.custom.main, 0.5)} : {}}
                />
            </Box>
        </div>;

        return <Box sx={{ display: 'flex', flexDirection: 'column' }} key={`trigger-card-${trigger.chart?.id}`}>
            {triggerCard}
            <ListItemIcon key={'down-arrow'} sx={{ minWidth: 0 }}>
                <SouthIcon sx={{
                    fontSize: "inherit", 
                    color: highlightedTableIds.includes(trigger.resultTableId) ? theme.palette.primary.light : 'darkgray',
                    ...(highlightedTableIds.includes(trigger.resultTableId) ? { strokeWidth: 1, stroke: theme.palette.primary.light } : { })
                }} />
            </ListItemIcon>
        </Box>;
    }

    let buildTableCard = (tableId: string, compact = false) => {

        if (parentTable && tableId == parentTable.id && parentTable.anchored && tableIdList.length > 1) {
            let table = tables.find(t => t.id == tableId);
            return <Typography sx={{ background: 'transparent', }} >
                <Box 
                    sx={{ 
                        margin: '0px', 
                        width: 'fit-content',
                        display: 'flex', 
                        cursor: 'pointer',
                        padding: '2px 4px',
                        borderRadius: '4px',
                        transition: 'all 0.2s ease',
                        '&:hover': {
                            backgroundColor: 'rgba(0, 0, 0, 0.04)',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
                        }
                    }}
                    onClick={(event) => {
                        event.stopPropagation();
                        dispatch(dfActions.setFocusedTable(tableId));
                        
                        // Find and set the first chart associated with this table
                        let firstRelatedChart = charts.find((c: Chart) => c.tableRef == tableId && c.source != "trigger");
                        
                        if (firstRelatedChart) {
                            dispatch(dfActions.setFocusedChart(firstRelatedChart.id));
                        }
                    }}
                >
                    <Stack direction="row" sx={{ marginLeft: 0.25, marginRight: 'auto', fontSize: 12 }} alignItems="center" gap={"2px"}>
                        <AnchorIcon sx={{ fontSize: 14, color: 'rgba(0,0,0,0.5)' }} />
                        <Typography fontSize="inherit" sx={{
                            textAlign: 'center',
                            color: 'rgba(0,0,0,0.7)', 
                            maxWidth: '100px',
                            wordWrap: 'break-word',
                            whiteSpace: 'normal'
                        }}>
                            {table?.displayId || tableId}
                        </Typography>
                    </Stack>
                </Box>
            </Typography>
        }

        // filter charts relavent to this
        let relevantCharts = chartElements.filter(ce => ce.tableId == tableId && !usedIntermediateTableIds.includes(tableId));

        let table = tables.find(t => t.id == tableId);

        let selectedClassName = tableId == focusedTableId ? 'selected-card' : '';

        let collapsedProps = collapsed ? { width: '50%', "& canvas": { width: 60, maxHeight: 50 } } : { width: '100%' }

        let releventChartElements = relevantCharts.map((ce, j) =>
            <Box key={`relevant-chart-${ce.chartId}`}
                sx={{ 
                    display: 'flex', padding: 0, pb: j == relevantCharts.length - 1 ? 1 : 0.5, ...collapsedProps }}>
                {buildChartCard(ce, focusedChartId, charts.find(c => c.id == ce.chartId)?.unread)}
            </Box>)

        // only charts without dependency can be deleted
        let tableDeleteEnabled = !tables.some(t => t.derive?.trigger.tableId == tableId);

        const iconColor = tableId === focusedTableId ? theme.palette.primary.main : 'rgba(0,0,0,0.6)';
        const iconOpacity = table?.anchored ? 1 : 0.5;
        
        let tableCardIcon = table?.virtual ? (
            <CloudQueueIcon sx={{ 
                fontSize: 16,
                color: iconColor,
                opacity: iconOpacity,
            }} />
        ) : (
            <TableRowsIcon sx={{ 
                fontSize: 16,
                color: iconColor,
                opacity: iconOpacity,
            }} />
        )

        let regularTableBox = <Box key={`regular-table-box-${tableId}`} ref={relevantCharts.some(c => c.chartId == focusedChartId) ? scrollRef : null} 
            sx={{ padding: '0px' }}>
            <Card className={`data-thread-card ${selectedClassName}`} variant="outlined"
                sx={{ width: '100%', backgroundColor: alpha(theme.palette.primary.light, 0.1),
                    borderLeft: highlightedTableIds.includes(tableId) ? 
                        `3px solid ${theme.palette.primary.light}` : '1px solid lightgray',
                    }}
                onClick={() => {
                    dispatch(dfActions.setFocusedTable(tableId));
                    if (focusedChart?.tableRef != tableId) {
                        let firstRelatedChart = charts.find((c: Chart) => c.tableRef == tableId && c.source != 'trigger');
                        if (firstRelatedChart) {
                            dispatch(dfActions.setFocusedChart(firstRelatedChart.id));
                        } else {
                            //dispatch(dfActions.createNewChart({ tableId: tableId, chartType: '?' }));
                        }
                    }
                }}>
                <Box sx={{ margin: '0px', display: 'flex' }}>
                    <Stack direction="row" sx={{ marginLeft: 0.5, marginRight: 'auto', fontSize: 12 }} alignItems="center" gap={"2px"}>
                        {/* For non-derived tables: icon opens menu; for derived tables: icon toggles anchored */}
                        {table?.derive == undefined ? (
                            <Tooltip title="more options">
                                <IconButton color="primary" sx={{
                                    minWidth: 0, 
                                    padding: 0.25,
                                    '&:hover': {
                                        transform: 'scale(1.3)',
                                        transition: 'all 0.1s linear'
                                    },
                                }} 
                                size="small" 
                                onClick={(event) => {
                                    event.stopPropagation();
                                    handleOpenTableMenu(table!, event.currentTarget);
                                }}>
                                    {tableCardIcon}
                                </IconButton>
                            </Tooltip>
                        ) : (
                            <IconButton color="primary" sx={{
                                minWidth: 0, 
                                padding: 0.25,
                                '&:hover': {
                                    transform: 'scale(1.3)',
                                    transition: 'all 0.1s linear'
                                },
                                '&.Mui-disabled': {
                                    color: 'rgba(0, 0, 0, 0.5)'
                                }
                            }} 
                            size="small" 
                            disabled={tables.some(t => t.derive?.trigger.tableId == tableId)}
                            onClick={(event) => {
                                event.stopPropagation();
                                dispatch(dfActions.updateTableAnchored({tableId: tableId, anchored: !table?.anchored}));
                            }}>
                                {tableCardIcon}
                            </IconButton>
                        )}
                        <Box sx={{ margin: '4px 8px 4px 2px', display: 'flex', alignItems: 'center' }}>
                            {/* Only show streaming icon when actively watching for updates */}
                            {(table?.source?.type === 'stream' || table?.source?.type === 'database') && table?.source?.autoRefresh ? (
                                <Tooltip title={`Auto-refresh every ${
                                    (table.source?.refreshIntervalSeconds || 60) < 60 
                                        ? `${table.source?.refreshIntervalSeconds}s` 
                                        : (table.source?.refreshIntervalSeconds || 60) < 3600 
                                            ? `${Math.floor((table.source?.refreshIntervalSeconds || 60) / 60)}m`
                                            : `${Math.floor((table.source?.refreshIntervalSeconds || 60) / 3600)}h`
                                } - Click to change interval or stop watching`}>
                                    <IconButton
                                        size="small"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            handleOpenStreamingSettingsPopup(table!, event.currentTarget);
                                        }}
                                        sx={{
                                            padding: 0.25,
                                            '&:hover': {
                                                transform: 'scale(1.2)',
                                                transition: 'all 0.1s linear'
                                            }
                                        }}
                                    >
                                        <StreamIcon sx={{ 
                                            fontSize: 12, 
                                            color: theme.palette.success.main,
                                            animation: 'pulse 2s infinite',
                                            '@keyframes pulse': {
                                                '0%': { opacity: 1 },
                                                '50%': { opacity: 0.5 },
                                                '100%': { opacity: 1 },
                                            },
                                        }} />
                                    </IconButton>
                                </Tooltip>
                            ) : ""}
                            {focusedTableId == tableId ? <EditableTableName
                                initialValue={table?.displayId || tableId}
                                tableId={tableId}
                                handleUpdateTableDisplayId={handleUpdateTableDisplayId}
                            /> : <Typography fontSize="inherit" sx={{
                                textAlign: 'center',
                                color:  'rgba(0,0,0,0.7)', 
                                maxWidth: '90px',
                                ml: table?.virtual || ((table?.source?.type === 'stream' || table?.source?.type === 'database') && table?.source?.autoRefresh) ? 0.5 : 0,
                                wordWrap: 'break-word',
                                whiteSpace: 'normal'
                            }}>{table?.displayId || tableId}</Typography>}
                        </Box>
                    </Stack>
                    <ButtonGroup aria-label="Basic button group" variant="text" sx={{ textAlign: 'end', margin: "auto 2px auto auto" }}>
                        <Tooltip key="create-new-chart-btn-tooltip" title="create a new chart">
                            <IconButton aria-label="create chart" size="small" sx={{ padding: 0.25, '&:hover': {
                                transform: 'scale(1.2)',
                                transition: 'all 0.1s linear'
                                } }}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    dispatch(dfActions.setFocusedTable(tableId));
                                    dispatch(dfActions.setFocusedChart(undefined));
                                }}
                            >   
                                <AddchartIcon fontSize="small" sx={{ fontSize: 18 }} color='primary'/>
                            </IconButton>
                        </Tooltip>
                        
                        {/* Delete button - shown for all deletable tables */}
                        {tableDeleteEnabled && (
                            <Tooltip key="delete-table-btn-tooltip" title="delete table">
                                <IconButton aria-label="delete" size="small" sx={{ padding: 0.25, '&:hover': {
                                    transform: 'scale(1.2)',
                                    transition: 'all 0.1s linear'
                                    } }}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        dispatch(dfActions.deleteTable(tableId));
                                    }}
                                >
                                    <DeleteIcon fontSize="small" sx={{ fontSize: 18 }} color='warning'/>
                                </IconButton>
                            </Tooltip>
                        )}
                    </ButtonGroup>
                </Box>
            </Card>
        </Box>

        let chartElementProps = collapsed ? { display: 'flex', flexWrap: 'wrap' } : {}

        let relevantAgentActions = agentActions.filter(a => a.tableId == tableId).filter(a => a.hidden == false);

        let agentActionBox = (
            <AgentStatusBox 
                tableId={tableId}
                relevantAgentActions={relevantAgentActions}
                dispatch={dispatch}
            />
        )

        return [
            regularTableBox,
            <Box
                key={`table-associated-elements-box-${tableId}`}
                sx={{ display: 'flex', flexDirection: 'row' }}>
                {!leafTableIds.includes(tableId) && <Box sx={{
                    minWidth: '1px', padding: '0px', width: '16px', flex: 'none', display: 'flex',
                    marginLeft: highlightedTableIds.includes(tableId) ? '7px' : '8px',
                    borderLeft:  highlightedTableIds.includes(tableId) ? 
                        `3px solid ${theme.palette.primary.light}` : '1px dashed darkgray',
                }}>
                    <Box sx={{
                        padding: 0, width: '1px', margin: 'auto',
                        backgroundImage: 'linear-gradient(180deg, darkgray, darkgray 75%, transparent 75%, transparent 100%)',
                        backgroundSize: '1px 6px, 3px 100%'
                    }}></Box>
                </Box>}
                <Box sx={{ flex: 1, padding: '4px 0px', minHeight: '0px', ...chartElementProps }}>
                    {releventChartElements}
                    {agentActionBox}
                </Box>
            </Box>
        ]
    }

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

    let highlightedTableIds: string[] = [];
    if (focusedTableId && leafTableIds.includes(focusedTableId)) {
        highlightedTableIds = [...tableIdList, focusedTableId];
    } else if (focusedTableId && newTableIds.includes(focusedTableId)) {
        highlightedTableIds = tableIdList.slice(0, tableIdList.indexOf(focusedTableId) + 1);
    }

    let tableElementList = newTableIds.map((tableId, i) => buildTableCard(tableId));
    let triggerCards = newTriggers.map((trigger) => buildTriggerCard(trigger));

    let leafTableComp = leafTables.length > 1 ? leafTables.map((lt, i) => {

        let leafTrigger = lt.derive?.trigger;

        let leftBorder = i == leafTables.length - 1 ? `none` : `1px dashed rgba(0, 0, 0, 0.3)`;
        let stackML = '8px';
        let spaceBox = <Box sx={{ height: '16px', width: '16px', flexShrink: 0,
            borderLeft: i == leafTables.length - 1 ? `1px dashed rgba(0, 0, 0, 0.3)` : 'none',
            borderBottom: `1px dashed rgba(0, 0, 0, 0.3)` }}></Box>

        if (focusedTableId && leafTableIds.indexOf(focusedTableId) > i) {
            leftBorder = `3px solid ${theme.palette.primary.light}`;
            stackML = '7px';
        }

        if (focusedTableId && lt.id == focusedTableId) {
            spaceBox = <Box sx={{ height: '16px', width: '16px', flexShrink: 0, ml: i == leafTables.length - 1 ? '-1px' : '-2px',
                borderLeft:`3px solid ${theme.palette.primary.light}`,
                borderBottom: `3px solid ${theme.palette.primary.light}` }}></Box>
        }

        return <Stack key={`leaf-table-stack-${lt.id}`} sx={{ ml: stackML , width: '208px', display: 'flex', flexDirection: 'row', 
                borderLeft: leftBorder, }}>
            {spaceBox}
            <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                {leafTrigger && buildTriggerCard(leafTrigger)}
                {buildTableCard(lt.id)}
            </Box>
        </Stack>;
    }) : leafTables.map((lt, i) => {
        return <Stack key={`leaf-table-stack-${lt.id}`} sx={{ ml: 0 , width: '192px', display: 'flex', flexDirection: 'row' }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                {lt.derive?.trigger && buildTriggerCard(lt.derive.trigger)}
                {buildTableCard(lt.id)}
            </Box>
        </Stack>;
    });

    // Compact mode: just show leaf table cards in a simple column
    if (compact) {
        // For compact mode, ensure highlightedTableIds includes focused table if it's a leaf
        if (focusedTableId && leafTableIds.includes(focusedTableId)) {
            highlightedTableIds = [focusedTableId];
        }
        
        return (
            <Box sx={{ ...sx, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                {leafTables.map((table) => {
                    const tableCardResult = buildTableCard(table.id, compact);
                    // buildTableCard returns an array [regularTableBox, chartBox]
                    // In compact mode, we want to show them stacked
                    return (
                        <React.Fragment key={`compact-table-${table.id}`}>
                            {tableCardResult}
                        </React.Fragment>
                    );
                })}
                <MetadataPopup
                    open={metadataPopupOpen}
                    anchorEl={metadataAnchorEl}
                    onClose={handleCloseMetadataPopup}
                    onSave={handleSaveMetadata}
                    initialValue={selectedTableForMetadata?.attachedMetadata || ''}
                    tableName={selectedTableForMetadata?.displayId || selectedTableForMetadata?.id || ''}
                />
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
                    {/* Watch for updates option - only shown when table has stream/database source but not actively watching */}
                    {selectedTableForMenu && 
                     (selectedTableForMenu.source?.type === 'stream' || selectedTableForMenu.source?.type === 'database') && 
                     (
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
                            <StreamIcon sx={{ fontSize: 16, color: 'text.secondary' }}/>
                            Watch for updates
                        </MenuItem>
                    )}
                    {/* Refresh data - hidden for database tables */}
                    {selectedTableForMenu?.source?.type !== 'database' && (
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
                            Refresh data
                        </MenuItem>
                    )}
                </Menu>
                {selectedTableForRefresh && (
                    <RefreshDataDialog
                        open={refreshDialogOpen}
                        onClose={handleCloseRefreshDialog}
                        table={selectedTableForRefresh}
                        onRefreshComplete={handleRefreshComplete}
                    />
                )}
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
        );
    }

    return <Box sx={{ ...sx, 
            '& .selected-card': { 
                border: `2px solid ${theme.palette.primary.light}`,
            },
            transition: "box-shadow 0.1s linear",
        }}
        data-thread-index={threadIdx}>
        <Box sx={{ display: 'flex', direction: 'ltr', margin: '2px 2px 8px 2px' }}>
            <Divider flexItem sx={{
                margin: 'auto',
                "& .MuiDivider-wrapper": { display: 'flex', flexDirection: 'row' },
                "&::before, &::after": { borderColor: alpha(theme.palette.custom.main, 0.2), borderWidth: '2px', width: 60 },
            }}>
                <Typography sx={{ fontSize: "10px",  color: 'text.secondary', textTransform: 'none' }}>
                    {threadIdx === -1 ? 'thread0' : `thread - ${threadIdx + 1}`}
                </Typography>
            </Divider>
        </Box>
        <div style={{ padding: '2px 4px 2px 4px', marginTop: 0, direction: 'ltr' }}>
            {usedTableIdsInThread.map((tableId, i) => {
                let table = tables.find(t => t.id === tableId) as DictTable;
                return [
                    <Typography key={`thread-used-table-${tableId}-${i}-text`} 
                        sx={{
                            fontSize: '10px',
                            cursor: 'pointer',
                            width: 'fit-content',
                            '&:hover': {
                                backgroundColor: alpha(theme.palette.primary.light, 0.1),
                            },
                        }} 
                        onClick={() => { dispatch(dfActions.setFocusedTable(tableId)) }}>
                        {table.displayId || tableId}
                    </Typography>,
                    <Box 
                        key={`thread-used-table-${tableId}-${i}-gap-box`}
                        sx={{
                        minWidth: '1px', padding: '0px', width: '16px', flex: 'none', display: 'flex',
                        height: '10px',
                        marginLeft: highlightedTableIds.includes(tableId) ? '7px' : '8px',
                        borderLeft:  highlightedTableIds.includes(tableId) ? `3px solid ${theme.palette.primary.light}` : '1px dashed darkgray',
                    }}>
                    </Box>
                ]
            })}
            <Box sx={{ display: 'flex',  width: '192px', flexDirection: 'column', flex: 1 }}>
                {tableElementList.length > triggerCards.length ? 
                    w(tableElementList, triggerCards, "") : w(triggerCards, tableElementList, "")}
            </Box>
            {leafTableComp}
        </div>
        <MetadataPopup
            open={metadataPopupOpen}
            anchorEl={metadataAnchorEl}
            onClose={handleCloseMetadataPopup}
            onSave={handleSaveMetadata}
            initialValue={selectedTableForMetadata?.attachedMetadata || ''}
            tableName={selectedTableForMetadata?.displayId || selectedTableForMetadata?.id || ''}
        />

        {/* Table actions menu for non-derived, non-virtual tables */}
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
            {/* Watch for updates option - only shown when table has stream/database source but not actively watching */}
            {selectedTableForMenu && 
             (selectedTableForMenu.source?.type === 'stream' || selectedTableForMenu.source?.type === 'database') && 
             !selectedTableForMenu.source?.autoRefresh && (
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
                    <StreamIcon sx={{ fontSize: 16, color: 'text.secondary' }}/>
                    Watch for updates
                </MenuItem>
            )}
            {/* Refresh data - hidden for database tables */}
            {selectedTableForMenu?.source?.type !== 'database' && (
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
                    Refresh data
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
                disabled={selectedTableForMenu ? tables.some(t => t.derive?.trigger.tableId === selectedTableForMenu.id) : true}
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

const VegaLiteChartElement = memo<{
    chart: Chart,
    assembledSpec: any,
    table: any,
    status: 'available' | 'pending' | 'unavailable',
    isSaved?: boolean,
    onChartClick: (chartId: string, tableId: string) => void,
    onDelete: (chartId: string) => void
}>(({ chart, assembledSpec, table, status, isSaved, onChartClick, onDelete }) => {
    const id = `data-thread-chart-Element-${chart.id}`;
    return (
        <Box
            onClick={() => onChartClick(chart.id, table.id)}
            className="vega-thumbnail-box"
            style={{ width: "100%", position: "relative", cursor: "pointer !important" }}
        >
            <Box sx={{ margin: "auto" }}>
                {isSaved && <Typography sx={{ position: "absolute", margin: "5px", zIndex: 2 }}>
                    <StarIcon sx={{ color: "gold" }} fontSize="small" />
                </Typography>}
                {status == 'pending' && <Box sx={{
                    position: "absolute", height: "100%", width: "100%", zIndex: 20,
                    backgroundColor: "rgba(243, 243, 243, 0.8)", display: "flex", alignItems: "center", cursor: "pointer"
                }}>
                    <LinearProgress sx={{ width: "100%", height: "100%", opacity: 0.05 }} />
                </Box>}
                <Box className='data-thread-chart-card-action-button'
                    sx={{ zIndex: 10, color: 'blue', position: "absolute", right: 1, background: 'rgba(255, 255, 255, 0.95)' }}>
                    <Tooltip title="delete chart">
                        <IconButton 
                            size="small" 
                            color="warning" 
                            onClick={(event) => {
                                event.stopPropagation();
                                onDelete(chart.id);
                            }}
                        >
                            <DeleteIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Box>
                <Box className={"vega-thumbnail"}
                    id={id}
                    sx={{
                        display: "flex",
                        backgroundColor: isSaved ? "rgba(255,215,0,0.05)" : "white",
                        '& .vega-embed': { margin: 'auto' },
                        '& canvas': { width: 'auto !important', height: 'auto !important', maxWidth: 120, maxHeight: 100 }
                    }}
                >
                    <VegaLite spec={assembledSpec} actions={false} />
                </Box>
            </Box>
        </Box>
    );
});

const MemoizedChartObject = memo<{
    chart: Chart;
    table: DictTable;
    conceptShelfItems: FieldItem[];
    status: 'available' | 'pending' | 'unavailable';
    onChartClick: (chartId: string, tableId: string) => void;
    onDelete: (chartId: string) => void;
}>(({ chart, table, conceptShelfItems, status, onChartClick, onDelete }) => {
    
    let visTableRows: any[] = [];
    if (table.rows.length > 1000) {
        visTableRows = structuredClone(_.sampleSize(table.rows, 1000));
    } else {
        visTableRows = structuredClone(table.rows);
    }

    // Preprocess the data for aggregations (same as VisualizationView)
    visTableRows = prepVisTable(visTableRows, conceptShelfItems, chart.encodingMap);

    let deleteButton = <Box className='data-thread-chart-card-action-button'
        sx={{ zIndex: 10, color: 'blue', position: "absolute", right: 1, background: 'rgba(255, 255, 255, 0.95)' }}>
        <Tooltip title="delete chart">
            <IconButton size="small" color="warning" onClick={(event) => {
                event.stopPropagation();
                onDelete(chart.id);
            }}><DeleteIcon fontSize="small" /></IconButton>
        </Tooltip>
    </Box>

    if (['Auto', '?'].includes(chart.chartType)) {
        let element = <Box 
            className="vega-thumbnail-box"
            onClick={() => onChartClick(chart.id, table.id)}
            sx={{ width: "100%", color: 'text.secondary', height: 48, display: "flex", backgroundColor: "white", position: 'relative', flexDirection: "column" }}>
            {status == 'pending' ? <Box sx={{
                position: "absolute", height: "100%", width: "100%", zIndex: 20,
                backgroundColor:  "rgba(243, 243, 243, 0.8)" , display: "flex", alignItems: "center", cursor: "pointer"
            }}>
                <LinearProgress sx={{ width: "100%", height: "100%", opacity: 0.05 }} />
            </Box> : ''}
            <InsightsIcon sx={{ margin: 'auto', color: 'darkgray' }}  fontSize="medium" />
            {deleteButton}
        </Box>
        return element;
    }

    if (status == 'unavailable' || chart.chartType == "Table") {
        let chartTemplate = getChartTemplate(chart.chartType);

        let element = <Box key={`unavailable-${chart.id}`} width={"100%"}
            className={"vega-thumbnail vega-thumbnail-box"}
            onClick={() => onChartClick(chart.id, table.id)}
            sx={{
                display: "flex", backgroundColor: "white", position: 'relative',
                flexDirection: "column"
            }}>
            {status == 'pending' ? <Box sx={{
                position: "absolute", height: "100%", width: "100%", zIndex: 20,
                backgroundColor:  "rgba(243, 243, 243, 0.8)" , display: "flex", alignItems: "center", cursor: "pointer"
            }}>
                <LinearProgress sx={{ width: "100%", height: "100%", opacity: 0.05 }} />
            </Box> : ''}
            <Box sx={{ display: "flex", flexDirection: "column", margin: "auto", height: 48}}>
                <Box sx={{ margin: "auto", transform: chart.chartType == 'Table' ? "rotate(15deg)" : undefined }} >
                    {generateChartSkeleton(chartTemplate?.icon, 32, 32, chart.chartType == 'Table' ? 1 : 0.5)} 
                </Box>
                {deleteButton}
            </Box>
        </Box>;
        return element;
    }

    // prepare the chart to be rendered
    let assembledChart = assembleVegaChart(chart.chartType, chart.encodingMap, conceptShelfItems, visTableRows, table.metadata, 20, true);
    assembledChart["background"] = "transparent";

    // Temporary fix, down sample the dataset
    if (assembledChart["data"]["values"].length > 5000) {
        let values = assembledChart["data"]["values"];
        assembledChart = (({ data, ...o }) => o)(assembledChart);

        let getRandom = (seed: number) => {
            let x = Math.sin(seed++) * 10000;
            return x - Math.floor(x);
        }
        let getRandomSubarray = (arr: any[], size: number) => {
            let shuffled = arr.slice(0), i = arr.length, temp, index;
            while (i--) {
                index = Math.floor((i + 1) * getRandom(233 * i + 888));
                temp = shuffled[index];
                shuffled[index] = shuffled[i];
                shuffled[i] = temp;
            }
            return shuffled.slice(0, size);
        }
        assembledChart["data"] = { "values": getRandomSubarray(values, 5000) };
    }

    assembledChart['config'] = {
        "axis": { "labelLimit": 30 }
    }

    const element = <VegaLiteChartElement
        chart={chart}
        assembledSpec={assembledChart}
        table={table}
        status={status}
        isSaved={chart.saved}
        onChartClick={() => onChartClick(chart.id, table.id)}
        onDelete={() => onDelete(chart.id)}
    />;

    return element;
}, (prevProps, nextProps) => {
    // Custom comparison function for memoization
    // Only re-render if the chart or its dependencies have changed

    // when conceptShelfItems change, we only need to re-render the chart if the conceptShelfItems depended by the chart have changed
    let nextReferredConcepts = Object.values(nextProps.chart.encodingMap).filter(e => e.fieldID || e.aggregate).map(e => `${e.fieldID}:${e.aggregate}`);

    return (
        prevProps.chart.id === nextProps.chart.id &&
        prevProps.chart.chartType === nextProps.chart.chartType &&
        prevProps.chart.saved === nextProps.chart.saved &&
        prevProps.status === nextProps.status &&
        _.isEqual(prevProps.chart.encodingMap, nextProps.chart.encodingMap) &&
        // Only check tables/charts that this specific chart depends on
        _.isEqual(prevProps.table, nextProps.table) &&
        _.isEqual(prevProps.table.attachedMetadata, nextProps.table.attachedMetadata) &&
        // Check if conceptShelfItems have changed
        _.isEqual(
            prevProps.conceptShelfItems.filter(c => nextReferredConcepts.includes(c.id)), 
            nextProps.conceptShelfItems.filter(c => nextReferredConcepts.includes(c.id)))
    );
});

export const DataThread: FC<{sx?: SxProps}> = function ({ sx }) {

    let tables = useSelector((state: DataFormulatorState) => state.tables);
    let focusedTableId = useSelector((state: DataFormulatorState) => state.focusedTableId);
    let charts = useSelector(dfSelectors.getAllCharts);

    let chartSynthesisInProgress = useSelector((state: DataFormulatorState) => state.chartSynthesisInProgress);

    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);

    let [threadDrawerOpen, setThreadDrawerOpen] = useState<boolean>(false);

    const scrollRef = useRef<null | HTMLDivElement>(null)

    const executeScroll = (smooth: boolean = true) => { 
        if (scrollRef.current != null) {
            scrollRef.current.scrollIntoView({ 
                behavior: smooth ? 'smooth' : 'auto', 
                block: 'center'
            }) 
        }
    }
    // run this function from an event handler or an effect to execute scroll

  
    const dispatch = useDispatch();

    useEffect(() => {
        // make it smooth when drawer from open -> close, otherwise just jump
        executeScroll(!threadDrawerOpen);
    }, [threadDrawerOpen])

    useEffect(() => {
        // load the example datasets
        if (focusedTableId) {
            executeScroll(true);
        }
    }, [focusedTableId]);

    // Now use useMemo to memoize the chartElements array
    let chartElements = useMemo(() => {
        return charts.filter(c => c.source == "user").map((chart) => {
            const table = getDataTable(chart, tables, charts, conceptShelfItems);
            let status: 'available' | 'pending' | 'unavailable' = chartSynthesisInProgress.includes(chart.id) ? 'pending' : 
                checkChartAvailability(chart, conceptShelfItems, table.rows) ? 'available' : 'unavailable';
            let element = <MemoizedChartObject
                chart={chart}
                table={table}
                conceptShelfItems={conceptShelfItems}
                status={status}
                onChartClick={() => {
                    dispatch(dfActions.setFocusedChart(chart.id));
                    dispatch(dfActions.setFocusedTable(table.id));
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
    
    // we want to sort the leaf tables by the order of their ancestors
    // for example if ancestor of list a is [0, 3] and the ancestor of list b is [0, 2] then b should come before a
    // when tables are anchored, we want to give them a higher order (so that they are displayed after their peers)
    let tableOrder = Object.fromEntries(tables.map((table, index) => [table.id, index + (table.anchored ? 1 : 0) * tables.length]));
    let getAncestorOrders = (leafTable: DictTable) => {
        let triggers = getTriggers(leafTable, tables);
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

    // Identify hanging tables (tables with no descendants or parents)
    let isHangingTable = (table: DictTable) => {
        // A table is hanging if:
        // 1. It has no derive.source (no parent)
        // 2. No other table derives from it (no descendants)
        const hasNoParent = table.derive == undefined;
        const hasNoDescendants = !tables.some(t => t.derive?.trigger.tableId == table.id);
        return hasNoParent && hasNoDescendants;
    };

    // Separate hanging tables from regular leaf tables
    let hangingTables = leafTables.filter(t => isHangingTable(t));
    let regularLeafTables = leafTables.filter(t => !isHangingTable(t));

    // Build groups for regular leaf tables (excluding hanging tables)
    let leafTableGroups = regularLeafTables.reduce((groups: { [groupId: string]: DictTable[] }, leafTable) => {
        // Get the immediate parent table ID (first trigger in the chain)
        const triggers = getTriggers(leafTable, tables);
        const immediateParentTableId = triggers.length > 0 ? triggers[triggers.length - 1].tableId : 'root';
        
        let groupId = immediateParentTableId + (leafTable.anchored ? ('-' + leafTable.id) : '');

        let subgroupIdCount = 0;
        while (groups[groupId] && groups[groupId].length >= 4) {
            groupId = groupId + '-' + subgroupIdCount;
            subgroupIdCount++;
        }

        // Initialize group if it doesn't exist
        if (!groups[groupId]) {
            groups[groupId] = [];
        }
        
        // Add leaf table to its group
        groups[groupId].push(leafTable);
        
        return groups;
    }, {});

    // Filter threads to only include those with length > 1
    let filteredLeafTableGroups: { [groupId: string]: DictTable[] } = {};
    Object.entries(leafTableGroups).forEach(([groupId, groupTables]) => {
        // Calculate thread length: count all tables in the thread chain
        const threadLength = groupTables.reduce((maxLength, leafTable) => {
            const triggers = getTriggers(leafTable, tables);
            // Thread length = number of triggers + 1 (the leaf table itself)
            return Math.max(maxLength, triggers.length + 1);
        }, 0);
        
        // Only include threads with length > 1
        if (threadLength > 1) {
            filteredLeafTableGroups[groupId] = groupTables;
        } else {
            // Add single-table threads to hanging tables (they go to thread0)
            groupTables.forEach(table => {
                if (!hangingTables.includes(table)) {
                    hangingTables.push(table);
                }
            });
        }
    });

    // Create thread0 group for hanging tables
    let thread0Group: { [groupId: string]: DictTable[] } = {};
    if (hangingTables.length > 0) {
        thread0Group['thread0'] = hangingTables;
    }

    let drawerOpen = threadDrawerOpen && (Object.keys(filteredLeafTableGroups).length > 0 || hangingTables.length > 0);
    let allGroupsForWidth = { ...filteredLeafTableGroups, ...thread0Group };
    let collaposedViewWidth = Math.max(...Object.values(allGroupsForWidth).map(x => x.length)) > 1 ? 248 : 232

    let view = <Box maxWidth={drawerOpen ? 720 : collaposedViewWidth} sx={{ 
        overflow: 'auto', // Add horizontal scroll when drawer is open
        position: 'relative',
        display: drawerOpen ? '-webkit-box' : 'flex', 
        flexDirection: 'column',
        direction: 'ltr',
        height: 'calc(100% - 16px)',
        flexWrap: drawerOpen ? 'wrap' : 'nowrap',
        gap: 1,
        p: 1,
        transition: 'max-width 0.1s linear', // Smooth width transition
    }}>
        {/* Render thread0 (hanging tables) first if it exists - using compact view */}
        {Object.entries(thread0Group).map(([groupId, leafTables], i) => {
            return <CompactThread0View
                key={`thread-${groupId}-${i}`}
                scrollRef={scrollRef}
                leafTables={leafTables} 
                chartElements={chartElements} 
                sx={{
                    backgroundColor: 'white', 
                    borderRadius: 2,
                    padding: 1,
                    my: 0.5,
                    flex:  'none',
                    display: 'flex',
                    flexDirection: 'column',
                    height: 'fit-content',
                    width: leafTables.length > 1 ? '216px' : '200px', 
                    transition: 'all 0.3s ease',
                }} />
        })}
        {/* Render regular threads (length > 1) */}
        {Object.entries(filteredLeafTableGroups).map(([groupId, leafTables], i) => {
            // Calculate used tables from thread0 and previous threads
            let usedIntermediateTableIds = Object.values(thread0Group).flat()
                .map(x => [ ...getTriggers(x, tables).map(y => y.tableId) || []]).flat();
            let usedLeafTableIds = Object.values(thread0Group).flat().map(x => x.id);
            
            // Add tables from previous regular threads
            const previousThreadGroups = Object.values(filteredLeafTableGroups).slice(0, i);
            usedIntermediateTableIds = [...usedIntermediateTableIds, ...previousThreadGroups.flat()
                .map(x => [ ...getTriggers(x, tables).map(y => y.tableId) || []]).flat()];
            usedLeafTableIds = [...usedLeafTableIds, ...previousThreadGroups.flat().map(x => x.id)];
                
            return <SingleThreadGroupView
                key={`thread-${groupId}-${i}`}
                scrollRef={scrollRef}
                threadIdx={i} 
                leafTables={leafTables} 
                chartElements={chartElements} 
                usedIntermediateTableIds={[...usedIntermediateTableIds, ...usedLeafTableIds]} 
                sx={{
                    backgroundColor: 'white', 
                    borderRadius: 2,
                    padding: 1,
                    my: 0.5,
                    flex:  'none',
                    display: 'flex',
                    flexDirection: 'column',
                    height: 'fit-content',
                    width: leafTables.length > 1 ? '216px' : '200px', 
                    transition: 'all 0.3s ease',
                }} />
        })}
    </Box>

    // Calculate total thread count (thread0 + regular threads)
    let totalThreadCount = Object.keys(filteredLeafTableGroups).length + (Object.keys(thread0Group).length > 0 ? 1 : 0);
    let threadIndices: number[] = [];
    if (Object.keys(thread0Group).length > 0) {
        threadIndices.push(-1); // thread0
    }
    threadIndices.push(...Array.from({length: Object.keys(filteredLeafTableGroups).length}, (_, i) => i));

    let jumpButtonsDrawerOpen = <ButtonGroup size="small" color="primary">
        {_.chunk(threadIndices, 3).map((group, groupIdx) => {
            const getLabel = (idx: number) => idx === -1 ? '0' : String(idx + 1);
            const startNum = getLabel(group[0]);
            const endNum = getLabel(group[group.length - 1]);
            const label = startNum === endNum ? startNum : `${startNum}-${endNum}`;
            
            return (
                <Tooltip key={`thread-nav-group-${groupIdx}`} title={`Jump to thread${startNum === endNum ? '' : 's'} ${label}`}>
                    <IconButton
                        size="small"
                        color="primary"
                        sx={{ fontSize: '12px' }}
                        onClick={() => {
                            setTimeout(() => {
                                // Get currently most visible thread index
                                const viewportCenter = window.innerWidth / 2;
                                const currentIndex = Array.from(document.querySelectorAll('[data-thread-index]')).reduce((closest, element) => {
                                    const rect = element.getBoundingClientRect();
                                    const distance = Math.abs(rect.left + rect.width/2 - viewportCenter);
                                    const idx = parseInt(element.getAttribute('data-thread-index') || '0');
                                    if (!closest || distance < closest.distance) {
                                        return { index: idx, distance };
                                    }
                                    return closest;
                                }, null as { index: number, distance: number } | null)?.index || 0;

                                // If moving from larger to smaller numbers (scrolling left), target first element
                                // If moving from smaller to larger numbers (scrolling right), target last element
                                const targetIndex = currentIndex > group[0] ? group[0] : group[group.length - 1];
                                
                                const targetElement = document.querySelector(`[data-thread-index="${targetIndex}"]`);
                                if (targetElement) {
                                    targetElement.scrollIntoView({
                                        behavior: 'smooth',
                                        block: 'nearest', // Don't change vertical scroll
                                        inline: currentIndex > group[group.length - 1] ? 'start' : 'end'
                                    });
                                }
                            }, 100);
                        }}
                    >
                        {label}
                    </IconButton>
                </Tooltip>
            );
        })}
    </ButtonGroup>

    let jumpButtonDrawerClosed = <ButtonGroup size="small" color="primary" sx={{ gap: 0 }}>
        {threadIndices.map((threadIdx) => {
            const label = threadIdx === -1 ? '0' : String(threadIdx + 1);
            return (
                <Tooltip key={`thread-nav-${threadIdx}`} title={`Jump to thread${threadIdx === -1 ? '0' : ` ${threadIdx + 1}`}`}>
                    <IconButton 
                        size="small" 
                        color="primary"
                        sx={{ fontSize: '12px', padding: '4px' }} 
                        onClick={() => {
                            const threadElement = document.querySelector(`[data-thread-index="${threadIdx}"]`);
                            threadElement?.scrollIntoView({ behavior: 'smooth' });
                        }}
                    > 
                        {label}
                    </IconButton>
                </Tooltip>
            );
        })}
    </ButtonGroup>

    let jumpButtons = drawerOpen ? jumpButtonsDrawerOpen : jumpButtonDrawerClosed;

    let carousel = (
        <Box className="data-thread" sx={{ ...sx, position: 'relative' }}>
            <Box sx={{
                direction: 'ltr', display: 'flex',
                paddingLeft: '12px', alignItems: 'center', justifyContent: 'space-between',
            }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography className="view-title" component="h2" sx={{ marginTop: "6px" }}>
                        Data Threads
                    </Typography>
                    {jumpButtons}
                </Box>
                
                <Box sx={{ display: 'flex', alignItems: 'center' }}>   
                    <Tooltip title={"collapse"}>
                        <span>
                            <IconButton size={'small'} color="primary" 
                            disabled={drawerOpen === false} onClick={() => { setThreadDrawerOpen(false); }}>
                                <ChevronLeftIcon />
                            </IconButton>
                        </span>
                    </Tooltip>
                    <Tooltip title={"expand"}>
                        <span>
                            <IconButton size={'small'} color="primary" 
                                disabled={totalThreadCount <= 1} onClick={() => { 
                                    setThreadDrawerOpen(true); 
                                }}>
                                <ChevronRightIcon />
                            </IconButton>
                        </span>
                    </Tooltip>
                </Box>
            </Box>

            <Box sx={{
                    overflow: 'hidden', 
                    direction: 'rtl', 
                    display: 'block', 
                    flex: 1,
                    height: 'calc(100% - 48px)',
                    transition: 'width 0.3s ease-in-out', // Smooth width transition for container
                }}>
                {view}
            </Box>
        </Box>
    );

    return carousel;
}

