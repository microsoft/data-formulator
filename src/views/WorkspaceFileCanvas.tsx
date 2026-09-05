import React, { FC, useEffect, useState } from 'react';
import { Box, Button, CircularProgress, IconButton, Tooltip, Typography } from '@mui/material';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import DownloadIcon from '@mui/icons-material/Download';
import { useTranslation } from 'react-i18next';

import {
    downloadWorkspaceFile,
    previewWorkspaceFile,
    type WorkspaceFilePreview,
} from '../app/workspaceService';
import { iconVar, textVar } from '../app/layout';

export const WorkspaceFileCanvas: FC<{ fileName: string }> = ({ fileName }) => {
    const { t } = useTranslation();
    const [preview, setPreview] = useState<WorkspaceFilePreview | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setPreview(null);
        setError(null);
        previewWorkspaceFile(fileName)
            .then(result => { if (!cancelled) setPreview(result); })
            .catch(() => {
                if (!cancelled) setError(t('dataThread.previewUnavailable', {
                    defaultValue: 'A quick preview is not available for this file type.',
                }));
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [fileName, t]);

    const handleDownload = async () => {
        const blob = await downloadWorkspaceFile(fileName);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName;
        anchor.click();
        URL.revokeObjectURL(url);
    };

    return (
        <Box id="vis-view-canvas" sx={{ width: '100%', height: '100%', overflow: 'hidden', bgcolor: 'background.default', display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
                <AttachFileIcon sx={{ fontSize: iconVar.md, color: 'text.secondary' }} />
                <Typography component="h2" noWrap sx={{ maxWidth: 'min(70%, 720px)', fontSize: textVar.xl, fontWeight: 500 }}>
                    {fileName}
                </Typography>
                <Tooltip title={t('dataThread.downloadFile', { defaultValue: 'Download file' })}>
                    <IconButton size="small" onClick={handleDownload} aria-label={t('dataThread.downloadFile', { defaultValue: 'Download file' })}>
                        <DownloadIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
                <Box sx={{ flex: 1 }} />
            </Box>
            <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden', bgcolor: '#fafafa' }}>
                {loading && <Box sx={{ height: '100%', display: 'grid', placeItems: 'center' }}><CircularProgress size={28} /></Box>}
                {!loading && error && (
                    <Box sx={{ height: '100%', display: 'grid', placeItems: 'center', px: 3, textAlign: 'center' }}>
                        <Box>
                            <Typography sx={{ fontSize: textVar.md, color: 'text.secondary', mb: 1.5 }}>{error}</Typography>
                            <Button startIcon={<DownloadIcon />} onClick={handleDownload} sx={{ textTransform: 'none' }}>
                                {t('dataThread.downloadFile', { defaultValue: 'Download file' })}
                            </Button>
                        </Box>
                    </Box>
                )}
                {!loading && preview && (
                    <Box sx={{ height: '100%', overflow: 'auto', p: 2.5, boxSizing: 'border-box' }}>
                        <Typography component="pre" sx={{
                            m: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
                            fontFamily: 'var(--df-font-mono)', fontSize: textVar.sm, lineHeight: 1.65,
                            userSelect: 'text',
                        }}>
                            {preview.content || t('dataThread.emptyFile', { defaultValue: 'This file is empty.' })}
                        </Typography>
                        {preview.truncated && (
                            <Typography sx={{ mt: 2, fontSize: textVar.xs, color: 'text.secondary' }}>
                                {t('dataThread.previewTruncated', { defaultValue: 'Preview truncated. Download the file to view the complete content.' })}
                            </Typography>
                        )}
                    </Box>
                )}
            </Box>
        </Box>
    );
};