import React, { useRef, useState } from 'react';
import { Alert, Box, Button, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Tooltip, Typography, useTheme, alpha } from '@mui/material';
import TerminalIcon from '@mui/icons-material/Terminal';
import BlockIcon from '@mui/icons-material/Block';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ScheduleIcon from '@mui/icons-material/Schedule';
import { useTranslation } from 'react-i18next';
import type { TerminalExecution } from './ComponentType';
import { iconVar, textVar } from '../app/layout';
import { CompactMarkdown } from '../views/InteractionEntryCard';

export const TerminalMessageContent = ({ content, executions, variant }: {
    content: string; executions?: TerminalExecution[]; variant?: 'document';
}) => <>
    {content.trim() && <CompactMarkdown content={content} color="text.primary" variant={variant} />}
    {executions?.map(execution => <TerminalExecutionView key={execution.id} execution={execution} />)}
</>;

export interface TerminalProposal {
    id: string;
    argv: string[];
    cwd: string;
    purpose: string;
    timeout_seconds: number;
}

const quoteShellArgument = (argument: string) => {
    if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(argument)) return argument;
    if (argument.includes("'")) return `"${argument.replace(/[\\"$`]/g, '\\$&')}"`;
    return `'${argument.replace(/'/g, `'"'"'`)}'`;
};

const formatTerminalCommand = (argv: string[]) => argv.map(quoteShellArgument).join(' ');

export const TerminalExecutionView = ({ execution, onOpen, passive = false, defaultExpanded = false }: {
    execution: TerminalExecution;
    onOpen?: () => void;
    passive?: boolean;
    defaultExpanded?: boolean;
}) => {
    const { t } = useTranslation();
    const theme = useTheme();
    const summaryOnly = passive || !!onOpen;
    const [expanded, setExpanded] = useState(defaultExpanded);
    const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
    const command = execution.commandText ?? formatTerminalCommand(execution.argv);
    const result = execution.result;
    const labels: Record<TerminalExecution['status'], string> = {
        awaiting_approval: 'Awaiting approval', running: 'Running', completed: 'Completed',
        failed: 'Failed', rejected: 'Rejected', interrupted: 'Interrupted', unknown: 'Status unavailable',
    };
    const statusLabel = t(`terminal.status.${execution.status}`, { defaultValue: labels[execution.status] });
    const singleLineCommand = command.replace(/\s+/g, ' ');
    const commandPreview = singleLineCommand.length > 80 ? `${singleLineCommand.slice(0, 77)}...` : singleLineCommand;
    const codeSx = {
        m: 0, py: 0.75, maxHeight: 240, maxWidth: '100%', overflow: 'auto',
        fontFamily: 'var(--df-font-mono)', fontSize: textVar.xxs, fontWeight: 400,
        color: 'text.primary', lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
    };
    return <Box component={passive ? 'span' : 'div'} sx={{ minWidth: 0, mt: passive ? 0 : 0.5,
        ...(passive ? { display: 'inline-flex', verticalAlign: 'text-bottom' } : {}),
        fontFamily: theme.typography.fontFamily, fontWeight: 400, letterSpacing: 0 }} onClick={passive ? undefined : (event: React.MouseEvent<HTMLElement>) => event.stopPropagation()}>
        <Box component={passive ? 'span' : 'button'} type={passive ? undefined : 'button'} aria-expanded={summaryOnly ? undefined : expanded}
            aria-label={`${passive ? t('terminal.command', { defaultValue: 'Command' }) : commandPreview} ${statusLabel}`}
            onClick={passive ? undefined : onOpen || (() => setExpanded(!expanded))} sx={{
            display: 'inline-flex', alignItems: 'center', gap: 0.5, width: 'fit-content', maxWidth: '100%', minWidth: 0,
            position: 'relative', overflow: 'hidden',
            p: passive ? 0 : 0.5, border: 0, borderRadius: 1, bgcolor: 'transparent', color: 'text.secondary',
            textAlign: 'left', cursor: passive ? 'inherit' : 'pointer', fontFamily: theme.typography.fontFamily, fontSize: textVar.xs, fontWeight: 400, lineHeight: 1.5,
            ...(!summaryOnly ? { px: 1, py: 0.5, border: '1px solid', borderColor: 'divider', bgcolor: 'action.hover', color: 'text.primary' } : {}),
            ...(!passive ? { '&:hover': { bgcolor: 'action.hover' } } : {}),
            '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
            ...(!passive && execution.status === 'running' ? {
                '&::before': {
                    content: '""', position: 'absolute',
                    top: 0, left: 0, width: '100%', height: '100%',
                    background: `linear-gradient(90deg, transparent 0%, ${alpha(theme.palette.background.paper, 0.8)} 50%, transparent 100%)`,
                    animation: 'windowWipe 2s ease-in-out infinite',
                    zIndex: 1, pointerEvents: 'none',
                },
                '@keyframes windowWipe': {
                    '0%': { transform: 'translateX(-100%)' },
                    '100%': { transform: 'translateX(100%)' },
                },
                '@media (prefers-reduced-motion: reduce)': {
                    '&::before': { display: 'none' },
                },
            } : {}),
        }}>
            {!summaryOnly && <ChevronRightIcon sx={{ fontSize: iconVar.sm, flexShrink: 0, transform: expanded ? 'rotate(90deg)' : undefined }} />}
            {passive ? <Tooltip title={`${t('terminal.command', { defaultValue: 'Command' })}: ${statusLabel}`}>
                <TerminalIcon data-terminal-indicator sx={{ width: 12, height: 12, flexShrink: 0, color: 'text.secondary' }} />
            </Tooltip> : <Tooltip title={t('terminal.command', { defaultValue: 'Command' })}>
                <TerminalIcon sx={{ fontSize: iconVar.sm, flexShrink: 0 }} />
            </Tooltip>}
            {!passive && <Box component="span" sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                ...(summaryOnly ? { fontFamily: 'var(--df-font-mono)', fontSize: textVar.xxs } : {}),
            }}>
                {commandPreview || t('terminal.command', { defaultValue: 'Command' })}
            </Box>}
            {!passive && execution.status !== 'unknown' && (!summaryOnly || execution.status !== 'running') && <Tooltip title={statusLabel}>
                <Box component="span" role="img" aria-label={statusLabel} sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 16, height: 16, flexShrink: 0,
                    color: execution.status === 'completed' ? 'success.main' : execution.status === 'failed' ? 'error.main' : 'text.secondary',
                }}>
                    {execution.status === 'completed' ? <CheckIcon sx={{ fontSize: iconVar.sm }} />
                        : execution.status === 'awaiting_approval' || execution.status === 'running' ? <ScheduleIcon sx={{ fontSize: iconVar.sm }} />
                        : execution.status === 'rejected' ? <BlockIcon sx={{ fontSize: iconVar.sm }} />
                        : <ErrorOutlineIcon sx={{ fontSize: iconVar.sm }} />}
                </Box>
            </Tooltip>}
        </Box>
        {!summaryOnly && <Collapse in={expanded} unmountOnExit>
            <Box sx={{ mt: 0.75, px: 1.25, py: 0.75, minWidth: 0, border: '1px solid',
                borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography sx={{ fontSize: textVar.xs, color: 'text.secondary' }}>{t('terminal.command', { defaultValue: 'Command' })}</Typography>
                    <Tooltip title={t(`terminal.copy.${copyStatus}`, { defaultValue: copyStatus === 'copied' ? 'Copied' : copyStatus === 'failed' ? 'Copy failed' : 'Copy command' })}>
                        <IconButton size="small" aria-label={t('terminal.copyCommand', { defaultValue: 'Copy command' })} onClick={async () => {
                            try { await navigator.clipboard.writeText(command); setCopyStatus('copied'); }
                            catch { setCopyStatus('failed'); }
                        }}><ContentCopyIcon sx={{ fontSize: iconVar.sm }} /></IconButton>
                    </Tooltip>
                </Box>
                <Box component="pre" sx={{ ...codeSx, maxHeight: 'none' }}>{command}</Box>
                <Typography sx={{ my: 0.5, fontSize: textVar.xxs, color: 'text.secondary', overflowWrap: 'anywhere' }}>
                    {t('terminal.directory', { defaultValue: 'Working directory' })}: {execution.cwd}
                </Typography>
                {execution.commandText === undefined && <Box component="details" sx={{ fontFamily: theme.typography.fontFamily, fontSize: textVar.xxs, fontWeight: 400, color: 'text.secondary', mb: 0.5 }}>
                    <summary>{t('terminal.arguments', { defaultValue: 'Executable and exact arguments' })}</summary>
                    <Box component="pre" sx={codeSx}>{JSON.stringify(execution.argv, null, 2)}</Box>
                </Box>}
                {result && <>
                    {!['stdout', 'stderr', 'output', 'error', 'exit_code', 'timed_out', 'truncated', 'rejected'].some(field => field in result)
                        && <Box component="pre" sx={codeSx}>{JSON.stringify(result, null, 2)}</Box>}
                    {['stdout', 'stderr', 'output', 'error'].map(field => result[field] ? <Box key={field} sx={{ mt: 1, pt: 0.75,
                        borderTop: '1px solid', borderColor: 'divider' }}>
                        <Typography sx={{ fontSize: textVar.xxs, color: 'text.secondary' }}>{t(`terminal.${field}`, { defaultValue: field === 'output' ? 'Output' : field === 'error' ? 'Error' : field })}</Typography>
                        <Box component="pre" sx={codeSx}>{String(result[field])}</Box>
                    </Box> : null)}
                    {result.exit_code != null && <Typography sx={{ fontSize: textVar.xxs, color: 'text.secondary' }}>
                        {t('terminal.exitCode', { defaultValue: 'Exit code' })}: {String(result.exit_code)}
                    </Typography>}
                    {result.timed_out === true && <Typography sx={{ fontSize: textVar.xxs, color: 'error.main' }}>{t('terminal.timedOut', { defaultValue: 'Timed out' })}</Typography>}
                    {result.truncated === true && <Typography sx={{ fontSize: textVar.xxs, color: 'text.secondary' }}>{t('terminal.truncated', { defaultValue: 'Output truncated' })}</Typography>}
                </>}
            </Box>
        </Collapse>}
    </Box>;
};

export const TerminalApprovalDialog = ({ proposal, onDecision }: {
    proposal: TerminalProposal;
    onDecision: (decision: 'approve' | 'reject') => void;
}) => {
    const { t } = useTranslation();
    const submitted = useRef(false);
    const decide = (decision: 'approve' | 'reject') => {
        if (submitted.current) return;
        submitted.current = true;
        onDecision(decision);
    };

    return <Dialog open maxWidth="sm" fullWidth aria-labelledby="terminal-approval-title"
        onClose={() => decide('reject')}>
        <DialogTitle id="terminal-approval-title" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TerminalIcon />
            {t('terminal.approvalTitle', { defaultValue: 'Allow this local command?' })}
        </DialogTitle>
        <DialogContent sx={{ minWidth: 0 }}>
            <Alert severity="warning" sx={{ mb: 2 }}>
                {t('terminal.confinedWarning', { defaultValue: 'Filesystem writes are restricted to this workspace\'s scratch folder. This command can still read local files and access the network, including remote services. Command output is sent to your model provider.' })}
            </Alert>
            <Typography variant="body2" sx={{ mb: 2, overflowWrap: 'anywhere' }}>{proposal.purpose}</Typography>
            <Typography variant="caption" color="text.secondary">
                {t('terminal.directory', { defaultValue: 'Working directory' })}
            </Typography>
            <Typography component="pre" variant="body2" sx={{ m: 0, mb: 2, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {proposal.cwd}
            </Typography>
            <Typography variant="caption" color="text.secondary">
                {t('terminal.arguments', { defaultValue: 'Executable and exact arguments' })}
            </Typography>
            <Box component="pre" sx={{ m: 0, mt: 0.5, p: 1.5, bgcolor: 'action.hover', borderRadius: 1,
                fontSize: '0.8125rem', maxHeight: 280, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {JSON.stringify(proposal.argv, null, 2)}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                {t('terminal.limit', { defaultValue: 'One command, up to {{seconds}} seconds. No approval carries over.', seconds: proposal.timeout_seconds })}
            </Typography>
        </DialogContent>
        <DialogActions>
            <Button autoFocus startIcon={<BlockIcon />} onClick={() => decide('reject')}>
                {t('terminal.reject', { defaultValue: 'Reject' })}
            </Button>
            <Button variant="contained" startIcon={<TerminalIcon />} onClick={() => decide('approve')}>
                {t('terminal.approve', { defaultValue: 'Run once' })}
            </Button>
        </DialogActions>
    </Dialog>;
};