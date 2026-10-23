// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Field semantic annotations: normalization and merging.
 *
 * Annotations reach DF from two places: the analyst agent's `field_metadata`
 * (intent-aware but free-form) and background semantic inference (validated
 * against the registry, but based on a small sample). Both are normalized to
 * Flint's `SemanticAnnotation` shape; anything Flint cannot use is dropped so
 * that inference can fill the gap. Agent-authored values are kept under
 * `authored` so they survive later inference runs.
 */

import { SemanticTypes } from 'flint-chart';
import type { FieldSemanticsInfo } from '../components/ComponentType';

const lookupKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const REGISTERED = new Map<string, string>(
    (Object.values(SemanticTypes) as string[]).map(type => [lookupKey(type), type]),
);

// Unambiguous names agents and older prompts use for registered types. Vega-Lite
// encoding words (quantitative, nominal, ordinal, temporal) carry no semantics
// and are deliberately absent.
const ALIASES: Record<string, string> = {
    string: 'Category', text: 'Category', categorical: 'Category',
    currency: 'Amount', money: 'Amount', monetary: 'Amount', revenue: 'Amount', cost: 'Amount', sales: 'Amount',
    percent: 'Percentage', pct: 'Percentage',
    rating: 'Score',
    agegroup: 'Range', timerange: 'Range', bin: 'Range', binned: 'Range', bucket: 'Range',
    hourofday: 'Hour', dayofweek: 'Day', weekday: 'Day', monthofyear: 'Month',
    postalcode: 'ZipCode', zip: 'ZipCode',
    identifier: 'ID',
};

/** The registered Flint semantic type for a free-form name, or undefined. */
export function canonicalSemanticType(value: unknown): string | undefined {
    if (typeof value !== 'string' || !value.trim()) return undefined;
    const key = lookupKey(value);
    return REGISTERED.get(key) ?? ALIASES[key];
}

const firstDefined = (source: Record<string, unknown>, keys: string[]) =>
    keys.map(key => source[key]).find(value => value !== undefined && value !== null);

const finiteNumber = (value: unknown): number | undefined => {
    const number = typeof value === 'string' && value.trim() ? Number(value) : value;
    return typeof number === 'number' && Number.isFinite(number) ? number : undefined;
};

const domainOf = (value: unknown): [number, number] | undefined => {
    if (!Array.isArray(value) || value.length !== 2) return undefined;
    const [min, max] = value.map(finiteNumber);
    return min !== undefined && max !== undefined && min < max ? [min, max] : undefined;
};

const orderOf = (value: unknown): (string | number)[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    const levels = [...new Set(value.filter((item): item is string | number =>
        (typeof item === 'string' && item !== '') || (typeof item === 'number' && Number.isFinite(item))))];
    return levels.length >= 2 ? levels : undefined;
};

/**
 * Normalize one field annotation (a bare type name or an object with snake_case
 * or camelCase keys) to DF's stored shape. Returns undefined when nothing usable
 * remains.
 */
export function normalizeFieldAnnotation(raw: unknown): FieldSemanticsInfo | undefined {
    const source: Record<string, unknown> = typeof raw === 'string'
        ? { semantic_type: raw }
        : raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const semanticType = canonicalSemanticType(firstDefined(source, ['semanticType', 'semantic_type']));
    const unitValue = firstDefined(source, ['unit', 'currency']);
    const unit = typeof unitValue === 'string' && unitValue.trim() ? unitValue.trim() : undefined;
    const intrinsicDomain = domainOf(firstDefined(source, ['intrinsicDomain', 'intrinsic_domain', 'domain']));
    const sortOrder = orderOf(firstDefined(source, ['sortOrder', 'sort_order', 'ordinal_order', 'order']));
    const divergingMidpoint = finiteNumber(firstDefined(source, ['divergingMidpoint', 'diverging_midpoint', 'baseline']));
    const displayValue = firstDefined(source, ['displayName', 'display_name']);
    const displayName = typeof displayValue === 'string' && displayValue.trim() ? displayValue.trim() : undefined;
    const info: FieldSemanticsInfo = {
        ...(semanticType ? { semanticType } : {}),
        ...(unit ? { unit } : {}),
        ...(intrinsicDomain ? { intrinsicDomain } : {}),
        ...(sortOrder ? { sortOrder } : {}),
        ...(divergingMidpoint !== undefined ? { divergingMidpoint } : {}),
        ...(displayName ? { displayName } : {}),
    };
    return Object.keys(info).length > 0 ? info : undefined;
}

/**
 * Normalize the agent's `field_metadata` and `field_display_names` for the
 * columns a table actually has.
 */
export function authoredFieldSemantics(
    columns: string[],
    fieldMetadata: unknown,
    fieldDisplayNames: unknown,
): Record<string, FieldSemanticsInfo> {
    const metadata = fieldMetadata && typeof fieldMetadata === 'object' ? fieldMetadata as Record<string, unknown> : {};
    const names = fieldDisplayNames && typeof fieldDisplayNames === 'object' ? fieldDisplayNames as Record<string, unknown> : {};
    const fields: Record<string, FieldSemanticsInfo> = {};
    for (const column of columns) {
        const raw = metadata[column];
        const base = typeof raw === 'string' ? { semantic_type: raw }
            : raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
        const displayName = names[column];
        const info = normalizeFieldAnnotation(typeof displayName === 'string' ? { ...base, display_name: displayName } : base);
        if (info) fields[column] = info;
    }
    return fields;
}

/** Layer newly authored annotations over a table's stored semantics. */
export function applyAuthoredSemantics(
    existing: Record<string, FieldSemanticsInfo>,
    authored: Record<string, FieldSemanticsInfo>,
): Record<string, FieldSemanticsInfo> {
    const fields = { ...existing };
    for (const [name, info] of Object.entries(authored)) {
        const merged = { ...existing[name]?.authored, ...info };
        fields[name] = { ...existing[name], ...merged, authored: merged };
    }
    return fields;
}

/**
 * Combine a fresh inference result with the authored annotations already stored:
 * authored values win, inference fills the rest, and columns no longer in the
 * table are dropped.
 */
export function mergeInferredSemantics(
    columns: string[],
    inferred: Record<string, FieldSemanticsInfo>,
    existing: Record<string, FieldSemanticsInfo>,
): Record<string, FieldSemanticsInfo> {
    const fields: Record<string, FieldSemanticsInfo> = {};
    for (const column of columns) {
        const previous = existing[column];
        const authored = previous?.authored;
        // Sessions saved before `authored` existed kept agent display names at the top level.
        const displayName = authored?.displayName ?? previous?.displayName;
        const merged: FieldSemanticsInfo = {
            ...inferred[column],
            ...authored,
            ...(displayName ? { displayName } : {}),
            ...(authored ? { authored } : {}),
        };
        if (Object.keys(merged).length > 0) fields[column] = merged;
    }
    return fields;
}
