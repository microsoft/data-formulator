// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * PluginHost — renders a plugin's Panel component inside the upload dialog.
 *
 * Wraps the plugin with error boundaries and provides the standard
 * {@link PluginHostCallbacks} interface.
 */

import React, { Component, FC, useCallback } from 'react';
import { Box, Typography, Alert } from '@mui/material';
import { useTranslation } from 'react-i18next';

import type { DataSourcePluginModule, PluginConfig, PluginHostCallbacks, DataLoadedInfo } from './types';

interface PluginHostProps {
    module: DataSourcePluginModule;
    config: PluginConfig;
    onDataLoaded: (info: DataLoadedInfo) => void;
    onClose: () => void;
}

interface ErrorBoundaryState {
    error: Error | null;
}

class PluginErrorBoundary extends Component<
    { pluginId: string; children: React.ReactNode },
    ErrorBoundaryState
> {
    state: ErrorBoundaryState = { error: null };

    static getDerivedStateFromError(error: Error) {
        return { error };
    }

    render() {
        if (this.state.error) {
            return (
                <Box sx={{ p: 3 }}>
                    <Alert severity="error">
                        Plugin "{this.props.pluginId}" crashed: {this.state.error.message}
                    </Alert>
                </Box>
            );
        }
        return this.props.children;
    }
}

export const PluginHost: FC<PluginHostProps> = ({
    module,
    config,
    onDataLoaded,
    onClose,
}) => {
    const callbacks: PluginHostCallbacks = {
        onDataLoaded,
        onClose,
    };

    const { Panel } = module;

    return (
        <PluginErrorBoundary pluginId={module.id}>
            <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <Panel config={config} callbacks={callbacks} />
            </Box>
        </PluginErrorBoundary>
    );
};
