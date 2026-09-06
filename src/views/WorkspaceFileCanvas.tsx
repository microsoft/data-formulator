import React, { FC, Suspense, useEffect, useState } from 'react';
import { Box, Button, CircularProgress, IconButton, Tooltip, Typography } from '@mui/material';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import DownloadIcon from '@mui/icons-material/Download';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import { useTranslation } from 'react-i18next';

import {
    downloadWorkspaceFile,
    previewWorkspaceFile,
    type WorkspaceFilePreview,
} from '../app/workspaceService';
import { iconVar, textVar } from '../app/layout';

const WorkspacePdfPreview = React.lazy(() => import('./WorkspacePdfPreview').then(module => ({
    default: module.WorkspacePdfPreview,
})));

export const WorkspaceFileCanvas: FC<{ fileName: string }> = ({ fileName }) => {
    const { t } = useTranslation();
    const [preview, setPreview] = useState<WorkspaceFilePreview | null>(null);
    const [pdfFile, setPdfFile] = useState<Blob | null>(null);
    const [pdfPageCount, setPdfPageCount] = useState(0);
    const [pdfPageNumber, setPdfPageNumber] = useState(1);
    const [pdfScale, setPdfScale] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const isPdf = /\.pdf$/i.test(fileName);
    const isCodeLike = /\.(csv|json|log|py|sql|tsv|xml|ya?ml)$/i.test(fileName);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setPreview(null);
        setPdfFile(null);
        setPdfPageCount(0);
        setPdfPageNumber(1);
        setPdfScale(1);
        setError(null);
        const loadPreview = isPdf ? downloadWorkspaceFile(fileName) : previewWorkspaceFile(fileName);
        loadPreview
            .then(result => {
                if (cancelled) return;
                if (result instanceof Blob) setPdfFile(result);
                else setPreview(result);
            })
            .catch(() => {
                if (!cancelled) setError(t('dataThread.previewUnavailable', {
                    defaultValue: 'A quick preview is not available for this file type.',
                }));
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [fileName, isPdf, t]);

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
            <Box sx={{
                minHeight: 40, display: 'grid', alignItems: 'center', gap: 1,
                gridTemplateColumns: isPdf ? 'minmax(0, 1fr) auto minmax(40px, 1fr)' : 'minmax(0, 1fr)',
                px: 1.5, py: 0.5, boxSizing: 'border-box', borderBottom: '1px solid', borderColor: 'divider',
            }}>
                <Box sx={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <AttachFileIcon sx={{ fontSize: iconVar.sm, color: 'text.secondary', flexShrink: 0 }} />
                    <Typography component="h2" noWrap sx={{ fontSize: textVar.md, fontWeight: 500 }}>
                        {fileName}
                    </Typography>
                    <Tooltip title={t('dataThread.downloadFile', { defaultValue: 'Download file' })}>
                        <IconButton size="small" onClick={handleDownload} aria-label={t('dataThread.downloadFile', { defaultValue: 'Download file' })}>
                            <DownloadIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Box>
                {isPdf && (
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                        <Typography sx={{ minWidth: 72, textAlign: 'center', fontSize: textVar.sm, color: 'text.secondary' }}>
                            {pdfPageCount ? `${pdfPageNumber} / ${pdfPageCount}` : '—'}
                        </Typography>
                        <Box sx={{ width: '1px', height: 18, flexShrink: 0, bgcolor: 'divider', mx: 0.5 }} />
                        <Tooltip title="Zoom out">
                            <span>
                                <IconButton size="small" disabled={pdfScale <= 0.75} onClick={() => setPdfScale(value => Math.max(0.75, value - 0.25))}>
                                    <ZoomOutIcon sx={{ fontSize: iconVar.md }} />
                                </IconButton>
                            </span>
                        </Tooltip>
                        <Typography sx={{ minWidth: 40, textAlign: 'center', fontSize: textVar.xs, color: 'text.secondary' }}>
                            {Math.round(pdfScale * 100)}%
                        </Typography>
                        <Tooltip title="Zoom in">
                            <span>
                                <IconButton size="small" disabled={pdfScale >= 2} onClick={() => setPdfScale(value => Math.min(2, value + 0.25))}>
                                    <ZoomInIcon sx={{ fontSize: iconVar.md }} />
                                </IconButton>
                            </span>
                        </Tooltip>
                    </Box>
                )}
                {isPdf && <Box />}
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
                            width: '100%', maxWidth: 960, mx: 'auto', my: 0,
                            whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
                            fontFamily: isCodeLike ? 'var(--df-font-mono)' : 'inherit',
                            fontSize: textVar.md, lineHeight: 1.65,
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
                {!loading && pdfFile && (
                    <Suspense fallback={<Box sx={{ height: '100%', display: 'grid', placeItems: 'center' }}><CircularProgress size={28} /></Box>}>
                        <WorkspacePdfPreview
                            file={pdfFile}
                            pageCount={pdfPageCount}
                            scale={pdfScale}
                            onPageCountChange={setPdfPageCount}
                            onVisiblePageChange={setPdfPageNumber}
                            errorLabel={t('dataThread.previewUnavailable', {
                                defaultValue: 'A quick preview is not available for this file type.',
                            })}
                        />
                    </Suspense>
                )}
            </Box>
        </Box>
    );
};