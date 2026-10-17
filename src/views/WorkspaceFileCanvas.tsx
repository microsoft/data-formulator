import React, { FC, Suspense, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, IconButton, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import WrapTextIcon from '@mui/icons-material/WrapText';
import RefreshIcon from '@mui/icons-material/Refresh';
import HtmlIcon from '@mui/icons-material/Html';
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined';
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import { CanvasHeader, CanvasHeaderAction } from './CanvasHeader';
import { useDispatch, useSelector } from 'react-redux';
import { CompactMarkdown } from './InteractionEntryCard';
import { MarkdownEditor } from '../components/MarkdownEditor';
import { LoadingStatus } from '../components/FunComponents';
import { dfActions, type DataFormulatorState } from '../app/dfSlice';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import { useTranslation } from 'react-i18next';

import {
    downloadWorkspaceFile,
    isInvalidWorkspaceFileName,
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

const HtmlAppPreview = React.lazy(() => import('./HtmlAppPreview'));
const ReactAppPreview = React.lazy(() => import('./ReactAppPreview'));

const textDrafts = new Map<string, { content: string; savedContent: string; hash: string }>();

const warnUnsavedDrafts = (event: BeforeUnloadEvent) => {
    if (textDrafts.size > 0) { event.preventDefault(); event.returnValue = ''; }
};

/**
 * `floatingAppControls`: the host canvas floats its own close button at the top
 * right, so HTML apps can preview full-bleed with floating source/reload buttons.
 */
export const WorkspaceFileCanvas: FC<{ fileName: string; sourceFile?: File; floatingAppControls?: boolean }> = ({ fileName, sourceFile, floatingAppControls = false }) => {
    const identity = useSelector((state: DataFormulatorState) => state.identity);
    const workspaceId = useSelector((state: DataFormulatorState) => state.activeWorkspace?.id);
    const draftKey = JSON.stringify([identity?.type, identity?.id, workspaceId, fileName]);
    return <WorkspaceFileContent key={`${draftKey}:${!!sourceFile}`} fileName={fileName} draftKey={draftKey} sourceFile={sourceFile}
        floatingAppControls={floatingAppControls} />;
};

const WorkspaceFileContent: FC<{ fileName: string; draftKey: string; sourceFile?: File; floatingAppControls: boolean }> = ({ fileName, draftKey, sourceFile, floatingAppControls }) => {
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
    // A new translation function (e.g. once i18n finishes loading) must not refetch the file.
    const tRef = useRef(t);
    tRef.current = t;
    // A file rewritten under the same name (an agent fix with `replaces`, or any in-place edit)
    // reaches the thread as a new content hash: reload it once per hash, unless it is our own save.
    const storedHash = useSelector((state: DataFormulatorState) => state.fileNodes.find(node => node.path === fileName)?.contentHash);
    const reloadedHash = useRef(storedHash);
    const loadedHash = useRef<string | undefined>(undefined);
    loadedHash.current = textFile?.hash;
    useEffect(() => {
        if (temporary || sourceFile || !storedHash || storedHash === reloadedHash.current) return;
        reloadedHash.current = storedHash;
        if (loadedHash.current !== storedHash) setFileRevision(current => current + 1);
    }, [storedHash, temporary, sourceFile]);
    const [mode, setMode] = useState('preview');
    const [lineWrap, setLineWrap] = useState(true);
    const [saving, setSaving] = useState(false);
    const [discardOpen, setDiscardOpen] = useState(false);
    const [renameOpen, setRenameOpen] = useState(false);
    const [newName, setNewName] = useState(fileName);
    const [renaming, setRenaming] = useState(false);
    const [renameError, setRenameError] = useState('');
    const trimmedName = newName.trim();
    const invalidName = !trimmedName || isInvalidWorkspaceFileName(trimmedName);
    const [saveError, setSaveError] = useState('');
    const isMarkdown = /\.(md|markdown)$/i.test(fileName);
    const isHtml = /\.html?$/i.test(fileName);
    const isReactApp = /\.app\.jsx$/i.test(fileName);
    const isApp = isHtml || isReactApp;
    const hasPreview = isMarkdown || isApp;
    const [appReloadKey, setAppReloadKey] = useState(0);
    const dirty = textFile !== null && textFile.content !== textFile.savedContent;
    // Only agent-editable workspace apps can be repaired with edit_file.
    const repairRequest = (errors: string[], hash: string) =>
        `The app files/${fileName} shows these errors:\n${errors.map(error => `- ${error}`).join('\n')}\n`
        + `Fix it in place with edit_file (path "files/${fileName}", expected_content_hash "${hash}", `
        + `replaces "files/${fileName}"), preferably with targeted replacements; keep its df-app manifest and do not create a copy.`;
    const askAgentToFix = !readOnly && textFile && !dirty ? (errors: string[]) => dispatch(dfActions.queueAnalystTask({
        text: repairRequest(errors, textFile.hash), images: [], attachments: [],
    })) : undefined;
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
                    setMode(hasPreview && file.content.length > 0 && !textDrafts.has(draftKey) ? 'preview' : 'edit');
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
                if (!cancelled) setError(tRef.current('dataThread.previewUnavailable', {
                    defaultValue: 'A quick preview is not available for this file type.',
                }));
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [fileName, isPdf, isMarkdown, hasPreview, draftKey, fileRevision, temporary, sourceFile]);

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
            dispatch(dfActions.renameFileNodes({ from: fileName, to: renamed.name }));
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

    // One title rule: the file's display name (e.g. an app's title), with its filename as context.
    const displayName = useSelector((state: DataFormulatorState) => state.fileNodes.find(node => node.path === fileName)?.displayName);
    const baseName = temporary ? fileName.slice('scratch/'.length) : fileName;
    const headerTitle = displayName && displayName !== baseName ? displayName : baseName;
    const headerMeta = [headerTitle !== baseName ? baseName : '', temporary ? 'Temporary' : ''].filter(Boolean).join(' · ');
    const FileIcon = isHtml ? HtmlIcon : isReactApp ? DashboardOutlinedIcon : isPdf ? PictureAsPdfOutlinedIcon : InsertDriveFileOutlinedIcon;

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
        }} sx={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', bgcolor: 'background.default', display: 'flex', flexDirection: 'column' }}>
            <CanvasHeader icon={<FileIcon />} title={headerTitle}
                meta={<>{headerMeta}{dirty && <Box component="span" role="status" aria-label="Unsaved changes"
                    sx={{ display: 'inline-block', width: 7, height: 7, ml: 0.75, borderRadius: '50%', bgcolor: 'text.secondary', verticalAlign: 'middle' }} />}</>}
                onRequestRename={!temporary && !sourceFile ? () => { setNewName(fileName); setRenameError(''); setRenameOpen(true); } : undefined}
                renameDisabled={workspace?.readOnly || saving || renaming}
                actions={<>
                    {textFile && hasPreview && <ToggleButtonGroup exclusive value={mode} size="small" aria-label="File view"
                        onChange={(_, value) => { if (value) setMode(value); }}
                        sx={{ mr: 0.5, '& .MuiToggleButton-root': { minHeight: 26, px: 1, py: 0, fontSize: '0.8125rem', textTransform: 'none',
                            lineHeight: 1.4, border: 0, borderRadius: '4px !important' } }}>
                        <ToggleButton value="edit" aria-label={readOnly ? 'View source' : 'Edit source'}>{readOnly ? 'Source' : 'Edit'}</ToggleButton>
                        <ToggleButton value="preview" aria-label={isApp ? t('htmlApp.previewApp') : 'Preview Markdown'}>Preview</ToggleButton>
                    </ToggleButtonGroup>}
                    {textFile && dirty && !temporary && !sourceFile && <>
                        <Button aria-label="Save file" size="small" onClick={save} disabled={saving || renaming || workspace?.readOnly}
                            sx={{ position: 'relative', minWidth: 0, px: 1, fontSize: '0.8125rem', textTransform: 'none' }}>
                            <Box component="span" sx={{ visibility: saving ? 'hidden' : 'visible' }}>Save</Box>
                            {saving && <CircularProgress size={14} sx={{ position: 'absolute', top: '50%', left: '50%', mt: '-7px', ml: '-7px' }} />}
                        </Button>
                        <Button aria-label="Discard changes" size="small" color="inherit" onClick={() => setDiscardOpen(true)} disabled={saving || renaming}
                            sx={{ minWidth: 0, px: 1, fontSize: '0.8125rem', textTransform: 'none' }}>Discard</Button>
                    </>}
                    {textFile && isApp && mode === 'preview' && <CanvasHeaderAction label={t('htmlApp.reload')} onClick={() => setAppReloadKey(value => value + 1)}>
                        <RefreshIcon />
                    </CanvasHeaderAction>}
                    {textFile && (!hasPreview || mode === 'edit') && <CanvasHeaderAction label="Wrap lines" active={lineWrap} onClick={() => setLineWrap(value => !value)}>
                        <WrapTextIcon />
                    </CanvasHeaderAction>}
                </>}
                menu={[{ label: t('dataThread.downloadFile', { defaultValue: 'Download file' }), icon: <DownloadIcon />, onClick: () => void handleDownload() }]} />
            {isPdf && !textFile && <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, flexShrink: 0,
                py: 0.25, borderBottom: '1px solid', borderColor: 'divider' }}>
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
            </Box>}
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
                {!loading && workbookFile && <Suspense fallback={<LoadingStatus label={t('dataThread.loadingFilePreview', { defaultValue: 'Loading file preview...' })} sx={{ height: '100%', p: 2 }} />}>
                    <WorkspaceWorkbookPreview file={workbookFile} fileName={fileName} errorLabel={t('dataThread.previewUnavailable', {
                        defaultValue: 'A quick preview is not available for this file type.',
                    })} />
                </Suspense>}
                {!loading && imageUrl && <Box component="img" src={imageUrl} alt={fileName}
                    sx={{ display: 'block', maxWidth: '100%', maxHeight: '100%', mx: 'auto', objectFit: 'contain' }} />}
                {!loading && textFile && (isApp && mode === 'preview'
                    ? <Suspense fallback={<LoadingStatus label={t('dataThread.loadingFilePreview', { defaultValue: 'Loading file preview...' })} sx={{ height: '100%', p: 2 }} />}>
                        {isReactApp
                            ? <ReactAppPreview source={textFile.content} title={fileName} reloadKey={appReloadKey} onAskFix={askAgentToFix} />
                            : <HtmlAppPreview html={textFile.content} title={fileName} reloadKey={appReloadKey} onAskFix={askAgentToFix} />}
                    </Suspense>
                    : isMarkdown && mode === 'preview'
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
                {loading && <LoadingStatus label={t('dataThread.loadingFilePreview', { defaultValue: 'Loading file preview...' })} sx={{ height: '100%', p: 2 }} />}
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
                        {preview.kind === 'table' ? <TablePreview fileName={fileName} preview={preview} /> : <Typography component="pre" sx={{
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
                    <Suspense fallback={<LoadingStatus label={t('dataThread.loadingFilePreview', { defaultValue: 'Loading file preview...' })} sx={{ height: '100%', p: 2 }} />}>
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
const formatCell = (value: unknown): string => {
    if (value == null) return '';
    if (typeof value === 'number') return Number.isInteger(value) ? String(value)
        : value.toLocaleString(undefined, { maximumFractionDigits: 4 });
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
};

/** A tabular file's first rows, compact like the data grid: one line per cell, numbers right-aligned. */
export const TablePreview: FC<{ fileName: string; preview: WorkspaceFilePreview }> = ({ fileName, preview }) => {
    const { t } = useTranslation();
    const columns = preview.columns || [];
    const rows = preview.rows || [];
    const numeric = new Set(columns.filter(column => rows.some(row => row[column] != null)
        && rows.every(row => row[column] == null || typeof row[column] === 'number')));
    const total = preview.row_count ?? rows.length;
    const cellSx = { px: 1.25, py: '5px', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        borderBottom: '1px solid', borderColor: 'divider', textAlign: 'left' } as const;
    return <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <Typography sx={{ mb: 1, fontSize: textVar.xs, color: 'text.secondary', flexShrink: 0 }}>
            {t('dataThread.tablePreviewSummary', { defaultValue: '{{rows}} rows · {{columns}} columns', rows: total.toLocaleString(), columns: columns.length })}
            {rows.length < total && ` · ${t('dataThread.tablePreviewShowing', { defaultValue: 'showing the first {{count}}', count: rows.length })}`}
        </Typography>
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: '6px', bgcolor: 'background.paper' }}>
            <Box component="table" aria-label={fileName} sx={{ borderCollapse: 'separate', borderSpacing: 0, minWidth: '100%',
                fontSize: textVar.sm, lineHeight: 1.5, '& tbody tr:hover td': { bgcolor: 'action.hover' } }}>
                <thead><tr>{columns.map(column => <Box component="th" key={column} title={column} sx={{ ...cellSx,
                    position: 'sticky', top: 0, zIndex: 1, bgcolor: 'grey.50', fontSize: textVar.xs, fontWeight: 600,
                    color: 'text.secondary', textAlign: numeric.has(column) ? 'right' : 'left' }}>{column}</Box>)}</tr></thead>
                <tbody>{rows.map((row, index) => <tr key={index}>{columns.map(column => {
                    const text = formatCell(row[column]);
                    return <Box component="td" key={column} title={text} sx={{ ...cellSx, color: 'text.primary',
                        ...(numeric.has(column) ? { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } : {}) }}>{text}</Box>;
                })}</tr>)}</tbody>
            </Box>
        </Box>
    </Box>;
};
