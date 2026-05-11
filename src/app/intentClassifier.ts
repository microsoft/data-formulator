// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Intent classifier — routes a user's chart-prompt to the right agent on Enter.
 *
 * Two outcomes:
 *   - 'style' → `agent_chart_restyle` (cheap, fast, single LLM call, has an
 *      explicit out-of-scope guardrail so misroutes self-correct)
 *   - 'data'  → `useFormulateData` (the full multi-step data agent)
 *
 * Implemented as a tiny LLM call (one request, ~1 token output) rather than a
 * keyword heuristic because:
 *   1. The encoding-shelf input accepts any language; keyword lists are
 *      English-only and silently misroute non-English style prompts to the
 *      slower data agent.
 *   2. Adding a heuristic shortcut here would mean maintaining keyword lists
 *      per language and never quite trusting the result. The LLM round-trip
 *      adds ~150-300ms, which is small relative to either downstream agent.
 *
 * Bias: when in doubt the classifier returns 'data' (and the SimpleAgents
 * Python prompt instructs the same). The data agent can handle anything;
 * the restyle agent cannot do data work. The restyle agent's `out_of_scope`
 * response also acts as a safety net for the rare false-positive 'style'
 * verdict — see the Enter handler in EncodingShelfCard.tsx.
 */

import { apiRequest } from './apiClient';
import { getUrls } from './utils';

export type ChartPromptIntent = 'style' | 'data';

/**
 * Classify a chart prompt via the backend LLM classifier.
 *
 * Always returns either 'style' or 'data'. On any error (transport,
 * malformed response, etc.) defaults to 'data' — the safe choice.
 */
export const classifyChartIntent = async (
    prompt: string,
    model: any,
): Promise<ChartPromptIntent> => {
    const text = prompt.trim();
    if (!text) return 'data';

    try {
        const { data } = await apiRequest(getUrls().CLASSIFY_CHART_INTENT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instruction: text, model }),
        });
        const intent = (data?.intent ?? '').toString().toLowerCase();
        return intent === 'style' ? 'style' : 'data';
    } catch (err) {
        // Transport / model errors fall back to the safer agent.
        console.warn('[intentClassifier] failed; defaulting to data', err);
        return 'data';
    }
};
