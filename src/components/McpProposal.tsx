// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * An MCP setup the agent proposed (the configure skill's `mcp` form), reviewed inside the Tools dialog:
 * proposed servers arrive as prefilled configuration JSON; switches and the shared mode apply on the
 * user's click. The form's state lives on its text turn, so the thread records what was added.
 */

import React from 'react';
import { Box, Button, Typography, alpha } from '@mui/material';
import ExtensionOutlinedIcon from '@mui/icons-material/ExtensionOutlined';
import CheckIcon from '@mui/icons-material/Check';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { dfActions, type DataFormulatorState } from '../app/dfSlice';
import type { AppDispatch } from '../app/store';
import { textVar } from '../app/layout';
import { requestToolsDialog } from '../app/toolsSettings';
import type { McpFormArtifact, TextTurn } from './ComponentType';
import { AddServerForm, proposalConfig, useMcpSettings } from './McpServers';

type McpForm = McpFormArtifact['mcp'];
type McpChange = McpForm['changes'][number];

export const mcpFormDone = (mcp: McpForm) => mcp.add.every(item => item.addedId) && (!!mcp.applied || (!mcp.changes.length && !mcp.mode));

/** The proposal's turn, when it holds an MCP form. */
export const useMcpProposal = (turnId?: string) => useSelector((state: DataFormulatorState) => {
    const turn = turnId ? state.textTurns.find(item => item.id === turnId) : undefined;
    return turn?.form?.kind === 'mcp' ? { turn, form: turn.form } : undefined;
});

/** The agent's proposal at the top of the Tools dialog. */
export const McpProposalPanel = ({ turnId, settings, onDismiss }: {
    turnId: string;
    settings: ReturnType<typeof useMcpSettings>;
    onDismiss: () => void;
}) => {
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();
    const proposal = useMcpProposal(turnId);
    if (!proposal) return null;
    const { form } = proposal;
    const { mcp } = form;
    const { snapshot, busy, setError } = settings;

    // Patch the stored form, not this render's copy, so consecutive additions keep each other.
    const patch = (change: (current: McpForm) => McpForm) => dispatch((_: unknown, getState: () => DataFormulatorState) => {
        const latest = getState().textTurns.find(item => item.id === turnId)?.form;
        if (latest?.kind !== 'mcp') return;
        const next = change(latest.mcp);
        dispatch(dfActions.updateTextTurn({ id: turnId, ...(mcpFormDone(next) ? { answered: true } : {}), form: { ...latest, mcp: next } }));
    });
    const addProposal = async (index: number, config: string) => {
        const [server] = await settings.importConfig(config);
        if (server) patch(current => ({ ...current, add: current.add.map((item, position) => position === index ? { ...item, addedId: server.id } : item) }));
        return !!server;
    };
    const applyChanges = async () => {
        setError('');
        for (const change of mcp.changes) {
            const server = snapshot?.servers.find(item => item.id === change.serverId);
            if (!server) { setError(t('mcp.form.missing', { defaultValue: '{{name}} is no longer in your MCP servers.', name: change.serverName })); return; }
            const result = await settings.change(server, { ...(change.enabled !== undefined ? { enabled: change.enabled } : {}),
                ...(change.tools ? { tools: change.tools } : {}) });
            if (!result) return;
        }
        if (mcp.mode && !(await settings.setMode(mcp.mode))) return;
        patch(current => ({ ...current, applied: true }));
    };

    const modeLabel = (mode?: string) => ({ off: t('tools.mode.off', { defaultValue: 'Off' }), ask: t('tools.mode.ask', { defaultValue: 'Ask every time' }),
        auto: t('tools.mode.auto', { defaultValue: 'Auto when safe' }) } as Record<string, string>)[mode || ''] || mode || '';
    const describe = (change: McpChange) => [
        change.enabled === true ? t('mcp.form.turnOnServer', { defaultValue: 'Turn on {{name}}', name: change.serverName })
            : change.enabled === false ? t('mcp.form.turnOffServer', { defaultValue: 'Turn off {{name}}', name: change.serverName }) : '',
        ...[true, false].map(enabled => {
            const names = (change.tools || []).filter(tool => tool.enabled === enabled).map(tool => tool.name).join(', ');
            return names ? (enabled ? t('mcp.form.turnOnTools', { defaultValue: '{{name}}: turn on {{tools}}', name: change.serverName, tools: names })
                : t('mcp.form.turnOffTools', { defaultValue: '{{name}}: turn off {{tools}}', name: change.serverName, tools: names })) : '';
        }),
    ].filter(Boolean);
    const pending = mcp.add.map((item, index) => ({ item, index })).filter(({ item }) => !item.addedId);
    const hasChanges = (mcp.changes.length > 0 || !!mcp.mode) && !mcp.applied;
    if (!pending.length && !hasChanges) return null;
    const caption = { fontSize: textVar.xs, color: 'text.secondary', overflowWrap: 'anywhere' } as const;

    return <Box role="region" aria-label={form.title} sx={{ bgcolor: theme => alpha(theme.palette.primary.main, 0.04),
        border: '1px solid', borderColor: theme => alpha(theme.palette.primary.main, 0.25), borderRadius: 1.5, p: 1.5,
        display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        <Box>
            <Typography sx={{ fontSize: textVar.xs, color: 'primary.main' }}>{t('mcp.form.suggested', { defaultValue: 'Suggested by the agent' })}</Typography>
            <Typography sx={{ fontSize: textVar.sm, fontWeight: 600, overflowWrap: 'anywhere' }}>{form.title}</Typography>
        </Box>
        {pending.map(({ item, index }) => <Box key={index} sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {item.reason && <Typography sx={{ ...caption, fontSize: textVar.sm }}>{item.reason}</Typography>}
            <Box sx={{ pt: 0.5 }}>
                <AddServerForm busy={busy || !snapshot} initial={proposalConfig(item)} onCancel={onDismiss}
                    onSubmit={config => addProposal(index, config)} />
            </Box>
        </Box>)}
        {hasChanges && <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            <Box component="ul" sx={{ m: 0, pl: 2.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                {mcp.changes.map(change => <Box component="li" key={change.serverId} sx={{ fontSize: textVar.sm }}>
                    {describe(change).join('; ')}
                    {change.reason && <Typography component="span" sx={{ ...caption, display: 'block' }}>{change.reason}</Typography>}
                </Box>)}
                {mcp.mode && <Box component="li" sx={{ fontSize: textVar.sm }}>
                    {t('mcp.form.modeChange', { defaultValue: 'Tools approval: {{from}} → {{to}}', from: modeLabel(mcp.currentMode), to: modeLabel(mcp.mode) })}
                </Box>}
            </Box>
            {!pending.length && <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                <Button size="small" disabled={busy} onClick={onDismiss}>{t('mcp.add.cancel', { defaultValue: 'Cancel' })}</Button>
                <Button variant="contained" size="small" disableElevation disabled={busy || !snapshot} onClick={() => void applyChanges()}>
                    {t('mcp.form.apply', { defaultValue: 'Apply changes' })}</Button>
            </Box>}
        </Box>}
    </Box>;
};

/** What the canvas shows if an MCP proposal turn is focused: a short summary; the review happens in the Tools dialog. */
export const McpFormSummary = ({ turn, form }: { turn: TextTurn; form: McpFormArtifact }) => {
    const { t } = useTranslation();
    const done = mcpFormDone(form.mcp);
    return <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1.5 }}>
        <ExtensionOutlinedIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: textVar.sm, fontWeight: 600, overflowWrap: 'anywhere' }}>{form.title}</Typography>
            <Typography sx={{ fontSize: textVar.xs, color: 'text.secondary', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                {done && <CheckIcon sx={{ fontSize: 14, color: 'success.main' }} />}
                {done ? t('mcp.form.done', { defaultValue: 'Done. Manage it in Tools.' }) : t('mcp.form.waiting', { defaultValue: 'Waiting for your review in Tools.' })}
            </Typography>
        </Box>
        <Button size="small" onClick={() => requestToolsDialog(done ? undefined : turn.id)} sx={{ textTransform: 'none', flexShrink: 0 }}>
            {t('mcp.form.openTools', { defaultValue: 'Open Tools' })}
        </Button>
    </Box>;
};

