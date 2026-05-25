// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Gallery test cases for BI-style chart prototypes (Vega-Lite only).
 *
 * KPI Card contract
 * ─────────────────
 * One row per tile. Channels:
 *   - `metric` (required) → caption
 *   - `value`  (required) → big number (numeric or pre-formatted string)
 *   - `goal`   (optional) → comparison value (numeric or string)
 *
 * Formatting is delegated to upstream data transformation. The template
 * applies only a trivial `toLocaleString` default to numeric values.
 * For currency / SI / percent formatting, format the column upstream
 * and pass strings.
 *
 * Progress bar appears when both `value` and `goal` are finite numbers.
 * Otherwise the goal renders as a small "Goal: <goal>" line.
 */

import { Type } from '../../../data/types';
import { TestCase, makeField, makeEncodingItem } from '../test-data/types';

export function genGalleryKpiCardTests(): TestCase[] {
    return [
        // ── Single tile, numeric ──────────────────────────────────────────
        {
            title: 'KPI: Single tile (Numeric)',
            description:
                'One row, only `value` bound. Caption defaults to the value field name. ' +
                'Numeric value rendered via `toLocaleString`.',
            tags: ['gallery', 'bi', 'kpi'],
            chartType: 'KPI Card',
            data: [{ Revenue: 1_184_320 }],
            fields: [makeField('Revenue')],
            metadata: {
                Revenue: { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: { value: makeEncodingItem('Revenue') },
            chartProperties: { layout: 'horizontal' },
        },

        // ── Single tile, pre-formatted string ─────────────────────────────
        {
            title: 'KPI: Single tile (pre-formatted string)',
            description:
                'Agent formatted upstream. Template renders verbatim.',
            tags: ['gallery', 'bi', 'kpi', 'preformatted'],
            chartType: 'KPI Card',
            data: [{ Metric: 'Revenue', Display: '$1.18M' }],
            fields: [makeField('Metric'), makeField('Display')],
            metadata: {
                Metric:  { type: Type.String, semanticType: 'Category', levels: [] },
                Display: { type: Type.String, semanticType: 'Category', levels: [] },
            },
            encodingMap: {
                metric: makeEncodingItem('Metric'),
                value:  makeEncodingItem('Display'),
            },
            chartProperties: { layout: 'horizontal' },
        },

        // ── Multi-tile, numeric ───────────────────────────────────────────
        {
            title: 'KPI: Multi-tile (Numeric quantities)',
            description:
                'Four tiles, plain numeric values with default `toLocaleString`.',
            tags: ['gallery', 'bi', 'kpi', 'multi-metric'],
            chartType: 'KPI Card',
            data: [
                { Metric: 'Active Users',  Value: 12_402 },
                { Metric: 'New Signups',   Value:  1_182 },
                { Metric: 'Churn',         Value:    214 },
                { Metric: 'Power Users',   Value:    876 },
            ],
            fields: [makeField('Metric'), makeField('Value')],
            metadata: {
                Metric: { type: Type.String, semanticType: 'Category', levels: [] },
                Value:  { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: {
                metric: makeEncodingItem('Metric'),
                value:  makeEncodingItem('Value'),
            },
            chartProperties: { layout: 'horizontal' },
        },

        // ── Multi-tile, pre-formatted heterogeneous ───────────────────────
        {
            title: 'KPI: Multi-tile (heterogeneous, pre-formatted)',
            description:
                'Per-tile units handled by the agent formatting each `Value` ' +
                'upstream. Template renders verbatim.',
            tags: ['gallery', 'bi', 'kpi', 'multi-metric', 'preformatted'],
            chartType: 'KPI Card',
            data: [
                { Metric: 'Revenue',  Value: '$1.23M'  },
                { Metric: 'Orders',   Value: '5,682'   },
                { Metric: 'Avg Cart', Value: '$217.45' },
                { Metric: 'Refunds',  Value: '312'     },
            ],
            fields: [makeField('Metric'), makeField('Value')],
            metadata: {
                Metric: { type: Type.String, semanticType: 'Category', levels: [] },
                Value:  { type: Type.String, semanticType: 'Category', levels: [] },
            },
            encodingMap: {
                metric: makeEncodingItem('Metric'),
                value:  makeEncodingItem('Value'),
            },
            chartProperties: { layout: 'horizontal' },
        },

        // ── Multi-tile with numeric goal (progress bar) ───────────────────
        {
            title: 'KPI: With goal (progress bar)',
            description:
                'Both value and goal are numeric → small "X% of goal" line + ' +
                'progress bar beneath the big number.',
            tags: ['gallery', 'bi', 'kpi', 'goal', 'progress'],
            chartType: 'KPI Card',
            data: [
                { Metric: 'Q1 Revenue', Value: 1_184_320, Goal: 1_500_000 },
                { Metric: 'Signups',    Value:     1_182, Goal:     2_000 },
                { Metric: 'NPS',        Value:        47, Goal:        60 },
                { Metric: 'Stretch',    Value:       128, Goal:       100 }, // overshoot
            ],
            fields: [makeField('Metric'), makeField('Value'), makeField('Goal')],
            metadata: {
                Metric: { type: Type.String, semanticType: 'Category', levels: [] },
                Value:  { type: Type.Number, semanticType: 'Quantity', levels: [] },
                Goal:   { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: {
                metric: makeEncodingItem('Metric'),
                value:  makeEncodingItem('Value'),
                goal:   makeEncodingItem('Goal'),
            },
            chartProperties: { layout: 'horizontal' },
        },

        // ── Multi-tile with string goal (no progress bar) ─────────────────
        {
            title: 'KPI: With goal (string, no progress bar)',
            description:
                'String value or string goal → progress bar suppressed; ' +
                'goal renders as a "Goal: …" line.',
            tags: ['gallery', 'bi', 'kpi', 'goal'],
            chartType: 'KPI Card',
            data: [
                { Metric: 'Revenue',  Value: '$1.18M', Goal: '$1.50M' },
                { Metric: 'Headcount',Value: '142',    Goal: '160'    },
            ],
            fields: [makeField('Metric'), makeField('Value'), makeField('Goal')],
            metadata: {
                Metric: { type: Type.String, semanticType: 'Category', levels: [] },
                Value:  { type: Type.String, semanticType: 'Category', levels: [] },
                Goal:   { type: Type.String, semanticType: 'Category', levels: [] },
            },
            encodingMap: {
                metric: makeEncodingItem('Metric'),
                value:  makeEncodingItem('Value'),
                goal:   makeEncodingItem('Goal'),
            },
            chartProperties: { layout: 'horizontal' },
        },

        // ── Vertical layout ───────────────────────────────────────────────
        {
            title: 'KPI: Vertical layout',
            description: 'Same data as multi-tile numeric, stacked vertically.',
            tags: ['gallery', 'bi', 'kpi', 'multi-metric', 'vertical'],
            chartType: 'KPI Card',
            data: [
                { Metric: 'Active Users',  Value: 12_402 },
                { Metric: 'New Signups',   Value:  1_182 },
                { Metric: 'Churn',         Value:    214 },
                { Metric: 'Power Users',   Value:    876 },
            ],
            fields: [makeField('Metric'), makeField('Value')],
            metadata: {
                Metric: { type: Type.String, semanticType: 'Category', levels: [] },
                Value:  { type: Type.Number, semanticType: 'Quantity', levels: [] },
            },
            encodingMap: {
                metric: makeEncodingItem('Metric'),
                value:  makeEncodingItem('Value'),
            },
            chartProperties: { layout: 'vertical' },
        },
    ];
}
