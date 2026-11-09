// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Wormhole session sharing UI (design-docs/71).
 *
 * - The send dialog shows the one-time code for a session; hiding it leaves the
 *   transfer running in the background.
 * - The receive dialog takes a code and starts a background receive.
 * - Background transfers show as cards in the bottom-right corner. A received
 *   session stays there, with "Open session", until the user closes it.
 */

import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
    Alert, AlertTitle, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
    IconButton, LinearProgress, Paper, TextField, Tooltip, Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';

import { DataFormulatorState, dfActions, dfSelectors } from '../app/dfSlice';
import type { AppDispatch } from '../app/store';
import { textVar } from '../app/layout';
import { openSession } from '../app/sessionThunks';
import { getSerializableState } from '../app/useAutoSave';
import { notifyWorkspaceListChanged, saveWorkspaceState } from '../app/workspaceService';
import {
    cancelWormholeTransfer, dismissWormholeTransfer, isActiveTransfer, listWormholeTransfers, onWormholeDialogRequest,
    receiveSessionByWormhole, sendSessionByWormhole, WormholeTransfer,
} from '../app/wormholeService';
import { formatBytes } from './ViewUtils';

type DialogState =
    | { kind: 'send'; workspaceId: string; displayName: string; transferId?: string; error?: string }
    | { kind: 'receive' };

const POLL_MS = 1000;

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

const TransferProgress: FC<{ transfer: WormholeTransfer }> = ({ transfer }) => {
    const { t } = useTranslation();
    if (transfer.status !== 'transferring' || !transfer.total_bytes) {
        return <LinearProgress sx={{ mt: 1, borderRadius: 1 }} />;
    }
    const value = Math.min(100, (100 * transfer.transferred_bytes) / transfer.total_bytes);
    return (
        <Box sx={{ mt: 1 }}>
            <LinearProgress variant="determinate" value={value} sx={{ borderRadius: 1 }} />
            <Typography sx={{ fontSize: textVar.xs, color: 'text.secondary', mt: 0.5 }}>
                {t('wormhole.progress', { done: formatBytes(transfer.transferred_bytes) || '0 B', total: formatBytes(transfer.total_bytes) })}
            </Typography>
        </Box>
    );
};

const statusLabel = (transfer: WormholeTransfer, t: (key: string, options?: any) => string): string => {
    switch (transfer.status) {
        case 'connecting': return t('wormhole.connecting');
        case 'waiting': return t('wormhole.waiting');
        case 'transferring': return transfer.direction === 'send' ? t('wormhole.sending') : t('wormhole.receiving');
        case 'importing': return t('wormhole.importing');
        default: return '';
    }
};

export const SessionWormhole: FC = () => {
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();
    const store = useStore<DataFormulatorState>();
    const available = useSelector((state: DataFormulatorState) => state.serverConfig?.SESSION_WORMHOLE_AVAILABLE === true);
    const [transfers, setTransfers] = useState<WormholeTransfer[]>([]);
    const [dialog, setDialog] = useState<DialogState | null>(null);
    const [code, setCode] = useState('');
    const [receiveError, setReceiveError] = useState('');
    const [receiving, setReceiving] = useState(false);
    const [copied, setCopied] = useState(false);
    const previous = useRef(new Map<string, WormholeTransfer['status']>());
    const dialogRef = useRef(dialog);
    dialogRef.current = dialog;

    const refresh = useCallback(async () => {
        try { setTransfers(await listWormholeTransfers()); } catch { /* polling is best-effort */ }
    }, []);

    const upsert = useCallback((transfer: WormholeTransfer) => {
        setTransfers(list => [...list.filter(item => item.id !== transfer.id), transfer]);
    }, []);

    const dismiss = useCallback((id: string) => {
        setTransfers(list => list.filter(item => item.id !== id));
        void dismissWormholeTransfer(id).catch(() => undefined);
    }, []);

    // Received sessions still waiting to be opened survive a reload: they are listed by the server.
    useEffect(() => { if (available) void refresh(); }, [available, refresh]);

    const anyActive = transfers.some(isActiveTransfer);
    useEffect(() => {
        if (!anyActive) return;
        const timer = window.setInterval(() => void refresh(), POLL_MS);
        return () => window.clearInterval(timer);
    }, [anyActive, refresh]);

    // React to transfers finishing: refresh session lists, report sends, forget cancelled ones.
    useEffect(() => {
        const shownInDialog = dialogRef.current?.kind === 'send' ? dialogRef.current.transferId : undefined;
        for (const transfer of transfers) {
            const before = previous.current.get(transfer.id);
            if (before === transfer.status) continue;
            if (before && isActiveTransfer({ ...transfer, status: before })) {
                if (transfer.direction === 'receive' && transfer.status === 'done') notifyWorkspaceListChanged();
                if (transfer.direction === 'send' && transfer.status === 'done' && transfer.id !== shownInDialog) {
                    dispatch(dfActions.addMessages({ timestamp: Date.now(), type: 'success', component: 'workspace',
                        value: t('wormhole.sent', { name: transfer.display_name }) }));
                    dismiss(transfer.id);
                }
            }
            if (transfer.status === 'cancelled') dismiss(transfer.id);
        }
        previous.current = new Map(transfers.map(transfer => [transfer.id, transfer.status]));
    }, [transfers, dispatch, dismiss, t]);

    const startSend = useCallback(async (workspaceId: string, displayName: string) => {
        setCopied(false);
        setDialog({ kind: 'send', workspaceId, displayName });
        try {
            // Send what the user sees: persist the open session's latest changes first.
            const state = store.getState();
            if (state.activeWorkspace?.id === workspaceId && !state.activeWorkspace.readOnly
                && !dfSelectors.selectSessionEmpty(state)) {
                try { await saveWorkspaceState(getSerializableState(state)); } catch { /* the saved copy is sent */ }
            }
            const transfer = await sendSessionByWormhole(workspaceId);
            upsert(transfer);
            setDialog(current => current?.kind === 'send' && current.workspaceId === workspaceId
                ? { ...current, transferId: transfer.id } : current);
        } catch (error) {
            setDialog(current => current?.kind === 'send' && current.workspaceId === workspaceId
                ? { ...current, error: errorMessage(error) } : current);
        }
    }, [store, upsert]);

    useEffect(() => onWormholeDialogRequest(request => {
        if (request.kind === 'send') {
            void startSend(request.workspaceId, request.displayName);
        } else {
            setCode('');
            setReceiveError('');
            setDialog({ kind: 'receive' });
        }
    }), [startSend]);

    const submitReceive = async () => {
        setReceiving(true);
        setReceiveError('');
        try {
            upsert(await receiveSessionByWormhole(code));
            setDialog(null);
        } catch (error) {
            setReceiveError(errorMessage(error));
        } finally {
            setReceiving(false);
        }
    };

    const openReceived = async (transfer: WormholeTransfer) => {
        dismiss(transfer.id);
        await dispatch(openSession(transfer.workspace_id, transfer.display_name));
    };

    if (!available) return null;

    const sendTransfer = dialog?.kind === 'send' && dialog.transferId
        ? transfers.find(transfer => transfer.id === dialog.transferId) : undefined;

    const closeSendDialog = () => {
        if (sendTransfer && !isActiveTransfer(sendTransfer)) dismiss(sendTransfer.id);
        setDialog(null);
    };

    const copyCode = async (value: string) => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
        } catch { /* the code stays selectable */ }
    };

    // The send shown in the dialog isn't repeated as a card; cancelled transfers simply disappear.
    const cards = transfers.filter(transfer => transfer.id !== sendTransfer?.id && transfer.status !== 'cancelled'
        && !(transfer.direction === 'send' && transfer.status === 'done'));

    return (
        <>
            {dialog?.kind === 'send' && (
                <Dialog open onClose={closeSendDialog} maxWidth="xs" fullWidth aria-labelledby="wormhole-send-title">
                    <DialogTitle id="wormhole-send-title" sx={{ pr: 6 }}>
                        {t('wormhole.sendTitle', { name: dialog.displayName })}
                        <IconButton aria-label={t('app.close')} onClick={closeSendDialog}
                            sx={{ position: 'absolute', right: 8, top: 8, color: 'grey.500' }}>
                            <CloseIcon />
                        </IconButton>
                    </DialogTitle>
                    <DialogContent>
                        {dialog.error || sendTransfer?.status === 'failed' ? (
                            <Alert severity="error">{dialog.error || sendTransfer?.error}</Alert>
                        ) : !sendTransfer?.code ? (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 2 }}>
                                <CircularProgress size={20} />
                                <Typography sx={{ fontSize: textVar.sm }}>{t('wormhole.gettingCode')}</Typography>
                            </Box>
                        ) : sendTransfer.status === 'done' ? (
                            <Alert severity="success">{t('wormhole.sent', { name: sendTransfer.display_name })}</Alert>
                        ) : (
                            <>
                                <Typography sx={{ fontSize: textVar.sm, color: 'text.secondary' }}>{t('wormhole.codeHint')}</Typography>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, my: 1.5, px: 1.5, py: 1,
                                    borderRadius: 1, bgcolor: 'action.hover' }}>
                                    <Typography component="code" data-testid="wormhole-code"
                                        sx={{ flex: 1, fontFamily: 'monospace', fontSize: '1.25rem', userSelect: 'all', wordBreak: 'break-all' }}>
                                        {sendTransfer.code}
                                    </Typography>
                                    <Tooltip title={copied ? t('wormhole.copied') : t('wormhole.copyCode')}>
                                        <IconButton aria-label={t('wormhole.copyCode')} onClick={() => void copyCode(sendTransfer.code)}>
                                            {copied ? <CheckIcon /> : <ContentCopyIcon />}
                                        </IconButton>
                                    </Tooltip>
                                </Box>
                                <Typography sx={{ fontSize: textVar.sm }}>{statusLabel(sendTransfer, t)}</Typography>
                                <TransferProgress transfer={sendTransfer} />
                                <Typography sx={{ fontSize: textVar.xs, color: 'text.secondary', mt: 1.5 }}>
                                    {t('wormhole.shares')}
                                </Typography>
                            </>
                        )}
                    </DialogContent>
                    <DialogActions>
                        {sendTransfer && isActiveTransfer(sendTransfer) && <>
                            <Button color="error" onClick={() => { void cancelWormholeTransfer(sendTransfer.id).then(refresh); setDialog(null); }}
                                sx={{ textTransform: 'none' }}>
                                {t('wormhole.cancel')}
                            </Button>
                            <Tooltip title={t('wormhole.background')}>
                                <Button variant="contained" onClick={closeSendDialog} sx={{ textTransform: 'none' }}>{t('wormhole.hide')}</Button>
                            </Tooltip>
                        </>}
                        {!(sendTransfer && isActiveTransfer(sendTransfer)) && (
                            <Button onClick={closeSendDialog} sx={{ textTransform: 'none' }}>{t('app.close')}</Button>
                        )}
                    </DialogActions>
                </Dialog>
            )}

            {dialog?.kind === 'receive' && (
                <Dialog open onClose={() => setDialog(null)} maxWidth="xs" fullWidth aria-labelledby="wormhole-receive-title">
                    <DialogTitle id="wormhole-receive-title">{t('wormhole.receiveSession')}</DialogTitle>
                    <DialogContent>
                        <Typography sx={{ fontSize: textVar.sm, color: 'text.secondary', mb: 1.5 }}>{t('wormhole.receiveHint')}</Typography>
                        <TextField autoFocus fullWidth size="small" label={t('wormhole.codeLabel')} placeholder={t('wormhole.codePlaceholder')}
                            value={code} onChange={event => setCode(event.target.value)} error={!!receiveError} helperText={receiveError || ' '}
                            onKeyDown={event => { if (event.key === 'Enter' && code.trim() && !receiving) void submitReceive(); }}
                            slotProps={{ htmlInput: { spellCheck: false, autoComplete: 'off', 'data-testid': 'wormhole-code-input' } }} />
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setDialog(null)} sx={{ textTransform: 'none' }}>{t('app.cancel')}</Button>
                        <Button variant="contained" disabled={!code.trim() || receiving} onClick={() => void submitReceive()}
                            sx={{ textTransform: 'none' }}>
                            {t('wormhole.receive')}
                        </Button>
                    </DialogActions>
                </Dialog>
            )}

            {cards.length > 0 && (
                // Bottom right, beside the system-messages button; brief messages show above the cards.
                <Box role="region" aria-label={t('wormhole.transfers')} sx={{ position: 'fixed', right: 56, bottom: 16,
                    zIndex: theme => theme.zIndex.snackbar - 1,
                    display: 'flex', flexDirection: 'column', gap: 1, width: 340, maxWidth: 'calc(100vw - 72px)' }}>
                    {cards.map(transfer => {
                        const close = (
                            <IconButton size="small" aria-label={t('wormhole.dismiss')} onClick={() => dismiss(transfer.id)}>
                                <CloseIcon fontSize="small" />
                            </IconButton>
                        );
                        if (transfer.direction === 'receive' && transfer.status === 'done') {
                            return (
                                <Alert key={transfer.id} severity="success" variant="outlined" elevation={6} role="alertdialog"
                                    sx={{ bgcolor: 'background.paper' }} action={close}>
                                    <AlertTitle sx={{ fontSize: textVar.sm }}>{t('wormhole.receivedTitle')}</AlertTitle>
                                    <Typography sx={{ fontSize: textVar.sm }}>{t('wormhole.received', { name: transfer.display_name })}</Typography>
                                    <Button size="small" variant="contained" onClick={() => void openReceived(transfer)}
                                        sx={{ mt: 1, textTransform: 'none' }}>
                                        {t('wormhole.openSession')}
                                    </Button>
                                </Alert>
                            );
                        }
                        if (transfer.status === 'failed') {
                            return (
                                <Alert key={transfer.id} severity="error" variant="outlined" elevation={6}
                                    sx={{ bgcolor: 'background.paper' }} action={close}>
                                    <AlertTitle sx={{ fontSize: textVar.sm }}>
                                        {transfer.direction === 'send'
                                            ? t('wormhole.sendFailed', { name: transfer.display_name })
                                            : t('wormhole.receiveFailed')}
                                    </AlertTitle>
                                    <Typography sx={{ fontSize: textVar.sm }}>{transfer.error}</Typography>
                                </Alert>
                            );
                        }
                        return (
                            <Paper key={transfer.id} elevation={6} sx={{ p: 1.5 }}>
                                <Typography sx={{ fontSize: textVar.sm, fontWeight: 600 }} noWrap>
                                    {transfer.direction === 'send'
                                        ? t('wormhole.sendingNamed', { name: transfer.display_name })
                                        : transfer.display_name
                                            ? t('wormhole.receivingNamed', { name: transfer.display_name })
                                            : t('wormhole.receivingSession')}
                                </Typography>
                                <Typography sx={{ fontSize: textVar.xs, color: 'text.secondary' }}>
                                    {statusLabel(transfer, t)}
                                    {transfer.direction === 'send' && transfer.status === 'waiting' && ` · ${transfer.code}`}
                                </Typography>
                                <TransferProgress transfer={transfer} />
                                <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5, mt: 0.5 }}>
                                    {transfer.direction === 'send' && (
                                        <Button size="small" sx={{ textTransform: 'none' }} onClick={() => setDialog({
                                            kind: 'send', workspaceId: transfer.workspace_id, displayName: transfer.display_name, transferId: transfer.id,
                                        })}>
                                            {t('wormhole.showCode')}
                                        </Button>
                                    )}
                                    {transfer.status !== 'importing' && (
                                        <Button size="small" color="error" sx={{ textTransform: 'none' }}
                                            onClick={() => void cancelWormholeTransfer(transfer.id).then(refresh)}>
                                            {t('wormhole.cancel')}
                                        </Button>
                                    )}
                                </Box>
                            </Paper>
                        );
                    })}
                </Box>
            )}
        </>
    );
};

export default SessionWormhole;
