// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useState, useCallback, useEffect } from 'react';
import {
    Box, Button, TextField, Typography, Alert, CircularProgress,
    Divider, alpha, useTheme,
} from '@mui/material';
import LoginIcon from '@mui/icons-material/Login';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useTranslation } from 'react-i18next';

import { supersetLogin, supersetSsoSaveTokens, supersetGuestLogin } from './api';
import type { PluginConfig } from '../types';

interface SupersetLoginProps {
    config: PluginConfig;
    onLoginSuccess: (user: Record<string, unknown>) => void;
}

export const SupersetLogin: FC<SupersetLoginProps> = ({ config, onLoginSuccess }) => {
    const { t } = useTranslation();
    const theme = useTheme();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const ssoLoginUrl = config.sso_login_url as string | undefined;
    const authModes = (config.auth_modes as string[]) || [];
    const showPasswordLogin = authModes.includes('password');
    const showSso = authModes.includes('sso') && !!ssoLoginUrl;
    const guestEnabled = config.guest_enabled as boolean | undefined;

    const handlePasswordLogin = useCallback(async () => {
        if (!username || !password) return;
        setLoading(true);
        setError('');
        try {
            const result = await supersetLogin(username, password);
            if (result.status === 'ok') {
                onLoginSuccess(result.user);
            } else {
                setError(result.message || t('plugin.superset.loginFailed'));
            }
        } catch (err: any) {
            setError(err.message || t('plugin.superset.loginFailed'));
        } finally {
            setLoading(false);
        }
    }, [username, password, onLoginSuccess, t]);

    const handleGuestLogin = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const result = await supersetGuestLogin();
            if (result.status === 'ok') {
                onLoginSuccess(result.user);
            } else {
                setError(result.message || t('plugin.superset.guestFailed'));
            }
        } catch (err: any) {
            setError(err.message || t('plugin.superset.guestFailed'));
        } finally {
            setLoading(false);
        }
    }, [onLoginSuccess, t]);

    const handleSsoLogin = useCallback(() => {
        if (!ssoLoginUrl) return;
        const popup = window.open(ssoLoginUrl, 'superset-sso', 'width=600,height=700');

        const handler = async (event: MessageEvent) => {
            if (!event.data?.type?.startsWith?.('superset-sso')) return;
            window.removeEventListener('message', handler);
            popup?.close();

            const { access_token, refresh_token, user } = event.data;
            if (access_token) {
                try {
                    const result = await supersetSsoSaveTokens(access_token, refresh_token, user);
                    if (result.status === 'ok') {
                        onLoginSuccess(result.user);
                    } else {
                        setError(result.message || t('plugin.superset.ssoFailed'));
                    }
                } catch (err: any) {
                    setError(err.message || t('plugin.superset.ssoFailed'));
                }
            }
        };
        window.addEventListener('message', handler);
    }, [ssoLoginUrl, onLoginSuccess, t]);

    return (
        <Box sx={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: '100%', p: 3, gap: 2,
        }}>
            <Typography variant="subtitle2" sx={{ mb: 1, opacity: 0.8 }}>
                {t('plugin.superset.connectTo', { name: config.name || 'Apache Superset' })}
            </Typography>

            {error && <Alert severity="error" sx={{ width: '100%', maxWidth: 360 }}>{error}</Alert>}

            {showPasswordLogin && (
                <Box sx={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                    <TextField
                        size="small"
                        label={t('plugin.superset.username')}
                        value={username}
                        onChange={e => setUsername(e.target.value)}
                        autoFocus
                        fullWidth
                        onKeyDown={e => e.key === 'Enter' && handlePasswordLogin()}
                    />
                    <TextField
                        size="small"
                        label={t('plugin.superset.password')}
                        type="password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        fullWidth
                        onKeyDown={e => e.key === 'Enter' && handlePasswordLogin()}
                    />
                    <Button
                        variant="contained"
                        size="small"
                        startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <LoginIcon />}
                        onClick={handlePasswordLogin}
                        disabled={loading || !username || !password}
                        sx={{ textTransform: 'none' }}
                    >
                        {t('plugin.superset.login')}
                    </Button>
                </Box>
            )}

            {showPasswordLogin && showSso && (
                <Divider sx={{ width: '100%', maxWidth: 360, my: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                        {t('plugin.superset.or')}
                    </Typography>
                </Divider>
            )}

            {showSso && (
                <Button
                    variant="outlined"
                    size="small"
                    startIcon={<OpenInNewIcon />}
                    onClick={handleSsoLogin}
                    sx={{ textTransform: 'none', maxWidth: 360, width: '100%' }}
                >
                    {t('plugin.superset.ssoLogin')}
                </Button>
            )}

            {guestEnabled && (
                <>
                    {(showPasswordLogin || showSso) && (
                        <Divider sx={{ width: '100%', maxWidth: 360, my: 1 }}>
                            <Typography variant="caption" color="text.secondary">
                                {t('plugin.superset.or')}
                            </Typography>
                        </Divider>
                    )}
                    <Button
                        variant="text"
                        size="small"
                        onClick={handleGuestLogin}
                        disabled={loading}
                        sx={{ textTransform: 'none', maxWidth: 360, width: '100%', color: 'text.secondary' }}
                    >
                        {t('plugin.superset.browsePublic')}
                    </Button>
                </>
            )}
        </Box>
    );
};
