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
import { parseApiResponse } from '../app/apiClient';

// ── Types ────────────────────────────────────────────────────────────────

export type KnowledgeCategory = 'rules' | 'skills' | 'experiences';

export interface KnowledgeItem {
    title: string;
    tags: string[];
    path: string;
    source: string;
    created: string;
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

export async function listKnowledge(
    category: KnowledgeCategory,
): Promise<KnowledgeItem[]> {
    const resp = await fetchWithIdentity('/api/knowledge/list', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ category }),
    });
    const body = await resp.json();
    if (body.status === 'error') {
        parseApiResponse(body, resp.status);
    }
    return body.items ?? [];
}

export async function readKnowledge(
    category: KnowledgeCategory,
    path: string,
): Promise<string> {
    const resp = await fetchWithIdentity('/api/knowledge/read', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ category, path }),
    });
    const body = await resp.json();
    if (body.status === 'error') {
        parseApiResponse(body, resp.status);
    }
    return body.content ?? '';
}

export async function writeKnowledge(
    category: KnowledgeCategory,
    path: string,
    content: string,
): Promise<void> {
    const resp = await fetchWithIdentity('/api/knowledge/write', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ category, path, content }),
    });
    const body = await resp.json();
    parseApiResponse(body, resp.status);
}

export async function deleteKnowledge(
    category: KnowledgeCategory,
    path: string,
): Promise<void> {
    const resp = await fetchWithIdentity('/api/knowledge/delete', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ category, path }),
    });
    const body = await resp.json();
    parseApiResponse(body, resp.status);
}

export async function searchKnowledge(
    query: string,
    categories?: KnowledgeCategory[],
): Promise<KnowledgeSearchResult[]> {
    const resp = await fetchWithIdentity('/api/knowledge/search', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ query, categories }),
    });
    const body = await resp.json();
    if (body.status === 'error') {
        parseApiResponse(body, resp.status);
    }
    return body.results ?? [];
}

export interface DistillExperienceResult {
    path: string;
    category: string;
}

export async function distillExperience(
    sessionId: string,
    userQuestion: string,
    model: Record<string, any>,
    categoryHint?: string,
): Promise<DistillExperienceResult> {
    const resp = await fetchWithIdentity('/api/knowledge/distill-experience', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
            session_id: sessionId,
            user_question: userQuestion,
            model,
            category_hint: categoryHint,
        }),
    });
    const body = await resp.json();
    if (body.status === 'error') {
        parseApiResponse(body, resp.status);
    }
    return { path: body.path, category: body.category };
}
