// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * API wrapper for the Superset plugin backend routes.
 *
 * All calls go through `fetchWithIdentity` so that identity headers
 * and OIDC tokens are automatically attached.
 */

import { fetchWithIdentity } from '../../app/utils';

const BASE = '/api/plugins/superset';

// -- Auth ---------------------------------------------------------------

export async function supersetLogin(username: string, password: string, remember = false) {
    const resp = await fetchWithIdentity(`${BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, remember }),
    });
    return resp.json();
}

export async function supersetSsoSaveTokens(
    accessToken: string,
    refreshToken?: string,
    user?: Record<string, unknown>,
) {
    const resp = await fetchWithIdentity(`${BASE}/auth/sso/save-tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: accessToken, refresh_token: refreshToken, user }),
    });
    return resp.json();
}

export async function supersetAuthStatus() {
    const resp = await fetchWithIdentity(`${BASE}/auth/status`);
    return resp.json();
}

export async function supersetMe() {
    const resp = await fetchWithIdentity(`${BASE}/auth/me`);
    return resp.json();
}

export async function supersetLogout() {
    const resp = await fetchWithIdentity(`${BASE}/auth/logout`, { method: 'POST' });
    return resp.json();
}

export async function supersetGuestLogin() {
    const resp = await fetchWithIdentity(`${BASE}/auth/guest`, { method: 'POST' });
    return resp.json();
}

// -- Catalog ------------------------------------------------------------

export interface SupersetDataset {
    id: number;
    name: string;
    schema: string;
    database: string;
    description: string;
    column_count: number;
    column_names: string[];
    row_count: number | null;
}

export interface SupersetDashboard {
    id: number;
    title: string;
    slug: string;
    status: string;
    url: string;
    changed_on_delta_humanized: string;
    owners: string[];
}

export interface DashboardFilter {
    id: string;
    name: string;
    filter_type: string;
    input_type: string;
    dataset_id: number;
    dataset_name: string;
    column_name: string;
    column_type: string;
    multi: boolean;
    required: boolean;
    supports_search: boolean;
    default_value?: unknown;
}

export interface FilterOption {
    label: string;
    value: unknown;
}

export async function fetchDatasets(): Promise<SupersetDataset[]> {
    const resp = await fetchWithIdentity(`${BASE}/catalog/datasets`);
    const data = await resp.json();
    if (data.status !== 'ok') throw new Error(data.message || 'Failed to fetch datasets');
    return data.datasets;
}

export async function fetchDashboards(): Promise<SupersetDashboard[]> {
    const resp = await fetchWithIdentity(`${BASE}/catalog/dashboards`);
    const data = await resp.json();
    if (data.status !== 'ok') throw new Error(data.message || 'Failed to fetch dashboards');
    return data.dashboards;
}

export async function fetchDashboardDatasets(dashboardId: number): Promise<SupersetDataset[]> {
    const resp = await fetchWithIdentity(`${BASE}/catalog/dashboards/${dashboardId}/datasets`);
    const data = await resp.json();
    if (data.status !== 'ok') throw new Error(data.message || 'Failed to fetch dashboard datasets');
    return data.datasets;
}

export async function fetchDashboardFilters(
    dashboardId: number,
    datasetId?: number,
): Promise<DashboardFilter[]> {
    const params = new URLSearchParams();
    if (datasetId != null) params.set('dataset_id', String(datasetId));
    const resp = await fetchWithIdentity(`${BASE}/catalog/dashboards/${dashboardId}/filters?${params}`);
    const data = await resp.json();
    if (data.status !== 'ok') throw new Error(data.message || 'Failed to fetch filters');
    return data.filters;
}

export async function fetchFilterOptions(
    datasetId: number,
    columnName: string,
    keyword?: string,
    limit = 50,
    offset = 0,
): Promise<{ options: FilterOption[]; has_more: boolean }> {
    const params = new URLSearchParams({
        dataset_id: String(datasetId),
        column_name: columnName,
        limit: String(limit),
        offset: String(offset),
    });
    if (keyword) params.set('keyword', keyword);
    const resp = await fetchWithIdentity(`${BASE}/catalog/filters/options?${params}`);
    const data = await resp.json();
    if (data.status !== 'ok') throw new Error(data.message || 'Failed to fetch filter options');
    return { options: data.options, has_more: data.has_more };
}

// -- Data ---------------------------------------------------------------

export interface LoadDatasetRequest {
    dataset_id: number;
    row_limit?: number;
    table_name?: string;
    filters?: Array<{ column: string; operator: string; value: unknown }>;
    stream?: boolean;
}

export interface LoadDatasetResult {
    status: string;
    table_name: string;
    row_count: number;
    columns: string[];
    message?: string;
}

export async function loadDataset(req: LoadDatasetRequest): Promise<LoadDatasetResult> {
    const resp = await fetchWithIdentity(`${BASE}/data/load-dataset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
    });
    const data = await resp.json();
    if (data.status !== 'ok') throw new Error(data.message || 'Failed to load dataset');
    return data;
}
