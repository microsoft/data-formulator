// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Semantic Context Test Cases
 *
 * Each test demonstrates how semantic type annotations improve chart output
 * via the field-context pipeline (vlApplyFieldContext).
 *
 * Every test includes a description explaining what happens WITHOUT the
 * semantic annotation so developers can see the importance of each property.
 */

import { Type } from '../../../data/types';
import type { SemanticAnnotation } from '../core/field-semantics';
import { TestCase, makeField, makeEncodingItem } from './types';

// ============================================================================
// Shared helper data
// ============================================================================

const CITIES = ['Seattle', 'Austin', 'Boston', 'Denver', 'Miami'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TEAMS  = ['Alpha', 'Beta', 'Gamma', 'Delta'];

function seeded(seed: number) {
    let s = seed;
    return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647; };
}

// ============================================================================
// 1. Revenue formatting  →  axis.format / axis.labelExpr
//    Semantic type: "Revenue"  →  currency format ($1.2M)
//
//    WITHOUT this annotation:
//      Axis labels show raw numbers: 1200000, 2300000, 3500000
//      No currency symbol, no abbreviation — hard to read large values.
//
//    WITH "Revenue":
//      Axis labels show: $1.2M, $2.3M, $3.5M
//      Currency prefix ($) + SI abbreviation via format + labelExpr.
// ============================================================================

function genRevenueFormatTest(): TestCase {
    const rand = seeded(42);
    const data = CITIES.map(city => ({
        city,
        revenue: Math.round(500000 + rand() * 4500000),
    }));

    return {
        title: 'Revenue Formatting ($)',
        description:
            'Semantic type "Revenue" with unit "USD" adds currency prefix ($) and SI abbreviation to axis labels. ' +
            'WITHOUT this: axis would show raw numbers like 1200000.',
        tags: ['semantic', 'format', 'currency', 'revenue'],
        chartType: 'Bar Chart',
        data,
        fields: [makeField('city'), makeField('revenue')],
        metadata: {
            city:    { type: Type.String, semanticType: 'City',    levels: CITIES },
            revenue: { type: Type.Number, semanticType: 'Amount', levels: [] },
        },
        semanticAnnotations: {
            revenue: { semanticType: 'Amount', unit: 'USD' },
        },
        encodingMap: {
            x: makeEncodingItem('city'),
            y: makeEncodingItem('revenue'),
        },
    };
}

// ============================================================================
// 2. Percentage formatting + nice=false
//    Semantic type: "Percentage"  →  ".1%" format, nice: false
//
//    WITHOUT this annotation:
//      Values 0.72, 0.85 shown as plain decimals on axis.
//      Axis range may extend beyond 1.0 (e.g., to 1.2) due to nice rounding.
//
//    WITH "Percentage":
//      Axis labels show "72%", "85%".
//      nice=false prevents axis from extending past 100%.
// ============================================================================

function genPercentageFormatTest(): TestCase {
    const rand = seeded(99);
    const categories = ['Marketing', 'Sales', 'Engineering', 'Support', 'Design', 'HR'];
    const data = categories.map(dept => ({
        department: dept,
        completion_rate: Math.round((0.40 + rand() * 0.58) * 100) / 100,
    }));

    return {
        title: 'Percentage Formatting (%)',
        description:
            'Semantic type "Percentage" formats axis as "72%" instead of 0.72, ' +
            'and sets nice=false so axis doesn\'t extend past 100%. ' +
            'WITHOUT this: axis shows decimal fractions and may overshoot to 1.2.',
        tags: ['semantic', 'format', 'percentage', 'nice'],
        chartType: 'Bar Chart',
        data,
        fields: [makeField('department'), makeField('completion_rate')],
        metadata: {
            department:      { type: Type.String, semanticType: 'Category',   levels: categories },
            completion_rate: { type: Type.Number, semanticType: 'Percentage', levels: [] },
        },
        semanticAnnotations: {
            completion_rate: { semanticType: 'Percentage', intrinsicDomain: [0, 1] },
        },
        encodingMap: {
            x: makeEncodingItem('department'),
            y: makeEncodingItem('completion_rate'),
        },
    };
}

// ============================================================================
// 3. Domain constraint + Tick constraint (Rating [1,5])
//    Semantic type: { semanticType: "Rating", intrinsicDomain: [1, 5] }
//      → scale.domain = [1, 5]
//      → axis.values = [1, 2, 3, 4, 5]  (integer ticks only)
//
//    WITHOUT this annotation:
//      Axis auto-scales to data range (e.g., 2.3–4.7) — partial range.
//      Tick marks at fractional values (2.5, 3.0, 3.5) — meaningless for ratings.
//
//    WITH "Rating" + intrinsicDomain:
//      Full 1–5 range always visible; only integers 1,2,3,4,5 on axis.
// ============================================================================

function genRatingDomainTest(): TestCase {
    const rand = seeded(77);
    const products = ['Widget A', 'Widget B', 'Widget C', 'Widget D', 'Widget E',
                      'Widget F', 'Widget G', 'Widget H'];
    const data = products.map(p => ({
        product: p,
        rating: Math.round((2.0 + rand() * 2.8) * 10) / 10,
        reviews: Math.round(10 + rand() * 490),
    }));

    return {
        title: 'Rating Domain [1–5] & Integer Ticks',
        description:
            'Enriched annotation { semanticType: "Rating", intrinsicDomain: [1,5] } ' +
            'pins the axis to 1–5 with integer-only ticks. ' +
            'WITHOUT this: axis auto-scales to data range (e.g., 2.3–4.7) ' +
            'and shows fractional tick marks like 2.5, 3.5.',
        tags: ['semantic', 'domain', 'ticks', 'rating'],
        chartType: 'Scatter Plot',
        data,
        fields: [makeField('product'), makeField('rating'), makeField('reviews')],
        metadata: {
            product: { type: Type.String, semanticType: 'Category', levels: products },
            rating:  { type: Type.Number, semanticType: 'Score',   levels: [] },
            reviews: { type: Type.Number, semanticType: 'Count',    levels: [] },
        },
        // Enriched annotation for rating — provides intrinsic domain
        semanticAnnotations: {
            rating: { semanticType: 'Score', intrinsicDomain: [1, 5] },
        },
        encodingMap: {
            x: makeEncodingItem('reviews'),
            y: makeEncodingItem('rating'),
        },
    };
}

// ============================================================================
// 4. Reversed axis (Rank)
//    Semantic type: "Rank"  →  scale.reverse = true
//
//    WITHOUT this annotation:
//      Rank 1 appears at the BOTTOM of the y-axis (lowest numeric value).
//      Visually misleading — the "best" team appears lowest on the chart.
//
//    WITH "Rank":
//      Rank 1 at TOP of y-axis. Visual position matches intuitive ranking.
// ============================================================================

function genRankReversedTest(): TestCase {
    const rand = seeded(55);
    const data: Record<string, any>[] = [];
    for (const team of TEAMS) {
        for (let m = 0; m < 6; m++) {
            data.push({
                month: MONTHS[m],
                team,
                rank: Math.ceil(rand() * TEAMS.length),
            });
        }
    }

    return {
        title: 'Rank Reversed Axis',
        description:
            'Semantic type "Rank" reverses the y-axis so rank 1 (best) appears at the TOP. ' +
            'WITHOUT this: rank 1 sits at the bottom — first place looks like last place.',
        tags: ['semantic', 'reversed', 'rank'],
        chartType: 'Line Chart',
        data,
        fields: [makeField('month'), makeField('team'), makeField('rank')],
        metadata: {
            month: { type: Type.String, semanticType: 'Month',    levels: MONTHS.slice(0, 6) },
            team:  { type: Type.String, semanticType: 'Category', levels: TEAMS },
            rank:  { type: Type.Number, semanticType: 'Rank',     levels: [] },
        },
        encodingMap: {
            x:     makeEncodingItem('month'),
            y:     makeEncodingItem('rank'),
            color: makeEncodingItem('team'),
        },
    };
}

// ============================================================================
// 5. Scale type — log scale for Population
//    Semantic type: "Population"  →  scale.type = "log"
//    Only triggers when data spans ≥ 4 orders of magnitude (10,000×)
//    AND the semantic type is in the allow-list (Population, GDP, etc.)
//
//    WITHOUT this annotation:
//      Linear scale compresses small settlements into an invisible band
//      while megacities dominate. Impossible to compare across 4+ orders.
//
//    WITH "Population":
//      Log scale spreads values evenly — hamlet (500) and megacity (10M)
//      are both clearly visible and comparable.
// ============================================================================

function genPopulationLogScaleTest(): TestCase {
    // 12 places spanning ~20,000× (500 to 10M) to exceed the 10,000× threshold
    const places = [
        { place: 'Hamlet A',     population: 500,       area_km2: 1 },
        { place: 'Hamlet B',     population: 1200,      area_km2: 3 },
        { place: 'Village A',    population: 3500,      area_km2: 10 },
        { place: 'Village B',    population: 8000,      area_km2: 18 },
        { place: 'Small Town',   population: 22000,     area_km2: 40 },
        { place: 'Town',         population: 65000,     area_km2: 80 },
        { place: 'Small City',   population: 180000,    area_km2: 150 },
        { place: 'City',         population: 520000,    area_km2: 300 },
        { place: 'Large City',   population: 1400000,   area_km2: 550 },
        { place: 'Metro A',     population: 3200000,   area_km2: 900 },
        { place: 'Metro B',     population: 5800000,   area_km2: 1400 },
        { place: 'Megacity',     population: 10000000,  area_km2: 2500 },
    ];

    return {
        title: 'Population Log Scale (≥10,000× span)',
        description:
            'Semantic type "Population" applies log scale when data spans ≥ 4 orders ' +
            'of magnitude (500 to 10M = 20,000×). Only triggers for allow-listed types. ' +
            'WITHOUT this: linear scale compresses small values into an invisible band.',
        tags: ['semantic', 'scaleType', 'log', 'population'],
        chartType: 'Scatter Plot',
        data: places,
        fields: [makeField('place'), makeField('population'), makeField('area_km2')],
        metadata: {
            place:      { type: Type.String, semanticType: 'Category',   levels: places.map(p => p.place) },
            population: { type: Type.Number, semanticType: 'Population', levels: [] },
            area_km2:   { type: Type.Number, semanticType: 'Quantity',   levels: [] },
        },
        encodingMap: {
            x: makeEncodingItem('area_km2'),
            y: makeEncodingItem('population'),
        },
    };
}

// ============================================================================
// 6. Interpolation — monotone for Temperature
//    Semantic type: "Temperature"  →  mark.interpolate = "monotone"
//    Also adds "°C" suffix via format → labelExpr.
//
//    WITHOUT this annotation:
//      Default linear interpolation creates jagged sawtooth lines between
//      data points. No unit suffix on axis.
//
//    WITH "Temperature":
//      Smooth monotone interpolation preserves local extrema without
//      overshooting (no false dips below min or above max between points).
//      Axis labels show "15°C", "22°C" etc.
// ============================================================================

function genTemperatureInterpolationTest(): TestCase {
    const data: Record<string, any>[] = [];
    // Two cities with different seasonal patterns
    const seattleTemps = [-1, 2, 6, 10, 14, 18, 22, 21, 17, 11, 5, 1];
    const miamiTemps   = [20, 21, 23, 25, 27, 29, 30, 30, 29, 27, 24, 21];

    for (let i = 0; i < 12; i++) {
        data.push({ month: MONTHS[i], city: 'Seattle', temperature: seattleTemps[i] });
        data.push({ month: MONTHS[i], city: 'Miami',   temperature: miamiTemps[i] });
    }

    return {
        title: 'Temperature Interpolation (monotone + °C)',
        description:
            'Semantic type "Temperature" applies monotone interpolation for smooth curves ' +
            'and adds "°C" suffix to axis labels. ' +
            'WITHOUT this: jagged linear segments between points, no unit on axis.',
        tags: ['semantic', 'interpolation', 'temperature', 'format'],
        chartType: 'Line Chart',
        data,
        fields: [makeField('month'), makeField('city'), makeField('temperature')],
        metadata: {
            month:       { type: Type.String, semanticType: 'Month',       levels: MONTHS },
            city:        { type: Type.String, semanticType: 'City',        levels: ['Seattle', 'Miami'] },
            temperature: { type: Type.Number, semanticType: 'Temperature', levels: [] },
        },
        // Enriched annotation for temperature — unit drives suffix
        semanticAnnotations: {
            temperature: { semanticType: 'Temperature', unit: '°C' },
        },
        encodingMap: {
            x:     makeEncodingItem('month'),
            y:     makeEncodingItem('temperature'),
            color: makeEncodingItem('city'),
        },
    };
}

// ============================================================================
// 7. Combined: Revenue + Percentage side by side
//    Shows that different semantic types on y-axis produce different formatting
//    even with the same chart template.
//
//    WITHOUT annotations:
//      Both charts show plain numeric axis (0.72 and 3500000).
//
//    WITH annotations:
//      Revenue chart: "$3.5M"   Percentage chart: "72%"
// ============================================================================

function genRevenueVsPercentTest(): TestCase {
    const rand = seeded(31);
    const data = CITIES.map(city => ({
        city,
        revenue: Math.round(1000000 + rand() * 4000000),
        growth_rate: Math.round((0.02 + rand() * 0.28) * 1000) / 1000,
    }));

    return {
        title: 'Revenue vs Growth Rate (dual semantics)',
        description:
            'Two numeric columns with different semantics on the same data. ' +
            'Revenue with unit "USD" gets "$" prefix + SI abbreviation; growth_rate gets "%" format. ' +
            'WITHOUT annotations: both axes show plain numbers.',
        tags: ['semantic', 'format', 'currency', 'percentage', 'dual'],
        chartType: 'Scatter Plot',
        data,
        fields: [makeField('city'), makeField('revenue'), makeField('growth_rate')],
        metadata: {
            city:        { type: Type.String, semanticType: 'City',       levels: CITIES },
            revenue:     { type: Type.Number, semanticType: 'Amount',    levels: [] },
            growth_rate: { type: Type.Number, semanticType: 'Percentage', levels: [] },
        },
        semanticAnnotations: {
            revenue: { semanticType: 'Amount', unit: 'USD' },
            growth_rate: { semanticType: 'Percentage', intrinsicDomain: [0, 1] },
        },
        encodingMap: {
            x:     makeEncodingItem('revenue'),
            y:     makeEncodingItem('growth_rate'),
            color: makeEncodingItem('city'),
        },
    };
}

// ============================================================================
// 8. Score domain [0, 100] with tick constraint
//    Enriched annotation: { semanticType: "Score", intrinsicDomain: [0, 100] }
//      → scale.domain = [0, 100], axis.tickMinStep = 1
//
//    WITHOUT this:
//      Axis may show 65–92 (auto-scaled to data) with arbitrary tick spacing.
//
//    WITH "Score" + intrinsicDomain:
//      Full 0–100 range, giving context that 85 is "85 out of 100".
// ============================================================================

function genScoreDomainTest(): TestCase {
    const rand = seeded(63);
    const students = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank', 'Grace', 'Hank'];
    const data = students.map(s => ({
        student: s,
        exam_score: Math.round(55 + rand() * 40),
        study_hours: Math.round(2 + rand() * 18),
    }));

    return {
        title: 'Exam Score Domain [0–100]',
        description:
            'Enriched annotation { semanticType: "Score", intrinsicDomain: [0, 100] } ' +
            'pins the axis to 0–100, giving full context. ' +
            'WITHOUT this: axis auto-scales to data range (e.g., 58–94), ' +
            'losing the "out of 100" context.',
        tags: ['semantic', 'domain', 'score'],
        chartType: 'Bar Chart',
        data,
        fields: [makeField('student'), makeField('exam_score'), makeField('study_hours')],
        metadata: {
            student:    { type: Type.String, semanticType: 'Category', levels: students },
            exam_score: { type: Type.Number, semanticType: 'Score',    levels: [] },
            study_hours:{ type: Type.Number, semanticType: 'Quantity', levels: [] },
        },
        semanticAnnotations: {
            exam_score: { semanticType: 'Score', intrinsicDomain: [0, 100] },
        },
        encodingMap: {
            x: makeEncodingItem('student'),
            y: makeEncodingItem('exam_score'),
        },
    };
}

// ============================================================================
// 15. Rating bar chart — domain [1,5] should NOT extend to zero
//     Semantic type: { semanticType: "Rating", intrinsicDomain: [1, 5] }
//
//     The key design question: should a bar chart of ratings include zero?
//     Most default tools naively force zero on all bar charts. But Rating
//     is a bounded scale [1, 5] — zero is outside the scale and wastes 20%
//     of visual space while compressing the meaningful 1-5 differences.
//
//     The semantic domain constraint [1, 5] is authoritative and should
//     clear any auto-computed zero:true from the zero-baseline heuristic.
//
//     WITHOUT semantic domain: bar starts at 0, compressing the 1-5 range
//     WITH semantic domain [1,5]: bars span the full [1,5] range
// ============================================================================

function genRatingBarDomainTest(): TestCase {
    const rand = seeded(501);
    const restaurants = ['Sakura Sushi', 'Bella Pasta', 'Taco Loco',
                         'Zen Noodle', 'Burger Joint', 'Le Bistro'];
    const data = restaurants.map(r => ({
        restaurant: r,
        avg_rating: Math.round((2.5 + rand() * 2.3) * 10) / 10,
    }));

    return {
        title: 'Rating Bar — Domain [1,5] vs Zero',
        description:
            'Bar chart of ratings with intrinsicDomain [1,5]. The semantic domain ' +
            'should prevent zero-extension — bars span [1,5] not [0,5]. ' +
            'WITHOUT this: bar chart forces zero, wasting 20% of space on impossible values.',
        tags: ['semantic', 'domain', 'zero', 'rating', 'bar'],
        chartType: 'Bar Chart',
        data,
        fields: [makeField('restaurant'), makeField('avg_rating')],
        metadata: {
            restaurant: { type: Type.String, semanticType: 'Category', levels: restaurants },
            avg_rating: { type: Type.Number, semanticType: 'Score',   levels: [] },
        },
        semanticAnnotations: {
            avg_rating: { semanticType: 'Score', intrinsicDomain: [1, 5] },
        },
        encodingMap: {
            x: makeEncodingItem('restaurant'),
            y: makeEncodingItem('avg_rating'),
        },
    };
}

// ============================================================================
// 16. Revenue bar chart — zero baseline IS meaningful
//     Semantic type: "Revenue" (zero-meaningful class)
//
//     Revenue is an additive measure where 0 = no revenue. Bar length from
//     zero communicates proportional magnitude. Including zero is correct.
//
//     WITHOUT semantic type: VL may or may not include zero by default
//     WITH "Revenue": zero:true ensures bars start at 0
// ============================================================================

function genRevenueBarZeroTest(): TestCase {
    const rand = seeded(502);
    const products = ['Widget A', 'Widget B', 'Widget C', 'Widget D', 'Widget E'];
    const data = products.map(p => ({
        product: p,
        revenue: Math.round(80000 + rand() * 320000),
    }));

    return {
        title: 'Revenue Bar — Zero Baseline',
        description:
            'Revenue is zero-meaningful: $0 = no revenue. Bar charts must start at zero ' +
            'to preserve proportional bar length. ' +
            'WITHOUT this: data-fit might show bars starting at $80K, exaggerating differences.',
        tags: ['semantic', 'zero', 'revenue', 'bar'],
        chartType: 'Bar Chart',
        data,
        fields: [makeField('product'), makeField('revenue')],
        metadata: {
            product: { type: Type.String, semanticType: 'Category', levels: products },
            revenue: { type: Type.Number, semanticType: 'Amount',  levels: [] },
        },
        semanticAnnotations: {
            revenue: { semanticType: 'Amount', unit: 'USD' },
        },
        encodingMap: {
            x: makeEncodingItem('product'),
            y: makeEncodingItem('revenue'),
        },
    };
}

// ============================================================================
// 17. Temperature scatter — zero is arbitrary, should NOT include zero
//     Semantic type: "Temperature" (zero-arbitrary class)
//
//     0°F / 0°C are arbitrary scale points, not physical absence.
//     Including zero on a scatter plot of 60–95°F summer temps wastes the
//     bottom 60% of the canvas.
//
//     WITHOUT semantic type: VL default may or may not include zero
//     WITH "Temperature": zero:false, VL nice-rounds to clean bounds
// ============================================================================

function genTemperatureScatterZeroTest(): TestCase {
    const rand = seeded(503);
    const days = Array.from({ length: 20 }, (_, i) => `Day ${i + 1}`);
    const data = days.map(d => ({
        day: d,
        high_temp: Math.round(65 + rand() * 30),
        humidity: Math.round(30 + rand() * 50),
    }));

    return {
        title: 'Temperature Scatter — No Zero',
        description:
            'Temperature zero (0°F/°C) is an arbitrary scale point. For data in 65–95°F, ' +
            'including zero wastes 60% of the canvas. zero:false lets VL data-fit with ' +
            'nice tick rounding. ' +
            'WITHOUT this: chart might waste space including the irrelevant zero.',
        tags: ['semantic', 'zero', 'temperature', 'scatter'],
        chartType: 'Scatter Plot',
        data,
        fields: [makeField('day'), makeField('high_temp'), makeField('humidity')],
        metadata: {
            day:       { type: Type.String, semanticType: 'Category',    levels: days },
            high_temp: { type: Type.Number, semanticType: 'Temperature', levels: [] },
            humidity:  { type: Type.Number, semanticType: 'Percentage',  levels: [] },
        },
        semanticAnnotations: {
            humidity: { semanticType: 'Percentage', intrinsicDomain: [0, 100] },
        },
        encodingMap: {
            x: makeEncodingItem('humidity'),
            y: makeEncodingItem('high_temp'),
        },
    };
}

// ============================================================================
// 18. Percentage line — snap-to-bound heuristic
//     Semantic type: "Percentage" → intrinsicDomain [0, 100]
//
//     Uses snap-to-bound: if data approaches the theoretical endpoint
//     (≥90% of max), the axis snaps to it. Data at 40–85% is below the
//     snap threshold → axis data-fits. Data at 60–97% would snap to 100%.
//     The zero-baseline contextual logic independently decides whether
//     to include 0 (bar = yes, line = depends on proximity).
// ============================================================================

function genPercentageLineDomainTest(): TestCase {
    const rand = seeded(504);
    const weeks = Array.from({ length: 10 }, (_, i) => `Week ${i + 1}`);
    const data = weeks.map(w => ({
        week: w,
        completion_rate: Math.round(40 + rand() * 45),
    }));

    return {
        title: 'Percentage Line — Snap-to-Bound',
        description:
            'Completion rates (40–85%) with intrinsicDomain [0, 100]. Data max (85%) is ' +
            'below the 90% snap threshold, so the axis data-fits rather than forcing 100%. ' +
            'If data reached 97%, the axis would snap to 100% (stopping at 97% looks arbitrary).',
        tags: ['semantic', 'domain', 'zero', 'percentage', 'line'],
        chartType: 'Line Chart',
        data,
        fields: [makeField('week'), makeField('completion_rate')],
        metadata: {
            week:            { type: Type.String, semanticType: 'Category',   levels: weeks },
            completion_rate: { type: Type.Number, semanticType: 'Percentage', levels: [] },
        },
        semanticAnnotations: {
            completion_rate: { semanticType: 'Percentage', intrinsicDomain: [0, 100] },
        },
        encodingMap: {
            x: makeEncodingItem('week'),
            y: makeEncodingItem('completion_rate'),
        },
    };
}

// ============================================================================
// Public generator
// ============================================================================

export function genSemanticContextTests(): TestCase[] {
    return [
        genRevenueFormatTest(),
        genPercentageFormatTest(),
        genRatingDomainTest(),
        genRankReversedTest(),
        genPopulationLogScaleTest(),
        genTemperatureInterpolationTest(),
        genRevenueVsPercentTest(),
        genScoreDomainTest(),
        genProfitSignedCurrencyTest(),
        genWeightUnitSuffixTest(),
        genCountStepInterpolationTest(),
        genLatitudeDomainClampTest(),
        genPercentageChangeSignedTest(),
        genMonthCanonicalOrderTest(),
        genRatingBarDomainTest(),
        genRevenueBarZeroTest(),
        genTemperatureScatterZeroTest(),
        genPercentageLineDomainTest(),
        genDayOfWeekOrderTest(),
        genYearFormatTest(),
        genSentimentDivergingColorTest(),
        genRevenueSequentialColorTest(),
        genCorrelationDivergingTest(),
        genNiceFalseScoreTest(),
        // --- New tests (25–39) ---
        genDurationUnitSuffixTest(),
        genQuarterCanonicalOrderTest(),
        genCostCurrencyFormatTest(),
        genDirectionCompassOrderTest(),
        genAgeGroupOrdinalTest(),
        genBooleanColorTest(),
        genLongitudeDomainClampTest(),
        genIndexOrdinalTest(),
        genPercentageWholeNumberTest(),
        genScoreColorDivergingTest(),
        genPriceEurCurrencyTest(),
        genYearOrdinalDisambiguationTest(),
        genProfitColorDivergingTest(),
        genCountIntegerFormatTest(),
        genUnregisteredTypeFallbackTest(),
    ];
}

// ============================================================================
// 9. Profit — signed decimal format
//    Semantic type: "Profit"  →  decimal format class
//
//    WITHOUT this annotation:
//      Axis shows raw numbers: 120000, -50000. No sign prefix on positive
//      values. Hard to tell gains from losses at a glance.
//
//    WITH "Profit":
//      Tooltip shows: +120,000, -50,000. Sign always visible in tooltips.
//      Axis defers to VL defaults. Currency prefix requires unit annotation.
// ============================================================================

function genProfitSignedCurrencyTest(): TestCase {
    const rand = seeded(111);
    const quarters = ['Q1-2024', 'Q2-2024', 'Q3-2024', 'Q4-2024',
                      'Q1-2025', 'Q2-2025', 'Q3-2025', 'Q4-2025'];
    const data = quarters.map(q => ({
        quarter: q,
        profit: Math.round((-200000 + rand() * 600000) / 1000) * 1000,
    }));

    return {
        title: 'Profit Signed Decimal',
        description:
            'Semantic type "Profit" with unit "USD" uses decimal format with currency in tooltip. ' +
            'Sign is always visible in tooltips, making gains vs losses obvious. ' +
            'WITHOUT this: raw numbers without sign prefix.',
        tags: ['semantic', 'format', 'decimal', 'profit'],
        chartType: 'Bar Chart',
        data,
        fields: [makeField('quarter'), makeField('profit')],
        metadata: {
            quarter: { type: Type.String, semanticType: 'Category', levels: quarters },
            profit:  { type: Type.Number, semanticType: 'Profit',   levels: [] },
        },
        semanticAnnotations: {
            profit: { semanticType: 'Profit', unit: 'USD' },
        },
        encodingMap: {
            x: makeEncodingItem('quarter'),
            y: makeEncodingItem('profit'),
        },
    };
}

// ============================================================================
// 10. Weight with unit suffix (kg)
//     Semantic type: "Weight" + unit: "kg"  →  "72.5 kg" on axis
//
//     WITHOUT this annotation:
//       Axis shows bare numbers: 72.5, 85.0. No indication of unit.
//       User has to look at column name to figure out what these numbers mean.
//
//     WITH "Weight" + unit:
//       Axis labels show "72.5 kg", "85.0 kg". Unit is part of the label.
// ============================================================================

function genWeightUnitSuffixTest(): TestCase {
    const rand = seeded(202);
    const athletes = ['Chen', 'Maria', 'James', 'Yuki', 'Priya',
                      'Lars', 'Fatima', 'Carlos', 'Anna', 'Kwame'];
    const data = athletes.map(name => ({
        athlete: name,
        weight_kg: Math.round((55 + rand() * 50) * 10) / 10,
        height_cm: Math.round(155 + rand() * 40),
    }));

    return {
        title: 'Weight Unit Suffix (kg)',
        description:
            'Enriched annotation { semanticType: "Weight", unit: "kg" } appends " kg" ' +
            'to axis labels. WITHOUT this: bare numbers with no unit context.',
        tags: ['semantic', 'format', 'unit-suffix', 'weight'],
        chartType: 'Scatter Plot',
        data,
        fields: [makeField('athlete'), makeField('weight_kg'), makeField('height_cm')],
        metadata: {
            athlete:   { type: Type.String, semanticType: 'Category', levels: athletes },
            weight_kg: { type: Type.Number, semanticType: 'Weight',   levels: [] },
            height_cm: { type: Type.Number, semanticType: 'Distance', levels: [] },
        },
        semanticAnnotations: {
            weight_kg: { semanticType: 'Weight', unit: 'kg' },
            height_cm: { semanticType: 'Distance', unit: 'cm' },
        },
        encodingMap: {
            x: makeEncodingItem('height_cm'),
            y: makeEncodingItem('weight_kg'),
        },
    };
}

// ============================================================================
// 11. Count — step-after interpolation
//     Semantic type: "Count"  →  interpolation = "step-after"
//
//     WITHOUT this annotation:
//       Line chart connects counts with straight diagonal lines, implying
//       gradual continuous change between data points.
//
//     WITH "Count":
//       Step-after interpolation shows flat steps — count stays constant
//       until the next event, then jumps. Accurate for discrete events.
// ============================================================================

function genCountStepInterpolationTest(): TestCase {
    const data: Record<string, any>[] = [];
    const weeks = ['Wk1', 'Wk2', 'Wk3', 'Wk4', 'Wk5', 'Wk6',
                   'Wk7', 'Wk8', 'Wk9', 'Wk10', 'Wk11', 'Wk12'];
    const bugCounts   = [3, 7, 12, 8, 15, 22, 18, 11, 9, 14, 6, 4];
    const featureDone = [1, 2, 4, 6, 7, 8, 10, 13, 15, 16, 18, 20];

    for (let i = 0; i < 12; i++) {
        data.push({ week: weeks[i], metric: 'Bugs Filed',        count: bugCounts[i] });
        data.push({ week: weeks[i], metric: 'Features Completed', count: featureDone[i] });
    }

    return {
        title: 'Count Step-After Interpolation',
        description:
            'Semantic type "Count" uses step-after interpolation — count stays ' +
            'constant then jumps at each data point (discrete events). ' +
            'WITHOUT this: diagonal lines imply gradual change between weeks.',
        tags: ['semantic', 'interpolation', 'count', 'step'],
        chartType: 'Line Chart',
        data,
        fields: [makeField('week'), makeField('metric'), makeField('count')],
        metadata: {
            week:   { type: Type.String, semanticType: 'Category', levels: weeks },
            metric: { type: Type.String, semanticType: 'Category', levels: ['Bugs Filed', 'Features Completed'] },
            count:  { type: Type.Number, semanticType: 'Count',    levels: [] },
        },
        encodingMap: {
            x:     makeEncodingItem('week'),
            y:     makeEncodingItem('count'),
            color: makeEncodingItem('metric'),
        },
    };
}

// ============================================================================
// 12. Latitude — hard domain [-90, 90] with clamp
//     Semantic type: "Latitude"  →  scale.domain = [-90, 90], clamp = true
//
//     WITHOUT this annotation:
//       Axis auto-scales to data (e.g., 30–60). No indication these are
//       geographic degrees. Axis could "nice-round" to 25–65.
//
//     WITH "Latitude":
//       Full -90 to 90 range. Clamp prevents out-of-range rendering.
//       Shows data in geographic context.
// ============================================================================

function genLatitudeDomainClampTest(): TestCase {
    const cities = [
        { city: 'Singapore',  latitude: 1.35,  gdp_per_capita: 65000 },
        { city: 'Mumbai',     latitude: 19.08, gdp_per_capita: 7200 },
        { city: 'Cairo',      latitude: 30.04, gdp_per_capita: 3900 },
        { city: 'Istanbul',   latitude: 41.01, gdp_per_capita: 9500 },
        { city: 'Paris',      latitude: 48.86, gdp_per_capita: 42000 },
        { city: 'London',     latitude: 51.51, gdp_per_capita: 46000 },
        { city: 'Moscow',     latitude: 55.76, gdp_per_capita: 11300 },
        { city: 'Helsinki',   latitude: 60.17, gdp_per_capita: 49000 },
        { city: 'Reykjavik',  latitude: 64.13, gdp_per_capita: 52000 },
        { city: 'Tromsø',     latitude: 69.65, gdp_per_capita: 65000 },
    ];

    return {
        title: 'Latitude Hard Domain [-90°, 90°]',
        description:
            'Semantic type "Latitude" pins axis to [-90, 90] with clamp=true ' +
            '(hard physical domain). Shows where cities fall in global context. ' +
            'WITHOUT this: axis auto-scales to data range (1–70), losing context.',
        tags: ['semantic', 'domain', 'clamp', 'latitude', 'geographic'],
        chartType: 'Scatter Plot',
        data: cities,
        fields: [makeField('city'), makeField('latitude'), makeField('gdp_per_capita')],
        metadata: {
            city:           { type: Type.String, semanticType: 'City',     levels: cities.map(c => c.city) },
            latitude:       { type: Type.Number, semanticType: 'Latitude', levels: [] },
            gdp_per_capita: { type: Type.Number, semanticType: 'Amount',   levels: [] },
        },
        encodingMap: {
            x: makeEncodingItem('gdp_per_capita'),
            y: makeEncodingItem('latitude'),
        },
    };
}

// ============================================================================
// 13. Percentage Change — signed percent (+12.3% / -5.1%)
//     Semantic type: "PercentageChange"  →  percent format
//
//     WITHOUT this annotation:
//       Axis shows 0.12, -0.05 — no sign on positive, no % symbol.
//       Hard to interpret at a glance.
//
//     WITH "PercentageChange":
//       Axis shows "+12.3%", "-5.1%". Sign always visible, % suffix.
// ============================================================================

function genPercentageChangeSignedTest(): TestCase {
    const rand = seeded(333);
    const stocks = ['AAPL', 'GOOG', 'MSFT', 'AMZN', 'META',
                    'TSLA', 'NVDA', 'AMD', 'NFLX', 'DIS'];
    const data = stocks.map(s => ({
        stock: s,
        ytd_change: Math.round((-0.30 + rand() * 0.80) * 1000) / 1000,
        market_cap_B: Math.round(50 + rand() * 2950),
    }));

    return {
        title: 'Percentage Change (signed ±%)',
        description:
            'Semantic type "PercentageChange" uses percent format. ' +
            'Sign is always visible, making gains and losses instantly clear. ' +
            'WITHOUT this: raw decimals like 0.12 or -0.05 with no % symbol.',
        tags: ['semantic', 'format', 'percent', 'percentage-change'],
        chartType: 'Bar Chart',
        data,
        fields: [makeField('stock'), makeField('ytd_change'), makeField('market_cap_B')],
        metadata: {
            stock:        { type: Type.String, semanticType: 'Category',         levels: stocks },
            ytd_change:   { type: Type.Number, semanticType: 'PercentageChange', levels: [] },
            market_cap_B: { type: Type.Number, semanticType: 'Amount',           levels: [] },
        },
        semanticAnnotations: {
            ytd_change: { semanticType: 'PercentageChange', intrinsicDomain: [-1, 1] },
        },
        encodingMap: {
            x: makeEncodingItem('stock'),
            y: makeEncodingItem('ytd_change'),
        },
    };
}

// ============================================================================
// 14. Month canonical ordering
//     Semantic type: "Month" → ordinal sort order preserved
//
//     WITHOUT this annotation:
//       Months sorted alphabetically: Apr, Aug, Dec, Feb, Jan, Jul...
//       Completely wrong for temporal data.
//
//     WITH "Month":
//       Canonical order: Jan, Feb, Mar, Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec.
// ============================================================================

function genMonthCanonicalOrderTest(): TestCase {
    const rand = seeded(444);
    // Deliberately out of order in data to show sorting
    const shuffledMonths = ['Mar', 'Nov', 'Jul', 'Jan', 'Sep', 'May',
                            'Apr', 'Dec', 'Feb', 'Oct', 'Jun', 'Aug'];
    const data = shuffledMonths.map(m => ({
        month: m,
        sales: Math.round(10000 + rand() * 40000),
    }));

    return {
        title: 'Month Canonical Ordering',
        description:
            'Semantic type "Month" preserves calendar order (Jan→Dec) regardless ' +
            'of data insertion order. ' +
            'WITHOUT this: months sort alphabetically (Apr, Aug, Dec, Feb...).',
        tags: ['semantic', 'ordering', 'month', 'canonical'],
        chartType: 'Bar Chart',
        data,
        fields: [makeField('month'), makeField('sales')],
        metadata: {
            month: { type: Type.String, semanticType: 'Month',    levels: shuffledMonths },
            sales: { type: Type.Number, semanticType: 'Amount',  levels: [] },
        },
        encodingMap: {
            x: makeEncodingItem('month'),
            y: makeEncodingItem('sales'),
        },
    };
}

// ============================================================================
// 19. Day-of-Week canonical ordering
//     Semantic type: "Day" → canonical Mon–Sun order
//
//     WITHOUT this annotation:
//       Day names sorted alphabetically: Fri, Mon, Sat, Sun, Thu, Tue, Wed.
//       This destroys the weekly cycle.
//
//     WITH "Day":
//       Canonical weekday order: Mon, Tue, Wed, Thu, Fri, Sat, Sun
//       (or data-matching variant). ordinalSortOrder provides the domain.
// ============================================================================

function genDayOfWeekOrderTest(): TestCase {
    const rand = seeded(555);
    // Deliberately shuffled
    const shuffledDays = ['Thu', 'Mon', 'Sat', 'Wed', 'Fri', 'Tue', 'Sun'];
    const data = shuffledDays.map(d => ({
        day: d,
        visitors: Math.round(200 + rand() * 800),
    }));

    return {
        title: 'Day-of-Week Canonical Order',
        description:
            'Semantic type "Day" preserves weekday order (Mon→Sun) regardless ' +
            'of data encounter order. ' +
            'WITHOUT this: days sort alphabetically (Fri, Mon, Sat...).',
        tags: ['semantic', 'ordering', 'day', 'canonical'],
        chartType: 'Bar Chart',
        data,
        fields: [makeField('day'), makeField('visitors')],
        metadata: {
            day:      { type: Type.String, semanticType: 'Day',   levels: shuffledDays },
            visitors: { type: Type.Number, semanticType: 'Count', levels: [] },
        },
        encodingMap: {
            x: makeEncodingItem('day'),
            y: makeEncodingItem('visitors'),
        },
    };
}

// ============================================================================
// 20. Year integer format — no comma separator
//     Semantic type: "Year" → format "d" (2024 not "2,024")
//
//     WITHOUT this annotation:
//       Numeric years treated as generic numbers → formatted with thousands
//       separator: "2,024" instead of "2024". Looks like a decimal value.
//
//     WITH "Year":
//       Format class = 'integer', and the pipeline uses bare "d" format
//       for years (without comma grouping). Axis reads: 2020, 2021, 2022...
// ============================================================================

function genYearFormatTest(): TestCase {
    const years = [2018, 2019, 2020, 2021, 2022, 2023, 2024];
    const rand = seeded(666);
    const data = years.map(y => ({
        year: y,
        gdp_trillion: Math.round((18 + rand() * 8) * 100) / 100,
    }));

    return {
        title: 'Year Format (no comma)',
        description:
            'Semantic type "Year" uses integer format without comma grouping: ' +
            '"2024" not "2,024". ' +
            'WITHOUT this: years shown as "2,024" with thousands separator.',
        tags: ['semantic', 'format', 'year', 'integer'],
        chartType: 'Line Chart',
        data,
        fields: [makeField('year'), makeField('gdp_trillion')],
        metadata: {
            year:         { type: Type.Number, semanticType: 'Year',    levels: years },
            gdp_trillion: { type: Type.Number, semanticType: 'Amount',  levels: [] },
        },
        encodingMap: {
            x: makeEncodingItem('year'),
            y: makeEncodingItem('gdp_trillion'),
        },
    };
}

// ============================================================================
// 21. Sentiment — diverging color scheme
//     Semantic type: "Sentiment" on color channel → diverging color scheme
//     with midpoint at 0
//
//     WITHOUT this annotation:
//       Color mapped to a generic sequential palette (e.g., viridis).
//       Positive and negative sentiment look like arbitrary gradients,
//       not intuitively split around a neutral center.
//
//     WITH "Sentiment":
//       Diverging color scheme (e.g., redblue) centered on 0.
//       Negative = one hue, positive = another, 0 = neutral white/grey.
//       scale.domainMid = 0 ensures the midpoint is visually centered.
// ============================================================================

function genSentimentDivergingColorTest(): TestCase {
    const rand = seeded(777);
    const products = ['Widget A', 'Widget B', 'Gadget X', 'Gadget Y',
                      'Tool M', 'Tool N', 'Part P', 'Part Q'];
    const data = products.map(p => ({
        product: p,
        reviews: Math.round(50 + rand() * 450),
        sentiment: Math.round((-0.8 + rand() * 1.6) * 100) / 100,
    }));

    return {
        title: 'Sentiment Diverging Color',
        description:
            'Semantic type "Sentiment" on the color channel triggers a diverging ' +
            'color scheme (redblue) with domainMid = 0. Negative sentiment gets ' +
            'one hue, positive gets another, and zero is neutral. ' +
            'WITHOUT this: generic sequential palette with no semantic midpoint.',
        tags: ['semantic', 'colorScheme', 'diverging', 'sentiment'],
        chartType: 'Bar Chart',
        data,
        fields: [makeField('product'), makeField('reviews'), makeField('sentiment')],
        metadata: {
            product:   { type: Type.String, semanticType: 'Category',  levels: products },
            reviews:   { type: Type.Number, semanticType: 'Count',     levels: [] },
            sentiment: { type: Type.Number, semanticType: 'Sentiment', levels: [] },
        },
        encodingMap: {
            x: makeEncodingItem('product'),
            y: makeEncodingItem('reviews'),
            color: makeEncodingItem('sentiment'),
        },
    };
}

// ============================================================================
// 22. Revenue sequential color — quantitative color uses sequential scheme
//     Semantic type: "Revenue" on color channel → sequential gold-green scheme
//
//     WITHOUT this annotation:
//       Default sequential palette (viridis). Works but doesn't convey
//       financial context.
//
//     WITH "Revenue":
//       Financial-themed sequential scheme (goldgreen) automatically chosen
//       for quantitative financial data. Warmer = higher revenue.
// ============================================================================

function genRevenueSequentialColorTest(): TestCase {
    const rand = seeded(888);
    const regions = ['North', 'South', 'East', 'West', 'Central'];
    const data: Record<string, any>[] = [];
    for (const region of regions) {
        for (const q of ['Q1', 'Q2', 'Q3', 'Q4']) {
            data.push({
                region,
                quarter: q,
                revenue: Math.round(100000 + rand() * 900000),
            });
        }
    }

    return {
        title: 'Revenue Sequential Color',
        description:
            'Semantic type "Revenue" on the color channel triggers a financial-themed ' +
            'sequential scheme (goldgreen). Higher revenue → warmer color. ' +
            'WITHOUT this: default viridis or generic palette with no financial connotation.',
        tags: ['semantic', 'colorScheme', 'sequential', 'revenue'],
        chartType: 'Bar Chart',
        data,
        fields: [makeField('region'), makeField('quarter'), makeField('revenue')],
        metadata: {
            region:  { type: Type.String, semanticType: 'Category', levels: regions },
            quarter: { type: Type.String, semanticType: 'Quarter',  levels: ['Q1', 'Q2', 'Q3', 'Q4'] },
            revenue: { type: Type.Number, semanticType: 'Amount',  levels: [] },
        },
        encodingMap: {
            x: makeEncodingItem('region'),
            y: makeEncodingItem('revenue'),
            color: makeEncodingItem('revenue'),
        },
    };
}

// ============================================================================
// 23. Correlation — diverging color + bounded domain [-1, 1]
//     Semantic type: "Correlation" → domain [-1, 1], diverging color,
//     clamped scale, decimal format
//
//     WITHOUT this annotation:
//       Color scale auto-fits to data range (e.g., [0.12, 0.89]).
//       No diverging scheme, no fixed [-1,1] bounds, no midpoint centering.
//
//     WITH "Correlation":
//       Domain clamped to [-1, 1], diverging color with midpoint at 0,
//       decimal format (0.85 / -0.42). Full semantic context.
// ============================================================================

function genCorrelationDivergingTest(): TestCase {
    const rand = seeded(999);
    const vars = ['GDP', 'Unemployment', 'Inflation', 'Education', 'Health'];
    const data: Record<string, any>[] = [];
    for (let i = 0; i < vars.length; i++) {
        for (let j = 0; j < vars.length; j++) {
            const corr = i === j ? 1.0 : Math.round((-0.9 + rand() * 1.8) * 100) / 100;
            data.push({
                var_x: vars[i],
                var_y: vars[j],
                correlation: corr,
            });
        }
    }

    return {
        title: 'Correlation Diverging + Domain',
        description:
            'Semantic type "Correlation" on color sets a diverging scheme with ' +
            'midpoint 0 and domain [-1, 1]. Positive correlations appear in one hue, ' +
            'negative in another. Domain is fixed to the mathematical bounds. ' +
            'WITHOUT this: auto-fitted color domain, sequential palette, no midpoint.',
        tags: ['semantic', 'colorScheme', 'diverging', 'domain', 'correlation'],
        chartType: 'Heatmap',
        data,
        fields: [makeField('var_x'), makeField('var_y'), makeField('correlation')],
        metadata: {
            var_x:       { type: Type.String, semanticType: 'Category',    levels: vars },
            var_y:       { type: Type.String, semanticType: 'Category',    levels: vars },
            correlation: { type: Type.Number, semanticType: 'Correlation', levels: [] },
        },
        semanticAnnotations: {
            correlation: { semanticType: 'Correlation', intrinsicDomain: [-1, 1] },
        },
        encodingMap: {
            x: makeEncodingItem('var_x'),
            y: makeEncodingItem('var_y'),
            color: makeEncodingItem('correlation'),
        },
    };
}

// ============================================================================
// 24. Nice = false — bounded domain without nice rounding
//     Semantic type: "Score" with domain [0, 100] → nice = false
//
//     WITHOUT nice = false:
//       VL's "nice" rounding extends domain [0, 100] to [0, 120] or similar —
//       wasting space and implying scores > 100 exist.
//
//     WITH nice = false (from bounded domainShape):
//       Axis endpoints stick exactly to [0, 100]. No extension beyond the
//       intrinsic bounds of the measurement scale.
// ============================================================================

function genNiceFalseScoreTest(): TestCase {
    const rand = seeded(1010);
    const students = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve',
                      'Frank', 'Grace', 'Heidi', 'Ivan', 'Judy'];
    const data = students.map(s => ({
        student: s,
        math_score: Math.round(45 + rand() * 55),
        science_score: Math.round(30 + rand() * 70),
    }));

    return {
        title: 'Nice = false (Score [0-100])',
        description:
            'Score\'s bounded domainShape sets nice = false so VL doesn\'t ' +
            'extend the axis beyond [0, 100]. Ticks stop at the intrinsic bounds. ' +
            'WITHOUT nice = false: VL extends to [0, 120] — implying impossible scores.',
        tags: ['semantic', 'nice', 'domain', 'score', 'bounded'],
        chartType: 'Scatter Plot',
        data,
        fields: [makeField('student'), makeField('math_score'), makeField('science_score')],
        metadata: {
            student:       { type: Type.String, semanticType: 'Category', levels: students },
            math_score:    { type: Type.Number, semanticType: 'Score',    levels: [] },
            science_score: { type: Type.Number, semanticType: 'Score',    levels: [] },
        },
        semanticAnnotations: {
            math_score:    { semanticType: 'Score', intrinsicDomain: [0, 100] },
            science_score: { semanticType: 'Score', intrinsicDomain: [0, 100] },
        },
        encodingMap: {
            x: makeEncodingItem('math_score'),
            y: makeEncodingItem('science_score'),
        },
    };
}

// ============================================================================
// 25. Duration with unit suffix — additive measure, "min" suffix
//     Semantic type: "Duration" + unit: "min"  →  "42 min" on axis
//
//     Duration is an additive measure (durations sum to a total), open domain,
//     meaningful zero (0 = no time elapsed), and uses unit-suffix format.
//
//     WITHOUT this annotation:
//       Axis shows bare numbers: 42, 85. No time context.
//       Zero might not be included in axis.
//
//     WITH "Duration" + unit:
//       Axis labels show "42 min", "85 min". Zero baseline included.
// ============================================================================

function genDurationUnitSuffixTest(): TestCase {
    const rand = seeded(2501);
    const tasks = ['Setup', 'Build', 'Test', 'Review', 'Deploy',
                   'Cleanup', 'Backup', 'Sync'];
    const data = tasks.map(t => ({
        task: t,
        duration_min: Math.round(5 + rand() * 115),
    }));

    return {
        title: 'Duration Unit Suffix (min)',
        description:
            'Semantic type "Duration" with unit "min" appends " min" to axis labels. ' +
            'Duration is additive (total makes sense) with meaningful zero. ' +
            'WITHOUT this: bare numbers with no time unit context.',
        tags: ['semantic', 'format', 'unit-suffix', 'duration', 'zero'],
        chartType: 'Bar Chart',
        data,
        fields: [makeField('task'), makeField('duration_min')],
        metadata: {
            task:         { type: Type.String, semanticType: 'Category', levels: tasks },
            duration_min: { type: Type.Number, semanticType: 'Duration', levels: [] },
        },
        semanticAnnotations: {
            duration_min: { semanticType: 'Duration', unit: 'min' },
        },
        encodingMap: {
            x: makeEncodingItem('task'),
            y: makeEncodingItem('duration_min'),
        },
    };
}

// ============================================================================
// 26. Quarter canonical order + cyclic behavior
//     Semantic type: "Quarter" → ordinal sort Q1, Q2, Q3, Q4
//
//     Quarter is cyclic (Q4 wraps to Q1) and uses ordinal encoding.
//     The canonical order ensures quarters appear in fiscal sequence.
//
//     WITHOUT this annotation:
//       Quarters sorted alphabetically: Q1, Q2, Q3, Q4 happens to work
//       but only by coincidence. Real datasets with "Q4-2024", "Q1-2025"
//       would break. Also no cyclic semantics for wrap-around analysis.
//
//     WITH "Quarter":
//       Guaranteed Q1→Q2→Q3→Q4 order. Cyclic flag enables wrap-around
//       for cross-year comparisons.
// ============================================================================

function genQuarterCanonicalOrderTest(): TestCase {
    const rand = seeded(2601);
    // Deliberately shuffled quarters
    const shuffledQuarters = ['Q3', 'Q1', 'Q4', 'Q2'];
    const data: Record<string, any>[] = [];
    for (const region of ['North', 'South', 'East']) {
        for (const q of shuffledQuarters) {
            data.push({
                quarter: q,
                region,
                sales: Math.round(50000 + rand() * 200000),
            });
        }
    }

    return {
        title: 'Quarter Canonical Order (Q1→Q4)',
        description:
            'Semantic type "Quarter" sorts Q1→Q2→Q3→Q4 in canonical order ' +
            'regardless of data encounter order. Quarter is cyclic (Q4→Q1 wraps). ' +
            'WITHOUT this: alphabetical order happens to work here, but no guarantee ' +
            'for variant labels or cross-year data.',
        tags: ['semantic', 'ordering', 'quarter', 'cyclic', 'canonical'],
        chartType: 'Bar Chart',
        data,
        fields: [makeField('quarter'), makeField('region'), makeField('sales')],
        metadata: {
            quarter: { type: Type.String, semanticType: 'Quarter',  levels: shuffledQuarters },
            region:  { type: Type.String, semanticType: 'Category', levels: ['North', 'South', 'East'] },
            sales:   { type: Type.Number, semanticType: 'Amount',  levels: [] },
        },
        encodingMap: {
            x:     makeEncodingItem('quarter'),
            y:     makeEncodingItem('sales'),
            color: makeEncodingItem('region'),
        },
    };
}

// ============================================================================
// 27. Cost currency format — another currency type (additive)
//     Semantic type: "Cost" → currency prefix ($) + SI abbreviation
//
//     Cost shares formatClass='currency' with Revenue/Amount but has
//     aggRole='additive' — costs sum to a meaningful total.
//
//     WITHOUT this annotation:
//       Axis shows raw numbers: 450000, 1200000. No $ symbol.
//
//     WITH "Cost":
//       Axis labels show "$450K", "$1.2M". Currency + abbreviation.
// ============================================================================

function genCostCurrencyFormatTest(): TestCase {
    const rand = seeded(2701);
    const departments = ['Engineering', 'Marketing', 'Sales', 'Support', 'HR', 'Legal'];
    const data = departments.map(d => ({
        department: d,
        annual_cost: Math.round(200000 + rand() * 1800000),
    }));

    return {
        title: 'Cost Currency Format ($)',
        description:
            'Semantic type "Cost" with unit "USD" uses currency format ($450K, $1.2M). ' +
            'Cost is additive — department costs sum to total company cost. ' +
            'WITHOUT this: plain numbers without currency context.',
        tags: ['semantic', 'format', 'currency', 'cost'],
        chartType: 'Bar Chart',
        data,
        fields: [makeField('department'), makeField('annual_cost')],
        metadata: {
            department:  { type: Type.String, semanticType: 'Category', levels: departments },
            annual_cost: { type: Type.Number, semanticType: 'Amount',     levels: [] },
        },
        semanticAnnotations: {
            annual_cost: { semanticType: 'Amount', unit: 'USD' },
        },
        encodingMap: {
            x: makeEncodingItem('department'),
            y: makeEncodingItem('annual_cost'),
        },
    };
}

// ============================================================================
// 28. Direction compass order + cyclic
//     Semantic type: "Direction" → compass order N→NE→E→SE→S→SW→W→NW
//
//     Direction is cyclic (NW wraps to N) and uses ordinal/nominal encoding.
//     The canonical order ensures compass directions appear in clockwise order.
//
//     WITHOUT this annotation:
//       Directions sorted alphabetically: E, N, NE, NW, S, SE, SW, W.
//       Completely wrong — geographic/compass ordering is destroyed.
//
//     WITH "Direction":
//       Canonical clockwise order: N, NE, E, SE, S, SW, W, NW.
// ============================================================================

function genDirectionCompassOrderTest(): TestCase {
    const rand = seeded(2801);
    // Deliberately shuffled
    const shuffledDirs = ['SW', 'N', 'E', 'NW', 'S', 'NE', 'W', 'SE'];
    const data = shuffledDirs.map(d => ({
        direction: d,
        wind_speed: Math.round(5 + rand() * 45),
    }));

    return {
        title: 'Direction Compass Order (N→NW)',
        description:
            'Semantic type "Direction" sorts compass directions in clockwise order ' +
            '(N→NE→E→SE→S→SW→W→NW). Direction is cyclic (NW→N wraps). ' +
            'WITHOUT this: alphabetical (E, N, NE, NW...) destroys geographic sense.',
        tags: ['semantic', 'ordering', 'direction', 'cyclic', 'compass', 'canonical'],
        chartType: 'Bar Chart',
        data,
        fields: [makeField('direction'), makeField('wind_speed')],
        metadata: {
            direction:  { type: Type.String, semanticType: 'Direction', levels: shuffledDirs },
            wind_speed: { type: Type.Number, semanticType: 'Quantity',  levels: [] },
        },
        encodingMap: {
            x: makeEncodingItem('direction'),
            y: makeEncodingItem('wind_speed'),
        },
    };
}

// ============================================================================
// 29. AgeGroup — binned ordinal with inherent order
//     Semantic type: "AgeGroup" → ordinal encoding, sequential color
//
//     AgeGroup is a binned type: continuous ages discretized into ranges.
//     Values have inherent order (18-24 < 25-34 < 35-44...) unlike
//     pure nominal categories. Uses ordinal encoding.
//
//     WITHOUT this annotation:
//       Age groups treated as nominal — no guaranteed order, potentially
//       sorted alphabetically which breaks the natural sequence.
//
//     WITH "AgeGroup":
//       Ordinal encoding preserves the range order. Color uses sequential
//       scheme reflecting the ordered nature.
// ============================================================================

function genAgeGroupOrdinalTest(): TestCase {
    const rand = seeded(2901);
    const ageGroups = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'];
    const data = ageGroups.map(ag => ({
        age_group: ag,
        population: Math.round(500000 + rand() * 2000000),
        avg_income: Math.round(25000 + rand() * 75000),
    }));

    return {
        title: 'AgeGroup Binned Ordinal',
        description:
            'Semantic type "AgeGroup" is a binned ordinal — age ranges have inherent ' +
            'order (18-24 < 25-34 < ...). Uses ordinal encoding, not nominal. ' +
            'WITHOUT this: treated as unordered categories, alphabetical sorting.',
        tags: ['semantic', 'ordinal', 'binned', 'agegroup'],
        chartType: 'Bar Chart',
        data,
        fields: [makeField('age_group'), makeField('population'), makeField('avg_income')],
        metadata: {
            age_group:  { type: Type.String, semanticType: 'Range', levels: ageGroups },
            population: { type: Type.Number, semanticType: 'Count',    levels: [] },
            avg_income: { type: Type.Number, semanticType: 'Amount',   levels: [] },
        },
        semanticAnnotations: {
            age_group: { semanticType: 'Range', sortOrder: ageGroups },
        },
        encodingMap: {
            x: makeEncodingItem('age_group'),
            y: makeEncodingItem('population'),
        },
    };
}

// ============================================================================
// 30. Boolean on color — fixed domain, categorical color, 2 values
//     Semantic type: "Boolean" → nominal encoding, fixed domain
//
//     Boolean has a fixed domainShape — only 2 values exist (True/False).
//     Uses nominal encoding and categorical color scheme.
//
//     WITHOUT this annotation:
//       Treated as generic string. No indication of the fixed 2-value nature.
//
//     WITH "Boolean":
//       Fixed domain recognized. Categorical color with 2 distinct hues.
// ============================================================================

function genBooleanColorTest(): TestCase {
    const rand = seeded(3001);
    const data: Record<string, any>[] = [];
    for (let i = 0; i < 30; i++) {
        data.push({
            customer_id: `C${i + 1}`,
            purchase_amount: Math.round(20 + rand() * 480),
            is_member: rand() > 0.5 ? 'True' : 'False',
        });
    }

    return {
        title: 'Boolean Color (True/False)',
        description:
            'Semantic type "Boolean" on color uses categorical scheme with ' +
            'fixed 2-value domain. Ideal for binary classification display. ' +
            'WITHOUT this: treated as generic string, no fixed-domain awareness.',
        tags: ['semantic', 'color', 'boolean', 'categorical', 'fixed'],
        chartType: 'Scatter Plot',
        data,
        fields: [makeField('customer_id'), makeField('purchase_amount'), makeField('is_member')],
        metadata: {
            customer_id:     { type: Type.String,  semanticType: 'ID',       levels: data.map(d => d.customer_id) },
            purchase_amount: { type: Type.Number,  semanticType: 'Amount',   levels: [] },
            is_member:       { type: Type.String,  semanticType: 'Boolean',  levels: ['True', 'False'] },
        },
        encodingMap: {
            x:     makeEncodingItem('customer_id'),
            y:     makeEncodingItem('purchase_amount'),
            color: makeEncodingItem('is_member'),
        },
    };
}

// ============================================================================
// 31. Longitude — hard domain [-180, 180] with clamp
//     Semantic type: "Longitude" → scale.domain = [-180, 180], clamp = true
//
//     Mirrors the Latitude test (test 12) but for the horizontal coordinate.
//     Longitude is a fixed geographic domain — values physically cannot
//     exceed ±180°.
//
//     WITHOUT this annotation:
//       Axis auto-scales to data range. No geographic context.
//
//     WITH "Longitude":
//       Full -180 to 180 range. Clamp prevents out-of-range rendering.
// ============================================================================

function genLongitudeDomainClampTest(): TestCase {
    const cities = [
        { city: 'Tokyo',      longitude: 139.69, population_M: 13.96 },
        { city: 'Delhi',      longitude:  77.21, population_M: 32.94 },
        { city: 'London',     longitude:  -0.12, population_M:  9.00 },
        { city: 'New York',   longitude: -74.01, population_M:  8.34 },
        { city: 'São Paulo',  longitude: -46.63, population_M: 12.33 },
        { city: 'Sydney',     longitude: 151.21, population_M:  5.31 },
        { city: 'Cairo',      longitude:  31.24, population_M: 21.32 },
        { city: 'Los Angeles',longitude:-118.24, population_M:  3.90 },
    ];

    return {
        title: 'Longitude Hard Domain [-180°, 180°]',
        description:
            'Semantic type "Longitude" pins axis to [-180, 180] with clamp=true ' +
            '(hard physical domain). Shows where cities fall in global E-W context. ' +
            'WITHOUT this: axis scales to data range (-118 to 151), no global frame.',
        tags: ['semantic', 'domain', 'clamp', 'longitude', 'geographic'],
        chartType: 'Scatter Plot',
        data: cities,
        fields: [makeField('city'), makeField('longitude'), makeField('population_M')],
        metadata: {
            city:         { type: Type.String, semanticType: 'City',      levels: cities.map(c => c.city) },
            longitude:    { type: Type.Number, semanticType: 'Longitude', levels: [] },
            population_M: { type: Type.Number, semanticType: 'Count',     levels: [] },
        },
        encodingMap: {
            x: makeEncodingItem('longitude'),
            y: makeEncodingItem('population_M'),
        },
    };
}

// ============================================================================
// 32. ID — nominal unique identifier (sequence numbers, row IDs)
//     Semantic type: "ID" → nominal encoding
//
//     Previously "Index" — removed because ID already covers row/sequence
//     numbers, and quantitative index-like measures (Gini, BMI) are just Number.
//
//     WITHOUT this annotation:
//       Treated as generic number → quantitative encoding. Values
//       like 1, 2, 3 would have fractional ticks and continuous axis.
//
//     WITH "ID":
//       Nominal encoding. No aggregation. Used as a unique identifier.
// ============================================================================

function genIndexOrdinalTest(): TestCase {
    const rand = seeded(3201);
    const data = Array.from({ length: 10 }, (_, i) => ({
        trial_number: i + 1,
        response_time_ms: Math.round(200 + rand() * 800),
    }));

    return {
        title: 'ID Sequence Number',
        description:
            'Semantic type "ID" uses nominal encoding for unique identifiers. ' +
            'Covers row numbers, sequence numbers, trial IDs. ' +
            'WITHOUT this: treated as quantitative with fractional ticks.',
        tags: ['semantic', 'nominal', 'id', 'identifier'],
        chartType: 'Line Chart',
        data,
        fields: [makeField('trial_number'), makeField('response_time_ms')],
        metadata: {
            trial_number:    { type: Type.Number, semanticType: 'ID',       levels: [] },
            response_time_ms:{ type: Type.Number, semanticType: 'Duration', levels: [] },
        },
        semanticAnnotations: {
            response_time_ms: { semanticType: 'Duration', unit: 'ms' },
        },
        encodingMap: {
            x: makeEncodingItem('trial_number'),
            y: makeEncodingItem('response_time_ms'),
        },
    };
}

// ============================================================================
// 33. Percentage 0-100 representation (whole numbers)
//     Semantic type: "Percentage" with whole-number data (40, 85, 72)
//
//     The format resolver detects 0-100 vs 0-1 representation.
//     For 0-100: uses data precision format + "%" suffix (not d3's .% which
//     multiplies by 100).
//
//     WITHOUT this:
//       Values 72, 85, 40 shown as plain numbers. No % context.
//
//     WITH "Percentage" (0-100):
//       Axis shows "72%", "85%", "40%". Data precision preserved.
// ============================================================================

function genPercentageWholeNumberTest(): TestCase {
    const rand = seeded(3301);
    const subjects = ['Math', 'Science', 'English', 'History', 'Art', 'PE'];
    const data = subjects.map(s => ({
        subject: s,
        pass_rate: Math.round(45 + rand() * 50),
    }));

    return {
        title: 'Percentage Whole-Number (0-100)',
        description:
            'Percentage field with whole-number data (45, 72, 85). Format resolver ' +
            'detects 0-100 representation and uses "d" + "%" suffix instead of ' +
            'd3\'s .% format (which would multiply by 100, showing "7200%"). ' +
            'WITHOUT this: bare numbers without %. Different from 0-1 test (#2).',
        tags: ['semantic', 'format', 'percentage', 'whole-number'],
        chartType: 'Bar Chart',
        data,
        fields: [makeField('subject'), makeField('pass_rate')],
        metadata: {
            subject:   { type: Type.String, semanticType: 'Category',   levels: subjects },
            pass_rate: { type: Type.Number, semanticType: 'Percentage', levels: [] },
        },
        semanticAnnotations: {
            pass_rate: { semanticType: 'Percentage', intrinsicDomain: [0, 100] },
        },
        encodingMap: {
            x: makeEncodingItem('subject'),
            y: makeEncodingItem('pass_rate'),
        },
    };
}

// ============================================================================
// 34. Score on color channel — conditional diverging
//     Semantic type: "Score" on color → diverging color when data spans
//     both sides of the domain midpoint
//
//     Score with domain [0, 100] has a midpoint at 50. When data spans
//     both below and above 50, the color scheme should be diverging
//     (e.g., below-50 = red, above-50 = blue).
//
//     WITHOUT this:
//       Generic sequential palette. No midpoint awareness.
//
//     WITH "Score" on color:
//       Diverging color scheme centered on midpoint 50.
// ============================================================================

function genScoreColorDivergingTest(): TestCase {
    const rand = seeded(3401);
    const students = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve',
                      'Frank', 'Grace', 'Heidi', 'Ivan', 'Judy',
                      'Karl', 'Laura'];
    const data = students.map(s => ({
        student: s,
        exam_score: Math.round(20 + rand() * 75),
        study_hours: Math.round(1 + rand() * 30),
    }));

    return {
        title: 'Score on Color (Conditional Diverging)',
        description:
            'Score with intrinsicDomain [0, 100] on color. Domain midpoint = 50. ' +
            'Data spans both sides → diverging color scheme centered at 50. ' +
            'Below-50 = one hue, above-50 = another. ' +
            'WITHOUT this: sequential palette, no midpoint.',
        tags: ['semantic', 'colorScheme', 'diverging', 'score', 'conditional'],
        chartType: 'Scatter Plot',
        data,
        fields: [makeField('student'), makeField('exam_score'), makeField('study_hours')],
        metadata: {
            student:    { type: Type.String, semanticType: 'Category', levels: students },
            exam_score: { type: Type.Number, semanticType: 'Score',    levels: [] },
            study_hours:{ type: Type.Number, semanticType: 'Quantity', levels: [] },
        },
        semanticAnnotations: {
            exam_score: { semanticType: 'Score', intrinsicDomain: [0, 100] },
        },
        encodingMap: {
            x:     makeEncodingItem('study_hours'),
            y:     makeEncodingItem('student'),
            color: makeEncodingItem('exam_score'),
        },
    };
}

// ============================================================================
// 35. Price with EUR currency override
//     Semantic type: "Price" + unit: "EUR"  →  "€15.50" on axis
//
//     Annotation.unit overrides the default $ prefix for currency types.
//     Price also uses intensive aggRole (unit price averages, doesn't sum)
//     and always shows 2 decimal places for cents.
//
//     WITHOUT this:
//       Default $ prefix. Or bare numbers with no currency.
//
//     WITH "Price" + unit: "EUR":
//       Axis labels show "€15.50". Euro prefix from CURRENCY_MAP.
// ============================================================================

function genPriceEurCurrencyTest(): TestCase {
    const rand = seeded(3501);
    const products = ['Espresso', 'Latte', 'Cappuccino', 'Mocha', 'Americano',
                      'Macchiato', 'Flat White', 'Cortado'];
    const data = products.map(p => ({
        drink: p,
        price_eur: Math.round((2.50 + rand() * 5.50) * 100) / 100,
        daily_sales: Math.round(20 + rand() * 180),
    }));

    return {
        title: 'Price with EUR Currency Override',
        description:
            'Annotation unit "EUR" provides an explicit currency symbol, showing "€3.50" on axis. ' +
            'Price is intensive (average makes sense, sum doesn\'t) with 2 decimal ' +
            'places for cents. ' +
            'WITHOUT this: bare numbers with no currency symbol.',
        tags: ['semantic', 'format', 'currency', 'price', 'unit-override'],
        chartType: 'Bar Chart',
        data,
        fields: [makeField('drink'), makeField('price_eur'), makeField('daily_sales')],
        metadata: {
            drink:       { type: Type.String, semanticType: 'Category', levels: products },
            price_eur:   { type: Type.Number, semanticType: 'Price',    levels: [] },
            daily_sales: { type: Type.Number, semanticType: 'Count',    levels: [] },
        },
        semanticAnnotations: {
            price_eur: { semanticType: 'Price', unit: 'EUR' },
        },
        encodingMap: {
            x: makeEncodingItem('drink'),
            y: makeEncodingItem('price_eur'),
        },
    };
}

// ============================================================================
// 36. Year temporal vs ordinal disambiguation
//     Semantic type: "Year" with few values (≤6) → ordinal
//     Semantic type: "Year" with many values (>6) → temporal
//
//     Year's registry entry has visEncodings: ['temporal', 'ordinal'].
//     resolveDefaultVisType disambiguates using distinct count:
//       ≤6 distinct → ordinal (e.g., 3 years: 2022, 2023, 2024)
//       >6 distinct → temporal (e.g., 20 years trend)
//
//     This test uses 4 years → should pick ordinal.
//     Contrast with test #20 (Year format) which uses 7 years → temporal.
// ============================================================================

function genYearOrdinalDisambiguationTest(): TestCase {
    const rand = seeded(3601);
    const years = [2021, 2022, 2023, 2024];
    const data: Record<string, any>[] = [];
    for (const y of years) {
        for (const region of ['North', 'South']) {
            data.push({
                year: y,
                region,
                revenue: Math.round(500000 + rand() * 1500000),
            });
        }
    }

    return {
        title: 'Year Ordinal (≤6 Distinct Values)',
        description:
            'Year with only 4 distinct values → ordinal encoding (not temporal). ' +
            'resolveDefaultVisType picks ordinal when distinct ≤ 6. ' +
            'Contrast with test #20 which uses 7 years → temporal. ' +
            'WITHOUT disambiguation: always temporal, wasting axis resolution on 4 points.',
        tags: ['semantic', 'defaultVisType', 'year', 'ordinal', 'disambiguation'],
        chartType: 'Bar Chart',
        data,
        fields: [makeField('year'), makeField('region'), makeField('revenue')],
        metadata: {
            year:    { type: Type.Number, semanticType: 'Year',     levels: years },
            region:  { type: Type.String, semanticType: 'Category', levels: ['North', 'South'] },
            revenue: { type: Type.Number, semanticType: 'Amount',  levels: [] },
        },
        encodingMap: {
            x:     makeEncodingItem('year'),
            y:     makeEncodingItem('revenue'),
            color: makeEncodingItem('region'),
        },
    };
}

// ============================================================================
// 37. Profit on color — signed currency diverging color
//     Semantic type: "Profit" on color → diverging color scheme
//     centered at 0, decimal format
//
//     When Profit is on the color channel instead of axis, the diverging
//     analysis applies to color: positive = one hue, negative = another,
//     midpoint at 0.
//
//     WITHOUT this:
//       Sequential palette for color. No sign awareness. Losses and gains
//       blend into the same gradient.
//
//     WITH "Profit" on color:
//       Diverging scheme with domainMid = 0. (+) green, (-) red conceptually.
// ============================================================================

function genProfitColorDivergingTest(): TestCase {
    const rand = seeded(3701);
    const divisions = ['Product A', 'Product B', 'Product C', 'Product D',
                       'Product E', 'Product F'];
    const data = divisions.map(d => ({
        product: d,
        revenue: Math.round(100000 + rand() * 500000),
        profit: Math.round(-80000 + rand() * 220000),
    }));

    return {
        title: 'Profit on Color (Diverging)',
        description:
            'Profit on color channel triggers diverging color scheme (midpoint 0). ' +
            'Positive profit → one hue, negative → another, making P&L obvious. ' +
            'WITHOUT this: sequential gradient, losses and gains look alike.',
        tags: ['semantic', 'colorScheme', 'diverging', 'profit', 'decimal'],
        chartType: 'Bar Chart',
        data,
        fields: [makeField('product'), makeField('revenue'), makeField('profit')],
        metadata: {
            product: { type: Type.String, semanticType: 'Category', levels: divisions },
            revenue: { type: Type.Number, semanticType: 'Amount',  levels: [] },
            profit:  { type: Type.Number, semanticType: 'Profit',   levels: [] },
        },
        encodingMap: {
            x:     makeEncodingItem('product'),
            y:     makeEncodingItem('revenue'),
            color: makeEncodingItem('profit'),
        },
    };
}

// ============================================================================
// 38. Count integer format — comma grouping
//     Semantic type: "Count" → integer format with comma grouping (,d)
//
//     Count uses format class 'integer' → ",d" format for axis labels.
//     This ensures tick marks are at whole numbers (no fractional counts)
//     and large counts show thousands separators (1,234 not 1234).
//
//     Also tests aggregationDefault = 'sum' (additive measure — counts
//     of subgroups sum to the total).
//
//     WITHOUT this:
//       Generic number format. Fractional ticks possible (1.5 items?).
//       No comma grouping on large values.
//
//     WITH "Count":
//       Integer-only ticks with comma grouping. Meaningful zero.
// ============================================================================

function genCountIntegerFormatTest(): TestCase {
    const rand = seeded(3801);
    const categories = ['Electronics', 'Clothing', 'Food', 'Books', 'Toys', 'Sports'];
    const data = categories.map(c => ({
        category: c,
        item_count: Math.round(500 + rand() * 9500),
    }));

    return {
        title: 'Count Integer Format (,d)',
        description:
            'Semantic type "Count" uses integer format ",d" — comma grouping ' +
            'with integer-only ticks (no fractional counts). Count is additive: ' +
            'sub-counts sum to total. ' +
            'WITHOUT this: fractional ticks (1,500.5?) and no commas.',
        tags: ['semantic', 'format', 'integer', 'count', 'aggregation'],
        chartType: 'Bar Chart',
        data,
        fields: [makeField('category'), makeField('item_count')],
        metadata: {
            category:   { type: Type.String, semanticType: 'Category', levels: categories },
            item_count: { type: Type.Number, semanticType: 'Count',    levels: [] },
        },
        encodingMap: {
            x: makeEncodingItem('category'),
            y: makeEncodingItem('item_count'),
        },
    };
}

// ============================================================================
// 39. Unregistered semantic type — fallback to data-driven behavior
//     Semantic type: "CustomMetric" (not in registry)
//
//     When a semantic type is not registered, the system falls back to
//     data-driven inference: if values are numeric → quantitative encoding,
//     aggregationDefault = 'sum', zeroClass = 'meaningful'.
//
//     This tests that unregistered types don't crash and behave sensibly.
//
//     WITHOUT this (before fallback was added):
//       Unknown types → nominal encoding even for numeric data.
//
//     WITH fallback:
//       Numeric data → quantitative, sensible defaults applied.
// ============================================================================

function genUnregisteredTypeFallbackTest(): TestCase {
    const rand = seeded(3901);
    const items = ['Item A', 'Item B', 'Item C', 'Item D', 'Item E', 'Item F'];
    const data = items.map(item => ({
        item,
        custom_metric: Math.round(100 + rand() * 900),
    }));

    return {
        title: 'Unregistered Type Fallback',
        description:
            'Semantic type "CustomMetric" is NOT in the registry. Falls back to ' +
            'data-driven inference: numeric data → quantitative encoding, ' +
            'aggregationDefault = sum, zeroClass = meaningful. ' +
            'Tests that unknown types don\'t crash and behave sensibly.',
        tags: ['semantic', 'fallback', 'unregistered', 'data-driven'],
        chartType: 'Bar Chart',
        data,
        fields: [makeField('item'), makeField('custom_metric')],
        metadata: {
            item:          { type: Type.String, semanticType: 'Category',     levels: items },
            custom_metric: { type: Type.Number, semanticType: 'CustomMetric', levels: [] },
        },
        encodingMap: {
            x: makeEncodingItem('item'),
            y: makeEncodingItem('custom_metric'),
        },
    };
}

// ############################################################################
// SNAP-TO-BOUND TESTS
//
// Demonstrate the snap-to-bound heuristic for Percentage and PercentageChange.
// Each bound snaps independently when data reaches within 25% of the
// intrinsic range from that edge. Data exceeding a bound never snaps.
// ############################################################################

// ============================================================================
// S1. Percentage — data far from both bounds → no snap
//     Data 35–65%, threshold=25. Neither end close → axis data-fits.
// ============================================================================

function genSnapPctNoSnapTest(): TestCase {
    const rand = seeded(7001);
    const weeks = Array.from({ length: 8 }, (_, i) => `Week ${i + 1}`);
    const data = weeks.map(w => ({
        week: w,
        usage: Math.round(35 + rand() * 30),
    }));

    return {
        title: 'Snap: Pct 35–65% → no snap',
        description:
            'Usage data ranges 35–65%. Both ends are far from 0 and 100 ' +
            '(threshold = 25% of range = 25), so no snap occurs. ' +
            'Axis data-fits to show detail in the 35–65% band.',
        tags: ['semantic', 'snap', 'percentage', 'no-snap'],
        chartType: 'Line Chart',
        data,
        fields: [makeField('week'), makeField('usage')],
        metadata: {
            week:  { type: Type.String, semanticType: 'Category',   levels: weeks },
            usage: { type: Type.Number, semanticType: 'Percentage', levels: [] },
        },
        semanticAnnotations: {
            usage: { semanticType: 'Percentage', intrinsicDomain: [0, 100] },
        },
        encodingMap: {
            x: makeEncodingItem('week'),
            y: makeEncodingItem('usage'),
        },
    };
}

// ============================================================================
// S2. Percentage — data near upper bound only → snap max to 100
//     Data 60–97%, 97 within threshold of 100 → domainMax=100.
//     Lower end (60) far from 0 → no snap min.
// ============================================================================

function genSnapPctMaxOnlyTest(): TestCase {
    const rand = seeded(7002);
    const depts = ['Engineering', 'Marketing', 'Sales', 'Support', 'Design', 'Legal'];
    const data = depts.map(d => ({
        dept: d,
        completion: Math.round(60 + rand() * 37),
    }));

    return {
        title: 'Snap: Pct 84–96% → snap max 100',
        description:
            'Completion data reaches 96%. Since 96 is within 25 (threshold = 25% of 100) ' +
            'of 100, the upper bound snaps to 100%. Lower end (84%) is far from 0 → ' +
            'no snap. Shows domainMax=100 while the lower end auto-fits.',
        tags: ['semantic', 'snap', 'percentage', 'snap-max'],
        chartType: 'Bar Chart',
        data,
        fields: [makeField('dept'), makeField('completion')],
        metadata: {
            dept:       { type: Type.String, semanticType: 'Category',   levels: depts },
            completion: { type: Type.Number, semanticType: 'Percentage', levels: [] },
        },
        semanticAnnotations: {
            completion: { semanticType: 'Percentage', intrinsicDomain: [0, 100] },
        },
        encodingMap: {
            x: makeEncodingItem('dept'),
            y: makeEncodingItem('completion'),
        },
    };
}

// ============================================================================
// S3. Percentage — data near lower bound only → snap min to 0
//     Data 2–25%, 2 within threshold of 0 → domainMin=0.
//     Upper end (25) far from 100 → no snap max.
// ============================================================================

function genSnapPctMinOnlyTest(): TestCase {
    const rand = seeded(7003);
    const items = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const data = items.map(item => ({
        item,
        error_rate: Math.round(2 + rand() * 23),
    }));

    return {
        title: 'Snap: Pct 4–20% → snap min 0',
        description:
            'Error rates range 4–20%. Since 4 is within 25 (threshold = 25% of 100) ' +
            'of 0, the lower bound snaps to 0%. Upper end (20%) is far from 100 → ' +
            'no snap. Shows domainMin=0 while the upper end auto-fits.',
        tags: ['semantic', 'snap', 'percentage', 'snap-min'],
        chartType: 'Bar Chart',
        data,
        fields: [makeField('item'), makeField('error_rate')],
        metadata: {
            item:       { type: Type.String, semanticType: 'Category',   levels: items },
            error_rate: { type: Type.Number, semanticType: 'Percentage', levels: [] },
        },
        semanticAnnotations: {
            error_rate: { semanticType: 'Percentage', intrinsicDomain: [0, 100] },
        },
        encodingMap: {
            x: makeEncodingItem('item'),
            y: makeEncodingItem('error_rate'),
        },
    };
}

// ============================================================================
// S4. Percentage — data near both bounds → snap both [0, 100]
//     Data 3–95%, both ends close → full [0, 100] domain.
// ============================================================================

function genSnapPctBothTest(): TestCase {
    const rand = seeded(7004);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const data = months.map((m, i) => ({
        month: m,
        capacity: Math.round(3 + (i / 11) * 87 + rand() * 5),
    }));

    return {
        title: 'Snap: Pct 3–95% → snap both [0,100]',
        description:
            'Capacity ranges 3–95%. Both 3 (within 25 of 0) and 95 (within 25 of 100) ' +
            'trigger snap, producing the full [0, 100] domain. Natural for data that ' +
            'spans nearly the entire percentage range.',
        tags: ['semantic', 'snap', 'percentage', 'snap-both'],
        chartType: 'Line Chart',
        data,
        fields: [makeField('month'), makeField('capacity')],
        metadata: {
            month:    { type: Type.String, semanticType: 'Month',      levels: months },
            capacity: { type: Type.Number, semanticType: 'Percentage', levels: [] },
        },
        semanticAnnotations: {
            capacity: { semanticType: 'Percentage', intrinsicDomain: [0, 100] },
        },
        encodingMap: {
            x: makeEncodingItem('month'),
            y: makeEncodingItem('capacity'),
        },
    };
}

// ============================================================================
// S5. Percentage — data exceeds upper bound → no snap
//     Data 30–130%, 130 exceeds 100 → no snap on either end.
//     (30 is also far from 0.)
// ============================================================================

function genSnapPctExceedTest(): TestCase {
    const rand = seeded(7005);
    const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
    const data = quarters.map(q => ({
        quarter: q,
        growth: Math.round(30 + rand() * 100),
    }));

    return {
        title: 'Snap: Pct 30–130% → no snap (exceeds)',
        description:
            'Growth data ranges 30–130%. The max (130) exceeds the intrinsic upper ' +
            'bound (100), so no snap — VL auto-extends. The min (30) is also far from 0. ' +
            'Axis data-fits to the actual data range.',
        tags: ['semantic', 'snap', 'percentage', 'exceed'],
        chartType: 'Bar Chart',
        data,
        fields: [makeField('quarter'), makeField('growth')],
        metadata: {
            quarter: { type: Type.String, semanticType: 'Category',   levels: quarters },
            growth:  { type: Type.Number, semanticType: 'Percentage', levels: [] },
        },
        semanticAnnotations: {
            growth: { semanticType: 'Percentage', intrinsicDomain: [0, 100] },
        },
        encodingMap: {
            x: makeEncodingItem('quarter'),
            y: makeEncodingItem('growth'),
        },
    };
}

// ============================================================================
// S6. PercentageChange — small range near zero → no snap
//     Data -3% to +5%, both far from ±100% → axis data-fits.
// ============================================================================

function genSnapPctChangeNoSnapTest(): TestCase {
    const rand = seeded(7006);
    const stocks = ['AAPL', 'GOOG', 'MSFT', 'AMZN', 'META', 'NVDA', 'TSLA'];
    const data = stocks.map(s => ({
        stock: s,
        daily_change: Math.round((-0.03 + rand() * 0.08) * 1000) / 1000,
    }));

    return {
        title: 'Snap: PctChange ±3–5% → no snap',
        description:
            'Daily stock changes range -3% to +5%. Both ends are far from ±1 ' +
            '(threshold = 0.25 per side), so no snap. Axis data-fits around the small range. ' +
            'Contextual zero-baseline still includes 0 for bar marks.',
        tags: ['semantic', 'snap', 'percentage-change', 'no-snap'],
        chartType: 'Bar Chart',
        data,
        fields: [makeField('stock'), makeField('daily_change')],
        metadata: {
            stock:        { type: Type.String, semanticType: 'Category',         levels: stocks },
            daily_change: { type: Type.Number, semanticType: 'PercentageChange', levels: [] },
        },
        semanticAnnotations: {
            daily_change: { semanticType: 'PercentageChange', intrinsicDomain: [-1, 1] },
        },
        encodingMap: {
            x: makeEncodingItem('stock'),
            y: makeEncodingItem('daily_change'),
        },
    };
}

// ============================================================================
// S7. PercentageChange — near negative bound → snap min to -1
//     Data -0.96 to +0.25, -0.96 within 0.25 (25% of 1) of -1 → snap min=-1.
// ============================================================================

function genSnapPctChangeMinTest(): TestCase {
    const data = [
        { sector: 'Tech',       ytd_return: -0.96 },
        { sector: 'Energy',     ytd_return: -0.42 },
        { sector: 'Finance',    ytd_return: -0.71 },
        { sector: 'Healthcare', ytd_return:  0.25 },
        { sector: 'Retail',     ytd_return: -0.55 },
        { sector: 'Telecom',    ytd_return: -0.83 },
    ];
    const sectors = data.map(d => d.sector);

    return {
        title: 'Snap: PctChange -96% to +25% → snap min -100%',
        description:
            'Sector returns range -96% to +25%. The min (-0.96) is within 0.25 (threshold = ' +
            '25% of distance 1 from zero to -1) of -1, so the lower bound snaps to -100%. ' +
            'Upper end (+25%) is far from +100% → no snap. Shows domainMin=-1 with ' +
            'auto-fit upper end.',
        tags: ['semantic', 'snap', 'percentage-change', 'snap-min'],
        chartType: 'Bar Chart',
        data,
        fields: [makeField('sector'), makeField('ytd_return')],
        metadata: {
            sector:     { type: Type.String, semanticType: 'Category',         levels: sectors },
            ytd_return: { type: Type.Number, semanticType: 'PercentageChange', levels: [] },
        },
        semanticAnnotations: {
            ytd_return: { semanticType: 'PercentageChange', intrinsicDomain: [-1, 1] },
        },
        encodingMap: {
            x: makeEncodingItem('sector'),
            y: makeEncodingItem('ytd_return'),
        },
    };
}

// ============================================================================
// S8. PercentageChange — near both bounds → snap both [-1, 1]
//     Data -0.95 to +0.93, both within 0.25 (25% of per-side distance 1) → full [-1, 1].
// ============================================================================

function genSnapPctChangeBothTest(): TestCase {
    const data = [
        { strategy: 'Strategy A', performance: -0.95 },
        { strategy: 'Strategy B', performance: -0.30 },
        { strategy: 'Strategy C', performance:  0.15 },
        { strategy: 'Strategy D', performance: -0.60 },
        { strategy: 'Strategy E', performance:  0.48 },
        { strategy: 'Strategy F', performance:  0.93 },
    ];
    const strategies = data.map(d => d.strategy);

    return {
        title: 'Snap: PctChange ±95–93% → snap both [-1,1]',
        description:
            'Strategy performance ranges -95% to +93%. Both -0.95 (within 0.25 of -1) ' +
            'and +0.93 (within 0.25 of +1) trigger snap (threshold = 25% of each side\'s ' +
            'distance from zero = 0.25), producing the full [-1, 1] domain.',
        tags: ['semantic', 'snap', 'percentage-change', 'snap-both'],
        chartType: 'Bar Chart',
        data,
        fields: [makeField('strategy'), makeField('performance')],
        metadata: {
            strategy:    { type: Type.String, semanticType: 'Category',         levels: strategies },
            performance: { type: Type.Number, semanticType: 'PercentageChange', levels: [] },
        },
        semanticAnnotations: {
            performance: { semanticType: 'PercentageChange', intrinsicDomain: [-1, 1] },
        },
        encodingMap: {
            x: makeEncodingItem('strategy'),
            y: makeEncodingItem('performance'),
        },
    };
}

// ============================================================================
// S9. Stacked bar — percentages sum to ~100% per group → keep snap
//     Individual values 30–40%, each group has 3 series summing to ~98%.
//     Individual values are far from 100% (no individual snap), but the stacked
//     totals (~98%) are within 25% of 100 → re-snap fires domainMax=100.
// ============================================================================

function genSnapStackedSumNear100Test(): TestCase {
    const categories = ['Alpha', 'Beta', 'Gamma', 'Delta'];
    const series = ['Part A', 'Part B', 'Part C'];
    // Each group's parts sum to ~97–99%
    const groupTotals: Record<string, number[]> = {
        'Alpha': [35, 30, 33],   // sum = 98
        'Beta':  [40, 28, 30],   // sum = 98
        'Gamma': [32, 35, 30],   // sum = 97
        'Delta': [38, 27, 34],   // sum = 99
    };

    const data: Record<string, any>[] = [];
    for (const cat of categories) {
        const parts = groupTotals[cat];
        series.forEach((s, i) => {
            data.push({ category: cat, series: s, share: parts[i] });
        });
    }

    return {
        title: 'Snap: Stacked Pct sum≈100% → snap max 100',
        description:
            'Stacked bar with 3 series per group. Individual values range 27–40% (far from 100, ' +
            'no individual snap), but stacked totals per group are 97–99%. Since 99 is within ' +
            '25 (threshold) of 100, the stacked-total re-snap fires → domainMax=100. ' +
            'This keeps the axis at a natural percentage ceiling.',
        tags: ['semantic', 'snap', 'percentage', 'stacked', 'sum-near-bound'],
        chartType: 'Stacked Bar Chart',
        data,
        fields: [makeField('category'), makeField('share'), makeField('series')],
        metadata: {
            category: { type: Type.String, semanticType: 'Category',   levels: categories },
            series:   { type: Type.String, semanticType: 'Category',   levels: series },
            share:    { type: Type.Number, semanticType: 'Percentage', levels: [] },
        },
        semanticAnnotations: {
            share: { semanticType: 'Percentage', intrinsicDomain: [0, 100] },
        },
        encodingMap: {
            x: makeEncodingItem('category'),
            y: makeEncodingItem('share'),
            color: makeEncodingItem('series'),
        },
    };
}

// ============================================================================
// S10. Stacked bar — percentages sum to ~150% per group → skip snap
//      Individual values 30–60%, but 3 series stack to ~150%.
//      Totals exceed intrinsic upper bound (100) → skip domain constraint.
// ============================================================================

function genSnapStackedSumExceedsTest(): TestCase {
    const categories = ['East', 'West', 'North', 'South'];
    const series = ['Source X', 'Source Y', 'Source Z'];
    // Each group's parts sum to ~140–160%
    const groupTotals: Record<string, number[]> = {
        'East':  [55, 48, 42],   // sum = 145
        'West':  [60, 50, 45],   // sum = 155
        'North': [45, 52, 43],   // sum = 140
        'South': [58, 55, 47],   // sum = 160
    };

    const data: Record<string, any>[] = [];
    for (const cat of categories) {
        const parts = groupTotals[cat];
        series.forEach((s, i) => {
            data.push({ region: cat, source: s, overlap_pct: parts[i] });
        });
    }

    return {
        title: 'Snap: Stacked Pct sum≈150% → no snap (exceeds)',
        description:
            'Stacked bar with 3 overlapping percentage sources per region. Individual values ' +
            'range 42–60%, but stacked totals are 140–160% — exceeding the intrinsic upper ' +
            'bound of 100%. Domain constraint is skipped so VL auto-extends the axis.',
        tags: ['semantic', 'snap', 'percentage', 'stacked', 'sum-exceeds'],
        chartType: 'Stacked Bar Chart',
        data,
        fields: [makeField('region'), makeField('overlap_pct'), makeField('source')],
        metadata: {
            region:      { type: Type.String, semanticType: 'Category',   levels: categories },
            source:      { type: Type.String, semanticType: 'Category',   levels: series },
            overlap_pct: { type: Type.Number, semanticType: 'Percentage', levels: [] },
        },
        semanticAnnotations: {
            overlap_pct: { semanticType: 'Percentage', intrinsicDomain: [0, 100] },
        },
        encodingMap: {
            x: makeEncodingItem('region'),
            y: makeEncodingItem('overlap_pct'),
            color: makeEncodingItem('source'),
        },
    };
}

// ============================================================================
// S11. Stacked bar — individual values snap, totals fit → keep snap
//      Individual values 80–95% (near 100, snap fires individually).
//      Stacked totals ~270% exceed 100, but the individual snap already
//      fired — this test verifies the stacked-total check correctly
//      overrides it: totals 270% > 100 → skip domain constraint.
// ============================================================================

function genSnapStackedIndividualSnapButTotalsExceedTest(): TestCase {
    const categories = ['Jan', 'Feb', 'Mar', 'Apr'];
    const series = ['Metric 1', 'Metric 2', 'Metric 3'];
    // Individual values 80–95% (all snap individually), but sum ~270%
    const groupTotals: Record<string, number[]> = {
        'Jan': [92, 88, 85],   // sum = 265
        'Feb': [95, 90, 87],   // sum = 272
        'Mar': [91, 93, 84],   // sum = 268
        'Apr': [94, 89, 91],   // sum = 274
    };

    const data: Record<string, any>[] = [];
    for (const cat of categories) {
        const parts = groupTotals[cat];
        series.forEach((s, i) => {
            data.push({ month: cat, metric: s, score: parts[i] });
        });
    }

    return {
        title: 'Snap: Stacked Pct indiv snap but sum>100% → skip',
        description:
            'Individual scores range 84–95% — close to 100%, so snap fires on individual ' +
            'values. But when stacked (3 metrics per month), totals reach 265–274%. Since ' +
            'totals exceed intrinsic bound (100), the stacked-total check overrides → ' +
            'domain constraint is skipped, VL auto-extends.',
        tags: ['semantic', 'snap', 'percentage', 'stacked', 'individual-snap-override'],
        chartType: 'Stacked Bar Chart',
        data,
        fields: [makeField('month'), makeField('score'), makeField('metric')],
        metadata: {
            month:  { type: Type.String, semanticType: 'Category',   levels: categories },
            metric: { type: Type.String, semanticType: 'Category',   levels: series },
            score:  { type: Type.Number, semanticType: 'Percentage', levels: [] },
        },
        semanticAnnotations: {
            score: { semanticType: 'Percentage', intrinsicDomain: [0, 100] },
        },
        encodingMap: {
            x: makeEncodingItem('month'),
            y: makeEncodingItem('score'),
            color: makeEncodingItem('metric'),
        },
    };
}

// ============================================================================
// S12. Stacked bar — individual values 30–50%, totals far from 100% → no snap
//      Individual values are mid-range (no individual snap).
//      Stacked totals ~58–70%, also far from 100% → no re-snap either.
//      Axis should data-fit.
// ============================================================================

function genSnapStackedTotalsFarFromBoundTest(): TestCase {
    const categories = ['Q1', 'Q2', 'Q3', 'Q4'];
    const series = ['Channel A', 'Channel B'];
    // Each group sums to ~58–70%
    const groupTotals: Record<string, number[]> = {
        'Q1': [30, 28],   // sum = 58
        'Q2': [35, 30],   // sum = 65
        'Q3': [28, 32],   // sum = 60
        'Q4': [38, 32],   // sum = 70
    };

    const data: Record<string, any>[] = [];
    for (const cat of categories) {
        const parts = groupTotals[cat];
        series.forEach((s, i) => {
            data.push({ quarter: cat, channel: s, coverage: parts[i] });
        });
    }

    return {
        title: 'Snap: Stacked Pct sum≈58–70% → no snap',
        description:
            'Stacked bar with 2 series per quarter. Individual values range 28–38% ' +
            '(far from 100%, no individual snap). Stacked totals are 58–70% — also ' +
            'far from 100% (threshold = 25). No snap fires on either individual values ' +
            'or stacked totals. Axis data-fits.',
        tags: ['semantic', 'snap', 'percentage', 'stacked', 'no-snap'],
        chartType: 'Stacked Bar Chart',
        data,
        fields: [makeField('quarter'), makeField('coverage'), makeField('channel')],
        metadata: {
            quarter:  { type: Type.String, semanticType: 'Category',   levels: categories },
            channel:  { type: Type.String, semanticType: 'Category',   levels: series },
            coverage: { type: Type.Number, semanticType: 'Percentage', levels: [] },
        },
        semanticAnnotations: {
            coverage: { semanticType: 'Percentage', intrinsicDomain: [0, 100] },
        },
        encodingMap: {
            x: makeEncodingItem('quarter'),
            y: makeEncodingItem('coverage'),
            color: makeEncodingItem('channel'),
        },
    };
}

/**
 * Generate all snap-to-bound test cases.
 *
 * Demonstrates the snap-to-bound heuristic for Percentage [0,100]
 * and PercentageChange [-1,1]. Each bound snaps independently when
 * data reaches within 25% of the effective side range from that edge.
 * For zero-straddling domains (lo < 0 < hi), each side's threshold is
 * computed relative to its distance from zero, not the full range.
 */
export function genSnapToBoundTests(): TestCase[] {
    return [
        genSnapPctNoSnapTest(),
        genSnapPctMaxOnlyTest(),
        genSnapPctMinOnlyTest(),
        genSnapPctBothTest(),
        genSnapPctExceedTest(),
        genSnapPctChangeNoSnapTest(),
        genSnapPctChangeMinTest(),
        genSnapPctChangeBothTest(),
        genSnapStackedSumNear100Test(),
        genSnapStackedSumExceedsTest(),
        genSnapStackedIndividualSnapButTotalsExceedTest(),
        genSnapStackedTotalsFarFromBoundTest(),
    ];
}

// ############################################################################
// SEMANTIC TYPE FALLBACK TESTS
//
// Demonstrate that the compiler handles wrong or overly generic semantic type
// annotations gracefully. Each test uses data that is identical (or similar)
// to a normal gallery example but deliberately assigns incorrect or
// "Unknown" semantic types. The compiler should fall back via the type
// hierarchy and produce a sensible chart from physical data characteristics.
// ############################################################################

// ============================================================================
// F1. Grouped Bar — revenue labeled as "Count"
//     Revenue should be "Amount" (gets $ prefix, sum aggregation). Labeled
//     as "Count" instead — a plausible mistake since both are numeric measures.
//     Loses currency formatting; gets integer formatting instead.
// ============================================================================

function genFallbackGroupedBarCountForRevenueTest(): TestCase {
    const rand = seeded(8001);
    const cities = ['Seattle', 'Austin', 'Boston', 'Denver', 'Miami'];
    const segments = ['Online', 'Retail', 'Wholesale'];
    const data: Record<string, any>[] = [];
    for (const city of cities) {
        for (const seg of segments) {
            data.push({ city, segment: seg, revenue: Math.round(100000 + rand() * 900000) });
        }
    }

    return {
        title: 'Fallback: Grouped Bar — Count for Revenue',
        description:
            'Revenue should be "Amount" (currency prefix $, SI abbreviation) but is ' +
            'labeled "Count" — a common near-miss since both are numeric measures. ' +
            'The compiler accepts "Count" (it is a valid numeric type) but applies ' +
            'integer formatting instead of currency formatting. Compare with the ' +
            'Revenue Formatting test to see what "Amount" adds.',
        tags: ['semantic', 'fallback', 'near-miss', 'grouped-bar', 'currency'],
        chartType: 'Grouped Bar Chart',
        data,
        fields: [makeField('city'), makeField('segment'), makeField('revenue')],
        metadata: {
            city:    { type: Type.String, semanticType: 'City',     levels: cities },
            segment: { type: Type.String, semanticType: 'Category', levels: segments },
            revenue: { type: Type.Number, semanticType: 'Count',    levels: [] },
        },
        encodingMap: {
            x:     makeEncodingItem('city'),
            y:     makeEncodingItem('revenue'),
            group: makeEncodingItem('segment'),
        },
    };
}

// ============================================================================
// F2. Grouped Bar — quarters labeled as "Month"
//     Quarters ("Q1"–"Q4") should be "Quarter" but labeled "Month" instead.
//     Both are temporal granules, so this is a plausible near-miss. The
//     compiler may apply month canonical ordering (Jan–Dec) which doesn't
//     match the data; it falls back when values don't parse as months.
// ============================================================================

function genFallbackGroupedBarMonthForQuarterTest(): TestCase {
    const rand = seeded(8002);
    const departments = ['Engineering', 'Marketing', 'Sales', 'Support'];
    const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
    const data: Record<string, any>[] = [];
    for (const dept of departments) {
        for (const q of quarters) {
            data.push({ department: dept, quarter: q, headcount: Math.round(20 + rand() * 80) });
        }
    }

    return {
        title: 'Fallback: Grouped Bar — Month for Quarter',
        description:
            'Quarter values ("Q1"–"Q4") should be "Quarter" but labeled "Month". ' +
            'Both are temporal granules — a plausible confusion. The compiler detects ' +
            'that "Q1" doesn\'t parse as a month name, so Month\'s canonical ordering ' +
            '(Jan–Dec) cannot apply. It falls back along the hierarchy: Month → ' +
            'DateGranule → Temporal, then to data-driven ordering.',
        tags: ['semantic', 'fallback', 'near-miss', 'grouped-bar', 'temporal'],
        chartType: 'Grouped Bar Chart',
        data,
        fields: [makeField('department'), makeField('quarter'), makeField('headcount')],
        metadata: {
            department: { type: Type.String, semanticType: 'Category', levels: departments },
            quarter:    { type: Type.String, semanticType: 'Month',    levels: quarters },
            headcount:  { type: Type.Number, semanticType: 'Count',    levels: [] },
        },
        encodingMap: {
            x:     makeEncodingItem('department'),
            y:     makeEncodingItem('headcount'),
            group: makeEncodingItem('quarter'),
        },
    };
}

// ============================================================================
// F3. Heatmap — days labeled as "Category", hours labeled as "Category"
//     Day-of-week ("Mon"–"Fri") should be "Day" for canonical ordering;
//     hour slots should be "Hour". Both labeled as generic "Category" instead.
//     Chart renders correctly but loses canonical Mon–Fri / 9am–5pm ordering.
// ============================================================================

function genFallbackHeatmapCategoryForDayTest(): TestCase {
    const rand = seeded(8003);
    const rows = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    const cols = Array.from({ length: 24 }, (_, hour) => `${hour.toString().padStart(2, '0')}:00`);
    const data: Record<string, any>[] = [];
    for (const r of rows) {
        for (const c of cols) {
            data.push({ day: r, hour: c, activity: Math.round(rand() * 100) });
        }
    }

    return {
        title: 'Fallback: Heatmap — Category for Day/Hour',
        description:
            'Day-of-week and hour-of-day are both labeled "Category" instead of "Day" ' +
            'and "Hour". This is a common near-miss — the LLM treats temporal labels ' +
            'as generic categories. The chart renders correctly, but loses the canonical ' +
            'Mon–Fri and 00:00–23:00 ordering that "Day" and "Hour" would provide.',
        tags: ['semantic', 'fallback', 'near-miss', 'heatmap', 'ordering'],
        chartType: 'Heatmap',
        data,
        fields: [makeField('day'), makeField('hour'), makeField('activity')],
        metadata: {
            day:      { type: Type.String, semanticType: 'Category', levels: rows },
            hour:     { type: Type.String, semanticType: 'Category', levels: cols },
            activity: { type: Type.Number, semanticType: 'Score',    levels: [] },
        },
        encodingMap: {
            x:     makeEncodingItem('hour'),
            y:     makeEncodingItem('day'),
            color: makeEncodingItem('activity'),
        },
    };
}

// ============================================================================
// F4. Heatmap — sales labeled as "Percentage"
//     Sales values (50–500) should be "Amount" but labeled "Percentage",
//     which expects 0–100 or 0–1 range. The compiler applies percentage
//     formatting ("50%"–"500%") which is wrong, but the chart still renders.
//     The compiler detects the values are way outside [0, 1], so no snap
//     fires, but the "%" suffix persists.
// ============================================================================

function genFallbackHeatmapPercentageForSalesTest(): TestCase {
    const rand = seeded(8004);
    const products = ['Widget', 'Gadget', 'Gizmo', 'Doohickey'];
    const regions = ['North', 'South', 'East', 'West'];
    const data: Record<string, any>[] = [];
    for (const p of products) {
        for (const r of regions) {
            data.push({ product: p, region: r, sales: Math.round(50 + rand() * 450) });
        }
    }

    return {
        title: 'Fallback: Heatmap — Percentage for Sales',
        description:
            'Sales (50–500) labeled as "Percentage" instead of "Amount". A plausible ' +
            'mistake when the LLM confuses revenue share with revenue. The compiler ' +
            'applies percentage formatting, which adds a "%" suffix to axis labels. ' +
            'Values are way outside the expected [0, 1] or [0, 100] range, so snap ' +
            'doesn\'t fire, but the formatting is misleading.',
        tags: ['semantic', 'fallback', 'near-miss', 'heatmap', 'format'],
        chartType: 'Heatmap',
        data,
        fields: [makeField('product'), makeField('region'), makeField('sales')],
        metadata: {
            product: { type: Type.String, semanticType: 'Category',   levels: products },
            region:  { type: Type.String, semanticType: 'Category',   levels: regions },
            sales:   { type: Type.Number, semanticType: 'Percentage', levels: [] },
        },
        semanticAnnotations: {
            sales: { semanticType: 'Percentage', intrinsicDomain: [0, 100] },
        },
        encodingMap: {
            x:     makeEncodingItem('region'),
            y:     makeEncodingItem('product'),
            color: makeEncodingItem('sales'),
        },
    };
}

// ============================================================================
// F5. Line Chart — months labeled as "Category"
//     Month names ("Jan"–"Dec") should be "Month" for canonical ordering.
//     Labeled as "Category" instead — the chart renders but months may
//     appear in alphabetical or data order, not Jan→Dec order.
// ============================================================================

function genFallbackLineCategoryForMonthTest(): TestCase {
    const rand = seeded(8005);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const data = months.map(m => ({
        month: m,
        signups: Math.round(50 + rand() * 200),
    }));

    return {
        title: 'Fallback: Line — Category for Month',
        description:
            'Month names ("Jan"–"Dec") should be "Month" for canonical Jan→Dec ordering, ' +
            'but labeled "Category". A very common LLM near-miss. The chart renders but ' +
            'months may appear in data-insertion or alphabetical order rather than the ' +
            'natural calendar order. Compare with the Month Canonical Order test.',
        tags: ['semantic', 'fallback', 'near-miss', 'line', 'ordering'],
        chartType: 'Line Chart',
        data,
        fields: [makeField('month'), makeField('signups')],
        metadata: {
            month:   { type: Type.String, semanticType: 'Category', levels: months },
            signups: { type: Type.Number, semanticType: 'Count',    levels: [] },
        },
        encodingMap: {
            x: makeEncodingItem('month'),
            y: makeEncodingItem('signups'),
        },
    };
}

// ============================================================================
// F6. Line Chart — temperature labeled as "Quantity"
//     Temperature should be "Temperature" (diverging detection, °C suffix).
//     Labeled as "Quantity" instead — a sibling under the Physical T1 family.
//     Loses the potential diverging color and degree formatting.
// ============================================================================

function genFallbackLineQuantityForTemperatureTest(): TestCase {
    const rand = seeded(8006);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const data = months.map(m => ({
        month: m,
        temperature: Math.round(-5 + rand() * 40),
    }));

    return {
        title: 'Fallback: Line — Quantity for Temperature',
        description:
            'Temperature (°C) labeled as "Quantity" instead of "Temperature". Both are ' +
            'under the Physical T1 family, so this is a sibling near-miss. The compiler ' +
            'treats it as a generic physical measure: no °C suffix formatting, no ' +
            'freezing-point diverging detection. The chart shape is correct but loses ' +
            'the temperature-specific formatting and semantic cues.',
        tags: ['semantic', 'fallback', 'near-miss', 'line', 'format', 'diverging'],
        chartType: 'Line Chart',
        data,
        fields: [makeField('month'), makeField('temperature')],
        metadata: {
            month:       { type: Type.String, semanticType: 'Month',    levels: months },
            temperature: { type: Type.Number, semanticType: 'Quantity', levels: [] },
        },
        encodingMap: {
            x: makeEncodingItem('month'),
            y: makeEncodingItem('temperature'),
        },
    };
}

// ============================================================================
// F7. Area Chart — user counts labeled as "Amount"
//     User counts should be "Count" (integer formatting, no currency prefix).
//     Labeled as "Amount" instead — gets currency prefix ($) and SI
//     abbreviation, which is misleading for a user count metric.
// ============================================================================

function genFallbackAreaAmountForCountTest(): TestCase {
    const rand = seeded(8007);
    const quarters = ['Q1 2023', 'Q2 2023', 'Q3 2023', 'Q4 2023',
                      'Q1 2024', 'Q2 2024', 'Q3 2024', 'Q4 2024'];
    const channels = ['Web', 'Mobile', 'Desktop'];
    const data: Record<string, any>[] = [];
    for (const q of quarters) {
        for (const ch of channels) {
            data.push({ period: q, channel: ch, users: Math.round(1000 + rand() * 9000) });
        }
    }

    return {
        title: 'Fallback: Area — Amount for Count',
        description:
            'User counts labeled as "Amount" instead of "Count". Both are numeric ' +
            'measures with sum aggregation and meaningful zero, so the chart shape is ' +
            'correct. But "Amount" still suggests a generic amount-style presentation, ' +
            'typically abbreviated as "5.2K" rather than formatted as a plain count ' +
            'like "5,200 users", which is a worse fit for this field.',
        tags: ['semantic', 'fallback', 'near-miss', 'area', 'format', 'currency'],
        chartType: 'Area Chart',
        data,
        fields: [makeField('period'), makeField('channel'), makeField('users')],
        metadata: {
            period:  { type: Type.String, semanticType: 'Category', levels: quarters },
            channel: { type: Type.String, semanticType: 'Category', levels: channels },
            users:   { type: Type.Number, semanticType: 'Amount',   levels: [] },
        },
        encodingMap: {
            x:     makeEncodingItem('period'),
            y:     makeEncodingItem('users'),
            color: makeEncodingItem('channel'),
        },
    };
}

// ============================================================================
// F8. Scatter Plot — score labeled as "Percentage"
//     Exam scores (0–100) labeled as "Percentage" instead of "Score".
//     Both have similar ranges, but "Percentage" adds "%" suffix and
//     snap-to-bound behavior, while "Score" uses integer ticks with
//     a fixed [0, 100] domain. The chart still renders, but axis
//     labels show "85%" instead of "85".
// ============================================================================

function genFallbackScatterPercentageForScoreTest(): TestCase {
    const rand = seeded(8008);
    const teams = ['Alpha', 'Beta', 'Gamma', 'Delta'];
    const data: Record<string, any>[] = [];
    for (const team of teams) {
        for (let i = 0; i < 15; i++) {
            data.push({
                team,
                study_hours: Math.round(2 + rand() * 18),
                exam_score: Math.round(55 + rand() * 40),
            });
        }
    }

    return {
        title: 'Fallback: Scatter — Percentage for Score',
        description:
            'Exam scores (55–95) labeled as "Percentage" instead of "Score". Both have ' +
            'similar numeric ranges, making this a very plausible LLM mistake. ' +
            '"Percentage" adds "%" suffix (showing "85%" instead of "85") and applies ' +
            'percentage snap-to-bound behavior. "Score" would use integer ticks and a ' +
            'clean [0, 100] domain without "%" formatting.',
        tags: ['semantic', 'fallback', 'near-miss', 'scatter', 'format', 'domain'],
        chartType: 'Scatter Plot',
        data,
        fields: [makeField('team'), makeField('study_hours'), makeField('exam_score')],
        metadata: {
            team:       { type: Type.String, semanticType: 'Category',   levels: teams },
            study_hours: { type: Type.Number, semanticType: 'Count',     levels: [] },
            exam_score: { type: Type.Number, semanticType: 'Percentage', levels: [] },
        },
        semanticAnnotations: {
            exam_score: { semanticType: 'Percentage', intrinsicDomain: [0, 100] },
        },
        encodingMap: {
            x:     makeEncodingItem('study_hours'),
            y:     makeEncodingItem('exam_score'),
            color: makeEncodingItem('team'),
        },
    };
}

// ============================================================================
// Public generator: Semantic Fallback Tests
// ============================================================================

export function genSemanticFallbackTests(): TestCase[] {
    return [
        genFallbackGroupedBarCountForRevenueTest(),
        genFallbackGroupedBarMonthForQuarterTest(),
        genFallbackHeatmapCategoryForDayTest(),
        genFallbackHeatmapPercentageForSalesTest(),
        genFallbackLineCategoryForMonthTest(),
        genFallbackLineQuantityForTemperatureTest(),
        genFallbackAreaAmountForCountTest(),
        genFallbackScatterPercentageForScoreTest(),
    ];
}
