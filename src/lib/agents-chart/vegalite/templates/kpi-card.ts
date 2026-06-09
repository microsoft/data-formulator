// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChartTemplateDef, ChartPropertyDef } from '../../core/types';

/**
 * KPI Card — "big number" dashboard tile, one row per tile.
 *
 * Data shape
 * ──────────
 * The input table is interpreted as a list of tiles. Each row produces
 * one tile.
 *
 *   { metric: string,             // tile caption (required, via `metric` channel)
 *     value:  number | string,    // big number (required, via `value` channel,
 *                                  //   pre-aggregated upstream)
 *     goal?:  number | string,    // optional comparison value (via `goal` channel)
 *   }
 *
 * Channels
 * ────────
 *   - `metric` (required): caption field.
 *   - `value`  (required): big-number field.
 *   - `goal`   (optional): comparison/target field.
 *
 * Formatting
 * ──────────
 * Formatting is delegated upstream. The template applies only a trivial
 * default (`toLocaleString`) to numeric values so a raw shelf binding
 * doesn't show `1184320.0`. If you want `"$1.18M"`, write that string
 * into the `value` column in the data prep step.
 *
 * Progress bar
 * ────────────
 * If both `value` and `goal` are numeric and finite, a thin progress
 * bar appears beneath the big number showing `value / goal` (clamped
 * to [0, 1.5] so overshoot is visible). Otherwise `goal` is shown as a
 * small "Goal: <goal>" line.
 */

type Layout = 'horizontal' | 'vertical' | 'grid';

const PROGRESS_TRACK = '#e6e9ef';
const PROGRESS_ON_TRACK = '#5b8def'; // < 100% of goal (in progress)
const PROGRESS_EXCEEDED = '#22a06b'; // ≥ 100% of goal (success)
const PROGRESS_BEHIND   = '#e07a3c'; // < 50% of goal (well short)

// Card frame — drawn behind every tile so each KPI reads as a discrete
// card rather than free-floating text. Sized to content (see cardTop /
// cardBot below) so a tall panel never produces a tall empty card.
const CARD_FILL   = '#ffffff';
const CARD_STROKE = '#e6e9ef';
const CARD_RADIUS = 8;

export const kpiCardDef: ChartTemplateDef = {
    chart: "KPI Card",
    template: { layer: [] },
    channels: ["metric", "value", "goal"],
    markCognitiveChannel: 'position',
    instantiate: (spec, ctx) => {
        const { metric, value, goal } = ctx.resolvedEncodings;
        const config = ctx.chartProperties || {};

        const metricField: string | undefined = metric?.field;
        const valueField:  string | undefined = value?.field;
        const goalField:   string | undefined = goal?.field;

        // Behind/on-track cutoff (see properties below).
        const rawBehind = Number(config.behindThreshold);
        const behindThreshold = Number.isFinite(rawBehind)
            ? Math.min(1, Math.max(0, rawBehind))
            : 0.5;

        const sourceTable = ctx.fullTable ?? ctx.table ?? [];

        // ── Collect tiles ──────────────────────────────────────────────────
        type Tile = {
            caption: string;
            valueText: string;
            goalText?: string;
            // Progress is shown only when both value & goal are numeric.
            progress?: { fraction: number; valueNum: number; goalNum: number };
        };

        const tiles: Tile[] = [];
        if (valueField) {
            for (const row of sourceTable) {
                if (!row) continue;
                const rawValue = row[valueField];
                if (rawValue == null) continue;

                const caption = metricField
                    ? (row[metricField] != null ? String(row[metricField]) : '')
                    : valueField;

                const rawGoal = goalField ? row[goalField] : undefined;

                const valueText = renderScalar(rawValue);
                const goalText  = rawGoal != null ? renderScalar(rawGoal) : undefined;

                let progress: Tile['progress'];
                if (
                    typeof rawValue === 'number' && Number.isFinite(rawValue) &&
                    typeof rawGoal  === 'number' && Number.isFinite(rawGoal)  &&
                    rawGoal !== 0
                ) {
                    progress = {
                        fraction: rawValue / rawGoal,
                        valueNum: rawValue,
                        goalNum:  rawGoal,
                    };
                }

                tiles.push({ caption, valueText, goalText, progress });
            }
        }

        if (tiles.length === 0) {
            tiles.push({ caption: 'Value', valueText: '—' });
        }

        // ── Layout ─────────────────────────────────────────────────────────
        const baseW = ctx.canvasSize.width;
        // baseH unused: tile height is derived from tile width via the
        // target aspect ratio (see TARGET_ASPECT below) rather than from
        // the canvas height.
        const n = tiles.length;

        const requestedLayout = (config.layout as Layout) || 'auto' as any;
        const layout: Layout =
            requestedLayout === 'horizontal' || requestedLayout === 'vertical' || requestedLayout === 'grid'
                ? requestedLayout
                : 'grid';

        let cols: number;
        let rows: number;
        if (layout === 'horizontal') {
            cols = n; rows = 1;
        } else if (layout === 'vertical') {
            cols = 1; rows = n;
        } else {
            cols = Math.ceil(Math.sqrt(n));
            rows = Math.ceil(n / cols);
        }

        const spacing = 4;
        // Sizing strategy
        // ───────────────
        // Cards target an aspect ratio (W:H) in the 1.2–1.5 range, which
        // is what Tableau / Power BI / Looker scorecards converge on.
        // Width is driven by the panel + tile-count budget; height is
        // *derived* from width via TARGET_ASPECT so cards stay in shape
        // whether they're compressed or expanded.
        //
        // Each tile *wants* to be TARGET_TILE_W wide. The canvas may
        // stretch up to baseW × MAX_STRETCH (the "budget"). If granting
        // every tile its wish would exceed that, tiles compress to share
        // what the budget allows. If even that compression would push
        // them below MIN_TILE_W, we let the canvas grow past the budget
        // — readability wins. tileH is then derived from tileW.
        const MAX_STRETCH   = 1.6;
        const TARGET_ASPECT = 1.4;  // card W:H — within Tableau/Power BI range
        const TARGET_TILE_W = 220;
        const MIN_TILE_W    = 130;
        const MIN_TILE_H    = Math.round(MIN_TILE_W / TARGET_ASPECT); // ~93

        const wishW        = cols * TARGET_TILE_W + (cols - 1) * spacing;
        const budgetW      = baseW * MAX_STRETCH;
        const minRequiredW = cols * MIN_TILE_W + (cols - 1) * spacing;

        const W = Math.max(
            minRequiredW,
            Math.min(budgetW, Math.max(baseW, wishW)),
        );

        // Tile dimensions follow the (possibly stretched) canvas; tileH
        // is derived from tileW via the target aspect ratio so cards
        // never go wider than ~1.5:1 or taller than ~1.2:1.
        const tileW = Math.max(MIN_TILE_W, Math.floor((W - spacing * (cols - 1)) / cols));
        const tileH = Math.max(MIN_TILE_H, Math.round(tileW / TARGET_ASPECT));
        const H     = rows * tileH + (rows - 1) * spacing;

        // Card horizontal inset (must match cardLeft below) and inner
        // horizontal padding for text. Computed before font sizing so we
        // can constrain valueFont to "longest value text fits inside the
        // card" — otherwise long numbers like 32,799,314 overflow the
        // card frame at small tile widths.
        const cardLeftInset = Math.max(0.5, Math.floor(tileW * 0.04));
        // Inner text padding scales with tile but has a sane floor; this
        // keeps a consistent card aspect ratio across tile counts.
        const cardInnerPadX = Math.max(8, Math.floor(tileW * 0.06));
        const cardInnerW    = Math.max(20, tileW - 2 * cardLeftInset - 2 * cardInnerPadX);

        // Estimate widest text per layer so fonts can be shrunk to fit
        // inside the card. Without this, long captions ("Massachusetts")
        // or sub-lines ("111% of 761,723") overflow the card border at
        // small tile widths.
        //   - Value is bold ⇒ ~0.66em per glyph on average (conservative;
        //     real digit widths in the default sans bold land near 0.6,
        //     but we leave headroom so the number never kisses the border).
        //   - Caption / sub are regular weight ⇒ ~0.58em.
        const CHAR_W_BOLD    = 0.66;
        const CHAR_W_REGULAR = 0.58;

        const maxValueChars   = tiles.reduce((m, t) => Math.max(m, t.valueText.length), 1);
        const maxCaptionChars = tiles.reduce((m, t) => Math.max(m, t.caption.length), 1);
        // Sub-line text is either "<pct>% of <goal>" (when both value and
        // goal are numeric) or "Goal: <goal>" (otherwise). Predict the
        // longest possible form per tile so the font shrinks accordingly.
        const maxSubChars = tiles.reduce((m, t) => {
            if (t.progress) {
                const pct  = Math.round(t.progress.fraction * 100);
                const text = `${pct}% of ${t.goalText ?? ''}`;
                return Math.max(m, text.length);
            }
            if (t.goalText != null) return Math.max(m, (`Goal: ${t.goalText}`).length);
            return m;
        }, 1);

        const fontFitsWidth = (chars: number, charW: number) =>
            Math.floor(cardInnerW / Math.max(1, chars * charW));

        const valueFontByWidth   = fontFitsWidth(maxValueChars,   CHAR_W_BOLD);
        const captionFontByWidth = fontFitsWidth(maxCaptionChars, CHAR_W_REGULAR);
        const subFontByWidth     = fontFitsWidth(maxSubChars,     CHAR_W_REGULAR);

        // Detect sub-line presence early — used both to size value (more
        // vertical room when there's no sub) and to lay out vertically below.
        const hasSubLine  = tiles.some(t => t.progress || t.goalText != null);
        const hasProgress = tiles.some(t => !!t.progress);

        // Typographic hierarchy (matches Material / Tableau / Power BI /
        // Looker scorecard conventions):
        //   - value is the hero (~hero number).
        //   - caption ≈ value / 3 (industry range 0.30–0.40).
        //   - sub    ≈ caption (same size; hierarchy is color/weight, not
        //     size — the sub-line carries data like "78% of 1.2M").
        // Vertical cap on value is loosened when there's no sub-line, so a
        // single-metric card uses more of its real estate.
        const valueHCap = hasSubLine ? tileH / 2.6 : tileH / 2.1;
        const valueFont   = Math.min(
            80,
            Math.max(10, Math.floor(Math.min(tileW / 5.0, valueHCap, valueFontByWidth))),
        );
        const captionFont = Math.max(11, Math.min(22, Math.floor(Math.min(valueFont / 3.0, captionFontByWidth))));
        const subFont     = Math.max(10, Math.min(18, Math.floor(Math.min(captionFont,       subFontByWidth))));

        const padTop   = Math.max(4, Math.floor(captionFont * 0.55));
        const padBot   = Math.max(4, Math.floor(subFont * 0.6));
        const gapCV    = Math.max(6, Math.floor(captionFont * 0.55));  // caption → value
        const gapVS    = Math.max(8, Math.floor(subFont * 1.0));        // value → sub-line
        const gapSB    = Math.max(4, Math.floor(subFont * 0.55));       // sub-line → bar
        const barHeight = Math.max(2, Math.floor(subFont * 0.4));

        const captionTop = padTop;
        const captionBot = captionTop + captionFont;
        const valueTop   = captionBot + gapCV;
        const valueMid   = valueTop + Math.floor(valueFont / 2);
        const valueBot   = valueTop + valueFont;
        const subTop     = valueBot + gapVS;
        const subBot     = subTop + subFont;
        const barTop     = subBot + gapSB;
        const barBot     = barTop + barHeight;

        const contentBot = hasProgress ? barBot : hasSubLine ? subBot : valueBot;
        const slack = Math.max(0, tileH - (contentBot + padBot));
        const yOffset = Math.floor(slack / 2);

        const captionY  = captionTop + yOffset;
        const valueY    = valueMid   + yOffset;
        const subY      = subTop     + yOffset;
        const barY      = barTop     + yOffset;

        const barPad    = Math.max(4, Math.floor(tileW * 0.1));
        const barLeft   = barPad;
        const barRight  = tileW - barPad;
        const barWidth  = Math.max(12, barRight - barLeft);

        // ── Card frame geometry ────────────────────────────────────────────
        // Card fills the tile minus a small outer margin so the card's
        // visible aspect ratio tracks the tile's (driven by TARGET_ASPECT
        // above). Content stays vertically centered inside via yOffset.
        const cardOuterPadY = Math.max(4, Math.floor(tileH * 0.06));
        const cardLeft   = cardLeftInset;
        const cardRight  = tileW - cardLeftInset;
        const cardTop    = Math.max(0.5, cardOuterPadY);
        const cardBot    = Math.min(tileH - 0.5, tileH - cardOuterPadY);

        // Card style toggle — see properties[] below. When false, the
        // frame layer is skipped and tiles render as plain text.
        const showCardFrame = config.style !== false;

        // ── Per-tile spec builder ──────────────────────────────────────────
        const buildTile = (t: Tile): any => {
            const layers: any[] = [];

            // Card frame (bottom layer) — sized to content, centered with it.
            if (showCardFrame) {
                layers.push({
                    data: { values: [{}] },
                    mark: {
                        type: 'rect',
                        fill: CARD_FILL,
                        stroke: CARD_STROKE,
                        strokeWidth: 1,
                        cornerRadius: CARD_RADIUS,
                        tooltip: null,
                    },
                    encoding: {
                        x:  { value: cardLeft },
                        x2: { value: cardRight },
                        y:  { value: cardTop },
                        y2: { value: cardBot },
                    },
                });
            }

            // Caption
            layers.push({
                data: { values: [{}] },
                mark: {
                    type: 'text',
                    fontSize: captionFont,
                    fontWeight: 500,
                    fill: '#4a4a4a',
                    align: 'center',
                    baseline: 'top',
                    text: t.caption,
                    tooltip: null,
                },
                encoding: {
                    x: { value: tileW / 2 },
                    y: { value: captionY },
                },
            });

            // Big number
            layers.push({
                data: { values: [{}] },
                mark: {
                    type: 'text',
                    fontSize: valueFont,
                    fontWeight: 'bold',
                    fill: '#1a1a1a',
                    align: 'center',
                    baseline: 'middle',
                    text: t.valueText,
                    tooltip: null,
                },
                encoding: {
                    x: { value: tileW / 2 },
                    y: { value: valueY },
                },
            });

            // Optional goal / progress line
            if (t.progress) {
                // Numeric value + numeric goal → "<pct>% of <goal>" + bar.
                const pct = clamp(t.progress.fraction, 0, 1.5);
                const pctText = `${Math.round(t.progress.fraction * 100)}% of ${t.goalText}`;

                // Status color: behind / on-track / exceeded. Assumes
                // higher-is-better; lower-is-better metrics should be
                // handled by the agent inverting the value/goal pair (or
                // by a future `direction` chart property).
                const isExceeded = t.progress.fraction >= 1;
                const isBehind   = t.progress.fraction < behindThreshold;
                const fillColor  = isExceeded
                    ? PROGRESS_EXCEEDED
                    : isBehind
                        ? PROGRESS_BEHIND
                        : PROGRESS_ON_TRACK;

                layers.push({
                    data: { values: [{}] },
                    mark: {
                        type: 'text',
                        fontSize: subFont,
                        fontWeight: isExceeded ? 600 : 400,
                        fill: isExceeded ? PROGRESS_EXCEEDED : '#666',
                        align: 'center',
                        baseline: 'top',
                        text: pctText,
                        tooltip: null,
                    },
                    encoding: {
                        x: { value: tileW / 2 },
                        y: { value: subY },
                    },
                });

                // Track
                layers.push({
                    data: { values: [{}] },
                    mark: {
                        type: 'rect',
                        fill: PROGRESS_TRACK,
                        cornerRadius: barHeight / 2,
                        tooltip: null,
                    },
                    encoding: {
                        x:  { value: barLeft },
                        x2: { value: barRight },
                        y:  { value: barY },
                        y2: { value: barY + barHeight },
                    },
                });
                // Fill — clamped to track width; overshoot capped visually
                // at 100% of the track, but the % label and color reveal
                // that the goal was exceeded.
                const fillEnd = barLeft + Math.min(1, pct) * barWidth;
                layers.push({
                    data: { values: [{}] },
                    mark: {
                        type: 'rect',
                        fill: fillColor,
                        cornerRadius: barHeight / 2,
                        tooltip: null,
                    },
                    encoding: {
                        x:  { value: barLeft },
                        x2: { value: fillEnd },
                        y:  { value: barY },
                        y2: { value: barY + barHeight },
                    },
                });
            } else if (t.goalText != null) {
                // Non-numeric goal (or non-numeric value) → just show "Goal: …".
                layers.push({
                    data: { values: [{}] },
                    mark: {
                        type: 'text',
                        fontSize: subFont,
                        fill: '#666',
                        align: 'center',
                        baseline: 'top',
                        text: `Goal: ${t.goalText}`,
                        tooltip: null,
                    },
                    encoding: {
                        x: { value: tileW / 2 },
                        y: { value: subY },
                    },
                });
            }

            return {
                width: tileW,
                height: tileH,
                layer: layers,
                resolve: { scale: { x: 'independent', y: 'independent' } },
            };
        };

        const tileSpecs = tiles.map(buildTile);

        if (tileSpecs.length === 1) {
            const tile = tileSpecs[0];
            spec.width  = tile.width;
            spec.height = tile.height;
            spec.layer  = tile.layer;
            spec.resolve = tile.resolve;
            return;
        }

        delete spec.layer;
        delete spec.encoding;
        if (layout === 'horizontal') {
            spec.hconcat = tileSpecs;
            spec.spacing = spacing;
        } else if (layout === 'vertical') {
            spec.vconcat = tileSpecs;
            spec.spacing = spacing;
        } else {
            const grid: any[] = [];
            for (let r = 0; r < rows; r++) {
                const rowTiles = tileSpecs.slice(r * cols, (r + 1) * cols);
                if (rowTiles.length === 0) continue;
                grid.push({ hconcat: rowTiles, spacing });
            }
            spec.vconcat = grid;
            spec.spacing = spacing;
        }
    },
    properties: [
        {
            key: 'layout',
            label: 'Layout',
            type: 'discrete',
            options: [
                { value: 'horizontal', label: 'Horizontal' },
                { value: 'vertical',   label: 'Vertical'   },
                { value: 'grid',       label: 'Grid'       },
            ],
            defaultValue: 'grid',
        },
        {
            // When on (default), each tile renders inside a subtle
            // rounded card frame (white fill + 1px border). When off,
            // the tile is plain text — useful for single hero numbers
            // or when the surrounding panel already provides framing.
            key: 'style',
            label: 'Card style',
            type: 'binary',
            defaultValue: true,
        },
        {
            // Progress fraction below this threshold is considered
            // "behind" (amber). Between threshold and 1 is "on track"
            // (blue). >= 1 is "exceeded" (green). Only applies when a
            // goal channel is bound and both value and goal are numeric.
            key: 'behindThreshold',
            label: 'Behind threshold',
            type: 'continuous',
            min: 0,
            max: 1,
            step: 0.05,
            defaultValue: 0.5,
            check: (ctx) => ({ applicable: !!ctx.encodings.goal?.field }),
        },
    ] as ChartPropertyDef[],
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Trivial scalar → display string.
 *
 * - Numbers: `toLocaleString` with at most 2 fraction digits. Tiny
 *   floating-point noise near zero is snapped so "-0" never appears.
 * - Strings / everything else: pass through via `String(...)`.
 *
 * Any richer formatting (currency symbols, SI abbreviations, percent,
 * locale-specific patterns) should be produced by the upstream data
 * transformation — the template intentionally does not parse format
 * patterns.
 */
function renderScalar(v: any): string {
    if (typeof v === 'number' && Number.isFinite(v)) {
        // Snap -0 / FP noise.
        if (Math.abs(v) < 1e-9) v = 0;
        return Number.isInteger(v)
            ? v.toLocaleString()
            : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }
    return String(v);
}

function clamp(n: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, n));
}
