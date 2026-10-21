// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useState } from 'react';
import { Box, ButtonBase, Typography } from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CodeIcon from '@mui/icons-material/Code';
import TerminalIcon from '@mui/icons-material/Terminal';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline';
import { useTranslation } from 'react-i18next';
import type { CodeExecution, TerminalExecution, TextTurn } from '../components/ComponentType';
import { CompactMarkdown } from './InteractionEntryCard';
import { ExecutionCodeBlock, TerminalExecutionView } from '../components/TerminalApprovalDialog';

type Call = TerminalExecution | CodeExecution;
type WorkEntry = { key: string; kind: 'thought'; text: string } | { key: string; kind: 'call'; call: Call };

/** A message's work in the order it happened: its thinking and its tool calls (charts show as results). */
export const workEntriesOf = (turn: TextTurn): WorkEntry[] => {
    const calls = new Map<string, Call>([...(turn.executions || []), ...(turn.codeExecutions || [])].map(call => [call.id, call]));
    const entries: WorkEntry[] = [];
    const shown = new Set<string>();
    for (const step of turn.progressSteps || []) {
        if (step.kind === 'thought' && step.label.trim()) entries.push({ key: step.id, kind: 'thought', text: step.label });
        const call = step.executionId ? calls.get(step.executionId) : undefined;
        if (step.kind === 'tool' && call && !shown.has(call.id)) {
            shown.add(call.id);
            entries.push({ key: call.id, kind: 'call', call });
        }
    }
    // Calls with no step of their own (older sessions) follow in the order they ran.
    [...calls.values()].filter(call => !shown.has(call.id))
        .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
        .forEach(call => entries.push({ key: call.id, kind: 'call', call }));
    return entries;
};

const rowSx = { display: 'flex', width: '100%', minWidth: 0, justifyContent: 'flex-start', alignItems: 'flex-start', gap: 0.75,
    py: '3px', px: 0.75, borderRadius: 0.5, color: 'text.secondary', textAlign: 'left',
    '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
    '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main' } } as const;
const iconSx = { fontSize: 14, flexShrink: 0, mt: '3px' } as const;

/**
 * One tool call: a quiet italic line, like thinking, until opened; opened, it becomes a box with
 * its code (or command) and output in place.
 */
const CallRow: FC<{ call: Call }> = ({ call }) => {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const isCode = 'code' in call;
    const statusLabel = t(`terminal.status.${call.status}`, { defaultValue: call.status });
    const failed = call.status === 'failed' || call.status === 'rejected';
    const StatusIcon = call.status === 'completed' ? CheckCircleOutlineIcon : failed ? ErrorOutlineIcon : PauseCircleOutlineIcon;
    const Icon = isCode ? CodeIcon : TerminalIcon;
    return <Box data-work-entry sx={{ minWidth: 0, border: '1px solid', borderColor: open ? 'divider' : 'transparent', borderRadius: 1.5,
        overflow: 'hidden', transition: 'border-color 0.15s' }}>
        <ButtonBase onClick={() => setOpen(value => !value)} aria-expanded={open} sx={{ ...rowSx, px: open ? 1 : 0.5, py: open ? 0.5 : '2px',
            borderRadius: open ? 0 : 1, color: 'text.disabled', '&:hover': { bgcolor: 'action.hover', color: 'text.secondary' } }}>
            <Icon sx={{ ...iconSx, fontSize: 13 }} />
            <Typography component="span" sx={{ flex: 1, minWidth: 0, fontSize: '0.75rem', lineHeight: 1.5, fontStyle: open ? 'normal' : 'italic',
                color: open ? 'text.primary' : 'inherit',
                ...(open ? { overflowWrap: 'anywhere' } : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }) }}>
                {call.purpose || (!isCode && call.argv?.length ? call.argv.join(' ')
                    : t(isCode ? 'tool.pythonCode' : 'terminal.command', { defaultValue: isCode ? 'Python code' : 'Command' }))}
            </Typography>
            <StatusIcon role="img" aria-label={statusLabel} sx={{ ...iconSx, color: failed ? 'error.main' : 'text.disabled' }} />
            <ChevronRightIcon sx={{ ...iconSx, transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
        </ButtonBase>
        {/* Open: the code (or command) and its output, flush in the same box. */}
        {/* Details read as a quiet aside, smaller than the conversation. Fixed sizes: the reading canvas
            enlarges the shared text scale. */}
        {open && <Box sx={{ borderTop: '1px solid', borderColor: 'divider', minWidth: 0, fontSize: '0.75rem',
            '& pre': { fontSize: '0.6875rem', lineHeight: 1.55 }, '& p': { fontSize: '0.6875rem' } }}>
            {isCode ? <ExecutionCodeBlock flush code={call.code} language="python"
                label={t('tool.pythonCode', { defaultValue: 'Python code' })}
                copyLabel={t('tool.copyCode', { defaultValue: 'Copy code' })}
                result={{ output: call.output, error: call.error }} />
                : <TerminalExecutionView execution={call} detailsOnly flush />}
        </Box>}
    </Box>;
};

/**
 * The agent's work before a message, as in Copilot or Claude: its thinking as quiet text and
 * each tool call as its own box, which opens its details.
 */
export const ConversationWorkLog: FC<{ turn: TextTurn }> = ({ turn }) => {
    const entries = workEntriesOf(turn);
    if (!entries.length) return null;
    return <Box data-work-log={turn.id} sx={{ mb: 2, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {entries.map(entry => entry.kind === 'thought'
            ? <Box key={entry.key} data-work-entry sx={{ color: 'text.secondary', fontSize: '0.8125rem', lineHeight: 1.6, my: 0.5,
                '& p': { my: 0.25, fontSize: 'inherit' }, '& li': { fontSize: 'inherit' } }}>
                <CompactMarkdown content={entry.text} color="text.secondary" />
            </Box>
            : <CallRow key={entry.key} call={entry.call} />)}
    </Box>;
};
