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

import CloudQueueIcon from '@mui/icons-material/CloudQueue';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import SettingsIcon from '@mui/icons-material/Settings';
import EditIcon from '@mui/icons-material/Edit';
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
                    sx={{ width: 240, fontSize: 12, p: 1.5, mt: 1, border: '1px solid', borderColor: 'divider' }}
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
                        // Build request body with required output_variable and virtual flag
                        const requestBody: any = {
                            input_tables: parentTableData,
                            code: derivedTable.derive.code,
                            output_variable: derivedTable.derive.outputVariable || 'result_df',
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
                    sx={{
                        fontSize: '11px',
                        '& .MuiBox-root': { mx: 0.5, my: 0.25 },
                        '& .MuiSvgIcon-root': { width: '12px', height: '12px' },
                        ...(highlightedTableIds.includes(trigger.resultTableId) ? {borderLeft: '3px solid', borderLeftColor: alpha(theme.palette.custom.main, 0.5)} : {}),
                    }}
                />
            </Box>
        </div>;

        return <Box sx={{ display: 'flex', flexDirection: 'column' }} key={`trigger-card-${trigger.chart?.id}`}>
            {triggerCard}
            <SouthIcon sx={{
                fontSize: 10, 
                ml: '3px',
                color: highlightedTableIds.includes(trigger.resultTableId) 
                    ? alpha(theme.palette.custom.main, 0.5) 
                    : 'darkgray',
            }} />
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
                        {/* For derived tables: icon toggles anchored */}
                        {/* {table?.derive != undefined && (
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
                        )} */}
                        {tableCardIcon}
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
                            <Typography fontSize="inherit" sx={{
                                textAlign: 'center',
                                color: 'rgba(0,0,0,0.7)', 
                                maxWidth: 160,
                                ml: ((table?.source?.type === 'stream' || table?.source?.type === 'database') && table?.source?.autoRefresh) ? 0.5 : 0,
                                wordWrap: 'break-word',
                                whiteSpace: 'normal'
                            }}>{table?.displayId || tableId}</Typography>
                        </Box>
                    </Stack>
                    <ButtonGroup aria-label="Basic button group" variant="text" sx={{ textAlign: 'end', margin: "auto 2px auto auto" }}>
                        {table?.derive == undefined && (
                            <Tooltip key="more-options-btn-tooltip" title="more options">
                                <IconButton className="more-options-btn" color="primary" aria-label="more options" size="small" sx={{ padding: 0.25, '&:hover': {
                                    transform: 'scale(1.2)',
                                    transition: 'all 0.1s linear'
                                    } }}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        handleOpenTableMenu(table!, event.currentTarget);
                                    }}
                                >
                                    <SettingsIcon fontSize="small" sx={{ fontSize: 16 }} />
                                </IconButton>
                            </Tooltip>
                        )}
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
                <RenameTablePopup
                    open={renamePopupOpen}
                    anchorEl={renameAnchorEl}
                    onClose={handleCloseRenamePopup}
                    onSave={handleSaveRename}
                    initialValue={selectedTableForRename?.displayId || selectedTableForRename?.id || ''}
                    tableName={selectedTableForRename?.displayId || selectedTableForRename?.id || ''}
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
                                handleOpenRenamePopup(selectedTableForMenu, tableMenuAnchorEl!);
                            }
                            handleCloseTableMenu();
                        }}
                        sx={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: 1 }}
                    >
                        <EditIcon sx={{ fontSize: 16, color: 'text.secondary' }}/>
                        Rename
                    </MenuItem>
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
        <RenameTablePopup
            open={renamePopupOpen}
            anchorEl={renameAnchorEl}
            onClose={handleCloseRenamePopup}
            onSave={handleSaveRename}
            initialValue={selectedTableForRename?.displayId || selectedTableForRename?.id || ''}
            tableName={selectedTableForRename?.displayId || selectedTableForRename?.id || ''}
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
                        handleOpenRenamePopup(selectedTableForMenu, tableMenuAnchorEl!);
                    }
                    handleCloseTableMenu();
                }}
                sx={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: 1 }}
            >
                <EditIcon sx={{ fontSize: 16, color: 'text.secondary' }}/>
                Rename
            </MenuItem>
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
    
    const serverConfig = useSelector((state: DataFormulatorState) => state.serverConfig);

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
    if (assembledChart["data"]["values"].length > serverConfig.MAX_DISPLAY_ROWS) {
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
        assembledChart["data"] = { "values": getRandomSubarray(values, serverConfig.MAX_DISPLAY_ROWS) };
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

// Thread dimension info for height estimation
interface ThreadDimension {
    tableCount: number;   // number of table cards
    triggerCount: number;  // number of trigger/instruction cards
    chartCount: number;    // number of chart cards
    messageCount: number;  // number of visible agent status messages
    isCompact: boolean;    // thread0 compact mode
}

// Height estimation constants (px) – derived from actual rendered sizes:
//   table card ≈ 36px, trigger card ≈ 90px (multi-line text + arrow),
//   chart card ≈ 140px (canvas maxHeight:100 + card chrome),
//   agent message ≈ 60px, thread header/separator ≈ 28px, thread padding ≈ 24px
const LAYOUT_TABLE_CARD_HEIGHT = 36;
const LAYOUT_TRIGGER_CARD_HEIGHT = 65;
const LAYOUT_CHART_HEIGHT = 110;
const LAYOUT_MESSAGE_HEIGHT = 60;
const LAYOUT_THREAD_HEADER_HEIGHT = 28;
const LAYOUT_THREAD_PADDING = 24;
const LAYOUT_COMPACT_TABLE_HEIGHT = 32;
const LAYOUT_THREAD_GAP = 8;  // my: 0.5 = 4px top + 4px bottom between threads

function estimateThreadHeight(dim: ThreadDimension): number {
    if (dim.isCompact) {
        return LAYOUT_THREAD_PADDING + dim.tableCount * LAYOUT_COMPACT_TABLE_HEIGHT;
    }
    return LAYOUT_THREAD_HEADER_HEIGHT + LAYOUT_THREAD_PADDING 
        + dim.tableCount * LAYOUT_TABLE_CARD_HEIGHT 
        + dim.triggerCount * LAYOUT_TRIGGER_CARD_HEIGHT 
        + dim.chartCount * LAYOUT_CHART_HEIGHT
        + dim.messageCount * LAYOUT_MESSAGE_HEIGHT;
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
): number[][] {
    if (heights.length === 0) return [];

    const cap = Math.min(maxColumns, heights.length);
    const tolerantHeight = viewportHeight * SCROLL_TOLERANCE;

    // Compute effective column height including gaps between threads
    const columnEffectiveHeight = (col: number[]) => {
        const contentH = col.reduce((sum, idx) => sum + heights[idx], 0);
        const gapH = Math.max(0, col.length - 1) * LAYOUT_THREAD_GAP;
        return contentH + gapH;
    };

    // Evaluate every candidate column count (1 … cap).
    // Pick the smallest n whose tallest column fits within tolerance.
    // If none fits, pick the one with the shortest tallest column.
    let bestLayout: number[][] = [];
    let bestMaxH = Infinity;

    for (let n = 1; n <= cap; n++) {
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
    let focusedTableId = useSelector((state: DataFormulatorState) => state.focusedTableId);
    let charts = useSelector(dfSelectors.getAllCharts);

    let chartSynthesisInProgress = useSelector((state: DataFormulatorState) => state.chartSynthesisInProgress);

    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);
    const agentActions = useSelector((state: DataFormulatorState) => state.agentActions);

    const scrollRef = useRef<null | HTMLDivElement>(null)
    const containerRef = useRef<null | HTMLDivElement>(null)

    const executeScroll = (smooth: boolean = true) => { 
        if (scrollRef.current != null) {
            scrollRef.current.scrollIntoView({ 
                behavior: smooth ? 'smooth' : 'auto', 
                block: 'center'
            }) 
        }
    }

    const dispatch = useDispatch();

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

    let hasContent = Object.keys(filteredLeafTableGroups).length > 0 || hangingTables.length > 0;

    // Build thread entries and their estimated heights for layout
    type ThreadEntry = { key: string; groupId: string; leafTables: DictTable[]; isCompact: boolean; threadIdx: number };
    let allThreadEntries: ThreadEntry[] = [];
    let allThreadHeights: number[] = [];

    // Track which table IDs have been claimed by earlier threads
    // (mirrors usedIntermediateTableIds logic in rendering)
    let claimedTableIds = new Set<string>();

    // thread0 first — claim all its table IDs
    Object.entries(thread0Group).forEach(([groupId, lts]) => {
        lts.forEach(lt => {
            claimedTableIds.add(lt.id);
            getTriggers(lt, tables).forEach(t => claimedTableIds.add(t.tableId));
        });

        allThreadEntries.push({
            key: `thread0-${groupId}`,
            groupId,
            leafTables: lts,
            isCompact: true,
            threadIdx: -1,
        });
        allThreadHeights.push(estimateThreadHeight({
            tableCount: lts.length,
            triggerCount: 0,
            chartCount: 0,
            messageCount: 0,
            isCompact: true,
        }));
    });

    // then regular threads — only count NEW (unclaimed) tables in each thread
    Object.entries(filteredLeafTableGroups).forEach(([groupId, lts], i) => {
        // Collect all table IDs in this thread's chains
        let threadTableIds = new Set<string>();
        lts.forEach(lt => {
            const triggers = getTriggers(lt, tables);
            triggers.forEach(t => threadTableIds.add(t.tableId));
            threadTableIds.add(lt.id);
        });

        // Only new (unclaimed) tables contribute to this thread's height
        let newTableIds = [...threadTableIds].filter(id => !claimedTableIds.has(id));

        // Triggers are only for new intermediate tables (not the leaf)
        let newTriggerCount = lts.reduce((max, lt) => {
            const triggers = getTriggers(lt, tables);
            const newTriggers = triggers.filter(t => newTableIds.includes(t.resultTableId));
            return Math.max(max, newTriggers.length);
        }, 0);

        // Charts only on new tables
        let chartCount = newTableIds.reduce((sum, tid) => {
            return sum + chartElements.filter(ce => ce.tableId === tid).length;
        }, 0);

        // Agent messages only on new tables
        let messageCount = newTableIds.reduce((sum, tid) => {
            return sum + agentActions.filter(a => a.tableId === tid && !a.hidden).length;
        }, 0);

        // Claim this thread's tables for subsequent threads
        threadTableIds.forEach(id => claimedTableIds.add(id));

        allThreadEntries.push({
            key: `thread-${groupId}-${i}`,
            groupId,
            leafTables: lts,
            isCompact: false,
            threadIdx: i,
        });
        allThreadHeights.push(estimateThreadHeight({
            tableCount: newTableIds.length,
            triggerCount: newTriggerCount,
            chartCount,
            messageCount,
            isCompact: false,
        }));
    });

    // Pick the best column layout: balances scroll burden vs whitespace.
    // Measure actual panel height from the DOM (accounts for browser zoom, panel resizing, etc.)
    const availableHeight = containerRef.current?.clientHeight ?? 600;
    const MAX_COLUMNS = 3;
    const columnLayout: number[][] = chooseBestColumnLayout(
        allThreadHeights, MAX_COLUMNS, availableHeight, /* flexOrder */ false
    );
    const actualColumns = columnLayout.length || 1;

    let renderThreadEntry = (entry: ThreadEntry) => {
        if (entry.isCompact) {
            return <SingleThreadGroupView
                key={entry.key}
                scrollRef={scrollRef}
                threadIdx={entry.threadIdx}
                leafTables={entry.leafTables}
                chartElements={chartElements}
                usedIntermediateTableIds={[]}
                compact={true}
                sx={{
                    backgroundColor: 'white',
                    borderRadius: 2,
                    padding: 1,
                    my: 0.5,
                    flex: 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    height: 'fit-content',
                    width: entry.leafTables.length > 1 ? '216px' : '200px',
                    transition: 'all 0.3s ease',
                }} />;
        } else {
            // Calculate used tables from thread0 and previous regular threads
            let usedIntermediateTableIds = Object.values(thread0Group).flat()
                .map(x => [...getTriggers(x, tables).map(y => y.tableId) || []]).flat();
            let usedLeafTableIds = Object.values(thread0Group).flat().map(x => x.id);

            const previousThreadGroups = Object.values(filteredLeafTableGroups).slice(0, entry.threadIdx);
            usedIntermediateTableIds = [...usedIntermediateTableIds, ...previousThreadGroups.flat()
                .map(x => [...getTriggers(x, tables).map(y => y.tableId) || []]).flat()];
            usedLeafTableIds = [...usedLeafTableIds, ...previousThreadGroups.flat().map(x => x.id)];

            return <SingleThreadGroupView
                key={entry.key}
                scrollRef={scrollRef}
                threadIdx={entry.threadIdx}
                leafTables={entry.leafTables}
                chartElements={chartElements}
                usedIntermediateTableIds={[...usedIntermediateTableIds, ...usedLeafTableIds]}
                sx={{
                    backgroundColor: 'white',
                    borderRadius: 2,
                    padding: 1,
                    my: 0.5,
                    flex: 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    height: 'fit-content',
                    width: entry.leafTables.length > 1 ? '216px' : '200px',
                    transition: 'all 0.3s ease',
                }} />;
        }
    };

    // Thread navigation buttons
    let threadIndices: number[] = [];
    if (Object.keys(thread0Group).length > 0) {
        threadIndices.push(-1); // thread0
    }
    threadIndices.push(...Array.from({length: Object.keys(filteredLeafTableGroups).length}, (_, i) => i));

    let jumpButtons = <ButtonGroup size="small" color="primary" sx={{ gap: 0 }}>
        {threadIndices.map((threadIdx) => {
            const label = threadIdx === -1 ? '0' : String(threadIdx + 1);
            return (
                <Tooltip key={`thread-nav-${threadIdx}`} title={`Jump to thread ${label}`}>
                    <IconButton 
                        size="small" 
                        color="primary"
                        sx={{ fontSize: '12px', padding: '4px' }} 
                        onClick={() => {
                            const threadElement = document.querySelector(`[data-thread-index="${threadIdx}"]`);
                            threadElement?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                        }}
                    > 
                        {label}
                    </IconButton>
                </Tooltip>
            );
        })}
    </ButtonGroup>

    // Column-based panel width: each column ≈ 224px + gaps + padding
    const COLUMN_WIDTH = 224;
    const panelWidth = actualColumns * COLUMN_WIDTH + (actualColumns - 1) * 8 + 16;

    let view = hasContent ? (
        <Box sx={{ 
            overflowY: 'auto',
            overflowX: 'hidden',
            position: 'relative',
            display: 'flex',
            flexDirection: 'row',
            direction: 'ltr',
            height: 'calc(100% - 16px)',
            gap: 1,
            p: 1,
            width: panelWidth,
        }}>
            {columnLayout.map((columnIndices: number[], colIdx: number) => (
                <Box key={`thread-column-${colIdx}`} sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0,
                    flex: 1,
                    minWidth: 0,
                }}>
                    {columnIndices.map((idx: number) => {
                        const entry = allThreadEntries[idx];
                        return entry ? renderThreadEntry(entry) : null;
                    })}
                </Box>
            ))}
        </Box>
    ) : null;

    return (
        <Box className="data-thread" sx={{ ...sx, position: 'relative' }}>
            <Box sx={{
                direction: 'ltr', display: 'flex',
                paddingLeft: '12px', alignItems: 'center', justifyContent: 'space-between',
            }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography className="view-title" component="h2" sx={{ marginTop: "6px" }}>
                        Data Threads
                    </Typography>
                    {threadIndices.length > 0 && jumpButtons}
                </Box>
            </Box>

            <Box ref={containerRef} sx={{
                    overflow: 'hidden', 
                    direction: 'rtl', 
                    display: 'block', 
                    flex: 1,
                    height: 'calc(100% - 48px)',
                }}>
                {view}
            </Box>
        </Box>
    );
}

