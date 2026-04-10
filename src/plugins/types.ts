// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Frontend type system for the data source plugin framework.
 *
 * Each plugin module exports a {@link DataSourcePluginModule} which the
 * {@link PluginHost} component uses to render the plugin's UI inside the
 * data upload dialog.
 */

import type { FC } from 'react';

/** Backend plugin config received via `/api/app-config` → `PLUGINS.<id>` */
export interface PluginConfig {
    id: string;
    name: string;
    icon?: string;
    description?: string;
    capabilities?: string[];
    auth_modes?: string[];
    /** Plugin-specific fields from `get_frontend_config()` */
    [key: string]: unknown;
}

/** Callbacks that the plugin host provides to each plugin panel. */
export interface PluginHostCallbacks {
    /** Called after a dataset has been loaded into the workspace. */
    onDataLoaded: (info: DataLoadedInfo) => void;
    /** Close the upload dialog. */
    onClose: () => void;
}

export interface DataLoadedInfo {
    tableName: string;
    rowCount: number;
    columns?: string[];
    source: string;
}

/**
 * A frontend plugin module — the unit that `import.meta.glob` discovers.
 *
 * Each plugin's `index.ts` must default-export an object matching this shape.
 */
export interface DataSourcePluginModule {
    /** Must match `manifest.id` from the backend. */
    id: string;
    /** MUI icon component for the data source menu card. */
    Icon: FC<{ sx?: object }>;
    /** Main panel component rendered in the upload dialog. */
    Panel: FC<PluginPanelProps>;
    /** Plugin-local translations, keyed by language code (e.g. `{ en: {...}, zh: {...} }`). */
    locales?: Record<string, Record<string, unknown>>;
}

export interface PluginPanelProps {
    config: PluginConfig;
    callbacks: PluginHostCallbacks;
}
