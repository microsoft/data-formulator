// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Fixed regional survey dataset for the Chart Gallery tab.
 * Source columns: season, region, city, percentage, count, attitude, rank
 */

export interface RegionalSurveyRow {
    /** Unix timestamp (seconds) */
    season: number;
    /** Stable categorical / temporal label for axes */
    seasonLabel: string;
    region: string;
    city: string;
    /** 0–100 */
    percentage: number;
    count: number;
    attitude: string;
    rank: number;
}

function labelFromUnixSec(sec: number): string {
    return new Date(sec * 1000).toISOString().slice(0, 10);
}

/** Parsed rows (percentages as numbers). */
export const REGIONAL_SURVEY_ROWS: RegionalSurveyRow[] = [
    { season: 1735689600, seasonLabel: labelFromUnixSec(1735689600), region: 'N', city: 'City A', percentage: 85, count: 1250, attitude: 'strongly agree', rank: 1 },
    { season: 1735689600, seasonLabel: labelFromUnixSec(1735689600), region: 'E', city: 'City B', percentage: 78, count: 2100, attitude: 'agree', rank: 2 },
    { season: 1735689600, seasonLabel: labelFromUnixSec(1735689600), region: 'S', city: 'City C', percentage: 65, count: 1540, attitude: 'agree', rank: 4 },
    { season: 1735689600, seasonLabel: labelFromUnixSec(1735689600), region: 'W', city: 'City D', percentage: 42, count: 890, attitude: 'neutral', rank: 8 },
    { season: 1743465600, seasonLabel: labelFromUnixSec(1743465600), region: 'N', city: 'City E', percentage: 55, count: 920, attitude: 'agree', rank: 6 },
    { season: 1743465600, seasonLabel: labelFromUnixSec(1743465600), region: 'E', city: 'City F', percentage: 92, count: 1780, attitude: 'strongly agree', rank: 1 },
    { season: 1743465600, seasonLabel: labelFromUnixSec(1743465600), region: 'S', city: 'City G', percentage: 88, count: 1950, attitude: 'strongly agree', rank: 2 },
    { season: 1743465600, seasonLabel: labelFromUnixSec(1743465600), region: 'W', city: 'City H', percentage: 30, count: 1100, attitude: 'disagree', rank: 12 },
    { season: 1751241600, seasonLabel: labelFromUnixSec(1751241600), region: 'N', city: 'City I', percentage: 15, count: 320, attitude: 'strongly disagree', rank: 20 },
    { season: 1751241600, seasonLabel: labelFromUnixSec(1751241600), region: 'E', city: 'City J', percentage: 60, count: 880, attitude: 'agree', rank: 7 },
    { season: 1751241600, seasonLabel: labelFromUnixSec(1751241600), region: 'S', city: 'City K', percentage: 72, count: 640, attitude: 'agree', rank: 5 },
    { season: 1751241600, seasonLabel: labelFromUnixSec(1751241600), region: 'W', city: 'City L', percentage: 48, count: 760, attitude: 'neutral', rank: 9 },
    { season: 1759017600, seasonLabel: labelFromUnixSec(1759017600), region: 'N', city: 'City M', percentage: 35, count: 540, attitude: 'disagree', rank: 15 },
    { season: 1759017600, seasonLabel: labelFromUnixSec(1759017600), region: 'E', city: 'City N', percentage: 81, count: 1420, attitude: 'strongly agree', rank: 3 },
    { season: 1759017600, seasonLabel: labelFromUnixSec(1759017600), region: 'S', city: 'City O', percentage: 58, count: 430, attitude: 'agree', rank: 10 },
    { season: 1759017600, seasonLabel: labelFromUnixSec(1759017600), region: 'W', city: 'City P', percentage: 66, count: 720, attitude: 'agree', rank: 6 },
    { season: 1766793600, seasonLabel: labelFromUnixSec(1766793600), region: 'N', city: 'City Q', percentage: 25, count: 310, attitude: 'disagree', rank: 18 },
    { season: 1766793600, seasonLabel: labelFromUnixSec(1766793600), region: 'E', city: 'City R', percentage: 70, count: 980, attitude: 'agree', rank: 5 },
    { season: 1766793600, seasonLabel: labelFromUnixSec(1766793600), region: 'S', city: 'City S', percentage: 44, count: 520, attitude: 'neutral', rank: 11 },
    { season: 1766793600, seasonLabel: labelFromUnixSec(1766793600), region: 'W', city: 'City T', percentage: 20, count: 150, attitude: 'strongly disagree', rank: 19 },
];

const SEASON_LABELS = [...new Set(REGIONAL_SURVEY_ROWS.map(r => r.seasonLabel))].sort();
const REGIONS = ['N', 'E', 'S', 'W'] as const;
const CITIES = [...new Set(REGIONAL_SURVEY_ROWS.map(r => r.city))];
const ATTITUDES = [...new Set(REGIONAL_SURVEY_ROWS.map(r => r.attitude))];

/** Table shape expected by assemblers (`Record<string, unknown>[]`). */
export function regionalSurveyTable(): Record<string, unknown>[] {
    return REGIONAL_SURVEY_ROWS.map(r => ({ ...r }));
}

export const REGIONAL_SURVEY_AXIS_LEVELS = {
    seasonLabels: SEASON_LABELS,
    regions: [...REGIONS],
    cities: CITIES,
    attitudes: ATTITUDES,
} as const;
