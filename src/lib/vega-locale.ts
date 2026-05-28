// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Synchronise Vega's time-format locale with the current i18n language.
 *
 * Locale data lives in the i18n translation files under "chart.vegaLocale".
 * To support a new language, add the d3-time-format locale definition to
 * that language's chart.json — no code changes needed here.
 *
 * Call {@link syncVegaLocale} once at startup and on every language change.
 */

import { defaultLocale } from 'vega';
import i18n from '../i18n';

const D3_DEFAULT_NUMBER = {
    decimal: '.',
    thousands: ',',
    grouping: [3],
    currency: ['$', ''],
};

const D3_DEFAULT_TIME = {
    dateTime: '%x, %X',
    date: '%-m/%-d/%Y',
    time: '%-I:%M:%S %p',
    periods: ['AM', 'PM'],
    days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    shortDays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    shortMonths: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

function readTimeLocale(): Record<string, unknown> | null {
    const obj = i18n.t('chart.vegaLocale', { returnObjects: true });
    if (obj && typeof obj === 'object' && 'months' in (obj as Record<string, unknown>)) {
        return obj as Record<string, unknown>;
    }
    return null;
}

export function syncVegaLocale(): void {
    const timeLocale = readTimeLocale();
    defaultLocale(D3_DEFAULT_NUMBER as any, (timeLocale ?? D3_DEFAULT_TIME) as any);
}
