import React, { FC, Suspense, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, IconButton, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import WrapTextIcon from '@mui/icons-material/WrapText';
import { useDispatch, useSelector } from 'react-redux';
import { CompactMarkdown } from './InteractionEntryCard';
import { MarkdownEditor } from '../components/MarkdownEditor';
import { dfActions, type DataFormulatorState } from '../app/dfSlice';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import { useTranslation } from 'react-i18next';
import { Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material';

import {
    downloadWorkspaceFile,
    onWorkspaceFilesChanged,
    previewWorkspaceFile,
    previewUploadedWorkspaceFile,
    readWorkspaceTextFile,
    renameWorkspaceFile,
    saveWorkspaceTextFile,
    type WorkspaceFilePreview,
} from '../app/workspaceService';
import { iconVar, textVar } from '../app/layout';

const WorkspaceWorkbookPreview = React.lazy(() => import('./WorkspaceWorkbookPreview').then(module => ({
    default: module.WorkspaceWorkbookPreview,
})));

const WorkspacePdfPreview = React.lazy(() => import('./WorkspacePdfPreview').then(module => ({
    default: module.WorkspacePdfPreview,
})));

const textDrafts = new Map<string, { content: string; savedContent: string; hash: string }>();

const warnUnsavedDrafts = (event: BeforeUnloadEvent) => {
    if (textDrafts.size > 0) { event.preventDefault(); event.returnValue = ''; }
};

export const WorkspaceFileCanvas: FC<{ fileName: string; sourceFile?: File }> = ({ fileName, sourceFile }) => {
    const identity = useSelector((state: DataFormulatorState) => state.identity);
    const workspaceId = useSelector((state: DataFormulatorState) => state.activeWorkspace?.id);
    const draftKey = JSON.stringify([identity?.type, identity?.id, workspaceId, fileName]);
    return <WorkspaceFileContent key={`${draftKey}:${!!sourceFile}`} fileName={fileName} draftKey={draftKey} sourceFile={sourceFile} />;
};

const WorkspaceFileContent: FC<{ fileName: string; draftKey: string; sourceFile?: File }> = ({ fileName, draftKey, sourceFile }) => {
    const { t } = useTranslation();
    const dispatch = useDispatch();
    const mounted = useRef(false);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);
    const workspace = useSelector((state: DataFormulatorState) => state.activeWorkspace);
    const temporary = fileName.startsWith('scratch/');
    const readOnly = temporary || !!sourceFile || workspace?.readOnly;
    const [fileRevision, setFileRevision] = useState(0);
    useEffect(() => {
        if (!temporary || sourceFile) return;
        return onWorkspaceFilesChanged(() => setFileRevision(current => current + 1));
    }, [temporary, sourceFile]);
    const [textFile, setTextFile] = useState<{ content: string; savedContent: string; hash: string } | null>(null);
    const [mode, setMode] = useState('preview');
    const [lineWrap, setLineWrap] = useState(true);
    const [saving, setSaving] = useState(false);
    const [discardOpen, setDiscardOpen] = useState(false);
    const [renameOpen, setRenameOpen] = useState(false);
    const [newName, setNewName] = useState(fileName);
    const [renaming, setRenaming] = useState(false);
    const [renameError, setRenameError] = useState('');
    const trimmedName = newName.trim();
    const invalidName = !trimmedName || /[\\/]/.test(trimmedName) || Array.from(trimmedName).some(character => character.charCodeAt(0) < 32) || trimmedName === '.' || trimmedName === '..';
    const [saveError, setSaveError] = useState('');
    const isMarkdown = /\.(md|markdown)$/i.test(fileName);
    const dirty = textFile !== null && textFile.content !== textFile.savedContent;
    const [preview, setPreview] = useState<WorkspaceFilePreview | null>(null);
    const [pdfFile, setPdfFile] = useState<Blob | null>(null);
    const [workbookFile, setWorkbookFile] = useState<Blob | null>(null);
    const [imageUrl, setImageUrl] = useState('');
    const [pdfPageCount, setPdfPageCount] = useState(0);
    const [pdfPageNumber, setPdfPageNumber] = useState(1);
    const [pdfScale, setPdfScale] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const isPdf = /\.pdf$/i.test(fileName);
    const isCodeLike = /\.(csv|json|log|py|sql|tsv|xml|ya?ml)$/i.test(fileName);

    useEffect(() => {
        let cancelled = false;
        let objectUrl = '';
        setLoading(true);
        setPreview(null);
        setPdfFile(null);
        setWorkbookFile(null);
        setImageUrl('');
        setPdfPageCount(0);
        setPdfPageNumber(1);
        setPdfScale(1);
        setError(null);
        setTextFile(null);
        setSaveError('');
        const loadPreview = async () => {
            if (/\.(xlsx?|png|jpe?g|gif|webp|bmp|svg)$/i.test(fileName)) {
                const blob = sourceFile ?? await downloadWorkspaceFile(fileName);
                if (cancelled) return null;
                if (blob.size > 20 * 1024 * 1024) throw new Error('Preview is limited to 20 MB.');
                if (/\.xlsx?$/i.test(fileName)) {
                    setWorkbookFile(blob);
                } else {
                    objectUrl = URL.createObjectURL(blob);
                    setImageUrl(objectUrl);
                }
                return null;
            }
            if (sourceFile) {
                if (isPdf) return sourceFile;
                const result = await previewUploadedWorkspaceFile(sourceFile);
                if (result.kind === 'text' && /\.(md|markdown|csv|json|log|py|sql|tsv|txt|xml|ya?ml)$/i.test(fileName)) {
                    if (!cancelled) {
                        setTextFile({ content: result.content, savedContent: result.content, hash: '' });
                        setMode(isMarkdown ? 'preview' : 'edit');
                    }
                    return null;
                }
                return result;
            }
            if (/\.parquet$/i.test(fileName)) return previewWorkspaceFile(fileName);
            try {
                const file = await readWorkspaceTextFile(fileName);
                if (!cancelled) {
                    setTextFile(textDrafts.get(draftKey) || { content: file.content, savedContent: file.content, hash: file.content_hash });
                    setMode(isMarkdown && file.content.length > 0 && !textDrafts.has(draftKey) ? 'preview' : 'edit');
                }
                return null;
            } catch {
                return isPdf ? downloadWorkspaceFile(fileName) : previewWorkspaceFile(fileName);
            }
        };
        loadPreview()
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
        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [fileName, isPdf, isMarkdown, draftKey, t, fileRevision, temporary, sourceFile]);

    const save = async () => {
        if (!textFile || readOnly || saving || discardOpen || renameOpen || renaming) return;
        setSaving(true);
        setSaveError('');
        try {
            const saved = await saveWorkspaceTextFile(fileName, textFile.content, textFile.hash);
            if (textDrafts.get(draftKey) === textFile) textDrafts.delete(draftKey);
            if (textDrafts.size === 0) window.removeEventListener('beforeunload', warnUnsavedDrafts);
            setTextFile({ content: saved.content, savedContent: saved.content, hash: saved.content_hash });
        } catch (reason) {
            setSaveError(reason instanceof Error ? reason.message : 'Could not save file');
        } finally {
            setSaving(false);
        }
    };

    const discard = () => {
        if (!textFile || saving || renaming) return;
        setTextFile({ ...textFile, content: textFile.savedContent });
        textDrafts.delete(draftKey);
        if (textDrafts.size === 0) window.removeEventListener('beforeunload', warnUnsavedDrafts);
        setSaveError('');
        setDiscardOpen(false);
    };

    const rename = async () => {
        if (readOnly || invalidName || trimmedName === fileName || saving || renaming) return;
        setRenaming(true);
        setRenameError('');
        try {
            const renamed = await renameWorkspaceFile(fileName, trimmedName);
            const draft = textDrafts.get(draftKey);
            if (draft) {
                const renamedKey = JSON.stringify([...JSON.parse(draftKey).slice(0, -1), renamed.name]);
                textDrafts.set(renamedKey, draft);
                textDrafts.delete(draftKey);
            }
            if (mounted.current) {
                setRenameOpen(false);
                dispatch(dfActions.setFocused({ type: 'file', fileName: renamed.name }));
            }
        } catch (reason) {
            if (mounted.current) setRenameError(reason instanceof Error ? reason.message : 'Could not rename file');
        } finally {
            if (mounted.current) setRenaming(false);
        }
    };

    const handleDownload = async () => {
        const blob = sourceFile ?? await downloadWorkspaceFile(fileName);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName;
        anchor.click();
        URL.revokeObjectURL(url);
    };

    return (
        <Box id={sourceFile ? undefined : 'vis-view-canvas'} onKeyDownCapture={event => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && textFile) {
                event.preventDefault();
                if (dirty) void save();
            }
        }} sx={{ width: '100%', height: '100%', overflow: 'hidden', bgcolor: 'background.default', display: 'flex', flexDirection: 'column' }}>
            <Box sx={{
                minHeight: 36, flexShrink: 0, display: 'grid', alignItems: 'center', gap: 1,
                gridTemplateColumns: isPdf && !textFile ? 'minmax(0, 1fr) auto minmax(40px, 1fr)' : 'minmax(0, 1fr)',
                pl: 1.5, pr: 5, py: 0.25, boxSizing: 'border-box', borderBottom: '1px solid', borderColor: 'divider',
                '& .MuiIconButton-root': { width: 28, height: 28, borderRadius: 1, flexShrink: 0 },
                '& .MuiButton-root': { minHeight: 28, px: 0.75, fontSize: textVar.md, flexShrink: 0 },
                '& .MuiSvgIcon-root': { fontSize: iconVar.md },
            }}>
                <Box sx={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <Typography component="h2" noWrap sx={{ minWidth: 0, fontSize: textVar.md, fontWeight: 500 }}>
                        {temporary ? fileName.slice('scratch/'.length) : fileName}
                    </Typography>
                    {temporary && <Typography sx={{ fontSize: textVar.xs, color: 'text.secondary', flexShrink: 0 }}>Temporary</Typography>}
                    {!temporary && !sourceFile && <Tooltip title="Rename file"><span><IconButton aria-label="Rename file" size="small" disabled={workspace?.readOnly || saving || renaming} onClick={() => {
                        setNewName(fileName);
                        setRenameError('');
                        setRenameOpen(true);
                    }}><EditOutlinedIcon /></IconButton></span></Tooltip>}
                    {dirty && <Tooltip title="Unsaved changes"><Box role="status" aria-label="Unsaved changes" sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: 'text.secondary', flexShrink: 0 }} /></Tooltip>}
                    <Box sx={{ flex: 1 }} />
                    {textFile && <>
                        <Box role="group" aria-label="View controls" sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
                            {isMarkdown && <ToggleButtonGroup exclusive value={mode} size="small" aria-label="File view"
                                onChange={(_, value) => { if (value) setMode(value); }}
                                sx={{ flexShrink: 0, '& .MuiToggleButton-root': { minHeight: 28, px: 1, py: 0.25, fontSize: textVar.md, textTransform: 'none', lineHeight: 1.4, border: 0, borderRadius: '4px !important' } }}>
                                <ToggleButton value="edit" aria-label={readOnly ? 'View source' : 'Edit source'}>{readOnly ? 'Source' : 'Edit'}</ToggleButton>
                                <ToggleButton value="preview" aria-label="Preview Markdown">Preview</ToggleButton>
                            </ToggleButtonGroup>}
                            {(!isMarkdown || mode === 'edit') && <Tooltip title="Wrap lines">
                                <IconButton aria-label="Wrap lines" aria-pressed={lineWrap} onClick={() => setLineWrap(value => !value)} color={lineWrap ? 'primary' : 'default'}><WrapTextIcon /></IconButton>
                            </Tooltip>}
                        </Box>
                        <Box aria-hidden="true" sx={{ width: '1px', height: 16, bgcolor: 'divider', flexShrink: 0, mx: 0.25 }} />
                        {!temporary && !sourceFile && <Box role="group" aria-label="File changes" sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
                            <Tooltip title="Save file (Cmd/Ctrl+S)"><span><Button aria-label="Save file" size="small" onClick={save} disabled={!dirty || saving || renaming || workspace?.readOnly} sx={{ position: 'relative' }}>
                                <Box component="span" sx={{ visibility: saving ? 'hidden' : 'visible' }}>Save</Box>
                                {saving && <CircularProgress size={14} sx={{ position: 'absolute', top: '50%', left: '50%', mt: '-7px', ml: '-7px' }} />}
                            </Button></span></Tooltip>
                            <Tooltip title="Discard unsaved changes"><span><Button aria-label="Discard changes" size="small" color="inherit" onClick={() => setDiscardOpen(true)} disabled={!dirty || saving || renaming}>
                                Discard
                            </Button></span></Tooltip>
                        </Box>}
                        {!temporary && !sourceFile && <Box aria-hidden="true" sx={{ width: '1px', height: 16, bgcolor: 'divider', flexShrink: 0, mx: 0.25 }} />}
                    </>}
                    <Tooltip title={t('dataThread.downloadFile', { defaultValue: 'Download file' })}>
                        <IconButton size="small" onClick={handleDownload} aria-label={t('dataThread.downloadFile', { defaultValue: 'Download file' })}>
                            <DownloadIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Box>
                {isPdf && !textFile && (
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
                {isPdf && !textFile && <Box />}
            </Box>
            <Dialog open={renameOpen} onClose={() => { if (!renaming) setRenameOpen(false); }} maxWidth="xs" fullWidth aria-labelledby="rename-file-title">
                <DialogTitle id="rename-file-title">Rename file</DialogTitle>
                <DialogContent>
                    {renameError && <Alert severity="error" sx={{ mb: 1 }}>{renameError}</Alert>}
                    <TextField autoFocus autoComplete="off" fullWidth size="small" label="Filename" value={newName} disabled={renaming}
                        slotProps={{ htmlInput: { spellCheck: false, autoCapitalize: 'none', autoCorrect: 'off' } }}
                        sx={{ mt: 1 }} onChange={event => { setNewName(event.target.value); setRenameError(''); }}
                        onFocus={event => { const dot = fileName.lastIndexOf('.'); event.target.setSelectionRange(0, dot > 0 ? dot : fileName.length); }}
                        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void rename(); } }} />
                </DialogContent>
                <DialogActions>
                    <Button disabled={renaming} onClick={() => setRenameOpen(false)}>Cancel</Button>
                    <Button variant="contained" disabled={renaming || invalidName || trimmedName === fileName || workspace?.readOnly} onClick={rename}>{renaming ? 'Renaming...' : 'Rename'}</Button>
                </DialogActions>
            </Dialog>
            <Dialog open={discardOpen} onClose={() => setDiscardOpen(false)} maxWidth="xs" fullWidth aria-labelledby="discard-file-title">
                <DialogTitle id="discard-file-title">Discard changes?</DialogTitle>
                <DialogContent>
                    <DialogContentText sx={{ overflowWrap: 'anywhere' }}>Restore {fileName} to its last saved contents? Unsaved changes will be discarded.</DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button autoFocus onClick={() => setDiscardOpen(false)}>Cancel</Button>
                    <Button color="error" onClick={discard} disabled={saving}>Discard changes</Button>
                </DialogActions>
            </Dialog>
            {saveError && <Alert severity="error">{saveError}</Alert>}
            <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden', bgcolor: '#fafafa' }}>
                {!loading && workbookFile && <Suspense fallback={<CircularProgress size={28} />}>
                    <WorkspaceWorkbookPreview file={workbookFile} fileName={fileName} errorLabel={t('dataThread.previewUnavailable', {
                        defaultValue: 'A quick preview is not available for this file type.',
                    })} />
                </Suspense>}
                {!loading && imageUrl && <Box component="img" src={imageUrl} alt={fileName}
                    sx={{ display: 'block', maxWidth: '100%', maxHeight: '100%', mx: 'auto', objectFit: 'contain' }} />}
                {!loading && textFile && (isMarkdown && mode === 'preview'
                    ? <Box sx={{ height: '100%', overflow: 'auto', px: 3, py: 2, boxSizing: 'border-box', fontSize: textVar.md, overflowWrap: 'anywhere', '& img': { maxWidth: '100%' }, '& pre': { overflow: 'auto' } }}>
                        <CompactMarkdown content={textFile.content} color="text.primary" variant="document" />
                    </Box>
                    : <MarkdownEditor showToolbar={false} lineWrap={lineWrap} fileName={fileName} value={textFile.content} readOnly={readOnly || saving || renaming} onChange={content => {
                        if (readOnly) return;
                        const draft = { ...textFile, content };
                        setTextFile(draft);
                        if (content === draft.savedContent) textDrafts.delete(draftKey);
                        else textDrafts.set(draftKey, draft);
                        if (textDrafts.size > 0) window.addEventListener('beforeunload', warnUnsavedDrafts);
                        else window.removeEventListener('beforeunload', warnUnsavedDrafts);
                    }} />)}
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
                        {preview.kind === 'table' ? <>
                            <Typography sx={{ mb: 1, fontSize: textVar.sm, color: 'text.secondary' }}>{preview.row_count?.toLocaleString()} rows</Typography>
                            <Table size="small" stickyHeader aria-label={fileName} sx={{ '& td, & th': { fontSize: textVar.sm, minWidth: 100, maxWidth: 320, overflowWrap: 'anywhere' } }}>
                                <TableHead><TableRow>{preview.columns?.map(column => <TableCell key={column}>{column}</TableCell>)}</TableRow></TableHead>
                                <TableBody>{preview.rows?.map((row, index) => <TableRow key={index}>{preview.columns?.map(column =>
                                    <TableCell key={column}>{row[column] == null ? '' : typeof row[column] === 'object' ? JSON.stringify(row[column]) : String(row[column])}</TableCell>
                                )}</TableRow>)}</TableBody>
                            </Table>
                        </> : <Typography component="pre" sx={{
                            width: '100%', maxWidth: 960, mx: 'auto', my: 0,
                            whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
                            fontFamily: isCodeLike ? 'var(--df-font-mono)' : 'inherit',
                            fontSize: textVar.md, lineHeight: 1.65,
                            userSelect: 'text',
                        }}>
                            {preview.content || t('dataThread.emptyFile', { defaultValue: 'This file is empty.' })}
                        </Typography>}
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