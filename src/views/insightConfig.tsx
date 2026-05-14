// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InsightKind } from '../components/ComponentType';

/** Display label per insight kind. The sidebar renders this as a small
 *  uppercase eyebrow above the title. Kept in a map so future kinds can
 *  be labelled in one place. */
export const KIND_CONFIG: Record<InsightKind, { label: string }> = {
    anomaly:      { label: 'Anomaly' },
    comparison:   { label: 'Comparison' },
    trend:        { label: 'Trend' },
    relationship: { label: 'Relationship' },
    observation:  { label: 'Observation' },
};

/** Derive a short title for an insight when the agent did not provide one.
 *  Uses the first ~5 words of the description text as a fallback. */
export function deriveInsightTitle(insight: { title?: string; text: string }): string {
    if (insight.title && insight.title.trim()) return insight.title.trim();
    const words = insight.text.split(/\s+/).filter(Boolean).slice(0, 5).join(' ');
    return words.replace(/[.,;:!?]+$/, '');
}
