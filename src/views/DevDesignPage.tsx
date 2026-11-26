// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * /dev/design: an exploded, product-style illustration of Data Formulator's four layers. Each layer is an
 * upright slide in an oblique projection (faces keep their true proportions), stacked front to back: the user
 * interaction layer in front, the data connector at the back. Everything is laid out in design units: the
 * page height is DH units, and the stack sits in a DW-wide frame. Wider windows give the extra width to the
 * callouts (up to CALLOUT_MAX); windows narrower than DW scroll sideways.
 */

import React, { useEffect, useState } from 'react';
import { Box, useTheme } from '@mui/material';
import { useSelector } from 'react-redux';
import { DEV_NAV_HEIGHT, DevNav } from './DevNav';
import { alpha } from '@mui/material/styles';
import GitHubIcon from '@mui/icons-material/GitHub';
import StarBorderRoundedIcon from '@mui/icons-material/StarBorderRounded';
import uiScreenshot from './DevDesignPage.ui.png';
import { fontSans, identText, ink, paper } from '../app/tokens';
import type { DataFormulatorState } from '../app/dfSlice';
import { LayerSketch, type LayerSketchKind } from './DevDesignSketch';

export const DW = 1740;
export const DH = 1080;
export const W = 720;
/** The slides share the UI screenshot's proportions (3224 x 1722). */
export const H = (W * 1722) / 3224;
const SCALE = 1.05;
export const RADIUS = 20;
const THICKNESS = 3;
/** Screen offset from one slide to the one behind it: the stack runs from the back (top left) to the front
 *  (bottom right), so the callouts read 1 to 4 from left to right. */
const STEP: [number, number] = [-70, -150];
const STEP_LENGTH = Math.hypot(...STEP);
const STACK_WIDTH = W * SCALE + 3 * Math.abs(STEP[0]);
const STACK_LEFT = (DW - STACK_WIDTH) / 2;
/** The front slide's top-left corner. */
const ORIGIN: [number, number] = [STACK_LEFT - 3 * Math.min(STEP[0], 0), 630];
export const LEFT_COLUMN = STACK_LEFT - 28;
export const RIGHT_COLUMN = STACK_LEFT + STACK_WIDTH + 28;
/** Callout width: the narrowest, and the widest it grows to when the window has room. */
const CALLOUT_WIDTH = 340;
const CALLOUT_MAX = 460;
const DW_MAX = DW + 2 * (CALLOUT_MAX - CALLOUT_WIDTH);
/** The title sketch, on the sketches' 4:3 board. */
const SKETCH_W = 80;
const SKETCH_H = 60;
const SKETCH_GAP = 6;
/** Design-unit height of each callout title row. Row 0 meets the connector's protocol bar; each row must also
 *  meet the visible part of its slide (the discovery slide shows on the right only between y 330 and 480). */
const ROW_Y0 = 289;
const ROW_GAP = 170;
const TITLE_LINE = 32;

export const MONO = '"SF Mono", ui-monospace, Menlo, Consolas, monospace';
export const INK = 'rgba(0, 0, 0, 0.87)';
export const MUTED = 'rgba(0, 0, 0, 0.7)';
export const LINE = 'rgba(0, 0, 0, 0.1)';
export const FILL = 'rgba(0, 0, 0, 0.045)';
export const BAR = 'rgba(0, 0, 0, 0.13)';

const slideOrigin = (depth: number): [number, number] => [ORIGIN[0] + depth * STEP[0], ORIGIN[1] + depth * STEP[1]];
/** A slide-space point (0..W, 0..H) on the slide at `depth` (0 = front), in design units. */
const project = (x: number, y: number, depth: number): [number, number] => {
    const [ox, oy] = slideOrigin(depth);
    return [ox + x * SCALE, oy + y * SCALE];
};
const slideTransform = (depth: number, dx = 0, dy = 0) => {
    const [ox, oy] = slideOrigin(depth);
    return `translate(${ox + dx} ${oy + dy}) scale(${SCALE})`;
};
export const u = (px: number) => `${(px / DH) * 100}cqh`;
/** Callouts take an even share of the stage width beyond the stack, less an edge margin, within [CALLOUT_WIDTH, CALLOUT_MAX]. */
const FRAME_EDGE = 48;
export const CALLOUT_SPAN = `clamp(${u(CALLOUT_WIDTH)}, calc((100cqw - ${u(DW - 2 * CALLOUT_WIDTH + 2 * FRAME_EDGE)}) / 2), ${u(CALLOUT_MAX)})`;
/** The page's only type sizes, in design units. */
export const TYPE = { display: 52, heading: 28, body: 18 } as const;

interface Layer {
    id: string;
    /** Position in the stack, 0 = front. */
    depth: number;
    title: string;
    /** Shown as a short list under the title. */
    points: React.ReactNode[];
    side: 'left' | 'right';
    /** Row of the callout's title, top to bottom; rows are evenly spaced down the page. */
    row: number;
    /** Slide-space x the leader line points at; it meets the slide at the row's height. */
    anchorX: number;
    Content: React.FC<{ accent: string }>;
    /** Hand-drawn sketch beside the callout title, and what it shows. */
    sketch: [LayerSketchKind, string];
}

// ---------------------------------------------------------------- slide contents (slide space, W x H)
// Behind the front slide only the top ~140 units of a slide show, so each slide leads with its key content
// there; the whole slide shows when it is hovered and drawn on top. Muted UI, one accent.

export type Run = [string, string?];

/** A line of text made of coloured runs. */
export const Line: React.FC<{ x: number; y: number; runs: Run[]; size?: number; mono?: boolean; color?: string; weight?: number; anchor?: 'start' | 'end' | 'middle' }> = ({
    x, y, runs, size = 11, mono = true, color = INK, weight, anchor,
}) => <text x={x} y={y} fontSize={size} fontFamily={mono ? MONO : undefined} fill={color} fontWeight={weight} textAnchor={anchor} xmlSpace="preserve">
    {runs.map(([text, runColor], i) => <tspan key={i} fill={runColor ?? color}>{text}</tspan>)}
</text>;

export const Panel: React.FC<{ x: number; y: number; width: number; height: number; label?: string; fill?: string; stroke?: string }> = ({
    x, y, width, height, label, fill = '#fff', stroke = LINE,
}) => <g>
    <rect x={x} y={y} width={width} height={height} rx={10} fill={fill} stroke={stroke} />
    {label && <text x={x + 12} y={y + 19} fontSize={10.5} fontWeight={600} letterSpacing="0.06em" fill={MUTED}>{label.toUpperCase()}</text>}
</g>;

export const ConnectorSlide: React.FC<{ accent: string }> = ({ accent }) => {
    const sources = ['PostgreSQL', 'MySQL', 'BigQuery', 'Databricks', 'Kusto', 'S3', 'Azure Blob', 'Files'];
    const verbs = ['ls', 'search', 'read', 'probe', 'load'];
    const width = 75, gap = 9, x0 = (W - (sources.length * width + (sources.length - 1) * gap)) / 2;
    const busX = 24, busW = W - 48, cell = busW / verbs.length;
    const catalog: [string, string, boolean?][] = [
        ['postgres-prod/', ''], ['  public/orders', '1.2M rows'], ['  public/customers', '84K rows'],
        ['bigquery/flights/', ''], ['  fares', '38M rows · virtual', true], ['  airports', '19K rows'], ['kusto/telemetry/', ''], ['s3/raw-events/', ''],
    ];
    const log: Run[][] = [
        [['probe ', accent], ['bigquery/flights/fares']],
        [['      {"origin": ["SEA","LAX"], "limit": 5}', MUTED]],
        [['→ 5 rows · origin, dest, depart, fare_usd', MUTED]],
        [['load  ', accent], ['bigquery/flights/fares']],
        [['      where origin in (\'SEA\',\'LAX\')', MUTED]],
        [['→ 21,480 rows · workspace/fares.parquet', MUTED]],
    ];
    const table = [['origin', 'dest', 'depart', 'fare_usd'], ['SEA', 'PEK', '2027-02-22', '806'], ['LAX', 'PEK', '2027-02-22', '912']];
    return <g>
        {sources.map((label, i) => {
            const x = x0 + i * (width + gap);
            return <g key={label}>
                <line x1={x + width / 2} x2={x + width / 2} y1={52} y2={84} stroke={BAR} strokeWidth={1.5} />
                <rect x={x} y={20} width={width} height={32} rx={9} fill="#fff" stroke={LINE} />
                <text x={x + width / 2} y={40.5} textAnchor="middle" fontSize={12} fontWeight={500} fill={MUTED}>{label}</text>
            </g>;
        })}
        <rect x={busX} y={84} width={busW} height={40} rx={12} fill={`${accent}0d`} stroke={`${accent}55`} />
        {verbs.map((verb, i) => <g key={verb}>
            {i > 0 && <line x1={busX + i * cell} x2={busX + i * cell} y1={94} y2={114} stroke={`${accent}33`} />}
            <Line x={busX + (i + 0.5) * cell} y={109} runs={[[verb]]} size={15.5} weight={500} anchor="middle" />
        </g>)}

        <Panel x={24} y={140} width={252} height={224} label="Catalog" />
        {catalog.map(([path, size, hit], i) => <g key={path}>
            {hit && <rect x={30} y={162 + i * 23} width={240} height={20} rx={5} fill={`${accent}12`} />}
            <Line x={36} y={176 + i * 23} runs={[[path, path.endsWith('/') ? INK : hit ? accent : INK]]} size={12.5} />
            {size && <Line x={264} y={176 + i * 23} runs={[[size]]} size={11} color={MUTED} anchor="end" />}
        </g>)}

        <Panel x={290} y={140} width={406} height={224} label="Agent calls" />
        {log.map((runs, i) => <Line key={i} x={302} y={176 + i * 19 + (i >= 3 ? 8 : 0)} runs={runs} size={11.5} />)}
        <rect x={302} y={298} width={382} height={56} rx={6} fill={FILL} />
        {table.map((row, r) => row.map((value, c) => <Line key={`${r}-${c}`} x={[312, 382, 452, 672][c]} y={315 + r * 17} runs={[[value]]}
            size={11} color={r === 0 ? MUTED : INK} anchor={c === 3 ? 'end' : 'start'} />))}
    </g>;
};

const DiscoverySlide: React.FC<{ accent: string }> = ({ accent }) => {
    const OK = '#7fd1a0', DIM = 'rgba(255,255,255,0.5)', TXT = 'rgba(255,255,255,0.88)';
    const terminal: Run[][] = [
        [['$ ', DIM], ['curl -sLO data.gov/airports.csv', TXT]],
        [['  3.4 MB → airports.csv', OK]],
        [['$ ', DIM], ['duckdb -c "select count(*)', TXT]],
        [['    from \'airports.csv\'"', TXT]],
        [['  19,214', OK]],
        [['$ ', DIM], ['python fetch_fares.py \\', TXT]],
        [['    --from SEA,LAX --to PEK,PVG', TXT]],
        [['  24 itineraries → fares.json', OK]],
        [['$ ', DIM]],
    ];
    const flights = [['Delta', '1 stop · 15h 10m', '$806'], ['United', '1 stop · 16h 05m', '$912'], ['Air China', 'nonstop · 12h 50m', '$1,140'],
        ['Hainan', 'nonstop · 13h 05m', '$1,215'], ['Alaska', '1 stop · 17h 40m', '$1,388']];
    const skills = ['analysis', 'visualization', 'map', 'report', 'html app', 'terminal', 'browser'];
    const chrome = (x: number, fill: string) => [0, 1, 2].map(i => <circle key={i} cx={x + i * 11} cy={32} r={3.2} fill={fill} />);
    return <g>
        <rect x={24} y={20} width={276} height={344} rx={10} fill="#2b2b2e" />
        {chrome(38, 'rgba(255,255,255,0.22)')}
        <text x={162} y={36} textAnchor="middle" fontSize={10.5} fill={DIM}>terminal · sandbox</text>
        {terminal.map((runs, i) => <Line key={i} x={36} y={64 + i * 21} runs={runs} size={12} />)}
        <rect x={52} y={221} width={7} height={14} fill={TXT} />

        <rect x={314} y={20} width={252} height={344} rx={10} fill="#fff" stroke={LINE} />
        {chrome(326, BAR)}
        <rect x={362} y={25} width={192} height={15} rx={7.5} fill={FILL} />
        <text x={372} y={36.5} fontSize={10.5} fill={MUTED}>google.com/travel/flights</text>
        <line x1={314} x2={566} y1={46} y2={46} stroke={LINE} />
        <Line x={326} y={66} runs={[['Seattle → Beijing']]} size={14} mono={false} weight={600} />
        <Line x={326} y={82} runs={[['Round trip · Feb 22 – 28 · Economy']]} size={10.5} mono={false} color={MUTED} />
        {flights.map(([airline, detail, price], i) => {
            const y = 92 + i * 42, hit = i === 0;
            return <g key={airline}>
                <rect x={322} y={y} width={236} height={36} rx={7} fill={hit ? `${accent}0d` : FILL}
                    stroke={hit ? accent : 'none'} strokeOpacity={0.7} strokeDasharray={hit ? '4 3' : undefined} />
                <Line x={332} y={y + 15} runs={[[airline]]} size={12} mono={false} weight={600} />
                <Line x={332} y={y + 28} runs={[[detail]]} size={10.5} mono={false} color={MUTED} />
                <Line x={548} y={y + 22} runs={[[price]]} size={13} mono={false} weight={600} anchor="end" color={hit ? accent : INK} />
            </g>;
        })}
        <Line x={326} y={316} runs={[['agent read 21 itineraries from this page', MUTED]]} size={10.5} mono={false} />

        <Panel x={580} y={20} width={116} height={344} label="Skills" />
        {skills.map((skill, i) => <g key={skill}>
            <rect x={590} y={44 + i * 34} width={96} height={26} rx={7} fill={FILL} />
            <Line x={600} y={61.5 + i * 34} runs={[[skill]]} size={12} mono={false} />
        </g>)}
        <rect x={590} y={44 + skills.length * 34} width={96} height={26} rx={7} fill="none" stroke={MUTED} strokeOpacity={0.45} strokeDasharray="4 3" />
        <Line x={600} y={61.5 + skills.length * 34} runs={[['+ add skill']]} size={12} mono={false} color={MUTED} />
    </g>;
};

const HarnessSlide: React.FC<{ accent: string }> = ({ accent }) => {
    const KW = '#8a5a9e', STR = '#a35a3c', FN = '#4a6fa5';
    const fares: [string, number][] = [['SEA → PEK', 806], ['LAX → PEK', 912], ['SEA → PVG', 1140], ['LAX → PVG', 1388]];
    const artifacts = [['chart', 'West Coast Beijing Routes'], ['report', 'Fare summary, Feb 2027'], ['app', 'Fare explorer']];
    const cell = (y: number, n: number, lines: Run[][], active = false) => <g>
        <rect x={24} y={y} width={384} height={14 + lines.length * 17} rx={8} fill="#fff" stroke={active ? accent : LINE} strokeOpacity={active ? 0.7 : 1} />
        {active && <rect x={24} y={y + 6} width={3} height={2 + lines.length * 17} rx={1.5} fill={accent} />}
        <Line x={33} y={y + 19.5} runs={[[`[${n}]`]]} size={10.5} color={MUTED} />
        {lines.map((runs, i) => <Line key={i} x={58} y={y + 19.5 + i * 17} runs={runs} size={11.5} />)}
    </g>;
    return <g>
        {cell(20, 1, [[['fares', INK], [' = pd.', MUTED], ['read_parquet', FN], ['(', MUTED], ['"fares.parquet"', STR], [')', MUTED]]])}
        {cell(58, 2, [
            [['west', INK], [' = (fares.', MUTED], ['query', FN], ['(', MUTED], ['"origin in [\'SEA\',\'LAX\']"', STR], [')', MUTED]],
            [['        .', MUTED], ['groupby', FN], ['(', MUTED], ['"route"', STR], [').fare_usd.', MUTED], ['min', FN], ['())', MUTED]],
        ])}
        <rect x={58} y={112} width={350} height={78} rx={6} fill={FILL} />
        <Line x={68} y={129} runs={[['route          fare_usd']]} size={11} color={MUTED} />
        {fares.slice(0, 3).map(([route, fare], i) => <Line key={route} x={68} y={147 + i * 16} runs={[[route.padEnd(15)], [String(fare)]]} size={11} />)}
        {cell(200, 3, [[['chart', FN], ['(', MUTED], ['"arc map"', STR], [', west, ', MUTED], ['color', KW], ['=', MUTED], ['"fare_usd"', STR], [')', MUTED]]], true)}
        <Line x={58} y={250} runs={[['✓ rendered with Flint · compact chart spec', MUTED]]} size={11} />
        {cell(264, 4, [[['report', FN], ['(', MUTED], ['"Fare summary"', STR], [', [chart, west])', MUTED]]])}
        {cell(302, 5, [[['app', FN], ['(', MUTED], ['"Fare explorer"', STR], [', west, ', MUTED], ['filters', KW], ['=[', MUTED], ['"origin"', STR], ['])', MUTED]]])}

        <Panel x={424} y={20} width={272} height={176} />
        <Line x={438} y={42} runs={[['Lowest fare by route (US$)']]} size={13} mono={false} weight={600} />
        {fares.map(([route, fare], i) => {
            const y = 58 + i * 32, width = (fare / 1388) * 134;
            return <g key={route}>
                <Line x={438} y={y + 15} runs={[[route]]} size={11.5} color={MUTED} />
                <rect x={506} y={y + 4} width={width} height={14} rx={3} fill={i === 0 ? accent : BAR} fillOpacity={i === 0 ? 0.8 : 1} />
                <Line x={511 + width} y={y + 15.5} runs={[[fare.toLocaleString()]]} size={10.5} color={MUTED} />
            </g>;
        })}

        <Panel x={424} y={208} width={272} height={156} label="Artifacts" />
        {artifacts.map(([kind, name], i) => <g key={kind}>
            <rect x={434} y={232 + i * 42} width={252} height={34} rx={7} fill={FILL} />
            <Line x={444} y={253.5 + i * 42} runs={[[kind, MUTED]]} size={11.5} />
            <Line x={498} y={253.5 + i * 42} runs={[[name]]} size={12.5} mono={false} weight={500} />
        </g>)}
    </g>;
};

const InteractionSlide: React.FC<{ accent: string }> = () => <g>
    <clipPath id="df-ui-clip"><rect width={W} height={H} rx={RADIUS} /></clipPath>
    <image href={uiScreenshot} width={W} height={H} clipPath="url(#df-ui-clip)" preserveAspectRatio="xMidYMid meet" />
</g>;

// ---------------------------------------------------------------- layers, back to front

export const Term: React.FC<{ children: React.ReactNode }> = ({ children }) => <Box component="span" sx={{
    color: INK, fontWeight: 500, whiteSpace: 'nowrap', textDecoration: 'underline', textDecorationThickness: '1px',
    textUnderlineOffset: '0.22em', textDecorationColor: ink(0.35),
}}>{children}</Box>;
/** GitHub star counts, fetched once per repo per page load (the public API allows 60 requests an hour). */
const starCounts = new Map<string, Promise<number | null>>();
const fetchStars = (repo: string) => {
    if (!starCounts.has(repo)) {
        starCounts.set(repo, fetch(`https://api.github.com/repos/${repo}`)
            .then(res => res.ok ? res.json() : null)
            .then(data => typeof data?.stargazers_count === 'number' ? data.stargazers_count : null, () => null));
    }
    return starCounts.get(repo)!;
};
const useStarCount = (repo: string) => {
    const [stars, setStars] = useState<number | null>(null);
    useEffect(() => {
        let live = true;
        fetchStars(repo).then(count => { if (live) setStars(count); });
        return () => { live = false; };
    }, [repo]);
    return stars;
};
const formatStars = (n: number) => n < 1000 ? `${n}` : `${(n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '')}k`;

/** A repo's star count after a thin divider; nothing until (or unless) GitHub answers. */
export const Stars: React.FC<{ repo: string }> = ({ repo }) => {
    const stars = useStarCount(repo);
    if (stars === null) return null;
    return <Box component="span" sx={{
        display: 'inline-flex', alignItems: 'center', gap: '0.2em', ml: '0.15em', pl: '0.5em', borderLeft: `1px solid ${LINE}`,
        color: MUTED, fontVariantNumeric: 'tabular-nums',
    }}>
        <StarBorderRoundedIcon sx={{ fontSize: '1.15em' }} />{formatStars(stars)}
    </Box>;
};

/** An inline link to a GitHub repo, styled as a small chip. */
export const RepoChip: React.FC<{ repo: string }> = ({ repo }) => <Box component="a" href={`https://github.com/${repo}`} target="_blank"
    rel="noreferrer" sx={{
        display: 'inline-flex', alignItems: 'center', gap: '0.3em', mx: '0.15em', px: '0.5em', py: '0.05em',
        verticalAlign: 'baseline', borderRadius: 999, border: `1px solid ${LINE}`, bgcolor: paper(),
        fontSize: '0.82em', lineHeight: 1.5, color: INK, textDecoration: 'none', whiteSpace: 'nowrap',
        transition: 'border-color .2s ease', '&:hover': { borderColor: ink(0.3) },
    }}>
    <GitHubIcon sx={{ fontSize: '1.05em' }} />{repo.split('/')[1]}<Stars repo={repo} />
</Box>;
export const Code: React.FC<{ children: React.ReactNode }> = ({ children }) => <Box component="span" sx={{ fontFamily: MONO, fontSize: '0.92em', color: INK }}>{children}</Box>;

const LAYERS: Layer[] = [
    {
        id: 'connector', depth: 3, side: 'left', row: 0, anchorX: 28, title: 'Data connector',
        points: [
            <>A <Term>unified protocol</Term> for agents to work with databases, warehouses, lakes, semantic models, and files the same way:{' '}
                <Code>ls</Code>, <Code>search</Code>, <Code>read</Code>, <Code>probe</Code>, <Code>load</Code>.</>,
            <><Term>Lazy connections</Term> let Data Formulator work with large and heterogeneous data effectively.</>,
        ],
        Content: ConnectorSlide, sketch: ['connector', 'Databases wired into one protocol'],
    },
    {
        id: 'discovery', depth: 2, side: 'right', row: 1, anchorX: 696, title: 'Data discovery tools',
        points: [
            <><Term>Terminal</Term> and <Term>browser use</Term> let agents discover new data on demand, and <Term>skills</Term> keep
                the toolbox extensible.</>,
            <><Term>Data memo</Term> lets agents actively manage and reuse data during exploration, reducing cost and improving
                reliability.</>,
        ],
        Content: DiscoverySlide, sketch: ['discovery', 'A browser and a terminal with a magnifier'],
    },
    {
        id: 'harness', depth: 1, side: 'left', row: 2, anchorX: 24, title: 'Data agent harness',
        points: [
            <>An interactive <Term>coding harness</Term> where agents transform data, create charts, and build artifacts.</>,
            <>The <Term>Flint language</Term> <RepoChip repo="microsoft/flint-chart" /> lets agents compose expressive, interactive charts reliably and token-efficiently.</>,
            <><Term>Plug-in memory and workflow modules</Term> support cross-task replay.</>,
        ],
        Content: HarnessSlide, sketch: ['harness', 'Notebook cells leading to a chart'],
    },
    {
        id: 'interaction', depth: 0, side: 'right', row: 3, anchorX: 676, title: 'User interaction',
        points: [
            <><Term>Data threads</Term> take an <Box component="span" sx={{ whiteSpace: 'nowrap' }}>artifact-centric</Box> approach to managing long‑horizon exploration and
                analysis.</>,
            <>An <Term>extensible interactive canvas</Term> lets users explore data with charts, maps, reports, and apps.</>,
        ],
        Content: InteractionSlide, sketch: ['interaction', 'A data thread branching into an editable chart'],
    },
];

const CORNERS: [number, number][] = [[4, 4], [W - 4, 4], [4, H - 4], [W - 4, H - 4]];

/** How far a hovered slide rises, in design units. */
const LIFT = 22;
const LIFT_TRANSITION = 'transform .35s cubic-bezier(.2,.8,.2,1)';

const Slide: React.FC<{ layer: Layer; accent: string; lifted: boolean; onHover: (id: string | null) => void }> = ({
    layer, accent, lifted, onHover,
}) => {
    const { Content } = layer;
    return <g>
        <g style={{ transform: `translateY(${lifted ? -LIFT : 0}px)`, transition: LIFT_TRANSITION }}
            onMouseEnter={() => onHover(layer.id)} onMouseLeave={() => onHover(null)}>
            <g transform={slideTransform(layer.depth, 8, 16)} filter="url(#df-soft-shadow)">
                <rect width={W} height={H} rx={RADIUS} fill="#000" opacity={0.08} />
            </g>
            {Array.from({ length: THICKNESS }, (_, k) => THICKNESS - k).map(t => <g key={t}
                transform={slideTransform(layer.depth, (t * STEP[0]) / STEP_LENGTH, (t * STEP[1]) / STEP_LENGTH)}>
                <rect width={W} height={H} rx={RADIUS} fill="#e4e4e7" stroke={t === THICKNESS ? LINE : 'none'} vectorEffect="non-scaling-stroke" />
            </g>)}
            <g transform={slideTransform(layer.depth)}>
                <rect width={W} height={H} rx={RADIUS} fill="#fff" />
                <Content accent={accent} />
                <rect width={W} height={H} rx={RADIUS} fill="none" stroke={LINE} vectorEffect="non-scaling-stroke" />
            </g>
        </g>
    </g>;
};

/** Dashed exploded-view guides joining a slide's corners to the slide in front of it. */
const Guides: React.FC<{ back: Layer; front: Layer }> = ({ back, front }) => <g>
    {CORNERS.map(([x, y], i) => {
        const [x1, y1] = project(x, y, back.depth), [x2, y2] = project(x, y, front.depth);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(0,0,0,0.28)" strokeDasharray="2 5" />;
    })}
</g>;

/** Where a layer's leader line starts on its slide, in design units. */
const anchorPoint = (layer: Layer): [number, number] => [project(layer.anchorX, 0, layer.depth)[0], ROW_Y0 + layer.row * ROW_GAP];

const Callout: React.FC<{ layer: Layer; accent: string; highlighted: boolean; onHover: (id: string | null) => void }> = ({
    layer, accent, highlighted, onHover,
}) => {
    const [, y] = anchorPoint(layer);
    const left = layer.side === 'left';
    return <Box onMouseEnter={() => onHover(layer.id)} onMouseLeave={() => onHover(null)} sx={{
        position: 'absolute', top: `${(y / DH) * 100}%`, width: CALLOUT_SPAN,
        ...(left ? { right: `${((DW - LEFT_COLUMN + 16) / DW) * 100}%` } : { left: `${((RIGHT_COLUMN + 16) / DW) * 100}%` }),
        transform: `translateY(-${u(SKETCH_H + SKETCH_GAP + TITLE_LINE / 2)})`, cursor: 'default',
    }}>
        <Box sx={{ width: u(SKETCH_W), height: u(SKETCH_H), mb: u(SKETCH_GAP), ml: u(-6) }}>
            <LayerSketch kind={layer.sketch[0]} label={layer.sketch[1]} />
        </Box>
        <Box sx={{ fontSize: u(TYPE.heading), lineHeight: u(TITLE_LINE), fontWeight: 600, letterSpacing: '-0.015em', whiteSpace: 'nowrap',
            color: highlighted ? accent : INK, transition: 'color .25s ease' }}>
            <Box component="span" sx={{ mr: u(10), fontVariantNumeric: 'tabular-nums' }}>{layer.row + 1}</Box>
            {layer.title}
        </Box>
        <Box component="ul" sx={{ m: 0, mt: u(12), p: 0, listStyle: 'none', fontSize: u(TYPE.body), lineHeight: 1.5, color: MUTED }}>
            {layer.points.map((point, i) => <Box component="li" key={i} sx={{ display: 'flex', gap: u(8), mt: i > 0 ? u(12) : 0 }}>
                <Box component="span" aria-hidden sx={{ color: ink(0.28), flexShrink: 0, width: '0.6em', textAlign: 'center' }}>–</Box>
                <span>{point}</span>
            </Box>)}
        </Box>
    </Box>;
};

const Leader: React.FC<{ layer: Layer; accent: string; lifted: boolean }> = ({ layer, accent, lifted }) => {
    const [x, y] = anchorPoint(layer);
    const end = layer.side === 'left' ? LEFT_COLUMN : RIGHT_COLUMN;
    const stroke = lifted ? accent : 'rgba(0,0,0,0.35)';
    const colorTransition = 'stroke .25s ease, fill .25s ease';
    return <g>
        <line x1={x} y1={y} x2={end} y2={y} stroke={stroke} strokeWidth={lifted ? 1.5 : 1} style={{ transition: colorTransition }} />
        <circle cx={end} cy={y} r={lifted ? 2.5 : 2} fill={lifted ? accent : 'rgba(0,0,0,0.45)'} style={{ transition: colorTransition }} />
        {/* While the slide is lifted, a short tick joins the line to the dot riding up with it. */}
        <line x1={x} y1={y} x2={x} y2={y - LIFT} stroke={stroke} strokeWidth={1.5}
            style={{ opacity: lifted ? 1 : 0, transition: 'opacity .2s ease' }} />
        <g style={{ transform: `translateY(${lifted ? -LIFT : 0}px)`, transition: LIFT_TRANSITION }}>
            <circle cx={x} cy={y} r={8} fill={accent} opacity={0.15} />
            <circle cx={x} cy={y} r={4} fill={accent} stroke="#fff" strokeWidth={1.5} />
        </g>
    </g>;
};

/** The architecture diagram: the stacked slides, their leader lines and callouts, inside a DesignFrame. */
export const ArchitectureDiagram: React.FC = () => {
    const accent = useTheme().palette.primary.main;
    const [active, setActive] = useState<string | null>(null);
    const slide = (layer: Layer) => <Slide key={layer.id} layer={layer} accent={accent} lifted={active === layer.id}
        onHover={setActive} />;
    const leader = (layer: Layer) => <Leader key={`leader-${layer.id}`} layer={layer} accent={accent}
        lifted={active === layer.id} />;
    const [groundX, groundY] = project(W / 2, H, 1.5);
    return <>
        <svg viewBox={`0 0 ${DW} ${DH}`} width="100%" height="100%" style={{ position: 'absolute', inset: 0, overflow: 'visible', fontFamily: fontSans }}>
            <defs>
                <filter id="df-soft-shadow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14" /></filter>
                <filter id="df-ground-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="28" /></filter>
            </defs>
            <ellipse cx={groundX} cy={groundY + 40} rx={520} ry={44} fill="#000" opacity={0.07} filter="url(#df-ground-blur)" />
            {LAYERS.flatMap((layer, i) => [
                i > 0 && <Guides key={`guides-${layer.id}`} back={LAYERS[i - 1]} front={layer} />,
                slide(layer),
            ])}
            {LAYERS.map(leader)}
        </svg>
        {LAYERS.map(layer => <Callout key={layer.id} layer={layer} accent={accent} highlighted={active === layer.id} onHover={setActive} />)}
    </>;
};

/** The page's title block and GitHub link, across the top of the frame. */
const DesignHeader: React.FC = () => {
    const version = useSelector((state: DataFormulatorState) => state.serverConfig?.VERSION);
    return <Box component="header" sx={{
        position: 'absolute', top: u(40),
        left: `calc(${u(LEFT_COLUMN - 16)} - ${CALLOUT_SPAN})`, right: `calc(${u(DW - RIGHT_COLUMN - 16)} - ${CALLOUT_SPAN})`,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: u(24),
    }}>
        <Box>
            <Box component="h1" sx={{
                m: 0, display: 'flex', alignItems: 'center', gap: u(14),
                fontSize: u(TYPE.display), fontWeight: 650, letterSpacing: '-0.03em', lineHeight: 1.05, color: INK,
            }}>
                <Box component="img" src="/data-formulator-logo-128.png" alt="" sx={{ width: u(52), height: u(52) }} />
                <span>
                    Data Formulator
                    {version && <Box component="span" sx={{
                        ml: u(14), fontSize: u(TYPE.body), fontWeight: 400, letterSpacing: 0, color: 'text.disabled',
                        ...identText, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                    }}>v{version}</Box>}
                </span>
            </Box>
            <Box sx={{ mt: u(10), ml: u(52 + 14), fontSize: u(TYPE.heading), fontWeight: 500, letterSpacing: '-0.01em', lineHeight: 1.25, color: MUTED }}>
                An evolving, interactive data agent harness
            </Box>
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: u(8), flexShrink: 0 }}>
            <Box component="a" href="https://github.com/microsoft/data-formulator" target="_blank" rel="noreferrer" sx={{
                display: 'flex', alignItems: 'center', gap: u(10), px: u(18), py: u(10), borderRadius: u(999),
                border: `1px solid ${LINE}`, bgcolor: paper(), color: INK, textDecoration: 'none',
                fontSize: u(TYPE.body), fontWeight: 500, boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                transition: 'border-color .2s ease, box-shadow .2s ease',
                '&:hover': { borderColor: ink(0.3), boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)' },
            }}>
                <GitHubIcon sx={{ fontSize: u(22) }} />
                microsoft/data-formulator
                <Stars repo="microsoft/data-formulator" />
            </Box>
            <Box sx={{ fontSize: u(TYPE.body), color: MUTED, pr: u(4) }}>Open source · MIT License</Box>
        </Box>
    </Box>;
};

/** A design page: the grid background, the dev nav (and an optional bar under it), and a stage that scales its
 *  DW x DH frame with the window height. The header (unless `header` is false) is drawn in the frame; `children`
 *  lay out under it, in design units (`u`). With an aspect ratio, the stage keeps that shape and fits both viewport
 *  dimensions; it stays DH units tall, and the DW-wide frame is centred in it. */
export const DesignFrame: React.FC<{ bar?: React.ReactNode; barHeight?: number; header?: boolean; aspectRatio?: number; children: React.ReactNode }> = ({
    bar, barHeight = 0, header = true, aspectRatio, children,
}) => {
    const stageHeight = `(100vh - ${DEV_NAV_HEIGHT + barHeight + 32}px)`;
    return <Box sx={{
        height: '100vh', overflowY: 'auto', fontFamily: fontSans, color: INK, WebkitFontSmoothing: 'antialiased', bgcolor: 'background.paper',
        backgroundImage: theme => `linear-gradient(90deg, ${alpha(theme.palette.text.primary, 0.02)} 1px, transparent 1px), linear-gradient(0deg, ${alpha(theme.palette.text.primary, 0.02)} 1px, transparent 1px)`,
        backgroundSize: '24px 24px',
    }}>
        <DevNav />
        {bar}
        <Box component="section" sx={{ height: `calc(100vh - ${DEV_NAV_HEIGHT + barHeight}px)`, overflowX: 'auto', p: 2, boxSizing: 'border-box' }}>
            <Box sx={{
                position: 'relative', mx: 'auto', containerType: 'size',
                ...(aspectRatio === undefined ? {
                    height: `calc${stageHeight}`, width: '100%',
                    minWidth: `calc(${stageHeight} * ${DW / DH})`, maxWidth: `calc(${stageHeight} * ${DW_MAX / DH})`,
                } : {
                    aspectRatio, width: '100%', maxWidth: `calc(${stageHeight} * ${aspectRatio})`, overflow: 'hidden',
                }),
            }}>
                <Box sx={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: u(DW), transform: 'translateX(-50%)' }}>
                    {header && <DesignHeader />}
                    {children}
                </Box>
            </Box>
        </Box>
    </Box>;
};

export default function DevDesignPage() {
    return <DesignFrame><ArchitectureDiagram /></DesignFrame>;
}
