// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Settings the agent's tools share: one approval mode (off / ask / auto) for the terminal and the user's
 * MCP servers, plus the terminal's own switch and sandbox paths. Stored server-side as the terminal policy.
 */

import { apiRequest } from './apiClient';
import type { TerminalFilesystemPolicy } from '../components/ComponentType';
import type { ServerConfig } from './dfSlice';

export type ToolsMode = 'off' | 'ask' | 'auto';

export interface ToolsPolicy {
    mode: ToolsMode;
    /** The terminal's own switch. */
    enabled: boolean;
    /** Whether the terminal can run here (local mode, supported OS, connectors allowed). */
    available: boolean;
    /** The mode is set by DF_TERMINAL_MODE. */
    locked: boolean;
    revision: number;
    sandboxFilesystem?: TerminalFilesystemPolicy | null;
    sandboxed?: boolean | null;
    sandboxInstallHint?: string | null;
}

export type ToolsChange = { mode?: ToolsMode; enabled?: boolean; sandbox?: { filesystem: { allowWrite: string[] } } | null };

const POLICY_URL = '/api/configurations/terminal';

export const loadToolsPolicy = async (): Promise<ToolsPolicy> => (await apiRequest<ToolsPolicy>(POLICY_URL)).data;

/** Save a change against the current revision (read just before, so independent switches do not conflict). */
export const saveToolsPolicy = async (change: ToolsChange): Promise<ToolsPolicy> => {
    const { revision } = await loadToolsPolicy();
    return (await apiRequest<ToolsPolicy>(POLICY_URL, { method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-DF-Configuration': '1' },
        body: JSON.stringify({ ...change, revision }) })).data;
};

/** The app-config fields a policy determines. */
export const toolsConfig = (policy: ToolsPolicy): Partial<ServerConfig> => ({
    TOOLS_MODE: policy.mode,
    TERMINAL_ENABLED: policy.enabled,
    TERMINAL_MODE: policy.available && policy.enabled ? policy.mode : 'off',
    TERMINAL_AVAILABLE: policy.available,
    TERMINAL_CONFIG_LOCKED: policy.locked,
});

type ToolsDialogListener = (turnId?: string) => void;
const toolsDialogListeners = new Set<ToolsDialogListener>();

/** Open the Tools dialog, optionally with an agent's MCP proposal (the text turn holding the form) to review. */
export const requestToolsDialog = (turnId?: string) => toolsDialogListeners.forEach(listener => listener(turnId));

/** Subscribe the Tools dialog to open requests; returns the unsubscribe function. */
export const onToolsDialogRequest = (listener: ToolsDialogListener) => {
    toolsDialogListeners.add(listener);
    return () => { toolsDialogListeners.delete(listener); };
};
