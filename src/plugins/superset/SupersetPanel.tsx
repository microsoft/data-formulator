// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useState, useEffect, useCallback } from 'react';
import { Box, Tab, Tabs, Typography, Button } from '@mui/material';
import TableRowsIcon from '@mui/icons-material/TableRows';
import DashboardIcon from '@mui/icons-material/Dashboard';
import LogoutIcon from '@mui/icons-material/Logout';
import { useTranslation } from 'react-i18next';

import type { PluginPanelProps } from '../types';
import { supersetAuthStatus, supersetLogout } from './api';
import { SupersetLogin } from './SupersetLogin';
import { SupersetCatalog } from './SupersetCatalog';
import { SupersetDashboards } from './SupersetDashboards';

export const SupersetPanel: FC<PluginPanelProps> = ({ config, callbacks }) => {
    const { t } = useTranslation();
    const [tab, setTab] = useState<0 | 1>(0);
    const [authenticated, setAuthenticated] = useState<boolean | null>(null);
    const [user, setUser] = useState<Record<string, unknown> | null>(null);
    const [vaultStale, setVaultStale] = useState(false);

    useEffect(() => {
        supersetAuthStatus()
            .then(data => {
                setAuthenticated(data.authenticated);
                if (data.authenticated) setUser(data.user);
                if (data.vault_stale) setVaultStale(true);
            })
            .catch(() => setAuthenticated(false));
    }, []);

    const handleLoginSuccess = useCallback((u: Record<string, unknown>) => {
        setAuthenticated(true);
        setUser(u);
    }, []);

    const handleLogout = useCallback(async () => {
        await supersetLogout();
        setAuthenticated(false);
        setUser(null);
    }, []);

    const handleDatasetLoaded = useCallback((tableName: string, rowCount: number) => {
        callbacks.onDataLoaded({
            tableName,
            rowCount,
            source: 'superset',
        });
    }, [callbacks]);

    if (authenticated === null) {
        return <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
            <Typography variant="body2" color="text.secondary">{t('plugin.superset.checkingAuth')}</Typography>
        </Box>;
    }

    if (!authenticated) {
        return <SupersetLogin config={config} onLoginSuccess={handleLoginSuccess} vaultStale={vaultStale} />;
    }

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Tabs
                    value={tab}
                    onChange={(_, v) => setTab(v)}
                    variant="fullWidth"
                    sx={{
                        flex: 1, minHeight: 36,
                        '& .MuiTab-root': { minHeight: 36, py: 0.5, textTransform: 'none', fontSize: 13 },
                    }}
                >
                    <Tab icon={<DashboardIcon sx={{ fontSize: 16 }} />} iconPosition="start" label={t('plugin.superset.dashboards')} />
                    <Tab icon={<TableRowsIcon sx={{ fontSize: 16 }} />} iconPosition="start" label={t('plugin.superset.datasets')} />
                </Tabs>
                <Button
                    size="small"
                    startIcon={<LogoutIcon sx={{ fontSize: 14 }} />}
                    onClick={handleLogout}
                    sx={{ textTransform: 'none', fontSize: 11, mr: 1, color: 'text.secondary' }}
                >
                    {user?.username ? String(user.username) : t('plugin.superset.logout')}
                </Button>
            </Box>

            <Box sx={{ flex: 1, overflow: 'hidden' }}>
                <Box sx={{ display: tab === 0 ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
                    <SupersetDashboards onDatasetLoaded={handleDatasetLoaded} />
                </Box>
                <Box sx={{ display: tab === 1 ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
                    <SupersetCatalog onDatasetLoaded={handleDatasetLoaded} />
                </Box>
            </Box>
        </Box>
    );
};
