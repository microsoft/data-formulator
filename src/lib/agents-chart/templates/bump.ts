// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChartTemplateDef } from '../types';
import { defaultBuildEncodings } from './utils';

/**
 * Bump Chart — shows ranking changes across an ordered dimension (typically time).
 *
 * The orientation is flexible:
 *   - Vertical (default): X = ordered dimension, Y = rank
 *   - Horizontal: Y = ordered dimension, X = rank
 *
 * Post-processor logic:
 *   1. Decide which axis is the rank axis using semantic types.
 *      - If one field has a Rank-family semantic type (Rank, Index, Score,
 *        Rating, Level), that axis is the rank axis.
 *      - Otherwise, the discrete (nominal/ordinal) axis is the ordered
 *        dimension; the quantitative one is rank.
 *      - If both are the same VL type, default to Y = rank.
 *   2. If Y is rank → reverse Y scale so rank 1 is at top. Done.
 *   3. If X is rank → set `order` encoding to the ordered-dim field
 *      so VL connects lines along Y instead of X.
 */

/** Semantic types that indicate a rank-like field */
const RANK_SEMANTIC_TYPES = new Set(['Rank', 'Index', 'Score', 'Rating', 'Level']);

const isDiscrete = (type: string | undefined) =>
    type === 'nominal' || type === 'ordinal';

export const bumpChartDef: ChartTemplateDef = {
    chart: "Bump Chart",
    template: {
        mark: { type: "line", point: true, interpolate: "monotone", strokeWidth: 2 },
        encoding: {},
    },
    channels: ["x", "y", "color", "detail", "column", "row"],
    buildEncodings: defaultBuildEncodings,
    postProcessor: (vgSpec: any, _table: any[], _config?: Record<string, any>, _canvasSize?: { width: number; height: number }, semanticTypes?: Record<string, string>) => {
        const xEnc = vgSpec.encoding?.x;
        const yEnc = vgSpec.encoding?.y;
        if (!xEnc || !yEnc) return vgSpec;

        // --- Step 1: decide which axis is rank ---
        let rankAxis: 'x' | 'y';

        const xSemType = (xEnc.field && semanticTypes?.[xEnc.field]) || '';
        const ySemType = (yEnc.field && semanticTypes?.[yEnc.field]) || '';
        const xIsRank = RANK_SEMANTIC_TYPES.has(xSemType);
        const yIsRank = RANK_SEMANTIC_TYPES.has(ySemType);

        if (yIsRank && !xIsRank) {
            rankAxis = 'y';
        } else if (xIsRank && !yIsRank) {
            rankAxis = 'x';
        } else if (isDiscrete(xEnc.type) && !isDiscrete(yEnc.type)) {
            // X is the ordered dimension → Y is rank
            rankAxis = 'y';
        } else if (isDiscrete(yEnc.type) && !isDiscrete(xEnc.type)) {
            // Y is the ordered dimension → X is rank
            rankAxis = 'x';
        } else {
            // Fallback: default to Y as rank (vertical bump chart)
            rankAxis = 'y';
        }

        // --- Step 2: Y is rank → reverse Y so rank 1 is at top ---
        if (rankAxis === 'y') {
            yEnc.scale = { ...yEnc.scale, reverse: true };
        }

        // --- Step 3: X is rank → fix line connection order ---
        if (rankAxis === 'x' && yEnc.field) {
            // VL's line mark connects points by X order by default.
            // We need lines to connect along Y (the ordered dimension).
            vgSpec.encoding.order = {
                field: yEnc.field,
                type: yEnc.type || "quantitative",
            };
        }

        return vgSpec;
    },
};
