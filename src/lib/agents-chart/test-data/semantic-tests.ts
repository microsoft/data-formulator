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
            'Semantic type "Revenue" adds currency prefix ($) and SI abbreviation to axis labels. ' +
            'WITHOUT this: axis would show raw numbers like 1200000.',
        tags: ['semantic', 'format', 'currency', 'revenue'],
        chartType: 'Bar Chart',
        data,
        fields: [makeField('city'), makeField('revenue')],
        metadata: {
            city:    { type: Type.String, semanticType: 'City',    levels: CITIES },
            revenue: { type: Type.Number, semanticType: 'Revenue', levels: [] },
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
            rating:  { type: Type.Number, semanticType: 'Rating',   levels: [] },
            reviews: { type: Type.Number, semanticType: 'Count',    levels: [] },
        },
        // Enriched annotation for rating — provides intrinsic domain
        semanticAnnotations: {
            rating: { semanticType: 'Rating', intrinsicDomain: [1, 5] },
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
            'Revenue gets "$" prefix + SI abbreviation; growth_rate gets "%" format. ' +
            'WITHOUT annotations: both axes show plain numbers.',
        tags: ['semantic', 'format', 'currency', 'percentage', 'dual'],
        chartType: 'Scatter Plot',
        data,
        fields: [makeField('city'), makeField('revenue'), makeField('growth_rate')],
        metadata: {
            city:        { type: Type.String, semanticType: 'City',       levels: CITIES },
            revenue:     { type: Type.Number, semanticType: 'Revenue',    levels: [] },
            growth_rate: { type: Type.Number, semanticType: 'Percentage', levels: [] },
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
            avg_rating: { type: Type.Number, semanticType: 'Rating',   levels: [] },
        },
        semanticAnnotations: {
            avg_rating: { semanticType: 'Rating', intrinsicDomain: [1, 5] },
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
            revenue: { type: Type.Number, semanticType: 'Revenue',  levels: [] },
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
// 18. Percentage line — contextual zero with data far from zero
//     Semantic type: "Percentage" → intrinsicDomain [0, 100]
//
//     Percentage is contextual: zero may or may not be included depending
//     on the data range and mark type. For a line chart with data 40–85%,
//     the intrinsicDomain [0, 100] shows the full scale, providing context
//     for how close values are to 0% or 100%.
//
//     WITHOUT this: line chart data-fits to [40, 85], losing context
//     WITH intrinsicDomain [0, 100]: full scale visible
// ============================================================================

function genPercentageLineDomainTest(): TestCase {
    const rand = seeded(504);
    const weeks = Array.from({ length: 10 }, (_, i) => `Week ${i + 1}`);
    const data = weeks.map(w => ({
        week: w,
        completion_rate: Math.round(40 + rand() * 45),
    }));

    return {
        title: 'Percentage Line — Full Scale [0,100]',
        description:
            'Completion rates (40–85%) with intrinsicDomain [0, 100]. The semantic domain ' +
            'shows the full percentage scale so you can see proximity to 0% and 100%. ' +
            'WITHOUT this: line fits tightly to 40–85, losing context about absolute position.',
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
    ];
}

// ============================================================================
// 9. Profit — signed currency format (+$120K / -$50K)
//    Semantic type: "Profit"  →  signed-currency format class
//
//    WITHOUT this annotation:
//      Axis shows raw numbers: 120000, -50000. No sign prefix on positive
//      values, no currency symbol. Hard to tell gains from losses at a glance.
//
//    WITH "Profit":
//      Axis labels show: +$120K, -$50K. Sign always visible, currency prefix.
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
        title: 'Profit Signed Currency (+$/-$)',
        description:
            'Semantic type "Profit" uses signed-currency format: "+$120K" / "-$50K". ' +
            'Sign is always visible on positive values, making gains vs losses obvious. ' +
            'WITHOUT this: raw numbers without sign prefix or currency symbol.',
        tags: ['semantic', 'format', 'signed-currency', 'profit'],
        chartType: 'Bar Chart',
        data,
        fields: [makeField('quarter'), makeField('profit')],
        metadata: {
            quarter: { type: Type.String, semanticType: 'Category', levels: quarters },
            profit:  { type: Type.Number, semanticType: 'Profit',   levels: [] },
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
//     Semantic type: "PercentageChange"  →  signed-percent format
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
            'Semantic type "PercentageChange" uses signed-percent format: "+12.3%" / "-5.1%". ' +
            'Sign is always visible, making gains and losses instantly clear. ' +
            'WITHOUT this: raw decimals like 0.12 or -0.05 with no % symbol.',
        tags: ['semantic', 'format', 'signed-percent', 'percentage-change'],
        chartType: 'Bar Chart',
        data,
        fields: [makeField('stock'), makeField('ytd_change'), makeField('market_cap_B')],
        metadata: {
            stock:        { type: Type.String, semanticType: 'Category',         levels: stocks },
            ytd_change:   { type: Type.Number, semanticType: 'PercentageChange', levels: [] },
            market_cap_B: { type: Type.Number, semanticType: 'Amount',           levels: [] },
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
            sales: { type: Type.Number, semanticType: 'Revenue',  levels: [] },
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
            revenue: { type: Type.Number, semanticType: 'Revenue',  levels: [] },
        },
        encodingMap: {
            x: makeEncodingItem('region'),
            y: makeEncodingItem('revenue'),
            color: makeEncodingItem('quarter'),
        },
    };
}

// ============================================================================
// 23. Correlation — diverging color + bounded domain [-1, 1]
//     Semantic type: "Correlation" → domain [-1, 1], diverging color,
//     clamped scale, signed-decimal format
//
//     WITHOUT this annotation:
//       Color scale auto-fits to data range (e.g., [0.12, 0.89]).
//       No diverging scheme, no fixed [-1,1] bounds, no midpoint centering.
//
//     WITH "Correlation":
//       Domain clamped to [-1, 1], diverging color with midpoint at 0,
//       signed-decimal format (+0.85 / -0.42). Full semantic context.
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
