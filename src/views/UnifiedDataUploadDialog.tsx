// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as React from 'react';
import { useState, useCallback, useEffect, useRef } from 'react';
import { borderColor, transition, radius } from '../app/tokens';
import {
    Box,
    Button,
    Chip,
    Dialog,
    DialogContent,
    DialogTitle,
    IconButton,
    TextField,
    Typography,
    Tooltip,
    Link,
    Input,
    alpha,
    useTheme,
} from '@mui/material';

import CloseIcon from '@mui/icons-material/Close';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import LinkIcon from '@mui/icons-material/Link';
import { StreamIcon } from '../icons';
import StorageIcon from '@mui/icons-material/Storage';
import ImageSearchIcon from '@mui/icons-material/ImageSearch';
import ExploreIcon from '@mui/icons-material/Explore';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import Paper from '@mui/material/Paper';
import CircularProgress from '@mui/material/CircularProgress';
import Backdrop from '@mui/material/Backdrop';

import { useDispatch, useSelector } from 'react-redux';
import { DataFormulatorState, dfActions, fetchFieldSemanticType } from '../app/dfSlice';
import { AppDispatch } from '../app/store';
import { loadTable, loadPluginTable } from '../app/tableThunks';
import { DataSourceConfig, DictTable } from '../components/ComponentType';
import { createTableFromFromObjectArray, createTableFromText, loadTextDataWrapper, loadBinaryDataWrapper, readFileText } from '../data/utils';
import { DataLoadingChat } from './DataLoadingChat';
import { DatasetSelectionView, DatasetMetadata } from './TableSelectionView';
import { getUrls, fetchWithIdentity } from '../app/utils';
import { DBManagerPane } from './DBTableManager';
import { MultiTablePreview } from './MultiTablePreview';
import { 
    ToggleButton, 
    ToggleButtonGroup,
    FormControlLabel,
    Switch,
} from '@mui/material';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import CloudIcon from '@mui/icons-material/Cloud';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import LanguageIcon from '@mui/icons-material/Language';
import { useTranslation } from 'react-i18next';
import { getEnabledPlugins, PluginHost } from '../plugins';

export type UploadTabType = 'menu' | 'upload' | 'paste' | 'url' | 'database' | 'extract' | 'explore' | `plugin:${string}`;

interface TabPanelProps {
    children?: React.ReactNode;
    index: UploadTabType;
    value: UploadTabType;
}

function TabPanel(props: TabPanelProps) {
    const { children, value, index, ...other } = props;

    return (
        <div
            role="tabpanel"
            hidden={value !== index}
            id={`data-upload-tabpanel-${index}`}
            aria-labelledby={`data-upload-tab-${index}`}
            style={{ height: '100%', overflow: 'auto', boxSizing: 'border-box' }}
            {...other}
        >
            {value === index && children}
        </div>
    );
}

// Data source menu card component
interface DataSourceCardProps {
    icon: React.ReactNode;
    title: string;
    description: string;
    onClick: () => void;
    disabled?: boolean;
}

const DataSourceCard: React.FC<DataSourceCardProps> = ({ 
    icon, 
    title, 
    description, 
    onClick, 
    disabled = false,
}) => {
    const theme = useTheme();
    
    const card = (
        <Paper
            elevation={0}
            onClick={disabled ? undefined : onClick}
            sx={{
                p: 1.5,
                cursor: disabled ? 'not-allowed' : 'pointer',
                border: `1px solid ${borderColor.divider}`,
                borderRadius: radius.sm,
                opacity: disabled ? 0.5 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                '&:hover': disabled ? {} : {
                    transform: 'translateY(-2px)',
                    backgroundColor: 'action.hover',
                }
            }}
        >
            <Box sx={{ 
                color: disabled ? 'text.disabled' : 'primary.main',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
                borderRadius: 1,
                backgroundColor: alpha(theme.palette.primary.main, 0.08),
                flexShrink: 0,
                '& .MuiSvgIcon-root': { fontSize: 18 }
            }}>
                {icon}
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography 
                    variant="body2" 
                    sx={{ 
                        fontWeight: 500,
                        color: disabled ? 'text.disabled' : 'text.primary',
                    }}
                >
                    {title}
                </Typography>
                <Typography
                    variant="caption"
                    sx={{
                        color: disabled ? 'text.disabled' : 'text.secondary',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        lineHeight: 1.3,
                        mt: 0.25,
                    }}
                >
                    {description}
                </Typography>
            </Box>
        </Paper>
    );

    return card;
};

const getUniqueTableName = (baseName: string, existingNames: Set<string>): string => {
    let uniqueName = baseName;
    let counter = 1;
    while (existingNames.has(uniqueName)) {
        uniqueName = `${baseName}_${counter}`;
        counter++;
    }
    return uniqueName;
};

// Reusable Data Load Menu Component
export interface DataLoadMenuProps {
    onSelectTab: (tab: UploadTabType) => void;
    serverConfig?: { WORKSPACE_BACKEND?: string };
    variant?: 'dialog' | 'page'; // 'dialog' uses smaller cards, 'page' uses larger cards
    hideSampleDatasets?: boolean;
}

export const DataLoadMenu: React.FC<DataLoadMenuProps> = ({ 
    onSelectTab, 
    serverConfig = { WORKSPACE_BACKEND: 'local' },
    variant = 'dialog',
    hideSampleDatasets = false
}) => {
    const theme = useTheme();
    const { t } = useTranslation();
    // Data source configurations
    const regularDataSources = [
        { 
            value: 'explore' as UploadTabType, 
            title: t('upload.sampleDatasets'), 
            description: t('upload.sampleDatasetsDesc'),
            icon: <ExploreIcon />, 
            disabled: false
        },
        { 
            value: 'upload' as UploadTabType, 
            title: t('upload.uploadFile'), 
            description: t('upload.uploadFileDesc'),
            icon: <UploadFileIcon />, 
            disabled: false
        },
        { 
            value: 'paste' as UploadTabType, 
            title: t('upload.pasteData'), 
            description: t('upload.pasteDataDesc'),
            icon: <ContentPasteIcon />, 
            disabled: false
        },
        { 
            value: 'extract' as UploadTabType, 
            title: t('upload.extractData'), 
            description: t('upload.extractDataDesc'),
            icon: <ImageSearchIcon />, 
            disabled: false
        },
    ].filter(source => !(hideSampleDatasets && source.value === 'explore'));

    const enabledPlugins = getEnabledPlugins((serverConfig as any)?.PLUGINS);

    const liveDataSources: Array<{ value: UploadTabType; title: string; description: string; icon: React.ReactNode; disabled: boolean }> = [
        { 
            value: 'url' as UploadTabType, 
            title: t('upload.loadFromUrl'), 
            description: t('upload.loadFromUrlDesc'),
            icon: <LinkIcon />, 
            disabled: false
        },
        { 
            value: 'database' as UploadTabType, 
            title: t('upload.database'), 
            description: t('upload.databaseDesc'),
            icon: <StorageIcon />, 
            disabled: false
        },
        ...enabledPlugins.map(({ module, config }) => ({
            value: `plugin:${module.id}` as UploadTabType,
            title: config.name,
            description: t(`plugin.${module.id}.description`, { defaultValue: config.description || '' }),
            icon: <module.Icon sx={{ fontSize: 18 }} />,
            disabled: false,
        })),
    ];

    if (variant === 'page') {
        // Page variant: 3-column grid, first column for liveDataSources, second 2 columns for regularDataSources
        return (
            <Box sx={{ 
                width: '100%',
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) repeat(2, minmax(0, 1fr))',
                gridTemplateRows: 'auto repeat(2, auto)',
                gap: 1.5,
                rowGap: 2,
                mx: 0,
                textAlign: 'left',
            }}>
                {/* Section Titles */}
                <Typography 
                    variant="body2" 
                    color="text.secondary" 
                    sx={{ 
                        gridColumn: 1,
                        gridRow: 1,
                        textAlign: 'left',
                        letterSpacing: '0.02em',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        position: 'relative',
                        zIndex: 1,
                        marginRight: 3, // Extra space between first column and other columns
                    }}
                >
                    <StreamIcon sx={{ fontSize: 14, animation: 'pulse 2s infinite', '@keyframes pulse': {
                        '0%': { opacity: 1, color: 'primary.main' },
                        '50%': { opacity: 0.5, color: 'primary.light' },
                        '100%': { opacity: 1, color: 'primary.main' },
                    }, }} /> {t('upload.connectToLiveData')}
                </Typography>
                <Typography 
                    variant="body2" 
                    color="text.secondary" 
                    sx={{ 
                        gridColumn: '2 / 3',
                        gridRow: 1,
                        textAlign: 'left',
                        letterSpacing: '0.02em'
                    }}
                >
                    {t('upload.loadLocalData')}
                </Typography>
                
                {/* Background for Live Data Column */}
                <Box
                    sx={{
                        gridColumn: 1,
                        gridRow: '1 / -1',
                        backgroundColor: alpha(theme.palette.primary.main, 0.03),
                        borderRadius: 1,
                        position: 'relative',
                        zIndex: 0,
                        // Extend into gaps to create continuous background
                        marginTop: '-16px', // Extend into row gaps (2 * 8px = 16px)
                        marginBottom: '-16px',
                        marginLeft: '-12px', // Extend into left column gap (1.5 * 8px = 12px)
                        marginRight: '12px', // Extra space between first column and other columns (3 * 8px = 24px total)
                        paddingTop: '16px',
                        paddingBottom: '16px',
                        paddingLeft: '12px',
                        paddingRight: '12px',
                    }}
                />
                
                {/* Live Data Sources - fill last column, 2 rows */}
                {liveDataSources.map((source, index) => (
                    <Box
                        key={source.value}
                        sx={{
                            gridColumn: 1,
                            gridRow: index + 2, // Start from row 2 (after title row)
                            position: 'relative',
                            zIndex: 1,
                            marginRight: 3, // Extra space between first column and other columns
                        }}
                    >
                        <DataSourceCard
                            icon={source.icon}
                            title={source.title}
                            description={source.description}
                            onClick={() => onSelectTab(source.value)}
                            disabled={source.disabled}
                        />
                    </Box>
                ))}
                {/* Regular Data Sources - fill first 2 columns, 2 rows */}
                {regularDataSources.map((source, index) => (
                    <Box
                        key={source.value}
                        sx={{
                            gridColumn: (index % 2) + 2,
                            gridRow: Math.floor(index / 2) + 2, // Start from row 2 (after title row)
                        }}
                    >
                        <DataSourceCard
                            icon={source.icon}
                            title={source.title}
                            description={source.description}
                            onClick={() => onSelectTab(source.value)}
                            disabled={source.disabled}
                        />
                    </Box>
                ))}
                
            </Box>
        );
    }

    // Dialog variant: original two-section layout
    return (
        <Box sx={{ 
            width: '100%',
            maxWidth: 860,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            mx: 0,
            textAlign: 'left',
        }}>
            {/* Local Data Sources */}
            <Typography 
                variant="body2" 
                color="text.secondary" 
                sx={{ 
                    textAlign: 'left',
                    mb: 1,
                    mt: 1,
                    opacity: 0.6,
                    fontSize: '0.75rem',
                    letterSpacing: '0.02em'
                }}
            >
                {t('upload.localData')}
            </Typography>

            <Box sx={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: 1.5,
                mb: 0,
            }}>
                {regularDataSources.map((source) => (
                    <DataSourceCard
                        key={source.value}
                        icon={source.icon}
                        title={source.title}
                        description={source.description}
                        onClick={() => onSelectTab(source.value)}
                        disabled={source.disabled}
                    />
                ))}
            </Box>

            {/* Live Data Sources */}
            <Typography 
                variant="body2" 
                color="text.secondary" 
                sx={{ 
                    textAlign: 'left',
                    my: 1,
                    opacity: 0.6,
                    fontSize: '0.75rem',
                    letterSpacing: '0.02em',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                }}
            >
                <StreamIcon sx={{ fontSize: 14, animation: 'pulse 2s infinite', '@keyframes pulse': {
                    '0%': { opacity: 1, color: 'primary.main' },
                    '50%': { opacity: 0.5, color: 'primary.light' },
                    '100%': { opacity: 1, color: 'primary.main' },
                }, }} /> {t('upload.orConnectToDataSource')}
            </Typography>

            <Box sx={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: 1.5,
            }}>
                {liveDataSources.map((source) => (
                    <DataSourceCard
                        key={source.value}
                        icon={source.icon}
                        title={source.title}
                        description={source.description}
                        onClick={() => onSelectTab(source.value)}
                        disabled={source.disabled}
                    />
                ))}
            </Box>
        </Box>
    );
};

export interface UnifiedDataUploadDialogProps {
    open: boolean;
    onClose: () => void;
    initialTab?: UploadTabType;
    hideSampleDatasets?: boolean;
}

export const UnifiedDataUploadDialog: React.FC<UnifiedDataUploadDialogProps> = ({
    open,
    onClose,
    initialTab = 'menu',
    hideSampleDatasets = false,
}) => {
    const theme = useTheme();
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();
    const existingTables = useSelector((state: DataFormulatorState) => state.tables);
    const serverConfig = useSelector((state: DataFormulatorState) => state.serverConfig);
    const dataCleanBlocks = useSelector((state: DataFormulatorState) => state.dataCleanBlocks);
    const frontendRowLimit = useSelector((state: DataFormulatorState) => state.config?.frontendRowLimit ?? 50000);
    const existingNames = new Set(existingTables.map(t => t.id));

    const [activeTab, setActiveTab] = useState<UploadTabType>(initialTab === 'menu' ? 'menu' : initialTab);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const urlInputRef = useRef<HTMLInputElement>(null);

    // Storage is determined by backend config — no user toggle
    const isEphemeral = serverConfig.WORKSPACE_BACKEND === 'ephemeral';
    const storeOnServer = !isEphemeral; // used to decide file upload behavior

    // Paste tab state
    const [pasteContent, setPasteContent] = useState<string>("");
    const [isLargeContent, setIsLargeContent] = useState<boolean>(false);
    const [showFullContent, setShowFullContent] = useState<boolean>(false);
    
    // File preview state
    const [filePreviewTables, setFilePreviewTables] = useState<DictTable[] | null>(null);
    const [filePreviewLoading, setFilePreviewLoading] = useState<boolean>(false);
    const [filePreviewError, setFilePreviewError] = useState<string | null>(null);
    const [filePreviewFiles, setFilePreviewFiles] = useState<File[]>([]);
    const [filePreviewActiveIndex, setFilePreviewActiveIndex] = useState<number>(0);
    const [isDragOver, setIsDragOver] = useState<boolean>(false);

    // URL tab state (separate from file upload)
    const [tableURL, setTableURL] = useState<string>("");
    const [urlAutoRefresh, setUrlAutoRefresh] = useState<boolean>(false);
    const [urlRefreshInterval, setUrlRefreshInterval] = useState<number>(60); // default 60 seconds
    const [urlPreviewTables, setUrlPreviewTables] = useState<DictTable[] | null>(null);
    const [urlPreviewLoading, setUrlPreviewLoading] = useState<boolean>(false);
    const [urlPreviewError, setUrlPreviewError] = useState<string | null>(null);
    const [urlPreviewActiveIndex, setUrlPreviewActiveIndex] = useState<number>(0);
    
    // Example URLs state
    const [exampleUrls, setExampleUrls] = useState<Array<{ label: string; url: string; refreshSeconds: number; resetUrl?: string }>>([]); 

    // Sample datasets state
    const [datasetPreviews, setDatasetPreviews] = useState<DatasetMetadata[]>([]);

    // Loading state for table loading (file/URL/paste)
    const [tableLoading, setTableLoading] = useState<boolean>(false);

    // Loading state for dataset loading
    const [datasetLoading, setDatasetLoading] = useState<boolean>(false);
    const [datasetLoadingLabel, setDatasetLoadingLabel] = useState<string>('');

    // Constants
    const MAX_DISPLAY_LINES = 20;
    const LARGE_CONTENT_THRESHOLD = 50000;

    // Update active tab when initialTab changes
    useEffect(() => {
        if (open) {
            setActiveTab(initialTab === 'menu' ? 'menu' : initialTab);
        }
    }, [initialTab, open]);


    // Load sample datasets
    useEffect(() => {
        if (open && activeTab === 'explore') {
            fetchWithIdentity(`${getUrls().EXAMPLE_DATASETS}`)
            .then((response) => response.json())
            .then((result) => {
                let datasets: DatasetMetadata[] = result.map((info: any) => {
                    let tables = info["tables"].map((table: any) => {
                        if (table["format"] == "json") {
                            return {
                                table_name: table["name"],
                                url: table["url"],
                                format: table["format"],
                                sample: table["sample"],
                            }
                        }
                        else if (table["format"] == "csv" || table["format"] == "tsv") {
                            const delimiter = table["format"] === "csv" ? "," : "\t";
                            const rows = table["sample"]
                                .split("\n")
                                .map((row: string) => row.split(delimiter));
                            
                            if (rows.length > 0) {
                                const headers = rows[0];
                                const dataRows = rows.slice(1);
                                const sampleData = dataRows.map((row: string[]) => {
                                    const obj: any = {};
                                    headers.forEach((header: string, index: number) => {
                                        obj[header] = row[index] || '';
                                    });
                                    return obj;
                                });
                                
                                return {
                                    table_name: table["name"],
                                    url: table["url"],
                                    format: table["format"],
                                    sample: sampleData,
                                };
                            }
                            
                            return {
                                table_name: table["name"],
                                url: table["url"],
                                format: table["format"],
                                sample: [],
                            };
                        }
                    })
                    return { 
                        tables: tables, 
                        name: info["name"], 
                        source: info["source"],
                        live: info["live"],
                        refreshIntervalSeconds: info["refreshIntervalSeconds"]
                    }
                }).filter((t: DatasetMetadata | undefined) => t != undefined);
                setDatasetPreviews(datasets);
            });
        } else if (open && activeTab === 'url') {
            fetchWithIdentity(`${window.location.origin}/api/demo-stream/info`)
            .then(res => res.json())
            .then(data => {
                const demoExamples = data.demo_examples
                    .map((ex: any) => ({
                        label: ex.name,
                        url: ex.url,
                        refreshSeconds: ex.refresh_seconds || 60,
                        resetUrl: ex.reset_url || undefined,
                }));
                
                setExampleUrls(demoExamples);
            })
            .catch((err) => {
                console.error('Failed to load examples:', err);
            })
            .finally(() => { });
        }
    }, [open, activeTab]);

    const handleClose = useCallback(() => {
        // Reset state when closing
        setPasteContent("");
        setIsLargeContent(false);
        setShowFullContent(false);
        setFilePreviewTables(null);
        setFilePreviewLoading(false);
        setFilePreviewError(null);
        setFilePreviewFiles([]);
        // Reset URL tab state
        setTableURL("");
        setUrlAutoRefresh(false);
        setUrlRefreshInterval(60);
        setUrlPreviewTables(null);
        setUrlPreviewLoading(false);
        setUrlPreviewError(null);
        setUrlPreviewActiveIndex(0);
        setExampleUrls([]);
        onClose();
    }, [onClose]);

    // Shared file processing logic (used by both file input and drag-and-drop)
    const processUploadedFiles = useCallback((selectedFiles: File[]): void => {
        setFilePreviewFiles(selectedFiles);
        setFilePreviewError(null);
        setFilePreviewTables(null);
        setFilePreviewLoading(true);

        const previewTables: DictTable[] = [];
        const errors: string[] = [];

        const processFiles = async () => {
            for (const file of selectedFiles) {
                const uniqueName = getUniqueTableName(file.name, existingNames);
                const isTextFile = file.type === 'text/csv' || 
                    file.type === 'text/tab-separated-values' || 
                    file.type === 'application/json' ||
                    file.name.endsWith('.csv') || 
                    file.name.endsWith('.tsv') || 
                    file.name.endsWith('.json');
                const isExcelFile = file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                    file.type === 'application/vnd.ms-excel' ||
                    file.name.endsWith('.xlsx') || 
                    file.name.endsWith('.xls');

                if (isTextFile) {
                    try {
                        const text = await readFileText(file);
                        const table = loadTextDataWrapper(uniqueName, text, file.type);
                        if (table) {
                            previewTables.push(table);
                        } else {
                            errors.push(t('upload.errors.failedToParse', { name: file.name }));
                        }
                    } catch {
                        errors.push(t('upload.errors.failedToRead', { name: file.name }));
                    }
                    continue;
                }

                if (isExcelFile) {
                    const isLegacyXls = file.name.toLowerCase().endsWith('.xls') && !file.name.toLowerCase().endsWith('.xlsx');
                    if (isLegacyXls) {
                        try {
                            const formData = new FormData();
                            formData.append('file', file);
                            const resp = await fetchWithIdentity(getUrls().PARSE_FILE, {
                                method: 'POST',
                                body: formData,
                            });
                            const result = await resp.json();
                            if (result.status === 'success' && result.sheets?.length > 0) {
                                for (const sheet of result.sheets) {
                                    const sheetTitle = result.sheets.length > 1
                                        ? `${uniqueName}-${sheet.sheet_name}`
                                        : uniqueName;
                                    const table = createTableFromFromObjectArray(sheetTitle, sheet.data, true);
                                    previewTables.push(table);
                                }
                            } else {
                                errors.push(t('upload.errors.failedToParseExcel', { name: file.name }));
                            }
                        } catch {
                            errors.push(t('upload.errors.failedToParseExcel', { name: file.name }));
                        }
                    } else {
                        try {
                            const arrayBuffer = await file.arrayBuffer();
                            const tables = await loadBinaryDataWrapper(uniqueName, arrayBuffer);
                            if (tables.length > 0) {
                                previewTables.push(...tables);
                            } else {
                                errors.push(t('upload.errors.failedToParseExcel', { name: file.name }));
                            }
                        } catch {
                            errors.push(t('upload.errors.failedToParseExcel', { name: file.name }));
                        }
                    }
                    continue;
                }

                errors.push(t('upload.errors.unsupportedFormat', { name: file.name }));
            }

            setFilePreviewTables(previewTables.length > 0 ? previewTables : null);
            setFilePreviewError(errors.length > 0 ? errors.join(' ') : null);
            setFilePreviewLoading(false);
        };

        processFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [existingNames, t]);

    // File input change handler
    const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
        const files = event.target.files;
        if (files && files.length > 0) {
            processUploadedFiles(Array.from(files));
        }
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    // Drag-and-drop handlers
    const handleDragOver = useCallback((event: React.DragEvent): void => {
        event.preventDefault();
        event.stopPropagation();
    }, []);

    const handleDragEnter = useCallback((event: React.DragEvent): void => {
        event.preventDefault();
        event.stopPropagation();
        setIsDragOver(true);
    }, []);

    const handleDragLeave = useCallback((event: React.DragEvent): void => {
        event.preventDefault();
        event.stopPropagation();
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setIsDragOver(false);
    }, []);

    const handleFileDrop = useCallback((event: React.DragEvent): void => {
        event.preventDefault();
        event.stopPropagation();
        setIsDragOver(false);
        const files = event.dataTransfer.files;
        if (files && files.length > 0) {
            processUploadedFiles(Array.from(files));
        }
    }, [processUploadedFiles]);

    // Reset activeIndex when tables change
    useEffect(() => {
        if (filePreviewTables && filePreviewTables.length > 0) {
            if (filePreviewActiveIndex >= filePreviewTables.length) {
                setFilePreviewActiveIndex(filePreviewTables.length - 1);
            }
        } else {
            setFilePreviewActiveIndex(0);
        }
    }, [filePreviewTables, filePreviewActiveIndex]);

    const handleFileLoadSingleTable = async (): Promise<void> => {
        if (!filePreviewTables || filePreviewTables.length === 0) {
            return;
        }
        const table = filePreviewTables[filePreviewActiveIndex];
        if (table) {
            const sourceConfig: DataSourceConfig = { type: 'file', fileName: filePreviewFiles[0]?.name };
            const tableWithSource = { ...table, source: sourceConfig };
            setTableLoading(true);
            try {
                await dispatch(loadTable({
                    table: tableWithSource,
                    file: storeOnServer ? filePreviewFiles[filePreviewActiveIndex] || filePreviewFiles[0] : undefined,
                }));
            } finally {
                setTableLoading(false);
            }
            handleClose();
        }
    };

    const handleFileLoadAllTables = async (): Promise<void> => {
        if (!filePreviewTables || filePreviewTables.length === 0) {
            return;
        }

        setTableLoading(true);
        try {
            // When storing on server, remove frontend-only orphans from the same
            // source files (sheets that existed before but are absent in the new batch).
            const seenSourceFiles = new Set<string>();
            if (storeOnServer) {
                const newTableIds = new Set(filePreviewTables.map(t => t.id));
                const sourceFileNames = new Set<string>();
                for (let i = 0; i < filePreviewTables.length; i++) {
                    const fn = filePreviewFiles[i]?.name || filePreviewFiles[0]?.name;
                    if (fn) sourceFileNames.add(fn);
                }
                for (const t of existingTables) {
                    if (t.source?.type === 'file' && t.source.fileName && sourceFileNames.has(t.source.fileName) && !newTableIds.has(t.id)) {
                        dispatch(dfActions.removeTableLocally(t.id));
                    }
                }
            }

            for (let i = 0; i < filePreviewTables.length; i++) {
                const table = filePreviewTables[i];
                const fileName = filePreviewFiles[i]?.name || filePreviewFiles[0]?.name;
                const sourceConfig: DataSourceConfig = { type: 'file', fileName };
                const tableWithSource = { ...table, source: sourceConfig };

                const isFirstForFile = fileName ? !seenSourceFiles.has(fileName) : false;
                if (fileName) seenSourceFiles.add(fileName);

                await dispatch(loadTable({
                    table: tableWithSource,
                    file: storeOnServer ? filePreviewFiles[i] || filePreviewFiles[0] : undefined,
                    replaceSource: storeOnServer && isFirstForFile,
                }));
            }
        } finally {
            setTableLoading(false);
        }
        handleClose();
    };

    const handleRemoveFilePreviewTable = (index: number): void => {
        setFilePreviewTables((prev) => {
            if (!prev) return prev;
            const next = prev.filter((_, i) => i !== index);
            return next.length > 0 ? next : null;
        });
    };

    // Paste content handler
    const handleContentChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const newContent = event.target.value;
        setPasteContent(newContent);
        
        const isLarge = newContent.length > LARGE_CONTENT_THRESHOLD;
        setIsLargeContent(isLarge);
        
        // If switching from large to small content, ensure full content is shown
        if (!isLarge) {
            setShowFullContent(true);
        }
    }, []);

    const toggleFullContent = useCallback(() => {
        setShowFullContent(!showFullContent);
    }, [showFullContent]);

    const handlePasteSubmit = async (): Promise<void> => {
        let table: undefined | DictTable = undefined;
        
        const defaultName = (() => {
            const hashStr = pasteContent.substring(0, 100) + Date.now();
            const hashCode = hashStr.split('').reduce((acc, char) => {
                return ((acc << 5) - acc) + char.charCodeAt(0) | 0;
            }, 0);
            const shortHash = Math.abs(hashCode).toString(36).substring(0, 4);
            return `data-${shortHash}`;
        })();

        const uniqueName = getUniqueTableName(defaultName, existingNames);

        try {
            let content = JSON.parse(pasteContent);
            table = createTableFromFromObjectArray(uniqueName, content, true);
        } catch (error) {
            table = createTableFromText(uniqueName, pasteContent);
        }
        if (table) {
            // Add source info for paste data
            const tableWithSource = { ...table, source: { type: 'paste' as const } };
            setTableLoading(true);
            try {
                await dispatch(loadTable({ table: tableWithSource }));
            } finally {
                setTableLoading(false);
            }
            handleClose();
        }
    };


    const handleURLPreview = (urlToUse: string): void => {
        if (!urlToUse) {
            return;
        }
        setUrlPreviewLoading(true);
        setUrlPreviewError(null);
        setUrlPreviewTables(null);


        // Support relative URLs by constructing full URL
        let fullUrl = urlToUse;
        if (urlToUse.startsWith('/')) {
            fullUrl = window.location.origin + urlToUse;
        }

        let parts = urlToUse.split('/');
        const baseName = parts[parts.length - 1]?.split('?')[0] || 'dataset';
        const tableName = getUniqueTableName(baseName.replace(/\.[^.]+$/, ''), existingNames);

        fetch(fullUrl)
            .then(res => {
                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
                }
                return res.text();
            })
            .then(content => {
                let table: undefined | DictTable = undefined;
                try {
                    // Try parsing as JSON first
                    let jsonContent = JSON.parse(content);
                    if (!Array.isArray(jsonContent)) {
                        throw new Error('JSON content must be an array of objects.');
                    }
                    table = createTableFromFromObjectArray(tableName, jsonContent, true);
                } catch (jsonError) {
                    // If JSON parsing fails, try JSONL (JSON Lines) format
                    try {
                        const lines = content.trim().split('\n').filter(line => line.trim() !== '');
                        const jsonlObjects = lines.map(line => {
                            try {
                                return JSON.parse(line);
                            } catch (e) {
                                throw new Error(`Invalid JSONL line: ${line.substring(0, 50)}...`);
                            }
                        });
                        if (jsonlObjects.length > 0 && typeof jsonlObjects[0] === 'object' && jsonlObjects[0] !== null) {
                            table = createTableFromFromObjectArray(tableName, jsonlObjects, true);
                        } else {
                            throw new Error('JSONL must contain objects.');
                        }
                    } catch (jsonlError) {
                        // If JSONL parsing fails, try CSV/TSV
                        table = createTableFromText(tableName, content);
                    }
                }

                if (table) {
                    setUrlPreviewTables([table]);
                } else {
                    setUrlPreviewError(t('upload.errors.unableToParseUrl'));
                }
            })
            .catch((err) => {
                setUrlPreviewError(t('upload.errors.failedToFetch', { message: err.message }));
            })
            .finally(() => {
                setUrlPreviewLoading(false);
            });
    };


    // URL tab load handlers
    const handleURLLoadSingleTable = async (): Promise<void> => {
        if (!urlPreviewTables || urlPreviewTables.length === 0) {
            return;
        }
        const table = urlPreviewTables[urlPreviewActiveIndex];
        if (table) {
            let sourceConfig: DataSourceConfig;
            if (urlAutoRefresh) {
                sourceConfig = { 
                    type: 'stream', 
                    url: tableURL,
                    autoRefresh: true,
                    refreshIntervalSeconds: urlRefreshInterval,
                    lastRefreshed: Date.now()
                };
            } else {
                sourceConfig = { type: 'url', url: tableURL };
            }
            const tableWithSource = { ...table, source: sourceConfig };
            setTableLoading(true);
            try {
                await dispatch(loadTable({ table: tableWithSource }));
            } finally {
                setTableLoading(false);
            }
            handleClose();
        }
    };

    const handleURLLoadAllTables = async (): Promise<void> => {
        if (!urlPreviewTables || urlPreviewTables.length === 0) {
            return;
        }
        setTableLoading(true);
        try {
            for (let i = 0; i < urlPreviewTables.length; i++) {
                const table = urlPreviewTables[i];
                let sourceConfig: DataSourceConfig;
                if (urlAutoRefresh) {
                    sourceConfig = { 
                        type: 'stream', 
                        url: tableURL,
                        autoRefresh: true,
                        refreshIntervalSeconds: urlRefreshInterval,
                        lastRefreshed: Date.now()
                    };
                } else {
                    sourceConfig = { type: 'url', url: tableURL };
                }
                const tableWithSource = { ...table, source: sourceConfig };
                await dispatch(loadTable({ table: tableWithSource }));
            }
        } finally {
            setTableLoading(false);
        }
        handleClose();
    };

    const handleRemoveUrlPreviewTable = (index: number): void => {
        setUrlPreviewTables((prev) => {
            if (!prev) return prev;
            const next = prev.filter((_, i) => i !== index);
            return next.length > 0 ? next : null;
        });
    };

    // URL validation - allow common data file extensions and API endpoints
    const hasValidUrl = (tableURL || '').trim() !== '' && (
        (tableURL || '').startsWith('http://') || (tableURL || '').startsWith('https://') || (tableURL || '').startsWith('/')
    );
    const hasMultipleFileTables = (filePreviewTables?.length || 0) > 1;
    const hasMultipleUrlTables = (urlPreviewTables?.length || 0) > 1;
    const showFilePreview = filePreviewLoading || !!filePreviewError || (filePreviewTables && filePreviewTables.length > 0);
    const showUrlPreview = urlPreviewLoading || !!urlPreviewError || (urlPreviewTables && urlPreviewTables.length > 0);
    const hasPasteContent = (pasteContent || '').trim() !== '';

    const enabledPluginsForDialog = getEnabledPlugins(serverConfig?.PLUGINS as any);

    // Get current tab title for header
    const getCurrentTabTitle = () => {
        if (activeTab.startsWith('plugin:')) {
            const pluginId = activeTab.slice(7);
            const found = enabledPluginsForDialog.find(p => p.module.id === pluginId);
            return found?.config.name || pluginId;
        }
        const tabTitles: Record<string, string> = {
            'menu': t('upload.title'),
            'explore': t('upload.sampleDatasets'),
            'upload': t('upload.uploadFile'),
            'paste': t('upload.pasteData'),
            'extract': t('upload.extractFromDocuments'),
            'url': t('upload.loadFromUrl'),
            'database': t('upload.database'),
        };
        return tabTitles[activeTab] || t('upload.addData');
    };

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            maxWidth={false}
            sx={{ 
                '& .MuiDialog-paper': { 
                    width: 1100,
                    maxWidth: '95vw',
                    height: 600, 
                    maxHeight: '90vh',
                    display: 'flex',
                    flexDirection: 'column',
                    transition: 'width 0.2s ease',
                } 
            }}
        >
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
                {activeTab !== 'menu' && (
                    <IconButton
                        size="small"
                        onClick={() => setActiveTab('menu')}
                        sx={{ mr: 0.5 }}
                    >
                        <ArrowBackIcon fontSize="small" />
                    </IconButton>
                )}
                <Typography variant="h6" component="span">
                    {activeTab === 'menu' ? t('upload.title') : getCurrentTabTitle()}
                </Typography>
                {activeTab === 'extract' && dataCleanBlocks.length > 0 && (
                    <Tooltip title={t('upload.resetExtraction')}>
                        <IconButton 
                            size="small" 
                            color='warning' 
                            sx={{
                                '&:hover': { 
                                    transform: 'rotate(180deg)', 
                                    transition: 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)' 
                                } 
                            }} 
                            onClick={() => dispatch(dfActions.resetDataCleanBlocks())}
                        >
                            <RestartAltIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                )}
                {activeTab !== 'menu' && (
                    <Tooltip title={
                        isEphemeral
                            ? t('upload.storedInBrowser', 'Data is stored in your browser (IndexedDB)')
                            : serverConfig.WORKSPACE_BACKEND === 'azure_blob'
                                ? t('upload.storedInAzure', 'Data is stored in Azure Blob Storage')
                                : t('upload.storedOnDisk', `Data is stored on disk (${serverConfig.DATA_FORMULATOR_HOME || '~/.data_formulator'})`)
                    } placement="bottom">
                        <Box sx={{ ml: 'auto', mr: 0, display: 'flex', alignItems: 'center', gap: 0.5, px: 1 }}>
                            {isEphemeral
                                ? <LanguageIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                                : serverConfig.WORKSPACE_BACKEND === 'azure_blob'
                                    ? <CloudIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                                    : <FolderOpenIcon sx={{ fontSize: 14, color: 'text.secondary' }} />}
                            <Typography variant="caption" sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>
                                {isEphemeral
                                    ? t('upload.browserLabel', 'Browser')
                                    : serverConfig.WORKSPACE_BACKEND === 'azure_blob'
                                        ? t('upload.azureLabel', 'Azure')
                                        : t('upload.diskLabel', 'Disk')}
                            </Typography>
                        </Box>
                    </Tooltip>
                )}
                <IconButton
                    sx={{ marginLeft: activeTab === 'menu' ? 'auto' : undefined }}
                    size="small"
                    onClick={handleClose}
                    aria-label="close"
                >
                    <CloseIcon fontSize="small" />
                </IconButton>
            </DialogTitle>

            <DialogContent sx={{ flex: 1, overflow: 'hidden', p: 0 }}>
                {/* Main Menu */}
                <TabPanel value={activeTab} index="menu">
                    <Box sx={{ p: 2, boxSizing: 'border-box', width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                        <DataLoadMenu 
                            onSelectTab={(tab) => setActiveTab(tab)}
                            serverConfig={serverConfig}
                            variant="dialog"
                            hideSampleDatasets={hideSampleDatasets}
                        />
                    </Box>
                </TabPanel>

                {/* Upload File Tab */}
                <TabPanel value={activeTab} index="upload">
                    <Box sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        height: '100%',
                        boxSizing: 'border-box',
                        gap: 2,
                        p: 2,
                        justifyContent: showFilePreview ? 'flex-start' : 'center',
                    }}>
                        <Box sx={{ width: '100%', maxWidth: showFilePreview ? '60%' : 760, alignSelf: 'center', display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <Input
                            inputProps={{ 
                                accept: '.csv,.tsv,.json,.xlsx,.xls',
                                multiple: true,
                            }}
                            id="unified-upload-data-file"
                            type="file"
                            sx={{ display: 'none' }}
                            inputRef={fileInputRef}
                            onChange={handleFileInputChange}
                        />
                        
                        {/* File Upload Section */}
                        <Box
                            sx={{
                                border: '2px dashed',
                                borderColor: isDragOver ? 'primary.main' : borderColor.divider,
                                borderRadius: radius.md,
                                p: showFilePreview ? 2 : 3,
                                textAlign: 'center',
                                cursor: 'pointer',
                                transition: transition.normal,
                                backgroundColor: isDragOver ? alpha(theme.palette.primary.main, 0.08) : 'transparent',
                                '&:hover': {
                                    borderColor: 'primary.main',
                                    backgroundColor: alpha(theme.palette.primary.main, 0.04),
                                }
                            }}
                            onClick={() => fileInputRef.current?.click()}
                            onDrop={handleFileDrop}
                            onDragOver={handleDragOver}
                            onDragEnter={handleDragEnter}
                            onDragLeave={handleDragLeave}
                        >
                            <UploadFileIcon sx={{ fontSize: showFilePreview ? 28 : 36, color: 'text.secondary', mb: 1 }} />
                            <Typography variant={showFilePreview ? "body2" : "subtitle1"} gutterBottom>
                                {t('upload.dragDrop')}
                            </Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ fontSize: showFilePreview ? '0.75rem' : '0.875rem' }}>
                                {t('upload.or')} <Link component="button" sx={{ textDecoration: 'underline', cursor: 'pointer' }}>{t('upload.browse')}</Link>
                            </Typography>
                            {!showFilePreview && (
                                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                                    {t('upload.supportedFormats')}
                                </Typography>
                            )}
                        </Box>
                        </Box>

                        {showFilePreview && (
                            <Box sx={{ width: '90%', alignSelf: 'center' }}>
                                <MultiTablePreview
                                    loading={filePreviewLoading}
                                    error={filePreviewError}
                                    tables={filePreviewTables}
                                    emptyLabel={t('upload.selectFileToPreview')}
                                    onRemoveTable={handleRemoveFilePreviewTable}
                                    activeIndex={filePreviewActiveIndex}
                                    onActiveIndexChange={setFilePreviewActiveIndex}
                                />
                            </Box>
                        )}

                        {filePreviewTables && filePreviewTables.length > 0 && (
                            <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1, alignItems: 'center' }}>
                                <Button
                                    variant="outlined"
                                    onClick={handleFileLoadSingleTable}
                                    disabled={filePreviewLoading || tableLoading}
                                    startIcon={tableLoading ? <CircularProgress size={16} /> : undefined}
                                    sx={{ textTransform: 'none', width: 240 }}
                                >
                                    {tableLoading ? t('upload.loadingTable') : t('upload.loadTable')}
                                </Button>
                                {hasMultipleFileTables && (
                                    <Button
                                        variant="contained"
                                        onClick={handleFileLoadAllTables}
                                        disabled={filePreviewLoading || tableLoading}
                                        startIcon={tableLoading ? <CircularProgress size={16} color="inherit" /> : undefined}
                                        sx={{ textTransform: 'none', width: 240 }}
                                    >
                                        {tableLoading ? t('upload.loadingTable') : t('upload.loadAllTables')}
                                    </Button>
                                )}
                            </Box>
                        )}
                    </Box>
                </TabPanel>

                {/* URL Tab */}
                <TabPanel value={activeTab} index="url">
                    <Box sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        height: '100%',
                        boxSizing: 'border-box',
                        gap: 2,
                        p: 2,
                        justifyContent: showUrlPreview ? 'flex-start' : 'center',
                    }}>
                        <Box sx={{ width: '100%', maxWidth: showUrlPreview ? '80%' : 760, alignSelf: 'center', display: 'flex', flexDirection: 'column', gap: 2 }}>
                            {/* URL Input */}
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <TextField
                                        fullWidth
                                        placeholder={t('upload.placeholder.url')}
                                        value={tableURL || ''}
                                        onChange={(e) => setTableURL((e.target.value || '').trim())}
                                        inputRef={urlInputRef}
                                        error={tableURL !== "" && !hasValidUrl}
                                        helperText={tableURL !== "" && !hasValidUrl ? t('upload.helperText.urlInvalid') : undefined}
                                        size="small"
                                        sx={{ 
                                            flex: 1,
                                            '& .MuiInputBase-input': {
                                                fontSize: '0.875rem',
                                            },
                                            '& .MuiInputBase-input::placeholder': {
                                                fontSize: '0.875rem',
                                            },
                                        }}
                                    />
                                    <Button
                                        variant="outlined"
                                        size="small"
                                        onClick={() => handleURLPreview(tableURL || '')}
                                        disabled={!hasValidUrl || urlPreviewLoading}
                                        sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
                                    >
                                        {t('upload.preview')}
                                    </Button>
                                </Box>
                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', ml: 0.5 }}>
                                    {t('upload.urlFormatHint')}
                                </Typography>
                            </Box>
                            
                            {/* Watch/Auto-refresh options - always visible */}
                            <Paper variant="outlined" sx={{ p: 2, borderRadius: 1 }}>
                                <Box sx={{ display: 'flex', flexDirection: 'row', gap: 1, alignItems: 'center', height: 24 }}>
                                    <FormControlLabel
                                        control={
                                            <Switch
                                                checked={urlAutoRefresh}
                                                onChange={(e) => setUrlAutoRefresh(e.target.checked)}
                                                size="small"
                                            />
                                        }
                                        label={
                                            <Typography component="span" variant="body2" sx={{ fontWeight: 500 }}>
                                                {t('upload.watchMode')}
                                            </Typography>
                                        }
                                    />
                                    {urlAutoRefresh ? (
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, }}>
                                            <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8rem' }}>
                                                {t('upload.checkUpdatesEvery')}
                                            </Typography>
                                            {[
                                                { seconds: 5, label: '5s' },
                                                { seconds: 15, label: '15s' },
                                                { seconds: 30, label: '30s' },
                                                { seconds: 60, label: '1m' },
                                                { seconds: 300, label: '5m' },
                                                { seconds: 600, label: '10m' },
                                                { seconds: 1800, label: '30m' },
                                                { seconds: 3600, label: '1h' },
                                                { seconds: 86400, label: '24h' },
                                            ].map((opt) => (
                                                <Chip
                                                    key={opt.seconds}
                                                    label={opt.label}
                                                    size="small"
                                                    variant={urlRefreshInterval === opt.seconds ? 'filled' : 'outlined'}
                                                    color={urlRefreshInterval === opt.seconds ? 'primary' : 'default'}
                                                    onClick={() => setUrlRefreshInterval(opt.seconds)}
                                                    sx={{ 
                                                        cursor: 'pointer', 
                                                        fontSize: '0.7rem',
                                                        height: 24,
                                                    }}
                                                />
                                            ))}
                                        </Box>
                                    ) : <Typography component="span" variant="caption" color="text.secondary">
                                        {t('upload.watchHint')}
                                    </Typography>}
                                    
                                </Box>
                            </Paper>

                            {/* Example APIs - Compact List */}
                            {(!urlPreviewTables || urlPreviewTables.length === 0) && !urlPreviewLoading && (
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                    <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>
                                        {t('upload.tryExamples')}
                                    </Typography>
                                    <Box component="ul" sx={{ 
                                        listStyle: 'none', 
                                        padding: 0, 
                                        margin: 0,
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 0.25,
                                    }}>
                                        {exampleUrls.map((example) => (
                                            <Box
                                                component="li"
                                                key={example.url}
                                                onClick={() => {
                                                    console.log('example', example);
                                                    if (example.url) {
                                                        
                                                        setTableURL(example.url);
                                                        setUrlAutoRefresh(true);
                                                        setUrlRefreshInterval(example.refreshSeconds || 60);
                                                        handleURLPreview(example.url);
                                                    }
                                                }}
                                                sx={{
                                                    cursor: 'pointer',
                                                    '&::before': {
                                                        content: '"• "',
                                                        color: 'text.secondary',
                                                        marginRight: 0.5,
                                                    }
                                                }}
                                            >
                                                <Typography 
                                                    component="span"
                                                    variant="caption" 
                                                    sx={{ 
                                                        fontSize: '0.75rem',
                                                        color: 'primary.main',
                                                        textDecoration: 'none',
                                                        '&:hover': {
                                                            textDecoration: 'underline',
                                                        }
                                                    }}
                                                >
                                                    {example.label}
                                                </Typography>
                                                {example.resetUrl && (
                                                    <Typography
                                                        component="span"
                                                        variant="caption"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            fetchWithIdentity(`${window.location.origin}${example.resetUrl}`, { method: 'POST' })
                                                                .then(() => {
                                                                    console.log('Reset successful');
                                                                })
                                                                .catch(err => console.error('Reset failed:', err));
                                                        }}
                                                        sx={{
                                                            fontSize: '0.7rem',
                                                            color: 'text.secondary',
                                                            ml: 1,
                                                            cursor: 'pointer',
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            gap: 0.25,
                                                            '&:hover': { color: 'warning.main' },
                                                        }}
                                                    >
                                                        <RestartAltIcon sx={{ fontSize: 12 }} />
                                                        {t('upload.resetLabel')}
                                                    </Typography>
                                                )}
                                            </Box>
                                        ))}
                                    </Box>
                                </Box>
                            )}
                        </Box>

                        {showUrlPreview && (
                            <Box sx={{ width: '90%', alignSelf: 'center' }}>
                                <MultiTablePreview
                                    loading={urlPreviewLoading}
                                    error={urlPreviewError}
                                    tables={urlPreviewTables}
                                    emptyLabel={t('upload.enterUrlToPreview')}
                                    onRemoveTable={handleRemoveUrlPreviewTable}
                                    activeIndex={urlPreviewActiveIndex}
                                    onActiveIndexChange={setUrlPreviewActiveIndex}
                                />
                            </Box>
                        )}

                        {urlPreviewTables && urlPreviewTables.length > 0 && (
                            <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1, alignItems: 'center' }}>
                                {urlAutoRefresh && (
                                    <Typography variant="caption" color="success.main" sx={{ mr: 1 }}>
                                        <StreamIcon sx={{ fontSize: 14, verticalAlign: 'middle', mr: 0.5 }} />
                                        {t('upload.watchModeStatus')} {urlRefreshInterval < 60 ? `${urlRefreshInterval}s` : `${Math.floor(urlRefreshInterval / 60)}m`}
                                    </Typography>
                                )}
                                <Button
                                    variant="contained"
                                    onClick={handleURLLoadSingleTable}
                                    disabled={urlPreviewLoading || tableLoading}
                                    startIcon={tableLoading ? <CircularProgress size={16} color="inherit" /> : undefined}
                                    sx={{ textTransform: 'none', width: 240 }}
                                >
                                    {tableLoading ? t('upload.loadingTable') : t('upload.loadTable')}
                                </Button>
                                {hasMultipleUrlTables && (
                                    <Button
                                        variant="contained"
                                        size="small"
                                        onClick={handleURLLoadAllTables}
                                        disabled={urlPreviewLoading || tableLoading}
                                        startIcon={tableLoading ? <CircularProgress size={16} color="inherit" /> : undefined}
                                        sx={{ textTransform: 'none' }}
                                    >
                                        {tableLoading ? t('upload.loadingTable') : t('upload.loadAllTables')}
                                    </Button>
                                )}
                            </Box>
                        )}
                    </Box>
                </TabPanel>

                {/* Paste Data Tab */}
                <TabPanel value={activeTab} index="paste">
                    <Box sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        height: '100%',
                        boxSizing: 'border-box',
                        p: 2,
                        justifyContent: hasPasteContent ? 'flex-start' : 'center',
                        alignItems: hasPasteContent ? 'stretch' : 'center',
                    }}>
                        {isLargeContent && (
                            <Box sx={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                mb: 1, 
                                p: 1, 
                                backgroundColor: 'rgba(255, 193, 7, 0.1)', 
                                borderRadius: 1 
                            }}>
                                <Typography variant="caption" sx={{ flex: 1 }}>
                                    {t('upload.largeContentDetected', { size: Math.round(pasteContent.length / 1000) })}{' '}
                                    {showFullContent ? t('upload.showingFullContent') : t('upload.showingPreview')}
                                </Typography>
                                <Button 
                                    size="small" 
                                    variant="outlined" 
                                    onClick={toggleFullContent}
                                    sx={{ textTransform: 'none', minWidth: 'auto' }}
                                >
                                    {showFullContent ? t('upload.showPreview') : t('upload.showFull')}
                                </Button>
                            </Box>
                        )}

                        <Box sx={{ width: '100%', maxWidth: hasPasteContent ? 'none' : 720 }}>
                            <TextField
                                autoFocus
                                multiline
                                fullWidth
                                value={pasteContent}
                                onChange={handleContentChange}
                                placeholder={t('upload.placeholder.paste')}
                                InputProps={{
                                    readOnly: isLargeContent && !showFullContent,
                                }}
                                sx={{
                                    flex: hasPasteContent ? 1 : 'none',
                                    '& .MuiInputBase-root': {
                                        height: hasPasteContent ? '100%' : 220,
                                        alignItems: 'flex-start',
                                    },
                                    '& .MuiInputBase-input': {
                                        fontSize: 12,
                                        fontFamily: 'monospace',
                                        height: hasPasteContent ? '100% !important' : 'auto !important',
                                        overflow: 'auto !important',
                                    },
                                    '& .MuiInputBase-input[readonly]': {
                                        cursor: 'not-allowed',
                                    }
                                }}
                            />
                            {/* Show preview indicator when in preview mode */}
                            {isLargeContent && !showFullContent && (
                                <Box sx={{ 
                                    mt: 0.5, 
                                    px: 1, 
                                    py: 0.5, 
                                    backgroundColor: alpha(theme.palette.info.main, 0.08),
                                    borderRadius: 0.5,
                                    border: `1px solid ${alpha(theme.palette.info.main, 0.2)}`
                                }}>
                                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                                        {t('upload.previewMode')}
                                    </Typography>
                                </Box>
                            )}
                        </Box>

                        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2, gap: 1 }}>
                            <Button
                                variant="contained"
                                onClick={handlePasteSubmit}
                                disabled={(pasteContent || '').trim() === '' || tableLoading}
                                startIcon={tableLoading ? <CircularProgress size={16} color="inherit" /> : undefined}
                                sx={{ textTransform: 'none' }}
                            >
                                {tableLoading ? t('upload.loadingTable') : t('upload.uploadData')}
                            </Button>
                        </Box>
                    </Box>
                </TabPanel>

                {/* Database Tab */}
                <TabPanel value={activeTab} index="database">
                    <DBManagerPane onClose={handleClose} />
                </TabPanel>

                {/* Plugin Tabs */}
                {enabledPluginsForDialog.map(({ module, config }) => (
                    <TabPanel key={module.id} value={activeTab} index={`plugin:${module.id}` as UploadTabType}>
                        <PluginHost
                            module={module}
                            config={config}
                            onDataLoaded={async (info) => {
                                dispatch(loadPluginTable({ tableName: info.tableName, pluginId: info.source }));
                                handleClose();
                            }}
                            onClose={handleClose}
                        />
                    </TabPanel>
                ))}

                {/* Extract Data Tab */}
                <TabPanel value={activeTab} index="extract">
                    <DataLoadingChat />
                </TabPanel>

                {/* Explore Sample Datasets Tab */}
                <TabPanel value={activeTab} index="explore">
                    <Box sx={{ p: 2, height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
                        <DatasetSelectionView 
                        datasets={datasetPreviews} 
                        hideRowNum
                        handleSelectDataset={async (dataset) => {
                            // Check if this is a live dataset
                            const isLiveDataset = dataset.live === true;
                            
                            setDatasetLoading(true);
                            setDatasetLoadingLabel(t('upload.loadingDataset', { name: dataset.name }));
                            
                            try {
                                const loadPromises = dataset.tables.map(async (table) => {
                                    // For live datasets with relative URLs, construct full URL
                                    let fullUrl = table.url;
                                    if (table.url.startsWith('/')) {
                                        fullUrl = window.location.origin + table.url;
                                    }
                                    
                                    const res = await fetch(fullUrl);
                                    const textData = await res.text();
                                    let tableName = table.url.split("/").pop()?.split(".")[0]?.split("?")[0] || 'table-' + Date.now().toString().substring(0, 8);
                                    let dictTable;
                                    if (table.format == "csv") {
                                        dictTable = createTableFromText(tableName, textData);
                                    } else if (table.format == "json") {
                                        dictTable = createTableFromFromObjectArray(tableName, JSON.parse(textData), true);
                                    } 
                                    if (dictTable) {
                                        // For live datasets, set up as stream source with auto-refresh
                                        if (isLiveDataset) {
                                            dictTable.source = { 
                                                type: 'stream', 
                                                url: fullUrl,
                                                autoRefresh: true,
                                                refreshIntervalSeconds: dataset.refreshIntervalSeconds || 60,
                                                lastRefreshed: Date.now()
                                            };
                                        } else {
                                            // Regular example data
                                            dictTable.source = { type: 'example', url: table.url };
                                        }
                                        await dispatch(loadTable({ table: dictTable }));
                                    }
                                });
                                await Promise.all(loadPromises);
                            } catch (error) {
                                console.error('Failed to load dataset:', error);
                            } finally {
                                setDatasetLoading(false);
                                setDatasetLoadingLabel('');
                            }
                            handleClose();
                        }}
                        />
                    </Box>
                </TabPanel>

            </DialogContent>

            {/* Loading overlay for dataset loading */}
            <Backdrop
                open={datasetLoading}
                sx={{
                    position: 'absolute',
                    zIndex: (theme) => theme.zIndex.drawer + 1,
                    backgroundColor: 'rgba(255, 255, 255, 0.85)',
                    backdropFilter: 'blur(4px)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                }}
            >
                <CircularProgress size={36} />
                <Typography variant="body2" color="text.secondary">
                    {datasetLoadingLabel || t('upload.loadingData')}
                </Typography>
                <Button
                    variant="text"
                    size="small"
                    onClick={() => { setDatasetLoading(false); setDatasetLoadingLabel(''); }}
                    sx={{ mt: 1, textTransform: 'none', color: 'text.secondary' }}
                >
                    {t('app.cancel')}
                </Button>
            </Backdrop>
        </Dialog>
    );
};

export default UnifiedDataUploadDialog;
