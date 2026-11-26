// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The agent's browser in the Tools dialog: its switch, which browser it drives, the availability check, and for
 * each step that fails, how to fix it with an illustration of where the setting is. Also the link the agent puts
 * in its message to bring one of its tabs (a sign-in page) to the user.
 */

import React, { useState } from 'react';
import { Alert, Box, Button, FormControl, InputLabel, MenuItem, Select, TextField, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import FilterNoneOutlinedIcon from '@mui/icons-material/FilterNoneOutlined';
import EditNoteOutlinedIcon from '@mui/icons-material/EditNoteOutlined';
import KeyOutlinedIcon from '@mui/icons-material/KeyOutlined';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import PanToolOutlinedIcon from '@mui/icons-material/PanToolOutlined';
import LanguageOutlinedIcon from '@mui/icons-material/LanguageOutlined';
import PersonOutlineOutlinedIcon from '@mui/icons-material/PersonOutlineOutlined';
import ExtensionOutlinedIcon from '@mui/icons-material/ExtensionOutlined';
import SettingsSuggestOutlinedIcon from '@mui/icons-material/SettingsSuggestOutlined';
import HandymanOutlinedIcon from '@mui/icons-material/HandymanOutlined';
import { useTranslation } from 'react-i18next';
import { textVar } from '../app/layout';
import { focusBrowserTab, openInAgentBrowser, type BrowserChoice, type BrowserStatus, type BrowserStep } from '../app/browserSettings';
import { ToolSwitch } from './McpServers';

const BROWSER_NAMES: Record<string, string> = { edge: 'Microsoft Edge', chrome: 'Google Chrome', safari: 'Safari' };
const AUTOMATION_SETTINGS = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation';

/** The browser's state in a word or two. */
export const BrowserStatusLabel = ({ status }: { status: BrowserStatus }) => {
    const { t } = useTranslation();
    const color = !status.enabled ? 'text.secondary' : status.ready === false ? 'warning.main' : status.ready ? 'success.main' : 'text.secondary';
    return <Typography component="span" variant="caption" sx={{ color }}>
        {!status.enabled ? t('browser.status.off', { defaultValue: 'Off' })
            : status.ready === false ? t('browser.status.needsSetup', { defaultValue: 'Needs setup' })
            : status.ready ? t('browser.status.ready', { defaultValue: 'Ready · {{name}}', name: status.label })
            : status.label || t('browser.status.on', { defaultValue: 'On' })}
    </Typography>;
};

// -- illustrations: where each setting is, drawn as the system shows it -----------------------------------------------

const mockFont = { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', fontSize: 12, lineHeight: 1.5 };
const highlight = { bgcolor: '#0a64d8', color: '#fff', borderRadius: '4px' };

/** A macOS menu bar with one menu (and optionally a submenu) open, the item to choose highlighted. */
const MenuIllustration = ({ app, menus, open, items, submenu }: {
    app: string; menus: string[]; open: string;
    items: { label: string; arrow?: boolean; active?: boolean; separator?: boolean }[];
    submenu?: { label: string; checked?: boolean; active?: boolean }[];
}) => {
    const row = 18;
    const activeRow = Math.max(0, items.findIndex(item => item.active));
    return <Box aria-hidden sx={{ ...mockFont, border: '1px solid', borderColor: 'divider', borderRadius: 1.5, overflow: 'hidden',
        bgcolor: 'grey.50', height: 40 + row * Math.max(items.length, activeRow + (submenu?.length ?? 0)), userSelect: 'none' }}>
        <Box sx={{ display: 'flex', gap: 1.75, px: 1.5, py: 0.4, bgcolor: 'rgba(0,0,0,0.06)', alignItems: 'center' }}>
            <Box component="span" sx={{ fontWeight: 700 }}>{app}</Box>
            {menus.map(menu => <Box key={menu} component="span" sx={{ position: 'relative' }}>
                <Box component="span" sx={menu === open ? { ...highlight, px: 0.75, mx: -0.75 } : undefined}>{menu}</Box>
                {menu === open && <Box sx={{ position: 'absolute', top: 'calc(100% + 4px)', left: -6, display: 'flex', alignItems: 'flex-start', zIndex: 1 }}>
                    <Box sx={{ bgcolor: 'background.paper', boxShadow: 3, borderRadius: 1.5, p: 0.5, minWidth: 170, whiteSpace: 'nowrap' }}>
                        {items.map((item, index) => item.separator
                            ? <Box key={index} sx={{ borderTop: '1px solid', borderColor: 'divider', my: '4px' }} />
                            : <Box key={index} sx={{ display: 'flex', px: 1, height: row, alignItems: 'center', ...(item.active ? highlight : { color: 'text.secondary' }) }}>
                                <span>{item.label}</span><Box sx={{ flex: 1, minWidth: 16 }} />{item.arrow && <span>›</span>}
                            </Box>)}
                    </Box>
                    {submenu && <Box sx={{ bgcolor: 'background.paper', boxShadow: 3, borderRadius: 1.5, p: 0.5, ml: '-4px', whiteSpace: 'nowrap',
                        mt: `${items.slice(0, activeRow).reduce((sum, item) => sum + (item.separator ? 9 : row), 0)}px` }}>
                        {submenu.map(item => <Box key={item.label} sx={{ display: 'flex', gap: 0.75, px: 1, height: row, alignItems: 'center',
                            ...(item.active ? highlight : { color: 'text.secondary' }) }}>
                            <Box component="span" sx={{ width: 10 }}>{item.checked ? '✓' : ''}</Box><span>{item.label}</span>
                        </Box>)}
                    </Box>}
                </Box>}
            </Box>)}
        </Box>
    </Box>;
};

/** A settings window: a sidebar or tab row, and the one control to change, highlighted. */
const SettingsIllustration = ({ title, nav, active, control, rows }: {
    title: string; nav: string[]; active: string; control: string; rows?: string[];
}) => <Box aria-hidden sx={{ ...mockFont, border: '1px solid', borderColor: 'divider', borderRadius: 1.5, overflow: 'hidden', userSelect: 'none' }}>
    <Box sx={{ px: 1.5, py: 0.4, bgcolor: 'rgba(0,0,0,0.06)', display: 'flex', gap: 0.75, alignItems: 'center' }}>
        {['#ff5f57', '#febc2e', '#28c840'].map(color => <Box key={color} sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: color }} />)}
        <Box component="span" sx={{ ml: 1, fontWeight: 600 }}>{title}</Box>
    </Box>
    <Box sx={{ display: 'flex', bgcolor: 'background.paper' }}>
        <Box sx={{ width: 150, borderRight: '1px solid', borderColor: 'divider', p: 0.75, bgcolor: 'grey.50' }}>
            {nav.map(item => <Box key={item} sx={{ px: 1, ...(item === active ? highlight : { color: 'text.secondary' }) }}>{item}</Box>)}
        </Box>
        <Box sx={{ p: 1.25, flex: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {(rows ?? []).map(row => <Box key={row} sx={{ color: 'text.disabled' }}>{row}</Box>)}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 0.75, py: 0.25, border: '2px solid #0a64d8', borderRadius: 1 }}>
                <Box sx={{ width: 26, height: 14, borderRadius: 7, bgcolor: '#28c840', position: 'relative', flexShrink: 0,
                    '&::after': { content: '""', position: 'absolute', right: 1, top: 1, width: 12, height: 12, borderRadius: '50%', bgcolor: '#fff' } }} />
                <span>{control}</span>
            </Box>
        </Box>
    </Box>
</Box>;

/** Safari's Settings window as it looks: icon tabs across the top, the pane's name as the title, and labelled checkbox rows. */
const SAFARI_PANES: [string, React.ElementType][] = [['General', SettingsOutlinedIcon], ['Tabs', FilterNoneOutlinedIcon],
    ['AutoFill', EditNoteOutlinedIcon], ['Passwords', KeyOutlinedIcon], ['Search', SearchOutlinedIcon], ['Security', LockOutlinedIcon],
    ['Privacy', PanToolOutlinedIcon], ['Websites', LanguageOutlinedIcon], ['Profiles', PersonOutlineOutlinedIcon],
    ['Extensions', ExtensionOutlinedIcon], ['Advanced', SettingsSuggestOutlinedIcon], ['Developer', HandymanOutlinedIcon]];
// Safari 17 added the Profiles and Developer panes.
const LEGACY_SAFARI_PANES = SAFARI_PANES.filter(([pane]) => pane !== 'Profiles' && pane !== 'Developer');

const SafariSettingsIllustration = ({ pane, legacy = false, rows }: {
    pane: string; legacy?: boolean; rows: { label?: string; text: string; checked?: boolean; target?: boolean }[];
}) => <Box aria-hidden sx={{ ...mockFont, border: '1px solid', borderColor: 'divider', borderRadius: 1.5, overflow: 'hidden', userSelect: 'none',
    bgcolor: 'background.paper' }}>
    <Box sx={{ bgcolor: 'grey.50', borderBottom: '1px solid', borderColor: 'divider', px: 1.5, py: 0.5 }}>
        <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', height: 18 }}>
            <Box sx={{ position: 'absolute', left: 0, display: 'flex', gap: 0.75 }}>
                {['#ff5f57', '#febc2e', '#28c840'].map(color => <Box key={color} sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: color }} />)}
            </Box>
            <Box component="span" sx={{ fontWeight: 600 }}>{pane}</Box>
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 0.25, mt: 0.25 }}>
            {(legacy ? LEGACY_SAFARI_PANES : SAFARI_PANES).map(([name, Icon]) => <Box key={name} sx={{ display: 'flex', flexDirection: 'column',
                alignItems: 'center', px: 0.75, py: 0.25, borderRadius: 1, fontSize: 10, lineHeight: 1.3,
                ...(name === pane ? { color: '#0a64d8', bgcolor: 'background.paper' } : { color: 'text.secondary' }) }}>
                <Icon sx={{ fontSize: 18 }} />{name}
            </Box>)}
        </Box>
    </Box>
    <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 3fr)', columnGap: 1, rowGap: 0.5, px: 2, py: 1.25 }}>
        {rows.map(row => <React.Fragment key={row.text}>
            <Box sx={{ textAlign: 'right', color: 'text.secondary', alignSelf: 'center' }}>{row.label ? `${row.label}:` : ''}</Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, justifySelf: 'start', px: 0.5, mx: -0.5, borderRadius: 1,
                ...(row.target ? { outline: '2px solid #0a64d8', color: 'text.primary' } : { color: 'text.disabled' }) }}>
                <Box sx={{ width: 12, height: 12, borderRadius: '3px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, color: '#fff', ...(row.checked ? { bgcolor: '#0a64d8' } : { border: '1px solid', borderColor: 'grey.400' }) }}>
                    {row.checked ? '✓' : ''}
                </Box>
                <span>{row.text}</span>
            </Box>
        </React.Fragment>)}
    </Box>
</Box>;

/** A numbered illustration, for a fix that takes more than one setting. */
const NumberedStep = ({ n, children }: { n: number; children: React.ReactNode }) =>
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Box aria-hidden sx={{ mt: 0.5, width: 20, height: 20, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center',
            justifyContent: 'center', bgcolor: '#0a64d8', color: '#fff', fontSize: textVar.xs, fontWeight: 600 }}>{n}</Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Box>;

/** How to fix one failed step, with a picture of where the setting is. */
const StepFix = ({ step, status }: { step: BrowserStep; status: BrowserStatus }) => {
    const { t } = useTranslation();
    const name = BROWSER_NAMES[status.browser || ''] || status.label || 'the browser';
    const mac = status.platform === 'darwin';
    if (step.step === 'automation') {
        return <>
            <Typography variant="body2">{t('browser.fix.automation', { defaultValue: 'macOS asks before one app controls another. Allow the app that runs Data Formulator (Terminal, VS Code, or Data Formulator itself) to control {{name}}: in System Settings → Privacy & Security → Automation, turn on {{name}} under that app. If the app is not listed yet, click Check again and choose OK when macOS asks.', name })}</Typography>
            <SettingsIllustration title={t('browser.fix.systemSettings', { defaultValue: 'Privacy & Security › Automation' })}
                nav={['Privacy & Security', 'Automation']} active="Automation" rows={['Terminal']} control={name} />
            <Box><Button size="small" component="a" href={AUTOMATION_SETTINGS} endIcon={<OpenInNewIcon sx={{ fontSize: 14 }} />}>
                {t('browser.fix.openAutomation', { defaultValue: 'Open Automation settings' })}</Button></Box>
        </>;
    }
    if (step.step === 'javascript' && status.browser === 'safari') {
        // Safari 17 moved the setting from the Develop menu into a Developer pane of Settings.
        const major = Number.parseInt(status.version ?? '', 10);
        if (Number.isFinite(major) && major < 17) {
            return <>
                <Typography variant="body2">{t('browser.fix.safariLegacy', { defaultValue: 'In Safari, open Settings (Preferences on older macOS) → Advanced and turn on “Show Develop menu in menu bar”. Then, in the menu bar, choose Develop → Allow JavaScript from Apple Events.' })}</Typography>
                <NumberedStep n={1}><SafariSettingsIllustration legacy pane="Advanced" rows={[
                    { label: 'Smart Search Field', text: 'Show full website address' },
                    { label: 'Accessibility', text: 'Press Tab to highlight each item on a webpage' },
                    { text: 'Show Develop menu in menu bar', checked: true, target: true }]} /></NumberedStep>
                <NumberedStep n={2}><MenuIllustration app="Safari" menus={['File', 'Edit', 'View', 'History', 'Bookmarks', 'Develop', 'Window']} open="Develop"
                    items={[{ label: 'Open Page With', arrow: true }, { label: 'User Agent', arrow: true }, { separator: true, label: '' },
                        { label: 'Allow JavaScript from Smart Search Field' }, { label: 'Allow JavaScript from Apple Events', active: true },
                        { label: 'Allow Remote Automation' }]} /></NumberedStep>
            </>;
        }
        return <>
            <Typography variant="body2">{t('browser.fix.safari', { defaultValue: 'In Safari, open Settings → Advanced and turn on “Show features for web developers”. Then, in Settings → Developer, turn on “Allow JavaScript from Apple Events”.' })}</Typography>
            <NumberedStep n={1}><SafariSettingsIllustration pane="Advanced" rows={[
                { label: 'Smart Search Field', text: 'Show full website address' },
                { label: 'Accessibility', text: 'Press Tab to highlight each item on a webpage' },
                { text: 'Show features for web developers', checked: true, target: true }]} /></NumberedStep>
            <NumberedStep n={2}><SafariSettingsIllustration pane="Developer" rows={[
                { label: 'Automation', text: 'Allow remote automation and external agents' },
                { text: 'Allow JavaScript from Smart Search field' },
                { text: 'Allow JavaScript from Apple Events', checked: true, target: true }]} /></NumberedStep>
        </>;
    }
    if (step.step === 'javascript' && mac) {
        return <>
            <Typography variant="body2">{t('browser.fix.chromium', { defaultValue: 'In {{name}}’s menu bar, choose View → Developer → Allow JavaScript from Apple Events, so a check mark shows next to it. It lets Data Formulator read the pages it opens.', name })}</Typography>
            <MenuIllustration app={status.browser === 'chrome' ? 'Chrome' : 'Edge'} menus={['File', 'Edit', 'View', 'History']} open="View"
                items={[{ label: 'Always Show Bookmarks Bar' }, { label: 'Full Screen' }, { separator: true, label: '' },
                    { label: 'Developer', arrow: true, active: true }]}
                submenu={[{ label: 'View Source' }, { label: 'Developer Tools' }, { label: 'Allow JavaScript from Apple Events', checked: true, active: true }]} />
        </>;
    }
    if (step.step === 'installed') {
        return status.driver === 'playwright' || !mac
            ? <>
                <Typography variant="body2">{t('browser.fix.playwright', { defaultValue: 'Data Formulator drives the Microsoft Edge already on this computer, which needs its browser support package. Install it into the Python environment that runs Data Formulator, then restart Data Formulator:' })}</Typography>
                <Box component="pre" sx={{ m: 0, p: 1, borderRadius: 1, bgcolor: 'grey.100', fontFamily: 'var(--df-font-mono)', fontSize: textVar.sm,
                    overflowX: 'auto' }}>pip install "data_formulator[browser]"</Box>
            </>
            : <Typography variant="body2">{t('browser.fix.installBrowser', { defaultValue: 'Install Microsoft Edge, Google Chrome, or use Safari, then check again.' })}</Typography>;
    }
    if (step.step === 'launch') {
        return <Typography variant="body2">{t('browser.fix.launch', { defaultValue: 'Edge could not be started for Data Formulator. On a work computer, your organization may turn this off (the Edge policy RemoteDebuggingAllowed); ask your IT administrator, or choose Google Chrome above.' })}</Typography>;
    }
    return null;
};

const stepLabel = (step: BrowserStep['step'], name: string, t: (key: string, options: Record<string, unknown>) => string) => ({
    installed: t('browser.step.installed', { defaultValue: '{{name}} is available', name }),
    automation: t('browser.step.automation', { defaultValue: 'macOS lets Data Formulator control {{name}}', name }),
    javascript: t('browser.step.javascript', { defaultValue: '{{name}} lets Data Formulator read pages', name }),
    launch: t('browser.step.launch', { defaultValue: '{{name}} starts for Data Formulator', name }),
}[step]);

/** The browser's page in the Tools dialog. */
export const BrowserDetails = ({ status, busy, onChange, onCheck }: {
    status: BrowserStatus; busy: boolean;
    onChange: (change: { enabled?: boolean; browser?: BrowserChoice }) => Promise<boolean>;
    onCheck: () => Promise<void>;
}) => {
    const { t } = useTranslation();
    const [siteUrl, setSiteUrl] = useState('');
    const [siteError, setSiteError] = useState('');
    const mac = status.platform === 'darwin';
    const name = BROWSER_NAMES[status.browser || ''] || status.label || t('browser.name', { defaultValue: 'Browser' });
    const choices: [BrowserChoice, string][] = mac
        ? [['auto', t('browser.choice.auto', { defaultValue: 'Your default browser' })], ['edge', 'Microsoft Edge'], ['chrome', 'Google Chrome'],
            ['safari', 'Safari'], ['profile', t('browser.choice.profile', { defaultValue: 'A separate Edge window (its own sign-ins)' })]]
        : [['auto', 'Microsoft Edge'], ['chrome', 'Google Chrome']];
    const openSite = async () => {
        setSiteError('');
        try { await openInAgentBrowser(/^https?:\/\//.test(siteUrl) ? siteUrl : `https://${siteUrl}`); }
        catch (reason) { setSiteError(reason instanceof Error ? reason.message : String(reason)); }
    };
    return <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t('browser.name', { defaultValue: 'Browser' })}</Typography>
                <BrowserStatusLabel status={status} />
                <Box sx={{ flex: 1 }} />
                <ToolSwitch checked={status.enabled} disabled={busy} onChange={enabled => void onChange({ enabled })}
                    color={status.enabled && status.ready === false ? 'warning' : 'primary'}
                    label={t('browser.use', { defaultValue: 'Use the browser' })} />
            </Box>
            <Typography variant="body2">{t('browser.about', { defaultValue: 'Let the agent read the web in a real browser: pages drawn by JavaScript, sites that block simple downloads, and sites you are signed in to. Pages open in a window of their own; the agent never uses your other tabs.' })}</Typography>
        </Box>
        <FormControl size="small" sx={{ maxWidth: 360 }} disabled={busy}>
            <InputLabel id="browser-choice">{t('browser.choiceLabel', { defaultValue: 'Browser to use' })}</InputLabel>
            <Select labelId="browser-choice" label={t('browser.choiceLabel', { defaultValue: 'Browser to use' })}
                value={choices.some(([value]) => value === status.choice) ? status.choice : 'auto'}
                onChange={event => void onChange({ browser: event.target.value as BrowserChoice })}>
                {choices.map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
            </Select>
        </FormControl>
        {status.label && <Typography variant="body2" color="text.secondary">
            {status.user_profile
                ? t('browser.userProfile', { defaultValue: 'Uses your own {{name}}, signed in as you: sites you are signed in to work as they do for you.', name: status.label })
                : t('browser.ownProfile', { defaultValue: 'Uses {{name}} with a profile of its own, so your everyday sign-ins are not there. When a site needs you to sign in, sign in once in that window and it is remembered.', name: status.label })}
        </Typography>}
        {status.enabled && <Box component="section" sx={{ display: 'flex', flexDirection: 'column', gap: 1, p: 1.5, border: '1px solid',
            borderColor: status.ready === false ? 'warning.light' : 'divider', borderRadius: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="subtitle2">{t('browser.setup', { defaultValue: 'Setup' })}</Typography>
                <Box sx={{ flex: 1 }} />
                <Button size="small" variant={status.ready === false ? 'contained' : 'outlined'} disableElevation disabled={busy}
                    onClick={() => void onCheck()}>
                    {status.steps ? t('browser.checkAgain', { defaultValue: 'Check again' }) : t('browser.check', { defaultValue: 'Check' })}
                </Button>
            </Box>
            {!status.steps && <Typography variant="body2" color="text.secondary">
                {mac ? t('browser.checkHintMac', { defaultValue: 'Check that the agent can use the browser. macOS may ask whether Data Formulator can control it; choose OK.' })
                    : t('browser.checkHint', { defaultValue: 'Check that the agent can use the browser. A browser window opens and closes.' })}
            </Typography>}
            {status.steps?.map(step => <Box key={step.step} sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    {step.ok ? <CheckCircleIcon sx={{ fontSize: 18, color: 'success.main' }} />
                        : step.ok === false ? <ErrorOutlineIcon sx={{ fontSize: 18, color: 'warning.main' }} />
                        : <RadioButtonUncheckedIcon sx={{ fontSize: 18, color: 'text.disabled' }} />}
                    <Typography variant="body2" sx={{ fontWeight: step.ok === false ? 600 : 400, color: step.ok === null ? 'text.disabled' : 'text.primary' }}>
                        {stepLabel(step.step, name, t)}
                    </Typography>
                </Box>
                {step.ok === false && <Box sx={{ pl: 3.25, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <StepFix step={step} status={status} />
                    {step.detail && <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{step.detail}</Typography>}
                </Box>}
            </Box>)}
            {status.ready && <Typography variant="body2" sx={{ color: 'success.main' }}>
                {t('browser.ready', { defaultValue: 'Ready. Ask the agent to get data from a web page.' })}</Typography>}
        </Box>}
        {status.enabled && !status.user_profile && status.label && <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            <Typography variant="subtitle2">{t('browser.signInTitle', { defaultValue: 'Sign in to a site' })}</Typography>
            <Typography variant="body2" color="text.secondary">{t('browser.signInHint', { defaultValue: 'Open a site in the agent’s browser window to sign in ahead of time. The agent also asks you when it reaches a sign-in page.' })}</Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField size="small" value={siteUrl} onChange={event => setSiteUrl(event.target.value)} placeholder="https://"
                    sx={{ flex: 1, maxWidth: 420 }} inputProps={{ 'aria-label': t('browser.signInTitle', { defaultValue: 'Sign in to a site' }) }}
                    onKeyDown={event => { if (event.key === 'Enter' && siteUrl.trim()) void openSite(); }} />
                <Button size="small" variant="outlined" disabled={busy || !siteUrl.trim()} onClick={() => void openSite()}>
                    {t('browser.open', { defaultValue: 'Open' })}</Button>
            </Box>
            {siteError && <Alert severity="error" sx={{ py: 0 }}>{siteError}</Alert>}
        </Box>}
    </Box>;
};

/** The agent's `df-browser://tab/<id>` link: brings that tab of its browser to the front. */
export const BrowserTabLink = ({ tab, children }: { tab: string; children: React.ReactNode }) => {
    const { t } = useTranslation();
    const [failed, setFailed] = useState(false);
    return <Box component="button" type="button" title={failed ? t('browser.tabGone', { defaultValue: 'That tab is no longer open.' }) : undefined}
        onClick={() => { setFailed(false); focusBrowserTab(tab).catch(() => setFailed(true)); }}
        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4, p: 0, border: 0, bgcolor: 'transparent', cursor: 'pointer',
            font: 'inherit', color: failed ? 'text.disabled' : 'primary.main', textDecoration: 'underline', textUnderlineOffset: 2 }}>
        {children}<OpenInNewIcon sx={{ fontSize: '0.9em' }} />
    </Box>;
};
