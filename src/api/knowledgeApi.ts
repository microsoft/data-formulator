// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Knowledge API client — CRUD, search, and experience distillation.
 *
 * All endpoints use POST with JSON body.  Requests go through
 * {@link fetchWithIdentity} for identity headers and 401 retry.
 * Errors are surfaced as {@link ApiRequestError} via {@link parseApiResponse}.
 */

import { fetchWithIdentity } from '../app/utils';
import { apiRequest } from '../app/apiClient';

// ── Types ────────────────────────────────────────────────────────────────

export type KnowledgeCategory = 'rules' | 'experiences';

export interface KnowledgeItem {
    title: string;
    tags: string[];
    path: string;
    source: string;
    created: string;
    /** Rules only: short one-line description (max 100 chars). */
    description?: string;
    /** Rules only: if true the rule is always injected into the agent prompt. */
    alwaysApply?: boolean;
    /**
     * Experiences only: workspace id this experience was distilled from.
     * Set by the session-scoped distillation flow (design-docs/24); used
     * by the KnowledgePanel to find the existing session experience.
     */
    sourceWorkspaceId?: string;
    /** Experiences only: workspace display name at distillation time. */
    sourceWorkspaceName?: string;
}

export interface KnowledgeLimits {
    rule_description_max: number;
    rules: number;
    experiences: number;
}

export interface KnowledgeSearchResult {
    category: KnowledgeCategory;
    title: string;
    tags: string[];
    path: string;
    snippet: string;
    source: string;
}

// ── API functions ────────────────────────────────────────────────────────

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

export async function fetchKnowledgeLimits(): Promise<KnowledgeLimits> {
    const { data } = await apiRequest<{ limits: KnowledgeLimits }>('/api/knowledge/limits', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: '{}',
    });
    return data.limits;
}

export async function listKnowledge(
    category: KnowledgeCategory,
): Promise<KnowledgeItem[]> {
    const { data } = await apiRequest<{ items?: KnowledgeItem[] }>('/api/knowledge/list', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ category }),
    });
    return data.items ?? [];
}

export async function readKnowledge(
    category: KnowledgeCategory,
    path: string,
): Promise<string> {
    const { data } = await apiRequest<{ content?: string }>('/api/knowledge/read', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ category, path }),
    });
    return data.content ?? '';
}

export async function writeKnowledge(
    category: KnowledgeCategory,
    path: string,
    content: string,
): Promise<void> {
    await apiRequest('/api/knowledge/write', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ category, path, content }),
    });
}

export async function deleteKnowledge(
    category: KnowledgeCategory,
    path: string,
): Promise<void> {
    await apiRequest('/api/knowledge/delete', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ category, path }),
    });
}

export async function searchKnowledge(
    query: string,
    categories?: KnowledgeCategory[],
): Promise<KnowledgeSearchResult[]> {
    const { data } = await apiRequest<{ results?: KnowledgeSearchResult[] }>('/api/knowledge/search', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ query, categories }),
    });
    return data.results ?? [];
}

export interface DistillExperienceResult {
    path: string;
    category: string;
}

/**
 * Session-scoped distillation payload shape (design-docs/24).
 *
 * `workspace_id` + `workspace_name` enable upsert-by-workspace and produce
 * a deterministic filename + title. `threads` carries one chronological
 * `events` list per leaf table on screen.
 */
export interface SessionExperienceContext {
    context_id?: string;
    workspace_id: string;
    workspace_name: string;
    threads: Array<{
        thread_id: string;
        events: Array<Record<string, any>>;
    }>;
    /** Front-end notes about payload trimming (e.g. dropped tool calls). */
    payload_notes?: string[];
}

export async function distillSessionExperience(
    sessionContext: SessionExperienceContext,
    model: Record<string, any>,
    instruction?: string,
    timeoutSeconds?: number,
    signal?: AbortSignal,
): Promise<DistillExperienceResult> {
    const { data } = await apiRequest<{ path: string; category: string }>('/api/knowledge/distill-experience', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
            experience_context: sessionContext,
            model,
            user_instruction: instruction,
            timeout_seconds: timeoutSeconds,
        }),
        signal,
    });
    return { path: data.path, category: data.category };
}
