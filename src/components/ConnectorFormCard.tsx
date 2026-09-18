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
import { Box, Button, CircularProgress, Collapse, IconButton, Menu, MenuItem, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { useDispatch, useSelector } from 'react-redux';
import { Trans, useTranslation } from 'react-i18next';
import { apiRequest } from '../app/apiClient';
import { deriveConnectorDisplayName } from '../app/connectorNames';
import { CONNECTOR_URLS } from '../app/utils';
import { DataFormulatorState, dfActions } from '../app/dfSlice';
import { AppDispatch } from '../app/store';
import { iconVar, textVar } from '../app/layout';
import { getConnectorIcon } from '../icons';
import { DataLoaderForm } from '../views/DBTableManager';
import { ConnectedSourceOverview } from './ConnectedSourceOverview';
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
    /** 'bare' drops the card chrome — the canvas already frames the form. */
    variant?: 'card' | 'bare';
    onResolved: (resolution: {
        status: 'connected';
        connectorId?: string;
        connectionName: string;
    }) => void;
}

export const ConnectorFormCard: React.FC<ConnectorFormCardProps> = ({ messageId, prompt, defaultExpanded = true, variant = 'card', onResolved }) => {
    const theme = useTheme();
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();

    const sourceType = prompt.sourceType;
    const isConnected = prompt.status === 'connected';
    const isBare = variant === 'bare';
    const draftKey = `connector-form:${messageId}`;
    const currentParams = useSelector((state: DataFormulatorState) => state.dataLoaderConnectParams[draftKey]);
    const draft = useSelector((state: DataFormulatorState) => state.textTurns.find(turn => turn.id === messageId)?.form?.draft);

    const [loaders, setLoaders] = useState<LoaderMeta[]>([]);
    const meta = loaders.find(loader => loader.type === sourceType) || null;
    const [connecting, setConnecting] = useState(false);
    const [sourceMenuAnchor, setSourceMenuAnchor] = useState<HTMLElement | null>(null);
    const [metaError, setMetaError] = useState<string>('');
    const [loadingMeta, setLoadingMeta] = useState(true);
    const [expanded, setExpanded] = useState(defaultExpanded);
    // Connected-state: collapsible details panel (non-sensitive only).
    const [connExpanded, setConnExpanded] = useState(false);
    const [connDetails, setConnDetails] = useState<Array<{ label: string; value: string }>>([]);

    const createdIdRef = useRef<string | null>(prompt.connectorId ?? null);
    const provisionalIdRef = useRef<string | null>(null);
    const generatedNameRef = useRef(prompt.connectionName || '');
    const seededRef = useRef(false);
    useEffect(() => {
        seededRef.current = false;
        createdIdRef.current = prompt.connectorId ?? null;
        provisionalIdRef.current = null;
        generatedNameRef.current = prompt.connectionName || '';
    }, [sourceType, messageId]);

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
                setLoaders(data.loaders || []);
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
    }, []);

    // Seed prefilled values once. Non-sensitive fields (host, port, database, …)
    // go into redux like any typed value. Sensitive fields are handled
    // separately via `sensitivePrefill` below — they must never enter redux
    // (which is persisted), so we skip them here.
    useEffect(() => {
        if (!meta || seededRef.current || isConnected) return;
        seededRef.current = true;
        dispatch(dfActions.initializeConnectorDraft({
            id: messageId,
            fields: meta.params.filter(param => !param.sensitive && param.type !== 'password').map(param => param.name),
        }));
        const prefilled = prompt.prefilled || {};
        for (const [name, value] of Object.entries(prefilled)) {
            const def = meta.params.find(p => p.name === name);
            if (!def) continue;
            if (def.sensitive || def.type === 'password') continue;
            if (currentParams?.[name] !== undefined) continue;
            if (value === undefined || value === null || value === '') continue;
            dispatch(dfActions.updateDataLoaderConnectParam({
                dataLoaderType: draftKey,
                paramName: name,
                paramValue: String(value),
            }));
        }
    }, [meta, isConnected, prompt.prefilled, draftKey, currentParams, onResolved, messageId, dispatch]);

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

    const selectableLoaders = loaders.filter(loader => !['sample_datasets', 'local_folder'].includes(loader.type));
    const selectSource = (loader: LoaderMeta) => {
        if (connecting) return;
        setSourceMenuAnchor(null);
        dispatch(dfActions.selectConnectorFormSource({
            id: messageId,
            sourceType: loader.type,
            title: t('chatConnector.connectTo', { name: loader.name, defaultValue: 'Connect to {{name}}' }),
            fields: loader.params.filter(param => !param.sensitive && param.type !== 'password').map(param => param.name),
        }));
    };

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
        setConnDetails([]);
        apiRequest<any>(CONNECTOR_URLS.LIST, { method: 'GET' })
            .then(({ data }) => {
                if (cancelled) return;
                const inst = (data.connectors || []).find((c: ConnectorInstance) => c.id === cid);
                if (!inst) return;
                const rows: Array<{ label: string; value: string }> = [
                    { label: t('chatConnector.detailType', { defaultValue: 'type' }), value: inst.type_name || inst.source_type },
                ];
                const pinned = inst.pinned_params || {};
                for (const def of inst.params_form || []) {
                    if (def.sensitive || def.type === 'password') continue;
                    const v = pinned[def.name] ?? def.default;
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
                connect_params: {},
                persist: true,
            }),
        });
        createdIdRef.current = data.id;
        provisionalIdRef.current = data.id;
        generatedNameRef.current = displayName;
        return data.id;
    }, [sourceType, meta]);

    const handleConnectionFailed = useCallback(async () => {
        const connectorId = provisionalIdRef.current;
        if (!connectorId) return;
        provisionalIdRef.current = null;
        createdIdRef.current = null;
        try {
            await apiRequest(CONNECTOR_URLS.DELETE(connectorId), { method: 'DELETE' });
        } catch (error) {
            console.warn('Failed to remove unverified connector', connectorId, error);
        }
    }, []);

    const handleConnected = useCallback(async () => {
        const cid = createdIdRef.current;
        provisionalIdRef.current = null;
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
        const resolution = {
            status: 'connected' as const,
            connectorId: cid ?? undefined,
            connectionName: resolvedName,
        };
        onResolved(resolution);
        // Make the new source show up in the data-source sidebar.
        dispatch(dfActions.requestConnectorRefresh());
        dispatch(dfActions.addMessages({
            timestamp: Date.now(), component: 'connector', type: 'success',
            value: t('chatConnector.connectedTo', {
                name: resolvedName,
                defaultValue: 'Connected to "{{name}}"',
            }),
        }));
    }, [messageId, meta, sourceType, dispatch, t, onResolved]);

    const cardSx = {
        mt: 1,
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: 1.5,
        bgcolor: 'background.paper',
        overflow: 'hidden',
        width: '100%',
        maxWidth: 640,
    } as const;

    const formBody = loadingMeta ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
            <CircularProgress size={16} />
            <Typography sx={{ fontSize: textVar.sm, color: 'text.secondary' }}>
                {t('chatConnector.loading', { defaultValue: 'Loading connector…' })}
            </Typography>
        </Box>
    ) : metaError ? (
        <Typography sx={{ fontSize: textVar.sm, color: 'error.main' }}>{metaError}</Typography>
    ) : meta ? (
        <Box>
        {draft?.conflict && <Typography role="alert" sx={{ fontSize: textVar.sm, color: 'warning.main', mb: 1 }}>
            {t('chatConnector.editConflict', { defaultValue: 'Your newer edits were kept. Ask the agent to review the current form again.' })}
        </Typography>}
        {!!draft?.changedByAgent.length && <Typography role="status" sx={{ fontSize: textVar.sm, color: 'text.secondary', mb: 1 }}>
            {t('chatConnector.agentUpdated', { defaultValue: 'Updated by agent: {{fields}}', fields: draft.changedByAgent.join(', ') })}
        </Typography>}
        <DataLoaderForm
            key={sourceType}
            dataLoaderType={draftKey}
            loaderType={sourceType}
            paramDefs={meta.params}
            authInstructions={meta.auth_instructions || ''}
            delegatedLogin={meta.delegated_login}
            authMode={meta.auth_mode}
            authPaths={meta.auth_paths}
            compact
            comfortableSpacing={isBare}
            hideInstructions={!isBare}
            onImport={() => {}}
            onFinish={(status, message) => {
                dispatch(dfActions.addMessages({
                    timestamp: Date.now(), component: 'connector',
                    type: status === 'success' ? 'success' : 'error',
                    value: message,
                }));
            }}
            onConnected={handleConnected}
            onBusyChange={setConnecting}
            onBeforeConnect={handleBeforeConnect}
            onConnectionFailed={handleConnectionFailed}
            initialSensitiveParams={sensitivePrefill}
        />
        </Box>
    ) : sourceType ? (
        <Typography color="error" sx={{ fontSize: textVar.sm }}>
            {t('chatConnector.unavailable', { type: sourceType, defaultValue: 'Connector "{{type}}" is not available in this deployment.' })}
        </Typography>
    ) : (
        <Box>
            <Typography sx={{ mb: 1.5, fontSize: textVar.sm, color: 'text.secondary' }}>
                {t('chatConnector.chooseConnector', { defaultValue: 'Choose a connector' })}
            </Typography>
            <Box sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                borderTop: `1px solid ${theme.palette.divider}`,
            }}>
                {selectableLoaders.map((loader, index) => (
                    <Button
                        key={loader.type}
                        variant="text"
                        onClick={() => selectSource(loader)}
                        startIcon={getConnectorIcon(loader.type, { sx: { fontSize: iconVar.lg, color: 'text.secondary' } })}
                        sx={{
                            minWidth: 0,
                            justifyContent: 'flex-start',
                            px: 1.25,
                            py: 1.25,
                            borderRadius: 0,
                            borderBottom: `1px solid ${theme.palette.divider}`,
                            borderRight: { sm: index % 2 === 0 ? `1px solid ${theme.palette.divider}` : 0 },
                            color: 'text.primary',
                            fontSize: textVar.sm,
                            fontWeight: 500,
                            textTransform: 'none',
                            overflowWrap: 'anywhere',
                            '&:hover': { bgcolor: 'action.hover' },
                        }}
                    >
                        {loader.name}
                    </Button>
                ))}
            </Box>
        </Box>
    );

    const sourceSelector = <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: 1 }}>
        {getConnectorIcon(sourceType, { sx: { fontSize: iconVar.lg, color: 'text.secondary', flexShrink: 0 } })}
        <Typography component="div" sx={{ minWidth: 0,
            fontSize: isBare ? textVar.lg : textVar.md, fontWeight: 600, lineHeight: 1.35 }}>
            <Trans i18nKey="chatConnector.connectionHeading"
                defaults="Connect to <connector>{{name}}</connector>"
                values={{ name: meta?.name || sourceType || t('chatConnector.chooseSource', { defaultValue: 'a data source' }) }}
                components={{ connector: <Button
                    variant="text" disableRipple disabled={loadingMeta || connecting}
                    aria-label={t('chatConnector.connectorType', { defaultValue: 'Connector' })}
                    aria-haspopup="menu" aria-expanded={Boolean(sourceMenuAnchor)}
                    aria-controls={sourceMenuAnchor ? `connector-menu-${messageId}` : undefined}
                    onClick={event => setSourceMenuAnchor(event.currentTarget)}
                    endIcon={<ExpandMoreIcon />}
                    sx={{ minWidth: 0, maxWidth: '100%', p: 0,
                        fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 'inherit', lineHeight: 'inherit',
                        letterSpacing: 'inherit', verticalAlign: 'baseline',
                        textTransform: 'none', color: 'primary.main', textAlign: 'left',
                        overflowWrap: 'anywhere', borderRadius: 0,
                        '& .MuiButton-endIcon': { color: 'inherit', flexShrink: 0, ml: 0.5, mr: 0 },
                        '&:hover, &.Mui-focusVisible': {
                            bgcolor: 'transparent', textDecoration: 'underline', textUnderlineOffset: '3px',
                        },
                    }} /> }}
            />
        </Typography>
        <Menu id={`connector-menu-${messageId}`} anchorEl={sourceMenuAnchor}
            open={Boolean(sourceMenuAnchor)} onClose={() => setSourceMenuAnchor(null)}
            slotProps={{ paper: { sx: { maxHeight: 360, maxWidth: 'calc(100vw - 32px)', minWidth: 220 } } }}>
            {selectableLoaders.map(loader =>
                <MenuItem key={loader.type} selected={loader.type === sourceType} disabled={connecting}
                    onClick={() => selectSource(loader)} sx={{ gap: 1, whiteSpace: 'normal', overflowWrap: 'anywhere', fontSize: textVar.sm }}>
                    {getConnectorIcon(loader.type, { sx: { fontSize: iconVar.md, color: 'text.secondary', flexShrink: 0 } })}
                    {loader.name}
                </MenuItem>)}
        </Menu>
    </Box>;

    // Connected: a compact, borderless button that expands to reveal the
    // connection's non-sensitive configuration (mirrors the code-block cards).
    if (isConnected) {
        const name = prompt.connectionName || meta?.name || sourceType;
        if (isBare) return (
            <Box sx={{ height: '100%', minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <Box sx={{ pb: 1, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                        {getConnectorIcon(sourceType, { sx: { fontSize: 16, color: 'text.secondary', flexShrink: 0 } })}
                        <Typography component="h1" sx={{ minWidth: 0, m: 0, fontSize: 12, lineHeight: 1.5, fontWeight: 400, color: 'text.secondary', overflowWrap: 'anywhere' }}>{name}</Typography>
                        <Tooltip title={t('chatConnector.connected', { defaultValue: 'Connected' })}>
                            <CheckIcon aria-label={t('chatConnector.connected', { defaultValue: 'Connected' })} sx={{ fontSize: 14, color: 'success.main', flexShrink: 0 }} />
                        </Tooltip>
                        <Tooltip title={t('chatConnector.connectionDetails', { defaultValue: 'Connection details' })}>
                            <IconButton size="small" aria-label={t('chatConnector.connectionDetails', { defaultValue: 'Connection details' })}
                                sx={{ ml: 'auto', color: 'text.secondary', flexShrink: 0 }}
                                aria-expanded={connExpanded} onClick={() => setConnExpanded(current => !current)}>
                                <InfoOutlinedIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    </Box>
                    <Collapse in={connExpanded} unmountOnExit>
                        <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'minmax(80px, auto) minmax(0, 1fr)',
                            columnGap: 2, rowGap: 0.75, mt: 1.5, mb: 0, maxHeight: 140, overflow: 'auto' }}>
                            {connDetails.map(row => <React.Fragment key={row.label}>
                                <Typography component="dt" variant="caption" color="text.secondary" sx={{ textTransform: 'capitalize' }}>{row.label.replace(/_/g, ' ')}</Typography>
                                <Typography component="dd" variant="caption" sx={{ m: 0, overflowWrap: 'anywhere' }}>{row.value}</Typography>
                            </React.Fragment>)}
                        </Box>
                    </Collapse>
                </Box>
                {prompt.connectorId && <ConnectedSourceOverview key={prompt.connectorId} connectorId={prompt.connectorId} />}
            </Box>
        );
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
                    {getConnectorIcon(sourceType, { sx: { fontSize: iconVar.md, opacity: 0.8 } })}
                    <CheckIcon sx={{ fontSize: iconVar.sm }} />
                    <Typography sx={{ fontSize: textVar.sm, fontWeight: 600 }}>
                        {t('chatConnector.connectedChip', {
                            name,
                            defaultValue: 'Connected to {{name}}',
                        })}
                    </Typography>
                    {connExpanded
                        ? <ExpandLessIcon sx={{ fontSize: iconVar.md, opacity: 0.7 }} />
                        : <ExpandMoreIcon sx={{ fontSize: iconVar.md, opacity: 0.7 }} />}
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
                                <Typography sx={{ fontSize: textVar.xs, color: 'text.secondary' }}>{row.label}</Typography>
                                <Typography sx={{ fontSize: textVar.xs, color: 'text.primary', wordBreak: 'break-all' }}>{row.value}</Typography>
                            </React.Fragment>
                        ))}
                        {typeof prompt.tableCount === 'number' && (
                            <React.Fragment>
                                <Typography sx={{ fontSize: textVar.xs, color: 'text.secondary' }}>
                                    {t('chatConnector.tablesLabel', { defaultValue: 'tables' })}
                                </Typography>
                                <Typography sx={{ fontSize: textVar.xs, color: 'text.primary' }}>{prompt.tableCount}</Typography>
                            </React.Fragment>
                        )}
                        {!isBare && connDetails.length === 0 && typeof prompt.tableCount !== 'number' && (
                            <Typography sx={{ fontSize: textVar.xs, color: 'text.disabled', gridColumn: '1 / -1' }}>
                                {t('chatConnector.noDetails', { defaultValue: 'No additional details.' })}
                            </Typography>
                        )}
                    </Box>
                </Collapse>
            </Box>
        );
    }

    if (isBare) {
        return <Box sx={{ width: '100%', minWidth: 0, position: 'relative' }}>
            <Box sx={{ pb: 1.5, mb: 2, borderBottom: 1, borderColor: 'divider' }}>{sourceSelector}</Box>
            {formBody}
        </Box>;
    }

    return (
        <Box sx={cardSx}>
            {/* Header — connector identity + collapse toggle */}
            <Box
                sx={{
                    display: 'flex', alignItems: 'center', gap: 1,
                    px: 1.5, py: 1,
                    bgcolor: alpha(theme.palette.primary.main, 0.04),
                    borderBottom: expanded ? `1px solid ${theme.palette.divider}` : 'none',
                }}
            >
                {sourceSelector}
                <IconButton size="small" onClick={() => setExpanded(current => !current)} aria-expanded={expanded}
                    aria-label={t('chatConnector.toggleForm', { defaultValue: 'Toggle connection details' })}>
                {expanded ? <ExpandLessIcon sx={{ fontSize: iconVar.lg, opacity: 0.6 }} /> : <ExpandMoreIcon sx={{ fontSize: iconVar.lg, opacity: 0.6 }} />}
                </IconButton>
            </Box>

            <Collapse in={expanded} timeout="auto" unmountOnExit>
                <Box sx={{ px: 1.5, py: 1.25, position: 'relative' }}>
                    {formBody}
                </Box>
            </Collapse>
        </Box>
    );
};
