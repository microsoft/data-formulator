// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The sign-in form (design-docs/72): one component wherever a user signs in to a service, the agent's sign-in card
 * (in the agent's message above the chat box, and in the chat view) and the service's page in Tools.
 *
 * It says where the key goes, then offers the ways to sign in: this computer's login for the service in one click (when
 * the spec names one and it is there), a code to enter on a built-in service's site, or the key the spec asks for (a
 * token, or a username and key), checked by the server before it is kept. The key goes straight to the server, which
 * keeps it in the vault; the browser keeps only the account's name or the key's last characters. A caller adds its own
 * buttons to the form's action row (`actions`) and a line above it (`note`).
 *
 * Three text styles only (the title is the caller's): body, muted, and links, all in the surrounding text's size.
 */

import React, { ReactNode, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Checkbox, FormControlLabel, Link, TextField, alpha, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { accountsApi, describeLocal, onProviderSite, unsavedAccount, type AccountState, type DeviceSignIn, type SignInMethod,
    type SignInScope } from '../app/accounts';

const errorText = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);

/** A button in the surrounding text's size. */
export const signInButtonSx = { textTransform: 'none', fontSize: 'inherit', lineHeight: 1.5, minWidth: 0, px: 1.25, py: 0.25 } as const;

/** A notice in the surrounding text's size. */
export const signInAlertSx = { py: 0, px: 1, fontSize: 'inherit', alignItems: 'center',
    '& .MuiAlert-icon': { fontSize: '1.2em', py: '4px', mr: 0.75 }, '& .MuiAlert-message': { minWidth: 0, py: '4px' } } as const;

export const AccountSignIn = ({ account, onChange, prefer, sessionScope = true, actions, note }: {
    account: AccountState;
    onChange: (next: AccountState) => void;
    /** The method to offer first, when it is available. */
    prefer?: SignInMethod;
    /** Offer to keep the sign-in for every session (it is kept for this session only otherwise). */
    sessionScope?: boolean;
    /** The caller's buttons, at the end of the action row (before the form's own). */
    actions?: ReactNode;
    /** A muted line above the controls. */
    note?: ReactNode;
}) => {
    const { t } = useTranslation();
    const theme = useTheme();
    const [flow, setFlow] = useState<(DeviceSignIn & { scope?: SignInScope }) | null>(null);
    // With a key to paste as the only way, the form opens on it.
    const [pasting, setPasting] = useState(account.methods.length === 1 && account.methods[0] === 'token');
    const [secret, setSecret] = useState<Record<string, string>>({});
    const [allSessions, setAllSessions] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [working, setWorking] = useState(false);
    const { id, name } = account;
    // The poll runs for a while: it reports to the caller as it is when sign-in finishes, not when it started.
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    const act = async (step: () => Promise<void>) => {
        setWorking(true);
        setError(null);
        try { await step(); } catch (reason) { setError(errorText(reason)); } finally { setWorking(false); }
    };
    useEffect(() => {
        if (!flow) return;
        let stopped = false;
        const timer = setInterval(async () => {
            try {
                const result = await accountsApi.poll(id, flow.flow_id, flow.scope);
                if (stopped) return;
                if (result.flow.status === 'connected') { setFlow(null); onChangeRef.current(result); }
                else if (result.flow.status !== 'pending') {
                    setFlow(null);
                    setError(t('accounts.signin.failed', { defaultValue: '{{name}} sign-in did not finish. Try again.', name }));
                }
            } catch (reason) {
                if (!stopped) { setFlow(null); setError(errorText(reason)); }
            }
        }, Math.max(5, flow.interval) * 1000);
        return () => { stopped = true; clearInterval(timer); };
    }, [flow?.flow_id]);

    const muted = { color: 'text.secondary' } as const;
    // A plain bordered box on white: clearly a field, in the surrounding text's size.
    const fieldSx = {
        flex: '1 1 150px', minWidth: 0,
        '& .MuiInputBase-root': { fontSize: 'inherit', bgcolor: 'background.paper', borderRadius: '6px' },
        '& .MuiInputBase-input': { py: '6px', px: '10px', height: '1.5em' },
        '& .MuiOutlinedInput-notchedOutline': { borderColor: alpha(theme.palette.text.primary, 0.23) },
        '& .MuiInputBase-input::placeholder': { color: theme.palette.text.secondary, opacity: 1 },
    } as const;
    const row = { display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' } as const;
    const end = <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, ml: 'auto', flexWrap: 'wrap' }}>{actions}</Box>;

    // Where the key goes: what the user confirms.
    const destination = <Box data-signin-destination sx={{ ...muted, overflowWrap: 'anywhere' }}>
        {t('accounts.destination', { defaultValue: 'Your key is sent only to' })}{' '}
        <Box component="span" sx={{ color: 'text.primary' }}>{account.send_to.join(', ')}</Box>
    </Box>;

    if (account.signed_in) {
        const who = account.login
            ? t('accounts.signedInAs', { defaultValue: 'Signed in to {{name}} as @{{login}}', name, login: account.login })
            : t('accounts.keySaved', { defaultValue: '{{name}} key {{hint}} saved', name, hint: account.secret_hint || '' });
        return <Box data-account-signin={id} sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, fontSize: 'inherit' }}>
            {destination}
            <Box sx={row}>
                <span>{who}{account.scope === 'user' && <Box component="span" sx={muted}>
                    {' · '}{t('accounts.allSessions', { defaultValue: 'all sessions' })}</Box>}</span>
                <Button size="small" disabled={working} sx={signInButtonSx}
                    onClick={() => act(async () => {
                        const next = await accountsApi.signOut(id);
                        onChange('removed' in next ? unsavedAccount(account) : next);
                    })}>
                    {account.verified ? t('accounts.signOut', { defaultValue: 'Sign out' }) : t('accounts.remove', { defaultValue: 'Remove key' })}
                </Button>
                {end}
            </Box>
            {error && <Alert severity="error" sx={signInAlertSx}>{error}</Alert>}
        </Box>;
    }

    // Left out, the server keeps it for the open session.
    const scope: SignInScope | undefined = allSessions ? 'user' : undefined;
    const scopeChoice = sessionScope && <FormControlLabel sx={{ ml: 0, mr: 0, '& .MuiFormControlLabel-label': { fontSize: 'inherit' } }}
        control={<Checkbox size="small" checked={allSessions} onChange={event => setAllSessions(event.target.checked)}
            sx={{ p: 0.25, mr: 0.5, '& .MuiSvgIcon-root': { fontSize: '1.2em' } }} />}
        label={t('accounts.keepForAll', { defaultValue: 'Keep for all sessions' })} />;
    const secretLabel = account.auth.secret_label || (account.verified ? t('accounts.tokenLabel', { defaultValue: '{{name}} token', name })
        : t('accounts.keyLabel', { defaultValue: 'API key' }));
    const fields: [string, string, boolean][] = account.auth.type === 'basic'
        ? [['username', account.auth.username_label || t('accounts.username', { defaultValue: 'Username' }), false], ['key', secretLabel, true]]
        : [['token', secretLabel, true]];
    const complete = fields.every(([key]) => (secret[key] || '').trim());
    const save = () => act(async () => {
        onChange(account.verified ? await accountsApi.token(id, secret.token || '', scope)
            : await accountsApi.saveCustom(account, secret, scope));
        setSecret({});
        setPasting(false);
    });
    const label: Record<SignInMethod, string> = {
        reuse: account.reusable_login
            ? t('accounts.reuse', { defaultValue: 'Use @{{login}} from this computer', login: account.reusable_login })
            : t('accounts.reuseLocal', { defaultValue: 'Use the login on this computer' }),
        device: t('accounts.device', { defaultValue: 'Sign in with {{name}}', name }),
        token: t('accounts.paste', { defaultValue: 'Paste a token' }),
    };
    const choose = (method: SignInMethod) => method === 'token' ? setPasting(true)
        : act(async () => method === 'device' ? setFlow({ ...await accountsApi.start(id), scope })
            : onChange(account.verified ? await accountsApi.reuse(id, scope) : await accountsApi.reuseCustom(account, scope)));
    const order = [...account.methods].sort((a, b) => Number(b === prefer) - Number(a === prefer));
    const keyPage = onProviderSite(account.get_token, account.domains) ? account.get_token : undefined;

    return <Box data-account-signin={id} sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, fontSize: 'inherit' }}>
        {destination}
        {note && <Box sx={muted}>{note}</Box>}
        {flow ? <><Alert severity="info" role="status" sx={signInAlertSx}
            action={<Button size="small" color="inherit" sx={signInButtonSx}
                onClick={() => { void accountsApi.cancel(id, flow.flow_id).catch(() => undefined); setFlow(null); }}>
                {t('accounts.cancel', { defaultValue: 'Cancel' })}</Button>}>
            {t('accounts.enterCode', { defaultValue: 'Enter this code on {{name}}, then approve. This waits for you.', name })}{' '}
            <Box component="code" aria-label={t('accounts.code', { defaultValue: 'Sign-in code' })}
                sx={{ fontFamily: 'monospace', fontWeight: 600, userSelect: 'all' }}>{flow.user_code}</Box>{' '}
            <Link href={flow.authorization_url} target="_blank" rel="noopener noreferrer"
                onClick={() => void navigator.clipboard?.writeText(flow.user_code).catch(() => undefined)}>
                {t('accounts.open', { defaultValue: 'Copy code and open {{name}}', name })}</Link>
        </Alert>{actions && <Box sx={row}>{end}</Box>}</>
        : pasting ? <Box component="form" sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}
            onSubmit={event => { event.preventDefault(); if (complete) void save(); }}>
            {!account.verified && (account.instructions || keyPage) && <Box sx={muted}>
                {account.instructions}{account.instructions && keyPage ? ' ' : ''}
                {keyPage && <Link href={keyPage} target="_blank" rel="noopener noreferrer">
                    {t('accounts.getKey', { defaultValue: 'Get it on {{host}}', host: new URL(keyPage).host })}</Link>}
            </Box>}
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {fields.map(([key, fieldLabel, hidden]) => <TextField key={key} size="small" placeholder={fieldLabel}
                    type={hidden ? 'password' : 'text'} autoComplete="off" value={secret[key] || ''}
                    onChange={event => setSecret(current => ({ ...current, [key]: event.target.value }))}
                    slotProps={{ htmlInput: { 'aria-label': fieldLabel } }} sx={fieldSx} />)}
            </Box>
            <Box sx={row}>
                {scopeChoice}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, ml: 'auto', flexWrap: 'wrap' }}>
                    {actions}
                    <Button type="submit" size="small" variant="contained" disableElevation disabled={working || !complete} sx={signInButtonSx}>
                        {account.verified ? t('accounts.tokenSave', { defaultValue: 'Sign in' }) : t('accounts.keySave', { defaultValue: 'Check and save' })}
                    </Button>
                </Box>
            </Box>
        </Box>
        : <>{account.local && order.includes('reuse') && <Box sx={muted}>
            {t('accounts.localRead', { defaultValue: 'The login on this computer is read with' })}{' '}
            <Box component="code" data-signin-local sx={{ fontFamily: 'monospace', color: 'text.primary', overflowWrap: 'anywhere' }}>
                {describeLocal(account.local)}</Box>
        </Box>}<Box sx={row}>
            {scopeChoice}
            {order.map((method, index) => <Button key={method} size="small" variant={index === 0 ? 'contained' : 'outlined'}
                disableElevation disabled={working} sx={signInButtonSx} onClick={() => void choose(method)}>{label[method]}</Button>)}
            {end}
        </Box></>}
        {error && <Alert severity="error" sx={signInAlertSx}>{error}</Alert>}
    </Box>;
};
