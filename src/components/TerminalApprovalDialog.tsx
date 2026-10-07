import React, { useRef, useState } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-json';
import 'prismjs/themes/prism.css';
import { Alert, Box, Button, Checkbox, CircularProgress, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, LinearProgress, Radio, RadioGroup, TextField, Tooltip, Typography, useTheme, alpha } from '@mui/material';
import TerminalIcon from '@mui/icons-material/Terminal';
import BlockIcon from '@mui/icons-material/Block';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ScheduleIcon from '@mui/icons-material/Schedule';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { dfActions, type DataFormulatorState } from '../app/dfSlice';
import { apiRequest } from '../app/apiClient';
import type { TerminalExecution, TerminalFilesystemPolicy } from './ComponentType';
import { iconVar, textVar } from '../app/layout';
import { CompactMarkdown } from '../views/InteractionEntryCard';

export const TerminalAccessButton = () => {
    const { t } = useTranslation();
    const dispatch = useDispatch();
    const reduxStore = useStore<DataFormulatorState>();
    const config = useSelector((state: DataFormulatorState) => state.serverConfig);
    const [open, setOpen] = useState(false);
    type TerminalPolicy = { mode: 'off' | 'ask' | 'auto'; available: boolean; locked: boolean; revision: number;
        sandboxFilesystem?: TerminalFilesystemPolicy };
    const [policy, setPolicy] = useState<TerminalPolicy>();
    const [draft, setDraft] = useState<TerminalPolicy['mode']>('off');
    const [useDefaultPaths, setUseDefaultPaths] = useState(true);
    const [writePaths, setWritePaths] = useState('');
    const [policyExpanded, setPolicyExpanded] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const paths = writePaths.split('\n').map(path => path.trim()).filter(Boolean);
    const sandboxChanged = !!policy?.sandboxFilesystem && (useDefaultPaths !== !policy.sandboxFilesystem.configured
        || (!useDefaultPaths && JSON.stringify(paths) !== JSON.stringify(policy.sandboxFilesystem.requested)));
    const applyPolicy = (next: TerminalPolicy) => {
        setPolicy(next);
        setDraft(next.mode);
        setUseDefaultPaths(!next.sandboxFilesystem?.configured);
        setWritePaths(next.sandboxFilesystem?.requested.join('\n') ?? '');
        dispatch(dfActions.setServerConfig({ ...reduxStore.getState().serverConfig, TERMINAL_MODE: next.mode,
            TERMINAL_AVAILABLE: next.available, TERMINAL_CONFIG_LOCKED: next.locked }));
    };
    const load = async () => {
        setBusy(true); setError(''); setPolicy(undefined); setDraft(config.TERMINAL_MODE ?? 'off');
        setPolicyExpanded(false);
        try { applyPolicy((await apiRequest<TerminalPolicy>('/api/configurations/terminal')).data); }
        catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
        finally { setBusy(false); }
    };
    const save = async () => {
        if (!policy) return;
        setBusy(true); setError('');
        try {
            const { data } = await apiRequest<TerminalPolicy>('/api/configurations/terminal', { method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'X-DF-Configuration': '1' },
                body: JSON.stringify({ revision: policy.revision, mode: draft,
                    ...(sandboxChanged ? { sandbox: useDefaultPaths ? null : { filesystem: { allowWrite: paths } } } : {}) }) });
            applyPolicy(data);
            setOpen(false);
        } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
        finally { setBusy(false); }
    };
    if (!config.TERMINAL_MODE) return null;
    const mode = config.TERMINAL_MODE;
    const label = t(`terminal.access.${mode}`, { defaultValue: { off: 'Off', ask: 'Ask', auto: 'Auto' }[mode] });
    const connectorsBlocked = config.IS_LOCAL_MODE && config.DISABLE_DATA_CONNECTORS;
    return <>
        <Tooltip describeChild title={t('terminal.accessDetails', { defaultValue: 'Terminal access and existing CLI logins' })}>
            <Button size="small" startIcon={<TerminalIcon />} aria-haspopup="dialog" onClick={() => { setOpen(true); void load(); }}
                sx={{ minWidth: 0, px: 0.75, py: 0.25, flexShrink: 0, textTransform: 'none', whiteSpace: 'nowrap',
                    fontWeight: 400, fontSize: textVar.xs, color: mode === 'off' ? 'text.secondary' : 'primary.main',
                    '& .MuiButton-startIcon': { mr: 0.5, '& .MuiSvgIcon-root': { fontSize: iconVar.md } } }}>
                {t('terminal.accessLabel', { defaultValue: 'Terminal: {{mode}}', mode: label })}
            </Button>
        </Tooltip>
        <Dialog open={open} onClose={() => { if (!busy) setOpen(false); }} maxWidth={policyExpanded ? 'md' : 'xs'} fullWidth aria-labelledby="terminal-access-title">
            <DialogTitle component="div" id="terminal-access-header" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                flexWrap: 'wrap', gap: 1, fontSize: textVar.lg }}>
                <Typography component="h2" variant="inherit" id="terminal-access-title">
                    {t('terminal.accessTitle', { defaultValue: 'Terminal access' })}
                </Typography>
                <Button size="small" disabled={busy || draft === 'off' || !policy?.sandboxFilesystem}
                    aria-expanded={policyExpanded} aria-controls={policyExpanded ? 'terminal-sandbox-policy' : undefined}
                    onClick={() => setPolicyExpanded(!policyExpanded)}
                    startIcon={<ChevronRightIcon sx={{ transform: policyExpanded ? 'rotate(90deg)' : undefined }} />}
                    sx={{ ml: 'auto', textTransform: 'none', fontWeight: 400, fontSize: textVar.xs }}>
                    {t('terminal.sandboxPolicy', { defaultValue: 'Sandbox policy' })}
                </Button>
            </DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Box sx={{ height: 2 }}>{busy && <LinearProgress sx={{ height: 2 }} />}</Box>
                {error && <Alert severity="error" action={<Button color="inherit" size="small" disabled={busy} onClick={() => void load()}>
                    {t('terminal.reloadAccess', { defaultValue: 'Reload' })}</Button>}>{error}</Alert>}
                <Box sx={{ display: 'grid', gap: 2.5, alignItems: 'start',
                    gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: policyExpanded ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)' },
                    '& > [role="region"]': { minWidth: 0, ...(policyExpanded ? {
                        borderLeft: { xs: 0, md: '1px solid' }, borderColor: 'divider', pl: { xs: 0, md: 3 },
                    } : {}) } }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 0 }}>
                <RadioGroup aria-labelledby="terminal-access-title" value={draft}
                    onChange={(_, value) => {
                        setDraft(value as TerminalPolicy['mode']);
                        if (value === 'off') setPolicyExpanded(false);
                    }}>
                    {([['off', 'Off'], ['ask', 'Ask every time'], ['auto', 'Auto approve']] as const).map(([value, defaultValue]) =>
                        <FormControlLabel key={value} value={value} control={<Radio size="small" />}
                            label={t(`terminal.accessChoice.${value}`, { defaultValue })}
                            disabled={busy || !policy?.available || policy.locked} />)}
                </RadioGroup>
                <Box component="ol" sx={{ m: 0, pl: 2.5, '& > li + li': { mt: 1 } }}>
                    <Typography component="li" variant="body2" color="text.secondary">
                        {t('terminal.accessBenefit', { defaultValue: 'Terminal access lets the agent read local files, use installed tools and existing CLI logins, and access online sources, expanding its ability to find, acquire, and analyze data.' })}
                    </Typography>
                    <Typography component="li" variant="body2" color="text.secondary">
                        {t('terminal.sandboxOverview', { defaultValue: 'By default, commands run in a sandbox that limits local writes but does not restrict file reads, network access, or remote changes.' })}
                    </Typography>
                </Box>
                {policy && !policy.available && <Alert severity="info">{connectorsBlocked
                    ? t('terminal.connectionsBlockedHere', { defaultValue: 'The deployment policy disables user-created connections and terminal access.' })
                    : t('terminal.localOnly', { defaultValue: 'Terminal requires single-user local mode on macOS or Linux.' })}</Alert>}
                {policy?.locked && <Typography variant="body2">
                    {t('terminal.environmentLocked', { defaultValue: 'Terminal mode is controlled by the server environment variable DF_TERMINAL_MODE.' })}
                </Typography>}
                {draft === 'ask' && <Alert severity="info">
                    {t('terminal.askApprovalSandbox', { defaultValue: 'With Ask every time, the agent must get your approval before running any terminal command, including commands inside the sandbox.' })}
                </Alert>}
                {draft === 'auto' && <Alert severity="error">
                    {t('terminal.autoWarningSandbox', { defaultValue: 'With Auto approve, the agent can run sandboxed commands without asking: read local files, send data over the network, modify allowed files, and use existing CLI credentials to change remote resources. Running commands outside the sandbox still requires your approval and a reason.' })}
                </Alert>}
                </Box>
                {policyExpanded && policy?.sandboxFilesystem && <Box id="terminal-sandbox-policy" role="region"
                    aria-label={t('terminal.sandboxPolicy', { defaultValue: 'Sandbox policy' })}>
                <TerminalFilesystemSummary policy={policy.sandboxFilesystem} inline>
                    <FormControlLabel sx={{ my: 0.5, '& .MuiFormControlLabel-label': { fontSize: textVar.sm } }}
                        control={<Checkbox size="small" checked={useDefaultPaths} disabled={busy || !policy.available || policy.locked}
                            onChange={(_, checked) => setUseDefaultPaths(checked)} />}
                        label={t('terminal.useDefaultWritePaths', { defaultValue: 'Use default CLI state paths' })} />
                    {useDefaultPaths ? policy.sandboxFilesystem.configured
                        ? <Typography variant="inherit" color="text.secondary">
                            {t('terminal.restoreDefaultWritePaths', { defaultValue: 'Default CLI state paths will be restored on save.' })}
                        </Typography>
                        : <Box component="pre" sx={{ my: 0.5, fontFamily: 'var(--df-font-mono)', fontSize: 'inherit',
                            whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{policy.sandboxFilesystem.requested.join('\n')}</Box>
                        : <TextField fullWidth multiline minRows={3} maxRows={8} size="small" value={writePaths}
                            disabled={busy || !policy.available || policy.locked} onChange={event => setWritePaths(event.target.value)}
                            label={t('terminal.writablePaths', { defaultValue: 'Writable paths (one per line)' })}
                            helperText={t('terminal.writablePathsHint', { defaultValue: 'Absolute or ~/ paths. Empty keeps only scratch and runtime writes. Missing or unsafe paths are not enabled.' })}
                            sx={{ mt: 1, '& textarea': { fontFamily: 'var(--df-font-mono)', fontSize: textVar.sm } }} />}
                </TerminalFilesystemSummary>
                </Box>}
                </Box>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2, flexWrap: 'wrap', gap: 0.5 }}>
                <Button disabled={busy} onClick={() => setOpen(false)}>{t('terminal.closeAccess', { defaultValue: 'Close' })}</Button>
                <Button variant="contained" disabled={busy || !policy?.available || policy.locked || (draft === policy.mode && !sandboxChanged)}
                    onClick={() => void save()}>{t('terminal.saveAccess', { defaultValue: 'Save' })}</Button>
            </DialogActions>
        </Dialog>
    </>;
};

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
    dangerouslyDisableSandbox?: boolean;
    sandboxDisablingReason?: string;
    sandboxFilesystem?: TerminalFilesystemPolicy;
}

const TerminalFilesystemSummary = ({ policy, compact = false, children, inline = false }: {
    policy: TerminalFilesystemPolicy; compact?: boolean; children?: React.ReactNode; inline?: boolean;
}) => {
    const { t } = useTranslation();
    const theme = useTheme();
    return <Box component={inline ? 'div' : 'details'} sx={{ my: inline ? 0 : 1, minWidth: 0, fontFamily: theme.typography.fontFamily,
        fontSize: compact ? textVar.xs : textVar.sm, lineHeight: 1.5, letterSpacing: 0,
        color: compact ? 'text.secondary' : undefined }}>
        {!inline && <Box component="summary" sx={{ fontFamily: 'inherit', fontSize: 'inherit', lineHeight: 'inherit',
            fontWeight: compact ? 400 : 500, cursor: 'pointer' }}>
            {t('terminal.sandboxPolicy', { defaultValue: 'Sandbox policy' })}
        </Box>}
        <Box component="section" sx={{ mt: inline ? 0 : 1 }}>
            <Typography component="h3" variant="inherit" sx={{ fontWeight: 500 }}>
                {t('terminal.policyRead', { defaultValue: 'Read' })}
            </Typography>
            <Typography variant="inherit" color="text.secondary">
                {t('terminal.policyReadDetails', { defaultValue: 'Commands can read sensitive files outside the workspace and access the network. Command output is shared with your AI model provider. Cloud services require their own credentials.' })}
            </Typography>
        </Box>
        <Box component="section" sx={{ mt: 1.5 }}>
            <Typography component="h3" variant="inherit" sx={{ fontWeight: 500 }}>
                {t('terminal.policyWrite', { defaultValue: 'Write' })}
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2.5, color: 'text.secondary', '& > li + li': { mt: 0.5 } }}>
                <Typography component="li" variant="inherit">
                    {t('terminal.policyWriteAllowed', { defaultValue: 'Allowed: create, modify, or delete files in workspace scratch, private runtime storage, and the CLI paths below. This includes credentials and configuration files stored there.' })}
                </Typography>
                <Typography component="li" variant="inherit">
                    {t('terminal.policyWriteBlocked', { defaultValue: 'Blocked: writes to other local paths while running inside the sandbox.' })}
                </Typography>
                <Typography component="li" variant="inherit">
                    {t('terminal.policyWriteRemote', { defaultValue: 'Not blocked by the sandbox: changes to cloud services or other remote systems through CLI tools or APIs, using available credentials.' })}
                </Typography>
            </Box>
            {children ?? <><Typography variant="inherit" sx={{ mt: 1 }}>{policy.configured
                ? t('terminal.customWritePolicy', { defaultValue: 'Configured persistent paths' })
                : t('terminal.defaultWritePolicy', { defaultValue: 'Default CLI state paths' })}</Typography>
            <Box component="pre" sx={{ my: 0.5, fontFamily: 'var(--df-font-mono)', fontSize: 'inherit',
                lineHeight: 'inherit', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {policy.allowWrite.join('\n') || t('terminal.noPersistentPaths', { defaultValue: 'None' })}
            </Box></>}
            {!!policy.skipped.length && <>
                <Typography variant="inherit" color="text.secondary">
                    {t('terminal.skippedWritePaths', { defaultValue: 'Currently unavailable paths (missing or unsafe)' })}
                </Typography>
                <Box component="pre" sx={{ my: 0.5, fontFamily: 'var(--df-font-mono)', fontSize: 'inherit',
                    lineHeight: 'inherit', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                    {policy.skipped.join('\n')}
                </Box>
            </>}
        </Box>
    </Box>;
};

const quoteShellArgument = (argument: string) => {
    if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(argument)) return argument;
    if (argument.includes("'")) return `"${argument.replace(/[\\"$`]/g, '\\$&')}"`;
    return `'${argument.replace(/'/g, `'"'"'`)}'`;
};

export const formatTerminalCommand = (argv: string[]) => argv.map(quoteShellArgument).join(' ');

export const ExecutionCodeBlock = ({ code, language, label, copyLabel, result, compact = false, children }: {
    code?: string;
    language: 'python' | 'bash' | 'json';
    label: string;
    copyLabel: string;
    result?: Record<string, unknown>;
    compact?: boolean;
    children?: React.ReactNode;
}) => {
    const { t } = useTranslation();
    const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
    const codeSx = { m: 0, py: 0.75, maxHeight: 240, maxWidth: '100%', overflow: 'auto',
        fontFamily: 'var(--df-font-mono)', fontSize: compact ? textVar.xxs : textVar.xs, fontWeight: 400,
        color: 'text.primary', lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };
    const labelSx = { fontSize: textVar.xs, fontWeight: 400, lineHeight: 1.5, color: 'text.secondary' };
    return <Box role="group" aria-label={label} sx={{ mt: 0.75, px: 1.25, py: 0.75, minWidth: 0,
        border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography sx={labelSx}>{label}</Typography>
            {code !== undefined && <Tooltip title={copyStatus === 'idle' ? copyLabel : t(`terminal.copy.${copyStatus}`, {
                defaultValue: copyStatus === 'copied' ? 'Copied' : 'Copy failed',
            })}>
                <IconButton size="small" aria-label={copyLabel} onClick={async () => {
                    try { await navigator.clipboard.writeText(code); setCopyStatus('copied'); }
                    catch { setCopyStatus('failed'); }
                }}><ContentCopyIcon sx={{ fontSize: iconVar.sm }} /></IconButton>
            </Tooltip>}
        </Box>
        {code !== undefined ? <Box component="pre" sx={{ ...codeSx, maxHeight: 'none' }}>
            <code className={`language-${language}`}
                style={{ font: 'inherit', whiteSpace: 'inherit', overflowWrap: 'inherit', color: 'inherit', textShadow: 'none' }}
                dangerouslySetInnerHTML={{ __html: Prism.highlight(code, Prism.languages[language], language) }} />
        </Box> : <Typography sx={{ ...labelSx, py: 0.75 }}>
            {t('tool.inputUnavailable', { defaultValue: 'Input not retained for this call.' })}
        </Typography>}
        {children}
        {result && <>
            {!['stdout', 'stderr', 'output', 'error', 'exit_code', 'timed_out', 'truncated', 'rejected'].some(field => field in result)
                && <Box component="pre" sx={codeSx}>{JSON.stringify(result, null, 2)}</Box>}
            {['stdout', 'stderr', 'output', 'error'].map(field => result[field] ? <Box key={field} sx={{ mt: 1, pt: 0.75,
                borderTop: '1px solid', borderColor: 'divider' }}>
                <Typography sx={labelSx}>{t(`terminal.${field}`, { defaultValue: field === 'output' ? 'Output' : field === 'error' ? 'Error' : field })}</Typography>
                <Box component="pre" sx={{ ...codeSx, ...(field === 'error' ? { color: 'error.main' } : {}) }}>{String(result[field])}</Box>
            </Box> : null)}
            {result.exit_code != null && <Typography sx={labelSx}>
                {t('terminal.exitCode', { defaultValue: 'Exit code' })}: {String(result.exit_code)}
            </Typography>}
            {result.timed_out === true && <Typography sx={{ ...labelSx, color: 'error.main' }}>{t('terminal.timedOut', { defaultValue: 'Timed out' })}</Typography>}
            {result.truncated === true && <Typography sx={labelSx}>{t('terminal.truncated', { defaultValue: 'Output truncated' })}</Typography>}
        </>}
    </Box>;
};

export const TerminalExecutionView = ({ execution, onOpen, passive = false, defaultExpanded = false, detailsOnly = false }: {
    execution: TerminalExecution;
    onOpen?: () => void;
    passive?: boolean;
    defaultExpanded?: boolean;
    detailsOnly?: boolean;
}) => {
    const { t } = useTranslation();
    const theme = useTheme();
    const summaryOnly = passive || !!onOpen;
    const [expanded, setExpanded] = useState(defaultExpanded);
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
        fontFamily: 'var(--df-font-mono)', fontSize: detailsOnly ? textVar.sm : textVar.xs, fontWeight: 400,
        color: 'text.primary', lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
    };
    const detailLabelSx = { fontFamily: theme.typography.fontFamily, fontSize: textVar.xs,
        fontWeight: 400, lineHeight: 1.5, color: 'text.secondary' };
    return <Box component={passive ? 'span' : 'div'} sx={{ minWidth: 0, mt: passive ? 0 : 0.5,
        ...(passive ? { display: 'inline-flex', verticalAlign: 'text-bottom' } : {}),
        fontFamily: theme.typography.fontFamily, fontWeight: 400, letterSpacing: 0 }} onClick={passive ? undefined : (event: React.MouseEvent<HTMLElement>) => event.stopPropagation()}>
        {!detailsOnly && <Box component={passive ? 'span' : 'button'} type={passive ? undefined : 'button'} aria-expanded={summaryOnly ? undefined : expanded}
            aria-label={passive ? t('terminal.command', { defaultValue: 'Command' }) : `${commandPreview} ${statusLabel}`}
            onClick={passive ? undefined : onOpen || (() => setExpanded(!expanded))} sx={{
            display: 'inline-flex', alignItems: 'center', gap: 0.5, width: 'fit-content', maxWidth: '100%', minWidth: 0,
            position: 'relative', overflow: 'hidden',
            p: passive ? 0 : 0.5, border: 0, borderRadius: 1, bgcolor: 'transparent', color: 'text.secondary',
            textAlign: 'left', cursor: passive ? 'inherit' : 'pointer', fontFamily: theme.typography.fontFamily, fontSize: textVar.xs, fontWeight: 400, lineHeight: 1.5,
            ...(!summaryOnly ? { px: 1, py: 0.5, border: '1px solid', borderColor: 'divider', bgcolor: 'action.hover', color: 'text.primary' } : {}),
            ...(!passive ? { '&:hover': { bgcolor: 'action.hover' } } : {}),
            '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
            ...(!summaryOnly && execution.status === 'running' ? {
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
            {passive ? <Tooltip title={t('terminal.command', { defaultValue: 'Command' })}>
                <TerminalIcon data-terminal-indicator sx={{ width: 12, height: 12, flexShrink: 0, color: 'text.secondary' }} />
            </Tooltip> : <Tooltip title={t('terminal.command', { defaultValue: 'Command' })}>
                <TerminalIcon sx={{ fontSize: iconVar.sm, flexShrink: 0 }} />
            </Tooltip>}
            {!passive && <Box component="span" sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                ...(summaryOnly ? { fontFamily: 'var(--df-font-mono)', fontSize: textVar.xxs } : {}),
            }}>
                {commandPreview || t('terminal.command', { defaultValue: 'Command' })}
            </Box>}
            {!summaryOnly && execution.status !== 'unknown' && <Tooltip title={statusLabel}>
                <Box component="span" role="img" aria-label={statusLabel} sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 16, height: 16, flexShrink: 0,
                    color: execution.status === 'completed' ? 'success.main' : execution.status === 'failed' ? 'error.main'
                        : execution.status === 'awaiting_approval' ? 'warning.main' : 'text.secondary',
                }}>
                    {execution.status === 'completed' ? <CheckIcon sx={{ fontSize: iconVar.sm }} />
                        : execution.status === 'running' ? <CircularProgress size={12} color="inherit" />
                        : execution.status === 'awaiting_approval' ? <ScheduleIcon sx={{ fontSize: iconVar.sm }} />
                        : execution.status === 'rejected' ? <BlockIcon sx={{ fontSize: iconVar.sm }} />
                        : <ErrorOutlineIcon sx={{ fontSize: iconVar.sm }} />}
                </Box>
            </Tooltip>}
            {!summaryOnly && execution.dangerouslyDisableSandbox && <Tooltip title={t('terminal.outsideSandbox', { defaultValue: 'Outside sandbox' })}>
                <ErrorOutlineIcon aria-label={t('terminal.outsideSandbox', { defaultValue: 'Outside sandbox' })}
                    sx={{ fontSize: iconVar.sm, flexShrink: 0, color: 'warning.main' }} />
            </Tooltip>}
        </Box>}
        {!summaryOnly && <Collapse in={detailsOnly || expanded} unmountOnExit>
            <ExecutionCodeBlock code={command} language="bash" result={result} compact={!detailsOnly}
                label={t('terminal.command', { defaultValue: 'Command' })}
                copyLabel={t('terminal.copyCommand', { defaultValue: 'Copy command' })}>
                <Typography sx={{ ...detailLabelSx, my: 0.5, overflowWrap: 'anywhere' }}>
                    {t('terminal.directory', { defaultValue: 'Working directory' })}: {execution.cwd}
                </Typography>
                {execution.dangerouslyDisableSandbox ? <Alert severity="warning" sx={{ my: 1, overflowWrap: 'anywhere' }}>
                    {t('terminal.outsideSandbox', { defaultValue: 'Outside sandbox' })}: {execution.sandboxDisablingReason}
                </Alert> : execution.sandboxFilesystem && <TerminalFilesystemSummary policy={execution.sandboxFilesystem} compact />}
                {!!execution.writePaths?.length && <Box sx={{ my: 1 }}>
                    <Typography sx={detailLabelSx}>
                        {t('terminal.additionalWritePaths', { defaultValue: 'Additional write paths (this command only)' })}
                    </Typography>
                    <Box component="pre" sx={codeSx}>{execution.writePaths.join('\n')}</Box>
                </Box>}
                {execution.commandText === undefined && <Box component="details" sx={{ ...detailLabelSx, mb: 0.5 }}>
                    <Box component="summary" sx={{ fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 'inherit',
                        lineHeight: 'inherit', cursor: 'pointer' }}>{t('terminal.arguments', { defaultValue: 'Executable and exact arguments' })}</Box>
                    <Box component="pre" sx={codeSx}>{JSON.stringify(execution.argv, null, 2)}</Box>
                </Box>}
            </ExecutionCodeBlock>
        </Collapse>}
    </Box>;
};

export const TerminalApprovalDialog = ({ proposal, onDecision }: {
    proposal: TerminalProposal;
    onDecision: (decision: 'approve' | 'reject') => void;
}) => {
    const { t } = useTranslation();
    const unsandboxed = proposal.dangerouslyDisableSandbox === true;
    const submitted = useRef(false);
    const decide = (decision: 'approve' | 'reject') => {
        if (submitted.current) return;
        submitted.current = true;
        onDecision(decision);
    };

    return <Dialog open maxWidth="sm" fullWidth aria-labelledby="terminal-approval-title"
        onClose={() => decide('reject')}>
        <DialogTitle id="terminal-approval-title" sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: textVar.lg, overflowWrap: 'anywhere' }}>
            <TerminalIcon sx={{ flexShrink: 0 }} />
            {unsandboxed
                ? t('terminal.unsandboxedTitle', { defaultValue: 'Run outside the sandbox?' })
                : t('terminal.approvalTitle', { defaultValue: 'Allow this local command?' })}
        </DialogTitle>
        <DialogContent sx={{ minWidth: 0 }}>
            <Alert severity="warning" sx={{ mb: 2 }}>
                {unsandboxed
                    ? t('terminal.unsandboxedWarning', { defaultValue: 'This command and its children will run without filesystem write confinement, with your normal OS-user access. They can modify or delete local files, including credentials and configuration, and access remote services. This is not limited to cache writes. Command output is sent to your model provider.' })
                    : t('terminal.confinedWarningPolicy', { defaultValue: 'Filesystem writes are restricted to scratch, runtime storage, and the configured CLI state paths. Reads and network access are not confined: commands can send data to remote services, and use existing CLI credentials. Remote resources may be changed. Command output is sent to your model provider.' })}
            </Alert>
            <Typography variant="body2" sx={{ mb: 2, overflowWrap: 'anywhere' }}>{proposal.purpose}</Typography>
            {unsandboxed ? <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2">
                    {t('terminal.sandboxReason', { defaultValue: 'Reason for leaving the sandbox' })}
                </Typography>
                <Typography variant="body2" sx={{ my: 1, overflowWrap: 'anywhere' }}>{proposal.sandboxDisablingReason}</Typography>
                <Typography variant="body2" color="text.secondary">
                    {t('terminal.unsandboxedScope', { defaultValue: 'Approval applies only to this command. Later commands return to the sandbox; changes remain. Auto mode never approves this request.' })}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    {t('terminal.retryRisk', { defaultValue: 'A previous attempt may have partially completed. Check its output before approving a retry.' })}
                </Typography>
            </Box> : proposal.sandboxFilesystem && <TerminalFilesystemSummary policy={proposal.sandboxFilesystem} />}
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
        <DialogActions disableSpacing sx={{ flexWrap: 'wrap', gap: 1, p: 2 }}>
            <Button autoFocus startIcon={<BlockIcon />} onClick={() => decide('reject')}>
                {t('terminal.reject', { defaultValue: 'Reject' })}
            </Button>
            <Button variant="contained" startIcon={<TerminalIcon />} onClick={() => decide('approve')}>
                {unsandboxed
                    ? t('terminal.approveUnsandboxed', { defaultValue: 'Run outside sandbox' })
                    : t('terminal.approve', { defaultValue: 'Run once' })}
            </Button>
        </DialogActions>
    </Dialog>;
};