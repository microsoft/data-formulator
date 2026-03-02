// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { useState, useCallback, useRef } from 'react';
import { borderColor, transition, radius } from '../app/tokens';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    IconButton,
    Typography,
    Box,
    TextField,
    Tabs,
    Tab,
    LinearProgress,
    Input,
    Link,
    alpha,
    useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { useSelector } from 'react-redux';
import { DataFormulatorState } from '../app/dfSlice';
import { DictTable } from '../components/ComponentType';
import { createTableFromText, loadTextDataWrapper, loadBinaryDataWrapper } from '../data/utils';

interface TabPanelProps {
    children?: React.ReactNode;
    index: number;
    value: number;
}

function TabPanel(props: TabPanelProps) {
    const { children, value, index, ...other } = props;
    return (
        <div
            role="tabpanel"
            hidden={value !== index}
            id={`refresh-tabpanel-${index}`}
            aria-labelledby={`refresh-tab-${index}`}
            {...other}
        >
            {value === index && <Box sx={{ p: 2.5, pt: 3 }}>{children}</Box>}
        </div>
    );
}

export interface RefreshDataDialogProps {
    open: boolean;
    onClose: () => void;
    table: DictTable;
    onRefreshComplete: (newRows: any[]) => void;
}

export const RefreshDataDialog: React.FC<RefreshDataDialogProps> = ({
    open,
    onClose,
    table,
    onRefreshComplete,
}) => {
    const theme = useTheme();
    const [tabValue, setTabValue] = useState(0);
    const [pasteContent, setPasteContent] = useState('');
    const [urlContent, setUrlContent] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const serverConfig = useSelector((state: DataFormulatorState) => state.serverConfig);

    // Constants for content size limits
    const MAX_DISPLAY_LINES = 20;
    const LARGE_CONTENT_THRESHOLD = 50000;
    const MAX_CONTENT_SIZE = 2 * 1024 * 1024; // 2MB

    const [displayContent, setDisplayContent] = useState('');
    const [isLargeContent, setIsLargeContent] = useState(false);
    const [showFullContent, setShowFullContent] = useState(false);
    const [isOverSizeLimit, setIsOverSizeLimit] = useState(false);

    const validateColumns = (newRows: any[]): { valid: boolean; message: string } => {
        if (!newRows || newRows.length === 0) {
            return { valid: false, message: 'No data found in the uploaded content.' };
        }

        const newColumns = Object.keys(newRows[0]).sort();
        const existingColumns = [...table.names].sort();

        if (newColumns.length !== existingColumns.length) {
            return {
                valid: false,
                message: `Column count mismatch. Expected ${existingColumns.length} columns (${existingColumns.join(', ')}), but got ${newColumns.length} columns (${newColumns.join(', ')}).`,
            };
        }

        const missingColumns = existingColumns.filter(col => !newColumns.includes(col));
        const extraColumns = newColumns.filter(col => !existingColumns.includes(col));

        if (missingColumns.length > 0 || extraColumns.length > 0) {
            let message = 'Column names do not match.';
            if (missingColumns.length > 0) {
                message += ` Missing: ${missingColumns.join(', ')}.`;
            }
            if (extraColumns.length > 0) {
                message += ` Unexpected: ${extraColumns.join(', ')}.`;
            }
            return { valid: false, message };
        }

        return { valid: true, message: '' };
    };

    const processAndValidateData = (newRows: any[]): boolean => {
        const validation = validateColumns(newRows);
        if (!validation.valid) {
            setError(validation.message);
            return false;
        }
        setError(null);
        onRefreshComplete(newRows);
        handleClose();
        return true;
    };

    const handleClose = () => {
        setPasteContent('');
        setUrlContent('');
        setDisplayContent('');
        setError(null);
        setIsLoading(false);
        setIsLargeContent(false);
        setShowFullContent(false);
        setIsOverSizeLimit(false);
        onClose();
    };

    const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
        setTabValue(newValue);
        setError(null);
    };

    // Handle paste content change with optimization for large content
    const handlePasteContentChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const newContent = event.target.value;
        setPasteContent(newContent);

        const contentSizeBytes = new Blob([newContent]).size;
        const isOverLimit = contentSizeBytes > MAX_CONTENT_SIZE;
        setIsOverSizeLimit(isOverLimit);

        const isLarge = newContent.length > LARGE_CONTENT_THRESHOLD;
        setIsLargeContent(isLarge);

        if (isLarge && !showFullContent) {
            const lines = newContent.split('\n');
            const previewLines = lines.slice(0, MAX_DISPLAY_LINES);
            const preview = previewLines.join('\n') + (lines.length > MAX_DISPLAY_LINES ? '\n... (truncated for performance)' : '');
            setDisplayContent(preview);
        } else {
            setDisplayContent(newContent);
        }
    }, [showFullContent]);

    const toggleFullContent = useCallback(() => {
        setShowFullContent(!showFullContent);
        if (!showFullContent) {
            setDisplayContent(pasteContent);
        } else {
            const lines = pasteContent.split('\n');
            const previewLines = lines.slice(0, MAX_DISPLAY_LINES);
            const preview = previewLines.join('\n') + (lines.length > MAX_DISPLAY_LINES ? '\n... (truncated for performance)' : '');
            setDisplayContent(preview);
        }
    }, [showFullContent, pasteContent]);

    // Handle paste submit
    const handlePasteSubmit = () => {
        if (!pasteContent.trim()) {
            setError('Please paste some data.');
            return;
        }

        setIsLoading(true);
        try {
            let newRows: any[] = [];
            try {
                const jsonContent = JSON.parse(pasteContent);
                if (Array.isArray(jsonContent)) {
                    newRows = jsonContent;
                } else {
                    setError('JSON content must be an array of objects.');
                    setIsLoading(false);
                    return;
                }
            } catch {
                // Try parsing as CSV/TSV
                const tempTable = createTableFromText('temp', pasteContent);
                if (tempTable) {
                    newRows = tempTable.rows;
                } else {
                    setError('Could not parse the pasted content as JSON or CSV/TSV.');
                    setIsLoading(false);
                    return;
                }
            }
            processAndValidateData(newRows);
        } catch (err) {
            setError('Failed to parse the pasted content.');
        } finally {
            setIsLoading(false);
        }
    };

    // Handle URL submit
    const handleUrlSubmit = () => {
        if (!urlContent.trim()) {
            setError('Please enter a URL.');
            return;
        }

        const hasValidSuffix = urlContent.endsWith('.csv') || urlContent.endsWith('.tsv') || urlContent.endsWith('.json');
        if (!hasValidSuffix) {
            setError('URL must point to a .csv, .tsv, or .json file.');
            return;
        }

        setIsLoading(true);
        fetch(urlContent)
            .then(res => res.text())
            .then(content => {
                let newRows: any[] = [];
                try {
                    const jsonContent = JSON.parse(content);
                    if (Array.isArray(jsonContent)) {
                        newRows = jsonContent;
                    } else {
                        setError('JSON content must be an array of objects.');
                        setIsLoading(false);
                        return;
                    }
                } catch {
                    const tempTable = createTableFromText('temp', content);
                    if (tempTable) {
                        newRows = tempTable.rows;
                    } else {
                        setError('Could not parse the URL content as JSON or CSV/TSV.');
                        setIsLoading(false);
                        return;
                    }
                }
                processAndValidateData(newRows);
            })
            .catch(err => {
                setError(`Failed to fetch data from URL: ${err.message}`);
            })
            .finally(() => {
                setIsLoading(false);
            });
    };

    // Handle file upload
    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        const file = files[0];
        setIsLoading(true);

        if (file.type === 'text/csv' ||
            file.type === 'text/tab-separated-values' ||
            file.type === 'application/json' ||
            file.name.endsWith('.csv') ||
            file.name.endsWith('.tsv') ||
            file.name.endsWith('.json')) {

            const MAX_FILE_SIZE = 5 * 1024 * 1024;
            if (file.size > MAX_FILE_SIZE) {
                setError(`File is too large (${(file.size / (1024 * 1024)).toFixed(2)}MB). Maximum size is 5MB.`);
                setIsLoading(false);
                return;
            }

            file.text().then((text) => {
                let newRows: any[] = [];
                try {
                    const jsonContent = JSON.parse(text);
                    if (Array.isArray(jsonContent)) {
                        newRows = jsonContent;
                    } else {
                        setError('JSON content must be an array of objects.');
                        setIsLoading(false);
                        return;
                    }
                } catch {
                    const tempTable = loadTextDataWrapper('temp', text, file.type);
                    if (tempTable) {
                        newRows = tempTable.rows;
                    } else {
                        setError('Could not parse the file content.');
                        setIsLoading(false);
                        return;
                    }
                }
                processAndValidateData(newRows);
            }).catch(err => {
                setError(`Failed to read file: ${err.message}`);
            }).finally(() => {
                setIsLoading(false);
            });
        } else if (file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
            file.type === 'application/vnd.ms-excel' ||
            file.name.endsWith('.xlsx') ||
            file.name.endsWith('.xls')) {

            const reader = new FileReader();
            reader.onload = async (e) => {
                const arrayBuffer = e.target?.result as ArrayBuffer;
                if (arrayBuffer) {
                    try {
                        const tables = await loadBinaryDataWrapper('temp', arrayBuffer);
                        if (tables.length > 0) {
                            processAndValidateData(tables[0].rows);
                        } else {
                            setError('Failed to parse Excel file.');
                        }
                    } catch (err) {
                        setError('Failed to parse Excel file.');
                    }
                }
                setIsLoading(false);
            };
            reader.readAsArrayBuffer(file);
        } else {
            setError('Unsupported file format. Please use CSV, TSV, JSON, or Excel files.');
            setIsLoading(false);
        }

        // Reset file input
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const hasValidUrlSuffix = urlContent.endsWith('.csv') || urlContent.endsWith('.tsv') || urlContent.endsWith('.json');

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            maxWidth="md"
            fullWidth
            sx={{ '& .MuiDialog-paper': { minHeight: 500 } }}
        >
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', pb: 1 }}>
                <Typography variant="h6" component="span">
                    Refresh Data for "{table.displayId || table.id}"
                </Typography>
                <IconButton
                    sx={{ marginLeft: 'auto' }}
                    size="small"
                    onClick={handleClose}
                >
                    <CloseIcon fontSize="small" />
                </IconButton>
            </DialogTitle>
            <DialogContent sx={{ p: 0 }}>
                <Box sx={{ px: 3, pt: 2.5, pb: 1.5 }}>
                    <Typography 
                        variant="caption" 
                        sx={{ 
                            display: 'block',
                            color: 'text.secondary',
                            fontSize: '0.75rem',
                            mb: 2,
                            lineHeight: 1.5
                        }}
                    >
                        Upload new data to replace the current table content. Required columns: <strong style={{ color: 'inherit' }}>{table.names.join(', ')}</strong>
                    </Typography>

                    {error && (
                        <Box 
                            sx={{ 
                                mb: 1.5,
                                p: 1,
                                backgroundColor: alpha(theme.palette.error.main, 0.08),
                                borderLeft: `3px solid ${theme.palette.error.main}`,
                                borderRadius: '4px',
                            }}
                        >
                            <Typography variant="caption" sx={{ color: 'error.main', fontSize: '0.75rem', lineHeight: 1.5 }}>
                                {error}
                            </Typography>
                        </Box>
                    )}

                    {isLoading && <LinearProgress sx={{ mb: 2, height: 2 }} />}
                </Box>

                <Tabs value={tabValue} onChange={handleTabChange} sx={{ borderBottom: `1px solid ${borderColor.divider}`, px: 3 }}>
                    <Tab label="Paste Data" sx={{ textTransform: 'none', fontSize: '0.875rem', minHeight: 48 }} />
                    <Tab label="Upload File" sx={{ textTransform: 'none', fontSize: '0.875rem', minHeight: 48 }} />
                    <Tab label="From URL" sx={{ textTransform: 'none', fontSize: '0.875rem', minHeight: 48 }} />
                </Tabs>

                <TabPanel value={tabValue} index={0}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                        {isOverSizeLimit && (
                            <Box 
                                sx={{ 
                                    p: 1,
                                    backgroundColor: alpha(theme.palette.error.main, 0.06),
                                    borderLeft: `3px solid ${theme.palette.error.main}`,
                                    borderRadius: '4px',
                                }}
                            >
                                <Typography variant="caption" sx={{ color: 'error.main', fontSize: '0.75rem', lineHeight: 1.5 }}>
                                    Content exceeds {(MAX_CONTENT_SIZE / (1024 * 1024)).toFixed(0)}MB limit ({(new Blob([pasteContent]).size / (1024 * 1024)).toFixed(2)}MB)
                                </Typography>
                            </Box>
                        )}
                        {isLargeContent && !isOverSizeLimit && (
                            <Box sx={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: 1.5,
                                p: 1, 
                                backgroundColor: alpha(theme.palette.text.secondary, 0.04), 
                                borderRadius: 1,
                                border: `1px solid ${borderColor.divider}`
                            }}>
                                <Typography variant="caption" sx={{ flex: 1, fontSize: '0.75rem', color: 'text.secondary' }}>
                                    Large content ({Math.round(pasteContent.length / 1000)}KB) • {showFullContent ? 'Full view' : 'Preview'}
                                </Typography>
                                <Button 
                                    size="small" 
                                    variant="text" 
                                    onClick={toggleFullContent}
                                    sx={{ 
                                        textTransform: 'none', 
                                        minWidth: 'auto', 
                                        fontSize: '0.75rem',
                                        color: 'text.secondary',
                                        '&:hover': {
                                            backgroundColor: alpha(theme.palette.text.secondary, 0.08),
                                        }
                                    }}
                                >
                                    {showFullContent ? 'Preview' : 'Full'}
                                </Button>
                            </Box>
                        )}
                        <TextField
                            autoFocus
                            multiline
                            fullWidth
                            value={displayContent}
                            onChange={handlePasteContentChange}
                            placeholder="Paste your data here (CSV, TSV, or JSON format)"
                            disabled={isLoading}
                            sx={{
                                '& .MuiInputBase-root': {
                                    minHeight: 240,
                                    alignItems: 'flex-start',
                                },
                                '& .MuiInputBase-input': {
                                    fontSize: 12,
                                    fontFamily: 'monospace',
                                    lineHeight: 1.5,
                                }
                            }}
                        />
                    </Box>
                </TabPanel>

                <TabPanel value={tabValue} index={1}>
                    {serverConfig.DISABLE_FILE_UPLOAD ? (
                        <Box sx={{ textAlign: 'center', py: 6 }}>
                            <Typography color="text.secondary" sx={{ mb: 1.5, fontSize: '0.875rem' }}>
                                File upload is disabled in this environment.
                            </Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                                Install Data Formulator locally to enable file upload. <br />
                                <Link 
                                    href="https://github.com/microsoft/data-formulator" 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    sx={{ fontSize: '0.75rem' }}
                                >
                                    https://github.com/microsoft/data-formulator
                                </Link>
                            </Typography>
                        </Box>
                    ) : (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <Input
                                inputProps={{ accept: '.csv,.tsv,.json,.xlsx,.xls' }}
                                type="file"
                                sx={{ display: 'none' }}
                                inputRef={fileInputRef}
                                onChange={handleFileUpload}
                            />
                            <Box
                                sx={{
                                    border: '2px dashed',
                                    borderColor: borderColor.divider,
                                    borderRadius: radius.md,
                                    p: 4,
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
                                <UploadFileIcon sx={{ fontSize: 40, color: 'text.secondary', mb: 1.5 }} />
                                <Typography variant="subtitle1" gutterBottom sx={{ fontSize: '0.9375rem', fontWeight: 500 }}>
                                    Drag & drop file here
                                </Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8125rem', mb: 0.5 }}>
                                    or <Link component="button" sx={{ textDecoration: 'underline', cursor: 'pointer' }}>Browse</Link>
                                </Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                                    Supported: CSV, TSV, JSON, Excel (xlsx, xls)
                                </Typography>
                            </Box>
                        </Box>
                    )}
                </TabPanel>

                <TabPanel value={tabValue} index={2}>
                    <TextField
                        fullWidth
                        placeholder="Load a CSV, TSV, or JSON file from a URL, e.g. https://example.com/data.json"
                        value={urlContent}
                        onChange={(e) => setUrlContent(e.target.value.trim())}
                        disabled={isLoading}
                        error={urlContent !== '' && !hasValidUrlSuffix}
                        helperText={urlContent !== '' && !hasValidUrlSuffix ? 'URL should link to a .csv, .tsv, or .json file' : ''}
                        size="small"
                        sx={{ 
                            '& .MuiInputBase-input': {
                                fontSize: '0.875rem',
                            },
                            '& .MuiInputBase-input::placeholder': {
                                fontSize: '0.875rem',
                            },
                            '& .MuiFormHelperText-root': {
                                fontSize: '0.75rem',
                            },
                        }}
                    />
                </TabPanel>
            </DialogContent>
            <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
                <Button 
                    onClick={handleClose} 
                    disabled={isLoading}
                    sx={{ textTransform: 'none' }}
                >
                    Cancel
                </Button>
                {tabValue === 0 && (
                    <Button
                        variant="contained"
                        onClick={handlePasteSubmit}
                        disabled={isLoading || !pasteContent.trim() || isOverSizeLimit}
                        sx={{ textTransform: 'none' }}
                    >
                        Refresh Data
                    </Button>
                )}
                {tabValue === 2 && (
                    <Button
                        variant="contained"
                        onClick={handleUrlSubmit}
                        disabled={isLoading || !urlContent.trim() || !hasValidUrlSuffix}
                        sx={{ textTransform: 'none' }}
                    >
                        Refresh Data
                    </Button>
                )}
            </DialogActions>
        </Dialog>
    );
};
