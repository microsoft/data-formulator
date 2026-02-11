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

import { useDispatch, useSelector } from 'react-redux';
import { DataFormulatorState, dfActions, fetchFieldSemanticType } from '../app/dfSlice';
import { AppDispatch } from '../app/store';
import { loadTable } from '../app/tableThunks';
import { DataSourceConfig, DictTable } from '../components/ComponentType';
import { createTableFromFromObjectArray, createTableFromText, loadTextDataWrapper, loadBinaryDataWrapper } from '../data/utils';
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
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import LanguageIcon from '@mui/icons-material/Language';

export type UploadTabType = 'menu' | 'upload' | 'paste' | 'url' | 'database' | 'extract' | 'explore';

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
                transition: transition.fast,
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                '&:hover': disabled ? {} : {
                    borderColor: 'primary.main',
                    backgroundColor: alpha(theme.palette.primary.main, 0.04),
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
    serverConfig?: { DISABLE_DATABASE?: boolean };
    variant?: 'dialog' | 'page'; // 'dialog' uses smaller cards, 'page' uses larger cards
}

export const DataLoadMenu: React.FC<DataLoadMenuProps> = ({ 
    onSelectTab, 
    serverConfig = { DISABLE_DATABASE: false },
    variant = 'dialog'
}) => {
    const theme = useTheme();
    // Data source configurations
    const regularDataSources = [
        { 
            value: 'explore' as UploadTabType, 
            title: 'Sample Datasets', 
            description: 'Explore and load curated example datasets',
            icon: <ExploreIcon />, 
            disabled: false
        },
        { 
            value: 'upload' as UploadTabType, 
            title: 'Upload File', 
            description: 'Upload local files (CSV, TSV, JSON, Excel)',
            icon: <UploadFileIcon />, 
            disabled: false
        },
        { 
            value: 'paste' as UploadTabType, 
            title: 'Paste Data', 
            description: 'Paste tabular data directly from clipboard',
            icon: <ContentPasteIcon />, 
            disabled: false
        },
        { 
            value: 'extract' as UploadTabType, 
            title: 'Extract Unstructured Data', 
            description: 'Extract tables from images or text using AI',
            icon: <ImageSearchIcon />, 
            disabled: false
        },
    ];

    const liveDataSources = [
        { 
            value: 'url' as UploadTabType, 
            title: 'Load from URL', 
            description: 'Load data from a URL with optional auto-refresh',
            icon: <LinkIcon />, 
            disabled: false
        },
        { 
            value: 'database' as UploadTabType, 
            title: 'Database', 
            description: 'Connect to databases or data services',
            icon: <StorageIcon />, 
            disabled: false
        },
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
                    }, }} /> Connect to live data sources
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
                    Load local data
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
                Local data
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
                }, }} /> Or connect to a data source (with optional auto-refresh)
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
}

export const UnifiedDataUploadDialog: React.FC<UnifiedDataUploadDialogProps> = ({
    open,
    onClose,
    initialTab = 'menu',
}) => {
    const theme = useTheme();
    const dispatch = useDispatch<AppDispatch>();
    const existingTables = useSelector((state: DataFormulatorState) => state.tables);
    const serverConfig = useSelector((state: DataFormulatorState) => state.serverConfig);
    const dataCleanBlocks = useSelector((state: DataFormulatorState) => state.dataCleanBlocks);
    const frontendRowLimit = useSelector((state: DataFormulatorState) => state.config?.frontendRowLimit ?? 10000);
    const existingNames = new Set(existingTables.map(t => t.id));

    const [activeTab, setActiveTab] = useState<UploadTabType>(initialTab === 'menu' ? 'menu' : initialTab);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const urlInputRef = useRef<HTMLInputElement>(null);

    // Store on server toggle (forced off when DISABLE_DATABASE)
    const diskPersistenceDisabled = serverConfig.DISABLE_DATABASE;
    const [storeOnServer, setStoreOnServer] = useState<boolean>(!diskPersistenceDisabled);

    // Paste tab state
    const [pasteContent, setPasteContent] = useState<string>("");
    const [isLargeContent, setIsLargeContent] = useState<boolean>(false);
    const [showFullContent, setShowFullContent] = useState<boolean>(false);
    const [isOverSizeLimit, setIsOverSizeLimit] = useState<boolean>(false);
    
    // File preview state
    const [filePreviewTables, setFilePreviewTables] = useState<DictTable[] | null>(null);
    const [filePreviewLoading, setFilePreviewLoading] = useState<boolean>(false);
    const [filePreviewError, setFilePreviewError] = useState<string | null>(null);
    const [filePreviewFiles, setFilePreviewFiles] = useState<File[]>([]);
    const [filePreviewActiveIndex, setFilePreviewActiveIndex] = useState<number>(0);

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

    // Constants
    const MAX_DISPLAY_LINES = 20;
    const LARGE_CONTENT_THRESHOLD = 50000;
    const MAX_CONTENT_SIZE = 2 * 1024 * 1024;

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
        setIsOverSizeLimit(false);
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

    // File upload handler
    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>): void => {
        const files = event.target.files;

        if (files && files.length > 0) {
            const selectedFiles = Array.from(files);
            setFilePreviewFiles(selectedFiles);
            setFilePreviewError(null);
            setFilePreviewTables(null);
            setFilePreviewLoading(true);

            const MAX_FILE_SIZE = 5 * 1024 * 1024;
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

                    if (file.size > MAX_FILE_SIZE && isTextFile) {
                        errors.push(`File ${file.name} is too large (${(file.size / (1024 * 1024)).toFixed(2)}MB). Use Database for large files.`);
                        continue;
                    }

                    if (isTextFile) {
                        try {
                            const text = await file.text();
                            const table = loadTextDataWrapper(uniqueName, text, file.type);
                            if (table) {
                                previewTables.push(table);
                            } else {
                                errors.push(`Failed to parse ${file.name}.`);
                            }
                        } catch {
                            errors.push(`Failed to read ${file.name}.`);
                        }
                        continue;
                    }

                    if (isExcelFile) {
                        try {
                            const arrayBuffer = await file.arrayBuffer();
                            const tables = await loadBinaryDataWrapper(uniqueName, arrayBuffer);
                            if (tables.length > 0) {
                                previewTables.push(...tables);
                            } else {
                                errors.push(`Failed to parse Excel file ${file.name}.`);
                            }
                        } catch {
                            errors.push(`Failed to parse Excel file ${file.name}.`);
                        }
                        continue;
                    }

                    errors.push(`Unsupported file format: ${file.name}.`);
                }

                setFilePreviewTables(previewTables.length > 0 ? previewTables : null);
                setFilePreviewError(errors.length > 0 ? errors.join(' ') : null);
                setFilePreviewLoading(false);
            };

            processFiles();
        }
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

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

    const handleFileLoadSingleTable = (): void => {
        if (!filePreviewTables || filePreviewTables.length === 0) {
            return;
        }
        const table = filePreviewTables[filePreviewActiveIndex];
        if (table) {
            const sourceConfig: DataSourceConfig = { type: 'file', fileName: filePreviewFiles[0]?.name };
            const tableWithSource = { ...table, source: sourceConfig };
            dispatch(loadTable({
                table: tableWithSource,
                storeOnServer,
                file: storeOnServer ? filePreviewFiles[filePreviewActiveIndex] || filePreviewFiles[0] : undefined,
            }));
            handleClose();
        }
    };

    const handleFileLoadAllTables = (): void => {
        if (!filePreviewTables || filePreviewTables.length === 0) {
            return;
        }
        for (let i = 0; i < filePreviewTables.length; i++) {
            const table = filePreviewTables[i];
            const sourceConfig: DataSourceConfig = { type: 'file', fileName: filePreviewFiles[i]?.name || filePreviewFiles[0]?.name };
            const tableWithSource = { ...table, source: sourceConfig };
            dispatch(loadTable({
                table: tableWithSource,
                storeOnServer,
                file: storeOnServer ? filePreviewFiles[i] || filePreviewFiles[0] : undefined,
            }));
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
        
        const contentSizeBytes = new Blob([newContent]).size;
        const isOverLimit = contentSizeBytes > MAX_CONTENT_SIZE;
        setIsOverSizeLimit(isOverLimit);
        
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

    const handlePasteSubmit = (): void => {
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
            dispatch(loadTable({ table: tableWithSource, storeOnServer }));
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
                    setUrlPreviewError('Unable to parse data from the provided URL. Please ensure the URL points to CSV, JSON, or JSONL data.');
                }
            })
            .catch((err) => {
                setUrlPreviewError(`Failed to fetch data: ${err.message}. Please ensure the URL points to CSV, JSON, or JSONL data.`);
            })
            .finally(() => {
                setUrlPreviewLoading(false);
            });
    };


    // URL tab load handlers
    const handleURLLoadSingleTable = (): void => {
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
            dispatch(loadTable({ table: tableWithSource, storeOnServer }));
            handleClose();
        }
    };

    const handleURLLoadAllTables = (): void => {
        if (!urlPreviewTables || urlPreviewTables.length === 0) {
            return;
        }
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
            dispatch(loadTable({ table: tableWithSource, storeOnServer }));
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

    // Get current tab title for header
    const getCurrentTabTitle = () => {
        const tabTitles: Record<UploadTabType, string> = {
            'menu': 'Load Data',
            'explore': 'Sample Datasets',
            'upload': 'Upload File',
            'paste': 'Paste Data',
            'extract': 'Extract from Documents',
            'url': 'Load from URL',
            'database': 'Database',
        };
        return tabTitles[activeTab] || 'Add Data';
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
                    {activeTab === 'menu' ? 'Load Data' : getCurrentTabTitle()}
                </Typography>
                {activeTab === 'extract' && dataCleanBlocks.length > 0 && (
                    <Tooltip title="Reset extraction">
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
                    <Box sx={{ ml: 'auto', mr: 0, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Typography variant="caption" sx={{ fontSize: '0.7rem', color: 'text.secondary', mr: 0.5 }}>
                            Load data in
                        </Typography>
                        <ToggleButtonGroup
                            value={storeOnServer ? 'disk' : 'browser'}
                            exclusive
                            onChange={(_, val) => { if (val) setStoreOnServer(val === 'disk'); }}
                            size="small"
                            sx={{ height: 26, '& .MuiToggleButton-root': { textTransform: 'none', fontSize: '0.7rem', px: 1, py: 0 } }}
                        >
                            <ToggleButton value="browser">
                                <Tooltip title={`Data stays in browser only (limited to ${frontendRowLimit.toLocaleString()} rows)`} placement="bottom">
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        <LanguageIcon sx={{ fontSize: 14 }} /> Browser
                                    </Box>
                                </Tooltip>
                            </ToggleButton>
                            <ToggleButton value="disk" disabled={diskPersistenceDisabled}>
                                <Tooltip title={diskPersistenceDisabled
                                    ? 'Install Data Formulator locally to unlock analysis for large datasets'
                                    : `Data stored in workspace on disk (supports large tables)`} placement="bottom">
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        <FolderOpenIcon sx={{ fontSize: 14 }} /> Disk
                                    </Box>
                                </Tooltip>
                            </ToggleButton>
                        </ToggleButtonGroup>
                        {storeOnServer && !diskPersistenceDisabled && serverConfig.DATA_FORMULATOR_HOME && (
                            <Tooltip title={`Open workspace: ${serverConfig.DATA_FORMULATOR_HOME}`} placement="bottom">
                                <IconButton
                                    size="small"
                                    onClick={() => {
                                        fetchWithIdentity(getUrls().OPEN_WORKSPACE, { method: 'POST' }).catch(() => {});
                                    }}
                                    sx={{ p: 0.5 }}
                                >
                                    <OpenInNewIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                                </IconButton>
                            </Tooltip>
                        )}
                    </Box>
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
                            onChange={handleFileUpload}
                        />
                        
                        {/* File Upload Section - only show drop zone when file upload is enabled */}
                        {!serverConfig.DISABLE_FILE_UPLOAD ? (
                            <Box
                                sx={{
                                    border: '2px dashed',
                                    borderColor: borderColor.divider,
                                    borderRadius: radius.md,
                                    p: showFilePreview ? 2 : 3,
                                    textAlign: 'center',
                                    cursor: 'pointer',
                                    transition: transition.normal,
                                    '&:hover': {
                                        borderColor: 'primary.main',
                                        backgroundColor: alpha(theme.palette.primary.main, 0.04),
                                    }
                                }}
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <UploadFileIcon sx={{ fontSize: showFilePreview ? 28 : 36, color: 'text.secondary', mb: 1 }} />
                                <Typography variant={showFilePreview ? "body2" : "subtitle1"} gutterBottom>
                                    Drag & drop file here
                                </Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ fontSize: showFilePreview ? '0.75rem' : '0.875rem' }}>
                                    or <Link component="button" sx={{ textDecoration: 'underline', cursor: 'pointer' }}>Browse</Link>
                                </Typography>
                                {!showFilePreview && (
                                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                                        Supported: CSV, TSV, JSON, Excel (xlsx, xls)
                                    </Typography>
                                )}
                            </Box>
                        ) : (
                            <Box sx={{ textAlign: 'center', py: 4, px: 2 }}>
                                <Typography color="text.secondary" sx={{ mb: 2 }}>
                                    File upload is disabled in this environment.
                                </Typography>
                                <Typography variant="body2" color="text.secondary">
                                    Use "Load from URL" to load data from a remote source.
                                </Typography>
                            </Box>
                        )}
                        </Box>

                        {showFilePreview && (
                            <Box sx={{ width: '90%', alignSelf: 'center' }}>
                                <MultiTablePreview
                                    loading={filePreviewLoading}
                                    error={filePreviewError}
                                    tables={filePreviewTables}
                                    emptyLabel="Select a file to preview."
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
                                    disabled={filePreviewLoading}
                                    sx={{ textTransform: 'none', width: 240 }}
                                >
                                    Load Table
                                </Button>
                                {hasMultipleFileTables && (
                                    <Button
                                        variant="contained"
                                        onClick={handleFileLoadAllTables}
                                        disabled={filePreviewLoading}
                                        sx={{ textTransform: 'none', width: 240 }}
                                    >
                                        Load All Tables
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
                                        placeholder="Enter URL: https://example.com/data.json or /api/data"
                                        value={tableURL || ''}
                                        onChange={(e) => setTableURL((e.target.value || '').trim())}
                                        inputRef={urlInputRef}
                                        error={tableURL !== "" && !hasValidUrl}
                                        helperText={tableURL !== "" && !hasValidUrl ? "Enter a valid URL starting with http://, https://, or /" : undefined}
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
                                        Preview
                                    </Button>
                                </Box>
                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', ml: 0.5 }}>
                                    The URL must point to data in CSV, JSON, or JSONL format
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
                                                Watch Mode
                                            </Typography>
                                        }
                                    />
                                    {urlAutoRefresh ? (
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, }}>
                                            <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8rem' }}>
                                                check data updates every
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
                                        automatically check and refresh data from the URL at regular intervals
                                    </Typography>}
                                    
                                </Box>
                            </Paper>

                            {/* Example APIs - Compact List */}
                            {(!urlPreviewTables || urlPreviewTables.length === 0) && !urlPreviewLoading && (
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                    <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>
                                        Try examples:
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
                                                        reset
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
                                    emptyLabel="Enter a URL and click Preview to see data."
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
                                        Watch mode: {urlRefreshInterval < 60 ? `${urlRefreshInterval}s` : `${Math.floor(urlRefreshInterval / 60)}m`}
                                    </Typography>
                                )}
                                <Button
                                    variant="contained"
                                    onClick={handleURLLoadSingleTable}
                                    disabled={urlPreviewLoading}
                                    sx={{ textTransform: 'none', width: 240 }}
                                >
                                    Load Table
                                </Button>
                                {hasMultipleUrlTables && (
                                    <Button
                                        variant="contained"
                                        size="small"
                                        onClick={handleURLLoadAllTables}
                                        disabled={urlPreviewLoading}
                                        sx={{ textTransform: 'none' }}
                                    >
                                        Load All Tables
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
                        {isOverSizeLimit && (
                            <Box sx={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                mb: 1, 
                                p: 1, 
                                backgroundColor: 'rgba(244, 67, 54, 0.1)', 
                                borderRadius: 1, 
                                border: '1px solid rgba(244, 67, 54, 0.3)' 
                            }}>
                                <Typography variant="caption" sx={{ flex: 1, color: 'error.main', fontWeight: 500 }}>
                                    ⚠️ Content exceeds {(MAX_CONTENT_SIZE / (1024 * 1024)).toFixed(0)}MB size limit. 
                                    Current size: {(new Blob([pasteContent]).size / (1024 * 1024)).toFixed(2)}MB. 
                                    Please use the DATABASE tab for large datasets.
                                </Typography>
                            </Box>
                        )}
                        
                        {isLargeContent && !isOverSizeLimit && (
                            <Box sx={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                mb: 1, 
                                p: 1, 
                                backgroundColor: 'rgba(255, 193, 7, 0.1)', 
                                borderRadius: 1 
                            }}>
                                <Typography variant="caption" sx={{ flex: 1 }}>
                                    Large content detected ({Math.round(pasteContent.length / 1000)}KB). 
                                    {showFullContent ? 'Showing full content (may be slow)' : 'Showing preview for performance'}
                                </Typography>
                                <Button 
                                    size="small" 
                                    variant="outlined" 
                                    onClick={toggleFullContent}
                                    sx={{ textTransform: 'none', minWidth: 'auto' }}
                                >
                                    {showFullContent ? 'Show Preview' : 'Show Full'}
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
                                placeholder="Paste your data here (CSV, TSV, or JSON format)"
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
                                        Preview mode: Editing disabled. Click "Show Full" to enable editing.
                                    </Typography>
                                </Box>
                            )}
                        </Box>

                        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2, gap: 1 }}>
                            <Button
                                variant="contained"
                                onClick={handlePasteSubmit}
                                disabled={(pasteContent || '').trim() === '' || isOverSizeLimit}
                                sx={{ textTransform: 'none' }}
                            >
                                Upload Data
                            </Button>
                        </Box>
                    </Box>
                </TabPanel>

                {/* Database Tab */}
                <TabPanel value={activeTab} index="database">
                    <DBManagerPane onClose={handleClose} storeOnServer={storeOnServer} />
                </TabPanel>

                {/* Extract Data Tab */}
                <TabPanel value={activeTab} index="extract">
                    <DataLoadingChat storeOnServer={storeOnServer} />
                </TabPanel>

                {/* Explore Sample Datasets Tab */}
                <TabPanel value={activeTab} index="explore">
                    <Box sx={{ p: 2, height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
                        <DatasetSelectionView 
                        datasets={datasetPreviews} 
                        hideRowNum
                        handleSelectDataset={(dataset) => {
                            // Check if this is a live dataset
                            const isLiveDataset = dataset.live === true;
                            
                            for (let table of dataset.tables) {
                                // For live datasets with relative URLs, construct full URL
                                let fullUrl = table.url;
                                if (table.url.startsWith('/')) {
                                    fullUrl = window.location.origin + table.url;
                                }
                                
                                fetch(fullUrl)
                                    .then(res => res.text())
                                    .then(textData => {
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
                                            dispatch(loadTable({ table: dictTable, storeOnServer }));
                                        }
                                    });
                            }
                            handleClose();
                        }}
                        />
                    </Box>
                </TabPanel>

            </DialogContent>
        </Dialog>
    );
};

export default UnifiedDataUploadDialog;
