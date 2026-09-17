import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, ListItemIcon, Menu, MenuItem, TextField, Tooltip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import NoteAddOutlinedIcon from '@mui/icons-material/NoteAddOutlined';
import { dfActions, type DataFormulatorState } from '../app/dfSlice';
import { createWorkspaceTextFile } from '../app/workspaceService';

export const WorkspaceFileMenu = ({ onUpload, onCreated, disabled = false, busy = false }: {
    onUpload: () => void;
    onCreated?: () => void;
    disabled?: boolean;
    busy?: boolean;
}) => {
    const dispatch = useDispatch();
    const workspace = useSelector((state: DataFormulatorState) => state.activeWorkspace);
    const fileCount = useSelector((state: DataFormulatorState) => state.workspaceFileCount);
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const [open, setOpen] = useState(false);
    const [name, setName] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const invalidName = !name.trim() || /[\\/\x00-\x1f]/.test(name) || name === '.' || name === '..';
    const create = async () => {
        if (invalidName || saving || workspace?.readOnly) return;
        setSaving(true);
        setError('');
        try {
            if (!workspace) {
                dispatch(dfActions.setActiveWorkspace({ id: `session_${crypto.randomUUID()}`, displayName: 'Untitled Session' }));
            }
            const file = await createWorkspaceTextFile(name.trim());
            dispatch(dfActions.setWorkspaceFileCount((fileCount || 0) + 1));
            dispatch(dfActions.setFocused({ type: 'file', fileName: file.name }));
            setOpen(false);
            onCreated?.();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Could not create file');
        } finally {
            setSaving(false);
        }
    };
    return <>
        <Tooltip title="Add file"><span>
            <IconButton size="small" aria-label="Add file" aria-haspopup="menu" aria-expanded={Boolean(anchor)}
                disabled={disabled || busy || workspace?.readOnly} onClick={event => { event.stopPropagation(); setAnchor(event.currentTarget); }}>
                {busy ? <CircularProgress size={16} /> : <AddIcon fontSize="small" />}
            </IconButton>
        </span></Tooltip>
        <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
            <MenuItem onClick={() => { setAnchor(null); onUpload(); }}><ListItemIcon><UploadFileIcon fontSize="small" /></ListItemIcon>Upload file...</MenuItem>
            <MenuItem onClick={() => { setAnchor(null); setName(''); setError(''); setOpen(true); }}><ListItemIcon><NoteAddOutlinedIcon fontSize="small" /></ListItemIcon>Create new file...</MenuItem>
        </Menu>
        <Dialog open={open} onClose={() => { if (!saving) setOpen(false); }} maxWidth="xs" fullWidth>
            <DialogTitle>Create new file</DialogTitle>
            <DialogContent>
                {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
                <TextField autoFocus autoComplete="off" slotProps={{ htmlInput: { spellCheck: false, autoCapitalize: 'none', autoCorrect: 'off' } }} fullWidth size="small" label="Filename" placeholder="notes.md" value={name} disabled={saving}
                    sx={{ mt: 1 }} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void create(); } }} />
            </DialogContent>
            <DialogActions>
                <Button disabled={saving} onClick={() => setOpen(false)}>Cancel</Button>
                <Button disabled={saving || invalidName || workspace?.readOnly} onClick={create} variant="contained">{saving ? 'Creating...' : 'Create'}</Button>
            </DialogActions>
        </Dialog>
    </>;
};