// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChartTemplateDef } from '../types';
import { defaultBuildEncodings } from './utils';

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
    buildEncodings: (spec, encodings, context) => {
        defaultBuildEncodings(spec, encodings, context);

        const xEnc = spec.encoding?.x;
        const yEnc = spec.encoding?.y;
        if (!xEnc || !yEnc) return;

        const semanticTypes = context.semanticTypes;

        // --- Decide which axis is rank ---
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
            rankAxis = 'y';
        } else if (isDiscrete(yEnc.type) && !isDiscrete(xEnc.type)) {
            rankAxis = 'x';
        } else {
            rankAxis = 'y';
        }

        // Y is rank → reverse Y so rank 1 is at top
        if (rankAxis === 'y') {
            yEnc.scale = { ...yEnc.scale, reverse: true };
        }

        // X is rank → fix line connection order
        if (rankAxis === 'x' && yEnc.field) {
            spec.encoding.order = {
                field: yEnc.field,
                type: yEnc.type || "quantitative",
            };
        }
    },
};
