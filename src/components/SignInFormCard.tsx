// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The agent's request to sign in to a service (the `signin` setup form, design-docs/72). It is shown inside the agent's
 * message: in the panel above the chat box and in the chat view (`embedded`, where the message already says why), or
 * on its own with the agent's explanation. It is the reusable sign-in form (`AccountSignIn`, as in Tools) under the
 * request's title and any steps the agent gave, with the request's own answers in the form's action row: continue
 * without signing in, or continue once signed in. Answering resumes the run the request paused. The thread keeps the
 * answer and the account's name, never a key or a sign-in code.
 *
 * Text follows the message it sits in: one size, with a bold title and muted secondary lines.
 */

import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Link, alpha, useTheme } from '@mui/material';
import LoginIcon from '@mui/icons-material/Login';
import CheckIcon from '@mui/icons-material/Check';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import { dfActions } from '../app/dfSlice';
import { accountsApi, onProviderSite, requestTurnResume, specIsCoherent, unsavedAccount, type AccountState } from '../app/accounts';
import { AccountSignIn, signInAlertSx, signInButtonSx } from './AccountSignIn';
import type { SignInFormArtifact, TextTurn } from './ComponentType';

const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const sameSpec = (a: AccountState, b: NonNullable<SignInFormArtifact['signin']['spec']>) =>
    a.send_to.join(',') === b.send_to.join(',') && a.auth.type === b.auth.type && (a.auth.name || '') === (b.auth.name || '');

/** The site's own icon, from the site the key goes to (not from the agent), so it always matches the hosts shown.
 *  Without one, the generic sign-in icon. */
const SiteIcon = ({ site }: { site?: string }) => {
    const [failed, setFailed] = useState(false);
    useEffect(() => setFailed(false), [site]);
    const size = { width: '1.15em', height: '1.15em', flexShrink: 0 } as const;
    return site && !failed
        ? <Box component="img" src={`https://${site}/favicon.ico`} alt="" referrerPolicy="no-referrer" data-signin-site-icon
            onError={() => setFailed(true)} sx={{ ...size, objectFit: 'contain' }} />
        : <LoginIcon sx={{ ...size, fontSize: '1.15em', color: 'primary.main' }} />;
};

export const SignInFormCard = ({ turn, form, embedded = false }: {
    turn: TextTurn;
    form: SignInFormArtifact;
    /** Inside the agent's message: its text already says why, so the card does not repeat the explanation. */
    embedded?: boolean;
}) => {
    const { t } = useTranslation();
    const theme = useTheme();
    const dispatch = useDispatch();
    const { signin } = form;
    const spec = signin.spec;
    const [account, setAccount] = useState<AccountState>();
    const [error, setError] = useState<string>();
    const [busy, setBusy] = useState(false);
    const answered = !!turn.answered || signin.status !== 'pending';
    const name = signin.providerName;
    // A card from a saved or imported session never passed the server's check of its spec: check it again here.
    const coherent = !spec || specIsCoherent(spec);

    useEffect(() => {
        let stopped = false;
        const use = (next: AccountState) => { if (!stopped) setAccount(next); };
        accountsApi.get(spec?.id || signin.provider)
            // A saved sign-in under this name stands unless the agent proposed a different one (which replaces it).
            .then(saved => use(!spec || spec.verified || sameSpec(saved, spec) ? saved : unsavedAccount(spec)))
            .catch(reason => {
                if (spec && !spec.verified) use(unsavedAccount(spec));
                else if (!stopped) setError(reason instanceof Error ? reason.message : String(reason));
            });
        return () => { stopped = true; };
    }, [signin.provider, spec?.id]);

    // The answer is recorded only once the paused run takes it, so the card never claims a resume that did not happen.
    const answer = (status: 'signed_in' | 'declined', next?: AccountState) => {
        if (answered) return;
        const login = next?.login ?? undefined;
        const who = login ? `${name} as @${login}` : name;
        const resumed = requestTurnResume(turn.id, status === 'declined'
            ? t('accounts.card.declinedMessage', { defaultValue: "I won't sign in to {{name}}. Continue without it.", name })
            : signin.steps.length
                ? t('accounts.card.doneMessage', { defaultValue: 'Signed in to {{who}}, and done with the steps. Continue.', who })
                : t('accounts.card.signedInMessage', { defaultValue: 'Signed in to {{who}}. Continue.', who }));
        setBusy(!resumed);
        if (resumed) dispatch(dfActions.updateTextTurn({ id: turn.id, form: { ...form, signin: { ...signin, status, ...(login ? { login } : {}) } } }));
    };
    // Signing in on the card continues at once, unless the user still has steps to take on the service's site.
    const changed = (next: AccountState) => {
        const justSignedIn = next.signed_in && !account?.signed_in;
        setAccount(next);
        if (justSignedIn && !answered && !signin.steps.length) answer('signed_in', next);
    };
    // On its own, the card says why; inside the message, only what the message does not already say.
    const explanation = !embedded && words(signin.explanation) && !words(turn.content || '').includes(words(signin.explanation))
        ? signin.explanation : '';
    const unlocks = !embedded ? signin.unlocks : undefined;

    const decline = <Button size="small" sx={signInButtonSx} onClick={() => answer('declined')}>
        {t('accounts.card.decline', { defaultValue: 'Continue without signing in' })}
    </Button>;
    const proceed = account?.signed_in && <Button size="small" variant="contained" disableElevation sx={signInButtonSx}
        onClick={() => answer('signed_in', account)}>
        {signin.steps.length ? t('accounts.card.done', { defaultValue: 'Done, continue' }) : t('accounts.card.continue', { defaultValue: 'Continue' })}
    </Button>;

    return <Box data-signin-card={signin.provider} sx={{
        display: 'flex', flexDirection: 'column', gap: 0.75, fontSize: 'inherit', lineHeight: 1.5,
        px: 1.25, py: 1, borderRadius: '8px', bgcolor: 'background.paper',
        border: `1px solid ${alpha(theme.palette.primary.main, answered ? 0.15 : 0.3)}`,
    }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <SiteIcon site={coherent ? spec?.domains?.[0] : undefined} />
            {/* Not an <h3>: the chat view styles a message's markdown headings, and this is the card's own title. */}
            <Box role="heading" aria-level={3} sx={{ fontWeight: 600, flex: 1, minWidth: 0 }}>{form.title}</Box>
            {answered && <Box component="span" sx={{ color: 'text.secondary', display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                {signin.status === 'signed_in' && <CheckIcon sx={{ fontSize: '1.1em', color: 'success.main' }} />}
                {signin.status === 'signed_in'
                    ? (signin.login
                        ? t('accounts.card.signedInAs', { defaultValue: 'Signed in as @{{login}}', login: signin.login })
                        : t('accounts.card.signedIn', { defaultValue: 'Signed in' }))
                    : signin.status === 'declined'
                        ? t('accounts.card.declined', { defaultValue: 'Continued without signing in' })
                        // 'replied', or a session saved before replies were recorded: answered, but not on the card.
                        : t('accounts.card.replied', { defaultValue: 'Not signed in · replied in chat' })}
            </Box>}
        </Box>
        {!answered && (explanation || unlocks || signin.steps.length > 0) && <Box component="section"
            aria-label={t('accounts.card.agentSays', { defaultValue: 'From the agent' })}>
            {explanation && <Box sx={{ overflowWrap: 'anywhere' }}>{explanation}</Box>}
            {unlocks && <Box sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>
                {t('accounts.card.unlocks', { defaultValue: 'Signing in lets it: {{unlocks}}', unlocks })}
            </Box>}
            {signin.steps.length > 0 && <Box component="ol" sx={{ m: 0, pl: '1.4em' }}>
                {signin.steps.map((step, index) => {
                    // Links only to the service's own sites; anything else is shown as text.
                    const href = coherent && onProviderSite(step.url, account?.domains ?? spec?.domains) ? step.url : undefined;
                    return <Box component="li" key={index} sx={{ overflowWrap: 'anywhere' }}>
                        {step.text}{href && <>{' '}<Link href={href} target="_blank" rel="noopener noreferrer">{new URL(href).host + new URL(href).pathname}</Link></>}
                    </Box>;
                })}
            </Box>}
        </Box>}
        {!coherent && <Alert severity="warning" sx={signInAlertSx}>
            {t('accounts.card.incoherent', { defaultValue: 'This sign-in would send a key outside the service it names, so it cannot be used.' })}
        </Alert>}
        {error && <Alert severity="error" sx={signInAlertSx}>{error}</Alert>}
        {busy && !answered && <Alert severity="info" sx={signInAlertSx}>
            {t('accounts.card.busy', { defaultValue: 'The agent is working on another request. Answer here once it finishes.' })}
        </Alert>}
        {!answered && coherent && !account && !error && <CircularProgress size="1em" />}
        {!answered && coherent && account && <AccountSignIn account={account} onChange={changed} prefer={signin.prefer}
            note={signin.replaces && !account.signed_in
                ? t('accounts.card.replaces', { defaultValue: 'Saving replaces your current {{name}} sign-in.', name }) : undefined}
            actions={<>{decline}{proceed}</>} />}
        {!answered && (!coherent || error) && <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>{decline}</Box>}
    </Box>;
};
