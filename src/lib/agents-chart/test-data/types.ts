// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Types and helper utilities for chart gallery test cases.
 * No React/UI dependencies — pure TypeScript.
 */

import { Type } from '../../../data/types';
import { Channel, EncodingItem, FieldItem } from '../../../components/ComponentType';
import { AssembleOptions } from '../core/types';

// ============================================================================
// Test Case Definition
// ============================================================================

export interface TestCase {
    title: string;
    description: string;
    tags: string[];  // e.g., ['temporal', 'large-cardinality', 'color']
    chartType: string;
    data: Record<string, any>[];
    fields: FieldItem[];
    metadata: Record<string, { type: Type; semanticType: string; levels: any[] }>;
    encodingMap: Partial<Record<Channel, EncodingItem>>;
    chartProperties?: Record<string, any>;
    assembleOptions?: AssembleOptions;
}

/** Date format definition for date stress tests */
export interface DateFormat {
    label: string;
    description: string;
    values: any[];
    fieldName: string;
    expectedType: Type;
    semanticType: string;
}

/** Gallery section definition */
export interface GallerySection {
    label: string;
    description: string;
    entries: string[];   // keys into TEST_GENERATORS
}

// ============================================================================
// Helper Functions
// ============================================================================

export function makeField(name: string, tableRef = 'test'): FieldItem {
    return { id: name, name, source: 'original', tableRef };
}

export function makeEncodingItem(fieldID: string, opts?: Partial<EncodingItem>): EncodingItem {
    return { fieldID, ...opts };
}

export function inferType(values: any[]): Type {
    if (values.length === 0) return Type.String;
    const sample = values.find(v => v != null);
    if (typeof sample === 'number') return Type.Number;
    if (typeof sample === 'boolean') return Type.String;
    if (sample instanceof Date) return Type.Date;
    // Check if string looks like a date
    if (typeof sample === 'string' && !isNaN(Date.parse(sample)) && sample.length > 4) return Type.Date;
    return Type.String;
}

export function buildMetadata(data: Record<string, any>[]): Record<string, { type: Type; semanticType: string; levels: any[] }> {
    if (data.length === 0) return {};
    const meta: Record<string, { type: Type; semanticType: string; levels: any[] }> = {};
    for (const key of Object.keys(data[0])) {
        const values = data.map(r => r[key]).filter(v => v != null);
        const type = inferType(values);
        const levels = [...new Set(values)];
        // Assign semantic types heuristically
        let semanticType = '';
        if (type === Type.Date) semanticType = 'Date';
        else if (type === Type.Number) semanticType = 'Quantity';
        else semanticType = 'Category';
        meta[key] = { type, semanticType, levels };
    }
    return meta;
}
