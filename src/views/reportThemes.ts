// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * How a report reads: a report is for its reader to take in, so its look is a few
 * reading settings, not a brand — the typeface (sans or serif), the density
 * (compact by default), in one column wide enough for tables yet short enough for
 * prose lines. The agent's genre (front matter `style:`) shapes the writing; the reader
 * can change either setting without regenerating. The styles merge over one base, so they apply alike
 * to the editor, the streaming view, and PDF/copy exports.
 */

import { alpha, Theme } from '@mui/material/styles';
import { readingTypography } from '../app/tokens';
import type { CalloutKind } from './reportBlocks';

export type ReportTypeface = 'sans' | 'serif';
export type ReportDensity = 'compact' | 'comfortable';

export const DEFAULT_REPORT_TYPEFACE: ReportTypeface = 'sans';
export const DEFAULT_REPORT_DENSITY: ReportDensity = 'compact';

/** The report column's max width (with the page's side padding): prose lines stay easy to follow;
 *  wider tables scroll within it. */
export const REPORT_COLUMN_WIDTH = 760;

export function reportTypefaceFor(chosen: string | undefined): ReportTypeface {
    // `academic` was the serif theme before themes became reading settings.
    return chosen === 'serif' || chosen === 'academic' ? 'serif' : DEFAULT_REPORT_TYPEFACE;
}

export function reportDensityFor(chosen: string | undefined): ReportDensity {
    return chosen === 'compact' || chosen === 'comfortable' ? chosen : DEFAULT_REPORT_DENSITY;
}

export interface ReportLook {
    typeface: ReportTypeface;
    density: ReportDensity;
}

const SERIF = '"Source Serif 4", "Source Serif Pro", "Iowan Old Style", Charter, Georgia, "Times New Roman", serif';

type Styles = Record<string, any>;

const isPlainObject = (value: unknown): value is Styles =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

/** Style objects merged key by key, so a theme can change one property of a rule without restating it. */
export function mergeStyles(...layers: Styles[]): Styles {
    const out: Styles = {};
    for (const layer of layers) {
        for (const [key, value] of Object.entries(layer)) {
            out[key] = isPlainObject(value) && isPlainObject(out[key]) ? mergeStyles(out[key], value) : value;
        }
    }
    return out;
}

/** Base prose: the clean, Notion-like look every theme starts from. */
function proseStyles(theme: Theme): Styles {
    return {
        fontFamily: readingTypography.fontFamily,
        fontSize: '0.95rem',
        lineHeight: 1.7,
        color: readingTypography.color,
        '& > :first-child': { marginTop: 0 },
        '& h1': { fontSize: '1.75rem', fontWeight: 700, lineHeight: 1.25, letterSpacing: '-0.02em', marginTop: '1.5em', marginBottom: '0.5em' },
        '& h2': { fontSize: '1.4rem', fontWeight: 600, lineHeight: 1.3, marginTop: '1.25em', marginBottom: '0.4em' },
        '& h3': { fontSize: '1.15rem', fontWeight: 600, lineHeight: 1.4, marginTop: '1em', marginBottom: '0.3em' },
        '& p': { marginBottom: '0.75em' },
        '& img': { maxWidth: '100%', height: 'auto', borderRadius: '4px', margin: '0.5em 0' },
        '& blockquote': {
            borderLeft: '3px solid',
            borderColor: alpha(theme.palette.text.disabled, 0.3),
            paddingLeft: '1em',
            margin: '0.75em 0',
            fontStyle: 'italic',
            color: 'rgb(73, 73, 73)',
        },
        '& ul, & ol': { paddingLeft: '1.5em', marginBottom: '0.75em' },
        '& li': { marginBottom: '0.25em' },
        // A list item's paragraphs sit close; the list, not each item, carries the paragraph gap.
        '& li > p': { marginTop: 0, marginBottom: '0.3em' },
        '& li > p:last-child': { marginBottom: 0 },
        '& strong': { fontWeight: 600 },
        '& code': {
            backgroundColor: 'rgba(247, 246, 243, 1)',
            padding: '0.15em 0.4em',
            borderRadius: '3px',
            fontSize: '0.85em',
            fontFamily: 'var(--df-font-mono)',
        },
        '& pre': {
            backgroundColor: 'rgba(247, 246, 243, 1)',
            padding: '0.75em 1em',
            borderRadius: '4px',
            overflow: 'auto',
            '& code': { backgroundColor: 'transparent', padding: 0 },
        },
        '& hr': { border: 'none', borderTop: `1px solid ${alpha(theme.palette.divider, 0.5)}`, margin: '1.5em 0' },
        '& table': {
            borderCollapse: 'collapse',
            margin: '0.75em 0',
            width: 'auto',
            tableLayout: 'auto',
            fontSize: '0.82em',
            lineHeight: 1.35,
            color: 'rgb(73, 73, 73)',
        },
        '& table td, & table th': {
            border: `1px solid ${alpha(theme.palette.divider, 0.55)}`,
            padding: '4px 8px',
            verticalAlign: 'top',
            position: 'relative',
            minWidth: '1em',
        },
        '& table th': {
            backgroundColor: alpha(theme.palette.text.primary, 0.04),
            fontWeight: 600,
            textAlign: 'left',
            color: 'rgb(55, 53, 47)',
        },
        '& .tableWrapper': { overflowX: 'auto', margin: '0.75em 0' },
        '& .column-resize-handle': {
            position: 'absolute',
            right: -2,
            top: 0,
            bottom: -2,
            width: 4,
            backgroundColor: alpha(theme.palette.primary.main, 0.35),
            pointerEvents: 'none',
        },
    };
}

/** Report blocks: excerpts, callouts, metrics, compare columns, references, citations. */
function blockStyles(theme: Theme): Styles {
    const calloutColors: Record<CalloutKind, { main: string; text: string }> = {
        summary: { main: theme.palette.primary.main, text: theme.palette.primary.dark },
        note: { main: theme.palette.info.main, text: theme.palette.info.dark },
        finding: { main: theme.palette.success.main, text: theme.palette.success.dark },
        caveat: { main: theme.palette.warning.main, text: theme.palette.warning.dark },
        definition: { main: theme.palette.text.secondary, text: theme.palette.text.secondary },
    };
    const badge = (color: string) => ({ color, backgroundColor: alpha(color, 0.1) });
    const card = {
        border: `1px solid ${alpha(theme.palette.divider, 0.14)}`,
        borderRadius: '8px',
        backgroundColor: alpha(theme.palette.text.primary, 0.015),
    };
    return {
        '& .report-block-body > :first-child': { marginTop: 0 },
        '& figure.report-excerpt': {
            position: 'relative',
            margin: '1em 0 1.1em',
            padding: '0.7em 1em 0.6em 1.1em',
            borderLeft: `3px solid ${alpha(theme.palette.primary.main, 0.45)}`,
            backgroundColor: alpha(theme.palette.primary.main, 0.035),
            borderRadius: '0 6px 6px 0',
            '& .report-block-body': {
                fontSize: '0.93em',
                lineHeight: 1.65,
                color: 'rgb(55, 53, 47)',
                '& p': { marginBottom: '0.5em' },
                '& > :last-child': { marginBottom: 0 },
            },
            '& figcaption': {
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'baseline',
                columnGap: '0.4em',
                marginTop: '0.45em',
                fontSize: '0.78em',
                lineHeight: 1.4,
                color: theme.palette.text.secondary,
                userSelect: 'none',
                '&::before': { content: '"—"', color: theme.palette.text.disabled },
            },
            '& .report-excerpt-source': { fontWeight: 600, color: 'inherit', textDecoration: 'none' },
            '& a.report-excerpt-source': { cursor: 'pointer' },
            '& a.report-excerpt-source:hover': { color: theme.palette.primary.main, textDecoration: 'underline' },
            '& a.report-excerpt-web': { color: theme.palette.text.disabled, textDecoration: 'none', fontWeight: 600 },
            '& a.report-excerpt-web:hover': { color: theme.palette.primary.main },
            '& .report-excerpt-locator::before': { content: '"·"', marginRight: '0.4em', color: theme.palette.text.disabled },
        },
        '& aside.report-callout': {
            margin: '1em 0',
            padding: '0.6em 1em 0.7em',
            borderRadius: '6px',
            '& .report-callout-title': {
                fontFamily: readingTypography.fontFamily,
                fontSize: '0.72em',
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: '0.25em',
                userSelect: 'none',
            },
            '& .report-block-body > :last-child': { marginBottom: 0 },
            '& .report-block-body li': { marginBottom: '0.15em' },
            ...Object.fromEntries(Object.entries(calloutColors).map(([kind, color]) => [`&[data-kind="${kind}"]`, {
                border: `1px solid ${alpha(color.main, kind === 'summary' ? 0.35 : 0.28)}`,
                backgroundColor: alpha(color.main, kind === 'definition' ? 0.04 : 0.06),
                '& .report-callout-title': { color: color.text },
                ...(kind === 'summary' ? { borderLeftWidth: '4px', padding: '0.75em 1.1em 0.8em' } : {}),
            }])),
        },
        '& .report-metrics': {
            margin: '1em 0',
            '& ul, & ol': {
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: '10px',
                listStyle: 'none',
                padding: 0,
                margin: 0,
            },
            '& li': {
                ...card,
                margin: 0,
                padding: '0.6em 0.85em 0.65em',
                fontSize: '0.85em',
                lineHeight: 1.4,
                color: theme.palette.text.secondary,
                '& p': { margin: 0 },
            },
            '& li p:first-of-type > strong:first-of-type': {
                display: 'block',
                fontSize: '1.75em',
                fontWeight: 700,
                lineHeight: 1.2,
                letterSpacing: '-0.01em',
                fontVariantNumeric: 'tabular-nums',
                color: readingTypography.color,
                marginBottom: '0.15em',
            },
        },
        '& .report-compare': {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '12px',
            margin: '1em 0',
        },
        '& .report-column': {
            ...card,
            padding: '0.7em 0.9em 0.75em',
            fontSize: '0.9em',
            lineHeight: 1.55,
            '& .report-column-title': {
                fontWeight: 700,
                fontSize: '0.98em',
                marginBottom: '0.4em',
                paddingBottom: '0.35em',
                borderBottom: `1px solid ${alpha(theme.palette.divider, 0.14)}`,
                userSelect: 'none',
            },
            '& .report-block-body > :last-child': { marginBottom: 0 },
            '& ul, & ol': { paddingLeft: '1.2em' },
        },
        '& .report-references': {
            marginTop: '2em',
            paddingTop: '0.75em',
            borderTop: `1px solid ${alpha(theme.palette.divider, 0.14)}`,
            fontSize: '0.82em',
            lineHeight: 1.5,
            color: theme.palette.text.secondary,
            '& .report-references-title': {
                fontWeight: 700,
                fontSize: '0.85em',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: '0.4em',
                userSelect: 'none',
            },
            '& ol': { paddingLeft: '1.8em', marginBottom: 0 },
            '& li': { marginBottom: '0.2em' },
        },
        '& sup.report-cite': {
            fontSize: '0.7em',
            fontWeight: 600,
            lineHeight: 0,
            marginLeft: '0.1em',
            color: theme.palette.primary.main,
            cursor: 'pointer',
            '&:hover': { textDecoration: 'underline' },
        },
        '& sup.report-cite + sup.report-cite::before': { content: '","', color: theme.palette.text.disabled },
        '& .report-details': {
            margin: '0.9em 0',
            borderTop: `1px solid ${alpha(theme.palette.divider, 0.14)}`,
            borderBottom: `1px solid ${alpha(theme.palette.divider, 0.14)}`,
            '& .report-details-title': {
                display: 'flex',
                alignItems: 'center',
                gap: '0.4em',
                width: '100%',
                padding: '0.4em 0',
                border: 'none',
                background: 'none',
                font: 'inherit',
                fontSize: '0.88em',
                fontWeight: 600,
                color: theme.palette.text.secondary,
                textAlign: 'left',
                cursor: 'pointer',
                userSelect: 'none',
                '&::before': {
                    content: '"▸"',
                    display: 'inline-block',
                    width: '0.9em',
                    color: theme.palette.text.disabled,
                    transition: 'transform 0.15s',
                },
                '&:hover': { color: theme.palette.text.primary },
            },
            '& > .report-block-body': { display: 'none', paddingBottom: '0.5em', '& > :last-child': { marginBottom: 0 } },
            '&.is-open > .report-block-body': { display: 'block' },
            '&.is-open > .report-details-title::before': { transform: 'rotate(90deg)' },
        },
        // While editing, collapsed content stays reachable.
        '&[contenteditable="true"] .report-details > .report-block-body': { display: 'block' },
    };
}

/** Serif text for long reading: the same layout in a book face, a touch larger. */
const serifStyles = (theme: Theme): Styles => ({
    fontFamily: SERIF,
    fontSize: '1rem',
    lineHeight: 1.75,
    '& h1, & h2, & h3': { fontFamily: SERIF },
    '& h1': { fontWeight: 600, letterSpacing: '-0.01em' },
    '& h2': { fontWeight: 600 },
    '& h3': { fontWeight: 600 },
    '& .report-callout-title, & .report-column-title, & .report-details-title, & .report-references-title, & figcaption': {
        fontFamily: readingTypography.fontFamily,
    },
    '& sup.report-cite': { fontFamily: readingTypography.fontFamily },
    '& table': { color: theme.palette.text.primary },
});

/** Type sizes when compact, by typeface: [body, h1, h2, h3] and the body line height. */
const COMPACT_TYPE: Record<ReportTypeface, { sizes: [string, string, string, string]; lineHeight: number }> = {
    sans: { sizes: ['0.9rem', '1.5rem', '1.2rem', '1.02rem'], lineHeight: 1.55 },
    serif: { sizes: ['0.93rem', '1.55rem', '1.15rem', '1rem'], lineHeight: 1.58 },
};

/** Compact density: smaller type, tighter leading, and less space between blocks. */
function compactStyles(typeface: ReportTypeface): Styles {
    const { sizes: [body, h1, h2, h3], lineHeight } = COMPACT_TYPE[typeface];
    return {
        fontSize: body,
        lineHeight,
        '& h1': { fontSize: h1, marginTop: '1em', marginBottom: '0.4em' },
        '& h2': { fontSize: h2, marginTop: '1em', marginBottom: '0.3em' },
        '& h3': { fontSize: h3, marginTop: '0.8em', marginBottom: '0.2em' },
        '& p': { marginBottom: '0.5em' },
        '& ul, & ol': { marginBottom: '0.5em', paddingLeft: '1.3em' },
        '& li': { marginBottom: '0.12em' },
        '& li > p': { marginBottom: '0.15em' },
        '& img': { marginTop: '0.3em', marginBottom: '0.3em' },
        '& table': { margin: '0.5em 0' },
        '& table td, & table th': { padding: '3px 7px' },
        '& figure.report-excerpt': { margin: '0.6em 0', padding: '0.5em 0.85em 0.45em 0.95em' },
        '& aside.report-callout': { margin: '0.6em 0', padding: '0.45em 0.85em 0.5em' },
        '& .report-metrics': { margin: '0.6em 0' },
        '& .report-metrics li': { padding: '0.45em 0.7em 0.5em' },
        '& .report-compare': { margin: '0.6em 0', gap: '8px' },
        '& .report-column': { padding: '0.55em 0.75em 0.6em' },
        '& .report-details': { margin: '0.6em 0' },
        '& .report-references': { marginTop: '1.2em' },
    };
}

/** The full content styles of a report: prose and blocks, then its typeface and density. */
export function reportContentSx(theme: Theme, look: ReportLook = { typeface: 'sans', density: 'compact' }): Styles {
    return mergeStyles(proseStyles(theme), blockStyles(theme),
        look.typeface === 'serif' ? serifStyles(theme) : {},
        look.density === 'compact' ? compactStyles(look.typeface) : {});
}
