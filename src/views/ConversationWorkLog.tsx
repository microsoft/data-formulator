// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, ReactNode, useState } from 'react';
import { Box, ButtonBase, Link, Typography } from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CodeIcon from '@mui/icons-material/Code';
import TerminalIcon from '@mui/icons-material/Terminal';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline';
import SearchIcon from '@mui/icons-material/Search';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import EditNoteIcon from '@mui/icons-material/EditNote';
import BuildOutlinedIcon from '@mui/icons-material/BuildOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { useTranslation } from 'react-i18next';
import type { ProgressStep, TerminalExecution, TextTurn, ToolCall } from '../components/ComponentType';
import { CompactMarkdown } from './InteractionEntryCard';
import { ExecutionCodeBlock, TerminalExecutionView } from '../components/TerminalApprovalDialog';
import { asCodeExecution, isCodeCall } from '../app/toolCalls';
import { formatAnalystToolProgress } from './analystToolProgress';

type Call = TerminalExecution | ToolCall;
type WorkEntry =
    | { key: string; kind: 'thought'; text: string }
    | { key: string; kind: 'call'; call: Call }
    // A tool step saved without its record (sessions before tool-call records): its line, and its error.
    | { key: string; kind: 'step'; label: string; tool?: string; status: ProgressStep['status']; error?: string }
    // A step the agent tried that was rejected or failed; it tried again or went on.
    | { key: string; kind: 'warning'; text: string };

/** How to open a path the agent named (a table, chart, report or file) on the canvas; undefined when it is gone. */
export type OpenSessionPath = (path: string) => (() => void) | undefined;

/** A saved progress line reads as a record: "Reading: x", not "reading: x...". */
const recordLabel = (label: string): string => {
    const text = label.trim().replace(/(\.\.\.|…)$/, '').trim();
    return text.charAt(0).toUpperCase() + text.slice(1);
};

const isTerminal = (call: Call): call is TerminalExecution => 'argv' in call;

/**
 * A message's work in the order it happened: its thinking, its tool calls and the attempts that
 * failed. Charts show as results, so their progress lines are left out.
 */
export const workEntriesOf = (turn: TextTurn): WorkEntry[] => {
    const calls = new Map<string, Call>([...(turn.executions || []), ...(turn.toolCalls || [])].map(call => [call.id, call]));
    const entries: WorkEntry[] = [];
    const shown = new Set<string>();
    for (const step of turn.progressSteps || []) {
        if (step.kind === 'thought' && step.label.trim()) entries.push({ key: step.id, kind: 'thought', text: step.label });
        if (step.kind === 'tool') {
            const call = [step.executionId, step.toolCallId].map(id => id ? calls.get(id) : undefined).find(Boolean);
            if (call && !shown.has(call.id)) {
                shown.add(call.id);
                entries.push({ key: call.id, kind: 'call', call });
            } else if (!call && (step.label.trim() || step.tool)) {
                entries.push({ key: step.id, kind: 'step', label: recordLabel(step.label) || step.tool!, tool: step.tool,
                    status: step.status });
            }
        }
        if (step.kind === 'warning' && step.label.trim()) {
            // A failed call's error belongs on that call, which shows it.
            const last = entries[entries.length - 1];
            if (last?.kind === 'call' && last.call.status === 'failed') continue;
            if (last?.kind === 'step' && last.status === 'failed' && !last.error) {
                last.error = step.label.trim();
                continue;
            }
            entries.push({ key: step.id, kind: 'warning', text: recordLabel(step.label) });
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
const preSx = { m: 0, px: 1, py: 0.75, fontFamily: 'monospace', fontSize: '0.6875rem', lineHeight: 1.55, whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere', maxHeight: 320, overflowY: 'auto', color: 'text.primary' } as const;
const sectionLabelSx = { px: 1, pt: 0.75, fontSize: '0.6875rem', fontWeight: 600, color: 'text.secondary' } as const;

const iconOf = (call: Call) => isTerminal(call) ? TerminalIcon : isCodeCall(call) ? CodeIcon
    : call.tool.startsWith('search') ? SearchIcon
    : ['read_file', 'list_files'].includes(call.tool) ? DescriptionOutlinedIcon
    : ['edit_file', 'create_file', 'move_file', 'delete_items'].includes(call.tool) ? EditNoteIcon : BuildOutlinedIcon;

/** The paths a call names, in order: what `read_file` read, where `search` looked, what an edit changed. */
const pathsOf = (call: ToolCall): string[] => {
    const args = call.args || {};
    const files = Array.isArray(args.files) ? args.files.map((item: any) => typeof item === 'string' ? item : item?.path) : [];
    const scope = Array.isArray(args.path) ? args.path : [args.path, args.filename];
    return [...files, ...scope].filter((path): path is string => typeof path === 'string' && !!path.trim());
};

const Section: FC<{ label: string; children: ReactNode }> = ({ label, children }) =>
    <Box sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
        <Typography sx={sectionLabelSx}>{label}</Typography>
        {children}
    </Box>;

/** A path the user can open while it still exists; otherwise plain text. */
const PathLink: FC<{ path: string; onOpenPath?: OpenSessionPath }> = ({ path, onOpenPath }) => {
    const open = onOpenPath?.(path);
    if (!open) return <Box component="span" sx={{ fontFamily: 'monospace' }}>{path}</Box>;
    return <Link component="button" underline="hover" sx={{ fontFamily: 'monospace', fontSize: 'inherit', textAlign: 'left' }}
        onClick={open}>{path}</Link>;
};

/** The text that came back, capped by the server; the note says how much was left out. */
const Output: FC<{ call: ToolCall }> = ({ call }) => {
    const { t } = useTranslation();
    const total = call.truncated?.output;
    return <>
        {call.output && <Section label={t('tool.output', { defaultValue: 'Output' })}>
            <Box component="pre" sx={preSx}>{call.output}</Box>
            {total && <Typography sx={{ px: 1, pb: 0.5, fontSize: '0.6875rem', color: 'text.disabled' }}>
                {t('tool.outputTruncated', { defaultValue: 'Showing the start and end of {{size}} characters', size: total.toLocaleString() })}
            </Typography>}
        </Section>}
        {call.error && <Section label={t('tool.error', { defaultValue: 'Error' })}>
            <Box component="pre" sx={{ ...preSx, color: 'error.main' }}>{call.error}</Box>
        </Section>}
    </>;
};

/** What a call was asked to do, by tool: the paths it touched, a search's query, an edit's change, or its arguments. */
const CallDetails: FC<{ call: ToolCall; onOpenPath?: OpenSessionPath }> = ({ call, onOpenPath }) => {
    const { t } = useTranslation();
    const args = call.args || {};
    const paths = pathsOf(call);
    const pathList = paths.length > 0 && <Box sx={{ px: 1, py: 0.5, display: 'flex', flexDirection: 'column', gap: 0.25,
        fontSize: '0.6875rem' }}>
        {paths.map((path, index) => <PathLink key={`${path}-${index}`} path={path} onOpenPath={onOpenPath} />)}
    </Box>;
    switch (call.tool) {
        case 'read_file':
        case 'list_files':
            return <>{pathList}<Output call={call} /></>;
        case 'search':
            return <>
                <Section label={t('tool.query', { defaultValue: 'Query' })}>
                    <Typography sx={{ px: 1, pb: 0.5, fontSize: '0.6875rem', fontFamily: 'monospace', overflowWrap: 'anywhere' }}>
                        {String(args.query ?? '')}
                        {args.regex ? <Box component="span" sx={{ fontFamily: 'inherit', color: 'text.secondary' }}>
                            {` (${t('tool.regex', { defaultValue: 'regular expression' })})`}</Box> : null}
                    </Typography>
                </Section>
                {pathList && <Section label={t('tool.searchedIn', { defaultValue: 'Searched in' })}>{pathList}</Section>}
                <Output call={call} />
            </>;
        case 'edit_file': {
            const replacements = Array.isArray(args.replacements) ? args.replacements as { old_text?: string; new_text?: string }[] : [];
            return <>
                {pathList}
                {replacements.length > 0 && <Section label={t('tool.changes', { defaultValue: 'Changes' })}>
                    <Box component="pre" sx={preSx}>{replacements.map(item => [
                        ...String(item.old_text ?? '').split('\n').map(line => `- ${line}`),
                        ...String(item.new_text ?? '').split('\n').map(line => `+ ${line}`),
                    ].join('\n')).join('\n\n')}</Box>
                </Section>}
                {typeof args.append_text === 'string' && <Section label={t('tool.appended', { defaultValue: 'Appended' })}>
                    <Box component="pre" sx={preSx}>{args.append_text}</Box>
                </Section>}
                {typeof args.content === 'string' && <Section label={t('tool.content', { defaultValue: 'Content' })}>
                    <Box component="pre" sx={preSx}>{args.content}</Box>
                </Section>}
                {typeof args.code === 'string' && <ExecutionCodeBlock flush code={args.code} language="python"
                    label={t('tool.pythonCode', { defaultValue: 'Python code' })} copyLabel={t('tool.copyCode', { defaultValue: 'Copy code' })} />}
                <Output call={call} />
            </>;
        }
        case 'create_file':
            return <>
                {pathList}
                {typeof args.content === 'string' && <Section label={t('tool.content', { defaultValue: 'Content' })}>
                    <Box component="pre" sx={preSx}>{args.content}</Box>
                </Section>}
                {typeof args.code === 'string' && <ExecutionCodeBlock flush code={args.code} language="python"
                    label={t('tool.pythonCode', { defaultValue: 'Python code' })} copyLabel={t('tool.copyCode', { defaultValue: 'Copy code' })} />}
                <Output call={call} />
            </>;
        default: {
            const { code, ...rest } = args;
            return <>
                {pathList}
                {Object.keys(rest).length > 0 && <Section label={t('tool.arguments', { defaultValue: 'Arguments' })}>
                    <Box component="pre" sx={preSx}>{JSON.stringify(rest, null, 2)}</Box>
                </Section>}
                {typeof code === 'string' && <ExecutionCodeBlock flush code={code} language="python"
                    label={t('tool.pythonCode', { defaultValue: 'Python code' })} copyLabel={t('tool.copyCode', { defaultValue: 'Copy code' })} />}
                <Output call={call} />
            </>;
        }
    }
};

/**
 * One tool call: a quiet italic line, like thinking, until opened; opened, it becomes a box with
 * what it was asked and what came back, shown for its tool (code as code, edits as changes).
 */
const CallRow: FC<{ call: Call; onOpenPath?: OpenSessionPath }> = ({ call, onOpenPath }) => {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const statusLabel = t(`terminal.status.${call.status}`, { defaultValue: call.status });
    const failed = call.status === 'failed' || call.status === 'rejected';
    const StatusIcon = call.status === 'completed' ? CheckCircleOutlineIcon : failed ? ErrorOutlineIcon : PauseCircleOutlineIcon;
    const Icon = iconOf(call);
    const code = !isTerminal(call) && isCodeCall(call) ? asCodeExecution(call) : undefined;
    const title = isTerminal(call)
        ? call.purpose || (call.argv?.length ? call.argv.join(' ') : t('terminal.command', { defaultValue: 'Command' }))
        : code ? code.purpose || t('tool.pythonCode', { defaultValue: 'Python code' })
        : recordLabel(formatAnalystToolProgress(call.tool, call.args, t) || call.tool);
    return <Box data-work-entry sx={{ minWidth: 0, border: '1px solid', borderColor: open ? 'divider' : 'transparent', borderRadius: 1.5,
        overflow: 'hidden', transition: 'border-color 0.15s' }}>
        <ButtonBase onClick={() => setOpen(value => !value)} aria-expanded={open} sx={{ ...rowSx, px: open ? 1 : 0.5, py: open ? 0.5 : '2px',
            borderRadius: open ? 0 : 1, color: 'text.disabled', '&:hover': { bgcolor: 'action.hover', color: 'text.secondary' } }}>
            <Icon sx={{ ...iconSx, fontSize: 13 }} />
            <Typography component="span" sx={{ flex: 1, minWidth: 0, fontSize: '0.75rem', lineHeight: 1.5, fontStyle: open ? 'normal' : 'italic',
                color: open ? 'text.primary' : 'inherit',
                ...(open ? { overflowWrap: 'anywhere' } : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }) }}>
                {title}
            </Typography>
            <StatusIcon role="img" aria-label={statusLabel} sx={{ ...iconSx, color: failed ? 'error.main' : 'text.disabled' }} />
            <ChevronRightIcon sx={{ ...iconSx, transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
        </ButtonBase>
        {/* Details read as a quiet aside, smaller than the conversation. Fixed sizes: the reading canvas
            enlarges the shared text scale. */}
        {open && <Box sx={{ borderTop: '1px solid', borderColor: 'divider', minWidth: 0, fontSize: '0.75rem',
            '& pre': { fontSize: '0.6875rem', lineHeight: 1.55 }, '& p': { fontSize: '0.6875rem' } }}>
            {isTerminal(call) ? <TerminalExecutionView execution={call} detailsOnly flush />
                : code ? <ExecutionCodeBlock flush code={code.code} language="python"
                    label={t('tool.pythonCode', { defaultValue: 'Python code' })}
                    copyLabel={t('tool.copyCode', { defaultValue: 'Copy code' })}
                    result={{ output: code.output, error: code.error }} />
                : <CallDetails call={call} onOpenPath={onOpenPath} />}
        </Box>}
    </Box>;
};

/** A tool step saved without its record (older sessions): one quiet line; failed, it opens its error. */
const StepRow: FC<{ entry: Extract<WorkEntry, { kind: 'step' }> }> = ({ entry }) => {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const failed = entry.status === 'failed';
    const Icon = entry.tool?.startsWith('search') ? SearchIcon : DescriptionOutlinedIcon;
    const line = <>
        <Icon sx={{ ...iconSx, fontSize: 13 }} />
        <Typography component="span" sx={{ flex: 1, minWidth: 0, fontSize: '0.75rem', lineHeight: 1.5, fontStyle: 'italic',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.label}</Typography>
        {failed && <ErrorOutlineIcon role="img" aria-label={t('terminal.status.failed', { defaultValue: 'failed' })}
            sx={{ ...iconSx, color: 'error.main' }} />}
    </>;
    if (!entry.error) return <Box data-work-entry sx={{ ...rowSx, px: 0.5, py: '2px', color: 'text.disabled',
        '&:hover': { bgcolor: 'transparent' } }}>{line}</Box>;
    return <Box data-work-entry sx={{ minWidth: 0 }}>
        <ButtonBase onClick={() => setOpen(value => !value)} aria-expanded={open} sx={{ ...rowSx, px: 0.5, py: '2px',
            color: 'text.disabled', '&:hover': { bgcolor: 'action.hover', color: 'text.secondary' } }}>
            {line}
            <ChevronRightIcon sx={{ ...iconSx, transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }} />
        </ButtonBase>
        {open && <Typography sx={{ pl: 3, pr: 1, py: 0.25, fontSize: '0.6875rem', color: 'text.secondary', overflowWrap: 'anywhere' }}>
            {entry.error}
        </Typography>}
    </Box>;
};

/**
 * The agent's work before a message, as in Copilot or Claude: its thinking as quiet text, each
 * tool call as its own line that opens what it was asked and what came back, and attempts that failed.
 */
export const ConversationWorkLog: FC<{ turn: TextTurn; onOpenPath?: OpenSessionPath }> = ({ turn, onOpenPath }) => {
    const entries = workEntriesOf(turn);
    if (!entries.length) return null;
    return <Box data-work-log={turn.id} sx={{ mb: 2, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {entries.map(entry => entry.kind === 'thought'
            ? <Box key={entry.key} data-work-entry sx={{ color: 'text.secondary', fontSize: '0.8125rem', lineHeight: 1.6, my: 0.5,
                '& p': { my: 0.25, fontSize: 'inherit' }, '& li': { fontSize: 'inherit' } }}>
                <CompactMarkdown content={entry.text} color="text.secondary" />
            </Box>
            : entry.kind === 'call' ? <CallRow key={entry.key} call={entry.call} onOpenPath={onOpenPath} />
            : entry.kind === 'step' ? <StepRow key={entry.key} entry={entry} />
            : <Box key={entry.key} data-work-entry sx={{ ...rowSx, px: 0.5, py: '2px', color: 'warning.dark',
                '&:hover': { bgcolor: 'transparent' } }}>
                <WarningAmberIcon sx={{ ...iconSx, fontSize: 13 }} />
                <Typography component="span" sx={{ flex: 1, minWidth: 0, fontSize: '0.75rem', lineHeight: 1.5, overflowWrap: 'anywhere' }}>
                    {entry.text}
                </Typography>
            </Box>)}
    </Box>;
};
