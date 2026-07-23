// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ConnectorFormCard — inline connection form rendered inside the data-loading
 * chat (design 38). The agent proposes a connection via the `propose_connection`
 * tool; the resulting `connectorForm` prompt on a chat message is rendered here.
 *
 * One card === one new connection. The card fetches the connector's parameter /
 * auth schema itself (from /api/data-loaders), seeds any prefilled values the
 * agent was given (non-sensitive into redux, credentials the user shared into
 * the form's transient state only), and — on connect — creates the connector
 * (create-on-connect via `onBeforeConnect`), marks the prompt connected, and
 * asks the app to refresh the data-source sidebar so the new source appears.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, CircularProgress, Collapse, Typography, alpha, useTheme } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { apiRequest } from '../app/apiClient';
import { deriveConnectorDisplayName } from '../app/connectorNames';
import { CONNECTOR_URLS } from '../app/utils';
import { dfActions } from '../app/dfSlice';
import { AppDispatch } from '../app/store';
import { getConnectorIcon } from '../icons';
import { DataLoaderForm } from '../views/DBTableManager';
import type { ConnectorFormPrompt, ConnectorInstance, ConnectorAuthPath } from './ComponentType';

interface LoaderMeta {
    type: string;
    name: string;
    params: Array<{ name: string; type: string; required: boolean; default?: string | number | boolean; options?: string[]; advanced?: boolean; description?: string; sensitive?: boolean; tier?: 'connection' | 'auth' | 'filter' }>;
    auth_mode?: string;
    auth_paths?: ConnectorAuthPath[];
    auth_instructions?: string;
    delegated_login?: { login_url: string; label?: string; params?: string[] } | null;
}

interface ConnectorFormCardProps {
    messageId: string;
    prompt: ConnectorFormPrompt;
    /** Whether this card should be expanded. The chat keeps only the latest
     *  pending form open; older ones collapse to a header the user can reopen. */
    defaultExpanded?: boolean;
}

export const ConnectorFormCard: React.FC<ConnectorFormCardProps> = ({ messageId, prompt, defaultExpanded = true }) => {
    const theme = useTheme();
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();

    const sourceType = prompt.sourceType;
    const isConnected = prompt.status === 'connected';

    const [meta, setMeta] = useState<LoaderMeta | null>(null);
    const [metaError, setMetaError] = useState<string>('');
    const [loadingMeta, setLoadingMeta] = useState(true);
    const [expanded, setExpanded] = useState(defaultExpanded);
    // Connected-state: collapsible details panel (non-sensitive only).
    const [connExpanded, setConnExpanded] = useState(false);
    const [connDetails, setConnDetails] = useState<Array<{ label: string; value: string }>>([]);

    const createdIdRef = useRef<string | null>(prompt.connectorId ?? null);
    const generatedNameRef = useRef(prompt.connectionName || '');
    const seededRef = useRef(false);

    // Fetch the connector's param/auth schema. The agent only sends the type;
    // the frontend owns the full field definitions (same source the Add
    // Connection panel uses).
    useEffect(() => {
        let cancelled = false;
        setLoadingMeta(true);
        setMetaError('');
        apiRequest<any>(CONNECTOR_URLS.DATA_LOADERS, { method: 'GET' })
            .then(({ data }) => {
                if (cancelled) return;
                const found = (data.loaders || []).find((l: LoaderMeta) => l.type === sourceType) || null;
                if (!found) {
                    setMetaError(t('chatConnector.unavailable', {
                        type: sourceType,
                        defaultValue: 'Connector "{{type}}" is not available in this deployment.',
                    }));
                }
                setMeta(found);
            })
            .catch(() => {
                if (!cancelled) {
                    setMetaError(t('chatConnector.metaFailed', {
                        defaultValue: 'Could not load connector details.',
                    }));
                }
            })
            .finally(() => { if (!cancelled) setLoadingMeta(false); });
        return () => { cancelled = true; };
    }, [sourceType]); // eslint-disable-line react-hooks/exhaustive-deps

    // Seed prefilled values once. Non-sensitive fields (host, port, database, …)
    // go into redux like any typed value. Sensitive fields are handled
    // separately via `sensitivePrefill` below — they must never enter redux
    // (which is persisted), so we skip them here.
    useEffect(() => {
        if (!meta || seededRef.current || isConnected) return;
        seededRef.current = true;
        const prefilled = prompt.prefilled || {};
        for (const [name, value] of Object.entries(prefilled)) {
            const def = meta.params.find(p => p.name === name);
            if (!def) continue;
            if (def.sensitive || def.type === 'password') continue;
            if (value === undefined || value === null || value === '') continue;
            dispatch(dfActions.updateDataLoaderConnectParam({
                dataLoaderType: sourceType,
                paramName: name,
                paramValue: String(value),
            }));
        }
    }, [meta, isConnected, prompt.prefilled, sourceType, dispatch]);

    // Credentials the user shared with the agent (e.g. a password). Passed to
    // the form as a one-time seed for its transient sensitive state — never
    // redux, never persisted. Only keys the loader marks sensitive are kept.
    const sensitivePrefill = useMemo(() => {
        if (!meta || isConnected) return undefined;
        const prefilled = prompt.prefilled || {};
        const out: Record<string, string> = {};
        for (const [name, value] of Object.entries(prefilled)) {
            const def = meta.params.find(p => p.name === name);
            if (!def || !(def.sensitive || def.type === 'password')) continue;
            if (value === undefined || value === null || value === '') continue;
            out[name] = String(value);
        }
        return Object.keys(out).length > 0 ? out : undefined;
    }, [meta, isConnected, prompt.prefilled]);

    // Once connected, fetch the registered connector so the collapsible panel
    // can show its non-sensitive configuration (host, port, database, …).
    // Sensitive params (passwords, tokens) live in the vault and are never
    // returned, so they can't leak here. Runs on reload too (the persisted
    // prompt only carries name/id), keeping the details self-healing.
    useEffect(() => {
        if (!isConnected) return;
        const cid = prompt.connectorId;
        if (!cid) return;
        let cancelled = false;
        apiRequest<any>(CONNECTOR_URLS.LIST, { method: 'GET' })
            .then(({ data }) => {
                if (cancelled) return;
                const inst = (data.connectors || []).find((c: ConnectorInstance) => c.id === cid);
                if (!inst) return;
                const rows: Array<{ label: string; value: string }> = [
                    { label: t('chatConnector.detailType', { defaultValue: 'type' }), value: inst.source_type },
                ];
                const pinned = inst.pinned_params || {};
                for (const def of inst.params_form || []) {
                    if (def.sensitive || def.type === 'password') continue;
                    const v = pinned[def.name];
                    if (v === undefined || v === null || String(v) === '') continue;
                    rows.push({ label: def.name, value: String(v) });
                }
                setConnDetails(rows);
            })
            .catch(() => { /* details are best-effort */ });
        return () => { cancelled = true; };
    }, [isConnected, prompt.connectorId, t]);

    // create-on-connect: called by DataLoaderForm right before it connects.
    const handleBeforeConnect = useCallback(async (params: Record<string, any>): Promise<string> => {
        if (createdIdRef.current) return createdIdRef.current;
        const displayName = deriveConnectorDisplayName(meta?.name || sourceType, params);
        const { data } = await apiRequest<any>(CONNECTOR_URLS.CREATE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                loader_type: sourceType,
                display_name: displayName,
                icon: sourceType,
                params,
                persist: true,
            }),
        });
        createdIdRef.current = data.id;
        generatedNameRef.current = displayName;
        return data.id;
    }, [sourceType, meta]);

    const handleConnected = useCallback(async () => {
        const cid = createdIdRef.current;
        let resolvedName = generatedNameRef.current || meta?.name || sourceType;
        if (cid) {
            try {
                const { data } = await apiRequest<any>(CONNECTOR_URLS.LIST, { method: 'GET' });
                const created = (data.connectors || []).find((c: ConnectorInstance) => c.id === cid);
                if (created?.display_name) resolvedName = created.display_name;
            } catch {
                // Connection succeeded even if the follow-up list fetch fails.
            }
        }
        dispatch(dfActions.resolveConnectorForm({
            messageId,
            status: 'connected',
            connectorId: cid ?? undefined,
            connectionName: resolvedName,
        }));
        // Make the new source show up in the data-source sidebar.
        dispatch(dfActions.requestConnectorRefresh());
        dispatch(dfActions.addMessages({
            timestamp: Date.now(), component: 'connector', type: 'success',
            value: t('chatConnector.connectedTo', {
                name: resolvedName,
                defaultValue: 'Connected to "{{name}}"',
            }),
        }));
        // Inform the agent so it can naturally continue (e.g. browse the new
        // source and give a comprehensive overview). Sent as a hidden trigger —
        // it is part of the agent's context but never shown as a user bubble;
        // the agent's reply is visible (design 38 §7).
        dispatch(dfActions.setDataLoadingChatPending({
            text: t('chatConnector.connectedAgentTrigger', {
                name: resolvedName,
                type: sourceType,
                defaultValue:
                    'I just connected a new data source "{{name}}" (type: {{type}}). '
                    + 'Browse it and give me a concise but comprehensive overview: what '
                    + 'databases/schemas it contains, the notable tables in each (with a '
                    + 'one-line hint of what they hold and their approximate size where '
                    + 'known), and any groupings or themes you notice. Then suggest a '
                    + 'couple of good starting points and ask what I would like to '
                    + 'explore or load.',
            }),
            images: [],
            attachments: [],
            hidden: true,
        }));
    }, [messageId, meta, sourceType, dispatch, t]);

    const cardSx = {
        mt: 1,
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: 1.5,
        bgcolor: 'background.paper',
        overflow: 'hidden',
        width: '100%',
        maxWidth: 640,
    } as const;

    // Connected: a compact, borderless button that expands to reveal the
    // connection's non-sensitive configuration (mirrors the code-block cards).
    if (isConnected) {
        const name = prompt.connectionName || meta?.name || sourceType;
        return (
            <Box sx={{ mt: 1, maxWidth: 420 }}>
                <Box
                    onClick={() => setConnExpanded(e => !e)}
                    sx={{
                        display: 'inline-flex', alignItems: 'center', gap: 0.75,
                        px: 1, py: 0.5, borderRadius: 1, cursor: 'pointer',
                        color: 'success.main',
                        '&:hover': { bgcolor: alpha(theme.palette.success.main, 0.08) },
                        transition: 'background-color 120ms',
                    }}
                >
                    {getConnectorIcon(sourceType, { sx: { fontSize: 16, opacity: 0.8 } })}
                    <CheckIcon sx={{ fontSize: 14 }} />
                    <Typography sx={{ fontSize: 12, fontWeight: 600 }}>
                        {t('chatConnector.connectedChip', {
                            name,
                            defaultValue: 'Connected to {{name}}',
                        })}
                    </Typography>
                    {connExpanded
                        ? <ExpandLessIcon sx={{ fontSize: 16, opacity: 0.7 }} />
                        : <ExpandMoreIcon sx={{ fontSize: 16, opacity: 0.7 }} />}
                </Box>
                <Collapse in={connExpanded} timeout="auto" unmountOnExit>
                    <Box sx={{
                        mt: 0.5, ml: 1, pl: 1.25,
                        borderLeft: `2px solid ${alpha(theme.palette.success.main, 0.25)}`,
                        display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)',
                        columnGap: 1.5, rowGap: 0.5,
                    }}>
                        {connDetails.map(row => (
                            <React.Fragment key={row.label}>
                                <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{row.label}</Typography>
                                <Typography sx={{ fontSize: 11, color: 'text.primary', wordBreak: 'break-all' }}>{row.value}</Typography>
                            </React.Fragment>
                        ))}
                        {typeof prompt.tableCount === 'number' && (
                            <React.Fragment>
                                <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                                    {t('chatConnector.tablesLabel', { defaultValue: 'tables' })}
                                </Typography>
                                <Typography sx={{ fontSize: 11, color: 'text.primary' }}>{prompt.tableCount}</Typography>
                            </React.Fragment>
                        )}
                        {connDetails.length === 0 && typeof prompt.tableCount !== 'number' && (
                            <Typography sx={{ fontSize: 11, color: 'text.disabled', gridColumn: '1 / -1' }}>
                                {t('chatConnector.noDetails', { defaultValue: 'No additional details.' })}
                            </Typography>
                        )}
                    </Box>
                </Collapse>
            </Box>
        );
    }

    return (
        <Box sx={cardSx}>
            {/* Header — connector identity + collapse toggle */}
            <Box
                sx={{
                    display: 'flex', alignItems: 'center', gap: 1,
                    px: 1.5, py: 1, cursor: 'pointer',
                    bgcolor: alpha(theme.palette.primary.main, 0.04),
                    borderBottom: expanded ? `1px solid ${theme.palette.divider}` : 'none',
                }}
                onClick={() => setExpanded(e => !e)}
            >
                {getConnectorIcon(sourceType, { sx: { fontSize: 18, opacity: 0.7 } })}
                <Typography sx={{ fontSize: 13, fontWeight: 600, flex: 1 }}>
                    {t('chatConnector.connectTo', {
                        name: meta?.name || sourceType,
                        defaultValue: 'Connect to {{name}}',
                    })}
                </Typography>
                {expanded ? <ExpandLessIcon sx={{ fontSize: 18, opacity: 0.6 }} /> : <ExpandMoreIcon sx={{ fontSize: 18, opacity: 0.6 }} />}
            </Box>

            <Collapse in={expanded} timeout="auto" unmountOnExit>
                <Box sx={{ px: 1.5, py: 1.25, position: 'relative' }}>
                    {loadingMeta ? (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
                            <CircularProgress size={16} />
                            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                                {t('chatConnector.loading', { defaultValue: 'Loading connector…' })}
                            </Typography>
                        </Box>
                    ) : metaError ? (
                        <Typography sx={{ fontSize: 12, color: 'error.main' }}>{metaError}</Typography>
                    ) : meta ? (
                        <DataLoaderForm
                            dataLoaderType={sourceType}
                            paramDefs={meta.params}
                            authInstructions={meta.auth_instructions || ''}
                            delegatedLogin={meta.delegated_login}
                            authMode={meta.auth_mode}
                            authPaths={meta.auth_paths}
                            compact
                            hideInstructions
                            onImport={() => {}}
                            onFinish={(status, message) => {
                                dispatch(dfActions.addMessages({
                                    timestamp: Date.now(), component: 'connector',
                                    type: status === 'success' ? 'success' : 'error',
                                    value: message,
                                }));
                            }}
                            onConnected={handleConnected}
                            onBeforeConnect={handleBeforeConnect}
                            initialSensitiveParams={sensitivePrefill}
                        />
                    ) : null}
                </Box>
            </Collapse>
        </Box>
    );
};
