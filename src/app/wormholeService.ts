// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Wormhole session sharing (design-docs/71): send a session with a one-time
 * code, or receive one into a new session. Transfers run on the local server
 * in the background; the UI polls their progress.
 */

import { apiRequest } from './apiClient';
import { getUrls } from './utils';

export type WormholeTransferStatus = 'connecting' | 'waiting' | 'transferring' | 'importing' | 'done' | 'failed' | 'cancelled';

export interface WormholeTransfer {
    id: string;
    direction: 'send' | 'receive';
    status: WormholeTransferStatus;
    display_name: string;
    code: string;
    /** The session sent, or the new session a receive created. */
    workspace_id: string;
    total_bytes: number;
    transferred_bytes: number;
    error: string;
    created_at: number;
    finished_at: number | null;
}

export const isActiveTransfer = (transfer: WormholeTransfer) =>
    ['connecting', 'waiting', 'transferring', 'importing'].includes(transfer.status);

const post = async <T>(url: string, body: Record<string, unknown>): Promise<T> =>
    (await apiRequest<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).data;

export async function sendSessionByWormhole(workspaceId: string): Promise<WormholeTransfer> {
    return (await post<{ transfer: WormholeTransfer }>(getUrls().SESSION_WORMHOLE_SEND, { workspace_id: workspaceId })).transfer;
}

export async function receiveSessionByWormhole(code: string): Promise<WormholeTransfer> {
    return (await post<{ transfer: WormholeTransfer }>(getUrls().SESSION_WORMHOLE_RECEIVE, { code })).transfer;
}

export async function listWormholeTransfers(): Promise<WormholeTransfer[]> {
    return (await apiRequest<{ transfers: WormholeTransfer[] }>(getUrls().SESSION_WORMHOLE_TRANSFERS)).data.transfers;
}

export async function cancelWormholeTransfer(id: string): Promise<void> {
    await post(getUrls().SESSION_WORMHOLE_CANCEL, { id });
}

export async function dismissWormholeTransfer(id: string): Promise<void> {
    await post(getUrls().SESSION_WORMHOLE_DISMISS, { id });
}

// ── Requests from anywhere in the app to open the send / receive dialogs ──

export type WormholeDialogRequest =
    | { kind: 'send'; workspaceId: string; displayName: string }
    | { kind: 'receive' };

const WORMHOLE_DIALOG_REQUEST = 'df:wormhole-dialog';

export function requestWormholeDialog(request: WormholeDialogRequest): void {
    window.dispatchEvent(new CustomEvent<WormholeDialogRequest>(WORMHOLE_DIALOG_REQUEST, { detail: request }));
}

export function onWormholeDialogRequest(cb: (request: WormholeDialogRequest) => void): () => void {
    const listener = (event: Event) => cb((event as CustomEvent<WormholeDialogRequest>).detail);
    window.addEventListener(WORMHOLE_DIALOG_REQUEST, listener);
    return () => window.removeEventListener(WORMHOLE_DIALOG_REQUEST, listener);
}
