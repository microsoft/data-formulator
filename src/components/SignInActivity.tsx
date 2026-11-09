// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The Console's Sign-ins tab (design-docs/72): what the user signed in to, how, for which session, and
 * every request made with a sign-in, newest first. The server keeps no secret in it.
 */

import React, { FC, useEffect, useState } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { apiRequest } from '../app/apiClient';
import { textVar } from '../app/layout';

export interface SignInEvent {
    time: number;
    event: 'signed_in' | 'signed_out' | 'login_changed' | 'login_unreadable' | 'used' | string;
    service: string;
    name: string;
    send_to: string[];
    session?: string;
    how?: 'token' | 'device' | 'local';
    scope?: 'user' | 'session';
    account?: string;
    read?: string;
    reason?: string;
    url?: string;
    status?: number;
    served_from?: string;
    failed?: boolean;
}

export const SignInActivity: FC<{ refresh: number }> = ({ refresh }) => {
    const { t } = useTranslation();
    const [events, setEvents] = useState<SignInEvent[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let stopped = false;
        setError(null);
        apiRequest<{ events: SignInEvent[] }>('/api/accounts/activity')
            .then(({ data }) => { if (!stopped) setEvents(data.events); })
            .catch(reason => { if (!stopped) setError(reason instanceof Error ? reason.message : String(reason)); });
        return () => { stopped = true; };
    }, [refresh]);

    const what: Record<string, string> = {
        signed_in: t('logs.signins.signedIn', { defaultValue: 'Signed in' }),
        signed_out: t('logs.signins.signedOut', { defaultValue: 'Signed out' }),
        login_changed: t('logs.signins.loginChanged', { defaultValue: 'Login changed' }),
        login_unreadable: t('logs.signins.loginUnreadable', { defaultValue: 'Login not readable' }),
        used: t('logs.signins.used', { defaultValue: 'Used' }),
    };
    const how: Record<string, string> = {
        token: t('logs.signins.token', { defaultValue: 'pasted key' }),
        device: t('logs.signins.device', { defaultValue: 'code on the site' }),
        local: t('logs.signins.local', { defaultValue: "this computer's login" }),
    };
    const details = (item: SignInEvent): string => {
        if (item.event === 'used') {
            return [`GET ${item.url ?? ''}`, item.status !== undefined ? `→ ${item.status}` : '',
                item.served_from ? `(${t('logs.signins.servedFrom', { defaultValue: 'served from {{host}}', host: item.served_from })})` : '',
                item.failed ? t('logs.signins.failed', { defaultValue: 'failed' }) : ''].filter(Boolean).join(' ');
        }
        if (item.event === 'signed_out') return item.reason ?? '';
        if (item.event === 'login_unreadable') return item.read ? t('logs.signins.read', { defaultValue: 'read with {{read}}', read: item.read }) : '';
        return [item.how && how[item.how], item.read && `(${item.read})`,
            item.scope === 'user' ? t('logs.signins.allSessions', { defaultValue: 'all sessions' })
                : item.scope === 'session' ? t('logs.signins.thisSession', { defaultValue: 'one session' }) : '',
            item.account && `@${item.account}`].filter(Boolean).join(' · ');
    };

    if (error) return <Typography color="error" sx={{ p: 2, fontSize: textVar.md }}>{error}</Typography>;
    if (!events) return <Box sx={{ p: 2 }}><CircularProgress size={16} /></Box>;
    if (!events.length) {
        return <Typography sx={{ p: 2, fontSize: textVar.sm, color: 'text.secondary' }}>
            {t('logs.signins.empty', { defaultValue: 'No sign-ins yet.' })}</Typography>;
    }
    const cell = { px: 1.5, py: 0.75, textAlign: 'left', verticalAlign: 'top', borderBottom: '1px solid', borderColor: 'divider' } as const;
    return <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <Box component="table" aria-label={t('logs.signinsTab', { defaultValue: 'Sign-ins' })}
            sx={{ width: '100%', borderCollapse: 'collapse', fontSize: textVar.sm, '& th': { ...cell, color: 'text.secondary', fontWeight: 400,
                position: 'sticky', top: 0, bgcolor: 'background.paper' }, '& td': cell }}>
            <thead><tr>
                <th>{t('logs.signins.time', { defaultValue: 'Time' })}</th>
                <th>{t('logs.signins.service', { defaultValue: 'Service' })}</th>
                <th>{t('logs.signins.event', { defaultValue: 'Event' })}</th>
                <th>{t('logs.signins.details', { defaultValue: 'Details' })}</th>
                <th>{t('logs.signins.keyGoesTo', { defaultValue: 'Key sent to' })}</th>
                <th>{t('logs.signins.session', { defaultValue: 'Session' })}</th>
            </tr></thead>
            <tbody>{events.map((item, index) => <tr key={`${item.time}-${index}`} data-signin-event={item.event}>
                <Box component="td" sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>{new Date(item.time * 1000).toLocaleString()}</Box>
                <td>{item.name}</td>
                <td>{what[item.event] ?? item.event}</td>
                <Box component="td" sx={{ overflowWrap: 'anywhere' }}>{details(item)}</Box>
                <Box component="td" sx={{ overflowWrap: 'anywhere' }}>{item.send_to.join(', ')}</Box>
                <Box component="td" sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>{item.session ?? '—'}</Box>
            </tr>)}</tbody>
        </Box>
    </Box>;
};
