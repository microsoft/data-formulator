// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * /dev/about: what Data Formulator is, on still pages in the style of /dev/design (the same frame, header and
 * type sizes): what it is, its architecture, the NeurIPS demo, and its projects. The arrow keys (or a
 * presenter's clicker) move between them; each has its own URL (/dev/about/<page>).
 */

import React, { useEffect, useState } from 'react';
import { Box, useTheme } from '@mui/material';
import { useNavigate, useParams } from 'react-router-dom';
import PublicRoundedIcon from '@mui/icons-material/PublicRounded';
import PersonOutlineRoundedIcon from '@mui/icons-material/PersonOutlineRounded';
import GitHubIcon from '@mui/icons-material/GitHub';
import PlayCircleOutlineRoundedIcon from '@mui/icons-material/PlayCircleOutlineRounded';
import QRCode from 'qrcode';
import {
    ArchitectureDiagram, CALLOUT_SPAN, DesignFrame, DH, DW, FILL, INK, LEFT_COLUMN, LINE, MONO, MUTED, Stars, Term, TYPE, u,
} from '../DevDesignPage';
import { fontSans, ink } from '../../app/tokens';
import { LayerSketch, SketchBrace, SketchPointers, type LayerSketchKind, type SketchPointer } from '../DevDesignSketch';
import { CONNECTOR_ICON_MAP } from '../../icons';
import sessionShot from './assets/neurips-session.webp';
import dfPaperThumbnail from './assets/df-paper.png';
import flintPaperThumbnail from './assets/flint-paper.png';
import reuseitPaperThumbnail from './assets/reuseit-paper.png';
import plugmemPaperThumbnail from './assets/plugmem-paper.png';

const REPO = 'https://github.com/microsoft/data-formulator';

// ---------------------------------------------------------------- shared pieces (design units)

/** A box placed in the frame at design-unit coordinates. */
const At: React.FC<{ x: number; y: number; w?: number; h?: number; children: React.ReactNode; sx?: object }> = ({ x, y, w, h, children, sx }) =>
    <Box sx={{ position: 'absolute', left: u(x), top: u(y), width: w === undefined ? undefined : u(w), height: h === undefined ? undefined : u(h), ...sx }}>
        {children}
    </Box>;

/** A heading in the callouts' style: a number, then the title. */
const Heading: React.FC<{ n?: number | string; children: React.ReactNode }> = ({ n, children }) => <Box sx={{
    fontSize: u(TYPE.heading), lineHeight: 1.15, fontWeight: 600, letterSpacing: '-0.015em', color: INK,
}}>
    {n !== undefined && <Box component="span" sx={{ mr: u(10), fontVariantNumeric: 'tabular-nums' }}>{n}</Box>}
    {children}
</Box>;

const Body: React.FC<{ children: React.ReactNode; sx?: object }> = ({ children, sx }) => <Box sx={{
    fontSize: u(TYPE.body), lineHeight: 1.5, color: MUTED, ...sx,
}}>{children}</Box>;

const Card: React.FC<{ children: React.ReactNode; sx?: object }> = ({ children, sx }) => <Box sx={{
    borderRadius: u(14), bgcolor: '#fff', border: `1px solid ${LINE}`, boxShadow: '0 6px 24px rgba(0,0,0,0.06)', overflow: 'hidden', ...sx,
}}>{children}</Box>;

// ---------------------------------------------------------------- 1. what

/** The title, a row (people · Data Formulator · data) and the talking points, top to bottom, laid out DW wide on a
 *  16:9 stage (so WHAT_H tall) and scaled up to fill the stage, which is DH tall. */
const WHAT_ASPECT = 16 / 9, WHAT_H = DW / WHAT_ASPECT, WHAT_SCALE = DH / WHAT_H;
const EDGE = 40;
const TITLE_Y = 0, TITLE_H = 140;
const PEOPLE_X = 36, PEOPLE_W = 160;
/** The row is the slide's centre: the screenshot as wide as the people, the trace and the data sources leave room for. */
const SHOT_X = PEOPLE_X + PEOPLE_W + 32, SHOT_W = 870, SHOT_H = SHOT_W * 9 / 16, TRACE_W = 420, GAP = 20;
const TRACE_X = SHOT_X + SHOT_W + GAP;
/** Connector icons sit in two staggered columns right of the trace. */
const CONN_X = TRACE_X + TRACE_W + 48, CONN_STAGGER = 16, CONN_STEP = 46;
/** A brace over the row points up at the title (the row is Data Formulator); a brace under each part points down at its message. */
const TOP_BRACE_Y = TITLE_Y + TITLE_H + 26, BRACE_H = 26;
const MID_Y = TOP_BRACE_Y + BRACE_H + 16;
/** The middle of the row (the screenshot and the trace), where the title and the braces' points sit. */
const ROW_MID = (SHOT_X + TRACE_X + TRACE_W) / 2;
const ROW_Y = MID_Y + SHOT_H / 2;
const BRACKET_Y = MID_Y + SHOT_H + 18;
const MSG_Y = BRACKET_Y + BRACE_H + 16, MSG_H = 80;
/** Centres the content vertically on the stage. */
const WHAT_SHIFT = (WHAT_H - (MSG_Y + MSG_H) - TITLE_Y) / 2;
const QR_SIZE = 116;
/** The slide's four type sizes: its name, its one line, the rest, and small print (labels and the trace). */
const WT = { title: 76, lead: 27, body: 18, small: 14 } as const;

const PEOPLE: [string, number][] = [
    ['Analysts', -20],
    ['Scientists', 18],
    ['Journalists', -8],
    ['Students', 28],
    ['Domain experts', -24],
    ['Business users', 12],
    ['Curious minds', -14],
    ['Developers', 22],
    ['...', 4],
];
/** Data sources on the right: [connector type (or null for the web), label]. */
const CONNECTORS: [string | null, string][] = [
    ['postgresql', 'PostgreSQL'], ['snowflake', 'Snowflake'], ['bigquery', 'BigQuery'], ['databricks', 'Databricks'],
    ['kusto', 'Kusto'], ['s3', 'Amazon S3'], ['powerbi', 'Power BI'], ['dataverse', 'Dataverse'],
    ['mongodb', 'MongoDB'], [null, 'Web'],
];
/** A connector's icon centre: x, and y relative to the row. */
const connectorAt = (i: number): [number, number] =>
    [CONN_X + (i % 2) * CONN_STAGGER, (i - (CONNECTORS.length - 1) / 2) * CONN_STEP];
/** Where a person's label ends (it is right-aligned there, its line starts there): x, and y relative to the row. They sit
 *  a little below the row, under the person icon, staggered like the connectors. */
const PEOPLE_STEP = 30, PEOPLE_DROP = 36;
const personAt = (i: number): [number, number] =>
    [PEOPLE_X + PEOPLE_W - 40 + PEOPLE[i][1] * 0.6, PEOPLE_DROP + (i - (PEOPLE.length - 1) / 2) * PEOPLE_STEP];

type CodeKind = 'kw' | 'str' | 'plain' | 'muted';
const CODE_COLOR: Record<CodeKind, string> = { kw: '#1565c0', str: '#2e7d32', plain: INK, muted: 'rgba(0,0,0,0.45)' };
/** The tool calls behind the map, as the analyst made them in the NeurIPS space's story (abridged). */
const TRACE: [string, string, [CodeKind, string][] | null][] = [
    ['load_skill', '("map")', null],
    ['read_file', '("NeurIPS data guide.md")', null],
    ['create_data', '→ papers_by_country_2026', [
        ['kw', 'select country_code, country,'],
        ['plain', '  count(*) as authors,'],
        ['plain', '  round(100.0 * count(*) / total, 1) as share'],
        ['kw', 'from authorships_2026'],
        ['plain', '  join institutions using (institution) …'],
        ['kw', 'group by all order by authors desc'],
    ]],
    ['create_file', '→ papers_by_country_2026.map.json', [
        ['plain', '{ "template": "choropleth",'],
        ['plain', '  "data": { "table": "papers_by_country_2026" },'],
        ['plain', '  "encoding": {'],
        ['plain', '    "region": "country_code", "color": "share" } }'],
    ]],
    ['view', '("papers_by_country_2026.map.json")', null],
];

const MESSAGES: [number, number, LayerSketchKind, string, React.ReactNode][] = [
    [PEOPLE_X, SHOT_X + SHOT_W - PEOPLE_X, 'interaction', 'A person asking a question and steering a chart', <>
        <b>Data threads</b> and an <b>interactive canvas</b> bridge users and agents<br />to work on <b>long-horizon data exploration</b>.</>],
    [TRACE_X, DW - EDGE - TRACE_X, 'connector', 'Databases wired into one protocol', <>
        A <b>unified agent-data protocol</b> to discover, connect<br />and analyze <b>heterogeneous and large datasets</b>.</>],
];

/** A muted connector icon with its label beside it, centred on (x, y). */
const Spot: React.FC<{ x: number; y: number; label: string; children: React.ReactNode }> = ({ x, y, label, children }) =>
    <At x={x - 20} y={y - 20} w={200} h={40} sx={{
        display: 'flex', alignItems: 'center', gap: u(10), color: ink(0.5),
    }}>
        {children}
        <Box sx={{ fontSize: u(WT.small), color: MUTED, lineHeight: 1.2, whiteSpace: 'nowrap' }}>{label}</Box>
    </At>;

const WhatPage: React.FC = () => {
    const accent = useTheme().palette.primary.main;
    const qr = useQrCode(REPO);
    const fan = 'rgba(0,0,0,0.12)';
    const iconSx = { fontSize: u(36), display: 'block', flexShrink: 0 };
    return <Box sx={{
        position: 'absolute', inset: 0, transformOrigin: 'top center',
        transform: `scale(${WHAT_SCALE}) translateY(${u(WHAT_SHIFT)})`,
    }}>
        {/* Data Formulator on the left; its repository (metadata, then QR code) on the right. */}
        {/* Data Formulator, centred over the row the brace below it groups; its repository follows its one line. */}
        <At x={ROW_MID - 800} y={TITLE_Y} w={1600} h={TITLE_H} sx={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        }}>
            <Box component="h1" sx={{
                m: 0, display: 'flex', alignItems: 'center', gap: u(14),
                fontSize: u(WT.title), fontWeight: 650, letterSpacing: '-0.03em', lineHeight: 1.05, color: INK,
            }}>
                <Box component="img" src="/data-formulator-logo-128.png" alt="" sx={{ width: u(WT.title), height: u(WT.title) }} />
                Data Formulator
            </Box>
            <Box sx={{ mt: u(10), display: 'flex', alignItems: 'center', gap: u(20), whiteSpace: 'nowrap' }}>
                <Box sx={{ fontSize: u(WT.lead), fontWeight: 500, letterSpacing: '-0.01em', lineHeight: 1.3, color: MUTED }}>
                    An interactive agent harness bridging any person × any data
                </Box>
                <Box component="a" href={REPO} target="_blank" rel="noreferrer" sx={{
                    display: 'flex', alignItems: 'center', gap: u(8), alignSelf: 'center', color: INK, textDecoration: 'none',
                    px: u(14), py: u(6), borderRadius: u(999), border: `1px solid ${LINE}`, bgcolor: '#fff',
                    fontSize: u(WT.body), fontWeight: 500, '&:hover': { color: accent, borderColor: accent },
                    '&:focus-visible': { outline: `2px solid ${accent}`, outlineOffset: u(4) },
                }}>
                    <GitHubIcon sx={{ fontSize: u(22) }} />microsoft/data-formulator<Stars repo="microsoft/data-formulator" />
                </Box>
            </Box>
        </At>
        {/* Its QR code, at the top right. */}
        {qr && <At x={DW - EDGE - QR_SIZE} y={TITLE_Y + (TITLE_H - QR_SIZE) / 2} w={QR_SIZE} h={QR_SIZE}>
            <Box component="a" href={REPO} target="_blank" rel="noreferrer" aria-label="Data Formulator on GitHub" sx={{
                display: 'block', borderRadius: u(10),
                '&:focus-visible': { outline: `2px solid ${accent}`, outlineOffset: u(4) },
            }}>
                <Box component="img" src={qr} alt={`QR code for ${REPO}`} sx={{
                    display: 'block', width: u(QR_SIZE), height: u(QR_SIZE), borderRadius: u(10), border: `1px solid ${LINE}`,
                }} />
            </Box>
        </At>}

        {/* People and data fan into it: any person, any data. */}
        <svg viewBox={`0 0 ${DW} ${DH}`} width="100%" height="100%" style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
            {PEOPLE.map(([label], i) => {
                const [x, dy] = personAt(i);
                return <line key={label} x1={x + 8} y1={ROW_Y + dy} x2={SHOT_X - 8} y2={ROW_Y} stroke={fan} />;
            })}
            {CONNECTORS.map(([, label], i) => {
                const [x, dy] = connectorAt(i);
                return <line key={label} x1={TRACE_X + TRACE_W + 8} y1={ROW_Y} x2={x - 30} y2={ROW_Y + dy} stroke={fan} />;
            })}
        </svg>
        <At x={PEOPLE_X} y={ROW_Y + personAt(0)[1] - 9 - 24 - 48} w={PEOPLE_W - 30} h={48} sx={{ display: 'flex', justifyContent: 'center', color: ink(0.5) }}>
            <PersonOutlineRoundedIcon sx={{ fontSize: u(48) }} />
        </At>
        {PEOPLE.map(([label], i) => {
            const [x, dy] = personAt(i);
            return <At key={label} x={x - 200} y={ROW_Y + dy - 10} w={200} h={20} sx={{
                display: 'flex', alignItems: 'center', justifyContent: 'flex-end', fontSize: u(WT.small), lineHeight: 1.2, color: MUTED, whiteSpace: 'nowrap',
            }}>{label}</At>;
        })}
        {CONNECTORS.map(([type, label], i) => {
            const [x, dy] = connectorAt(i);
            const Icon = type ? CONNECTOR_ICON_MAP[type] : PublicRoundedIcon;
            return <Spot key={label} x={x} y={ROW_Y + dy} label={label}><Icon sx={iconSx} /></Spot>;
        })}

        {/* What people see: Data Formulator, with the answer open on its canvas. */}
        <At x={SHOT_X} y={MID_Y} w={SHOT_W} h={SHOT_H}>
            <Card sx={{ height: '100%' }}>
                <Box component="img" src={sessionShot} alt="Data Formulator with a NeurIPS session: its data threads and a map of where NeurIPS 2026 authors work"
                    sx={{ display: 'block', width: '100%', height: '100%' }} />
            </Card>
        </At>
        {/* What the agents do with the data: the tool calls and code behind the map. */}
        <At x={TRACE_X} y={MID_Y} w={TRACE_W} h={SHOT_H}>
            <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <Box sx={{
                    display: 'flex', justifyContent: 'space-between', px: u(16), py: u(9), borderBottom: `1px solid ${LINE}`,
                    fontSize: u(WT.small), fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED,
                }}>
                    <span>Agent trace</span><span>{TRACE.length} tool calls</span>
                </Box>
                <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden', px: u(16), py: u(14), fontFamily: MONO, fontSize: u(WT.small - 2), lineHeight: 1.7 }}>
                    {TRACE.map(([tool, arg, code], i) => <Box key={tool + i} sx={{ mt: i ? u(12) : 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: u(8), whiteSpace: 'nowrap' }}>
                            <Box sx={{
                                width: u(18), height: u(18), borderRadius: '50%', bgcolor: accent, color: '#fff', fontFamily: fontSans,
                                fontSize: u(WT.small - 2), fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                            }}>{i + 1}</Box>
                            <Box component="span" sx={{ color: accent, fontWeight: 600 }}>{tool}</Box>
                            <Box component="span" sx={{ color: MUTED }}>{arg}</Box>
                        </Box>
                        {code && <Box sx={{ ml: u(26), mt: u(4), pl: u(10), borderLeft: `2px solid ${LINE}`, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: INK }}>
                            {code.map(([kind, text], j) => <Box key={j} sx={{ color: CODE_COLOR[kind] }}>{text || ' '}</Box>)}
                        </Box>}
                    </Box>)}
                </Box>
            </Card>
        </At>

        {/* Both parts are Data Formulator: a brace over them points up at its name. */}
        <At x={SHOT_X} y={TOP_BRACE_Y} w={TRACE_X + TRACE_W - SHOT_X} h={BRACE_H}>
            <SketchBrace width={TRACE_X + TRACE_W - SHOT_X} height={BRACE_H} flip />
        </At>
        {MESSAGES.map(([x, w, kind, label, text]) => <React.Fragment key={x}>
            <At x={x} y={BRACKET_Y} w={w} h={BRACE_H}>
                <SketchBrace width={w} height={BRACE_H} />
            </At>
            <At x={x} y={MSG_Y} w={w} h={MSG_H} sx={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: u(16),
            }}>
                <Box sx={{ width: u(80), height: u(60), flexShrink: 0 }}><LayerSketch kind={kind} label={label} /></Box>
                <Body sx={{ fontSize: u(WT.body), whiteSpace: 'nowrap', '& b': { color: INK, fontWeight: 600 } }}>{text}</Body>
            </At>
        </React.Fragment>)}
    </Box>;
};

// ---------------------------------------------------------------- 2. architecture

/** The architecture diagram under its own title, aligned with the left callouts; the diagram rises a little to balance
 *  the slide's top and bottom margins. */
const ARCH_RISE = 18;
const ArchitecturePage: React.FC = () => <>
    <Box component="h1" sx={{
        position: 'absolute', top: u(48), left: `calc(${u(LEFT_COLUMN - 16)} - ${CALLOUT_SPAN})`, m: 0,
        fontSize: u(TYPE.display), fontWeight: 650, letterSpacing: '-0.03em', lineHeight: 1.05, color: INK,
    }}>
        Inside Data Formulator
    </Box>
    <Box sx={{ position: 'absolute', inset: 0, transform: `translateY(-${u(ARCH_RISE)})` }}>
        <ArchitectureDiagram />
    </Box>
</>;

// ---------------------------------------------------------------- 3. NeurIPS demo

/** The demo video, e.g. an import of a file in ./assets; until it is set, the page shows a placeholder. */
const DEMO_VIDEO: string | null = null;

const VIDEO_W = 1640, VIDEO_H = VIDEO_W * 9 / 16;
const VIDEO_X = (DW - VIDEO_W) / 2, VIDEO_Y = (DH - VIDEO_H) / 2;

const NeuripsPage: React.FC = () => {
    const accent = useTheme().palette.primary.main;
    return <>
        <At x={VIDEO_X} y={VIDEO_Y} w={VIDEO_W} h={VIDEO_H}>
            <Card sx={{ width: '100%', height: '100%', boxShadow: '0 24px 70px rgba(0,0,0,0.14)' }}>
                {DEMO_VIDEO
                    ? <Box component="video" src={DEMO_VIDEO} controls playsInline sx={{ display: 'block', width: '100%', height: '100%', bgcolor: '#000' }} />
                    : <Box sx={{
                        height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: u(18),
                        bgcolor: FILL,
                    }}>
                        <PlayCircleOutlineRoundedIcon sx={{ fontSize: u(96), color: accent }} />
                        <Heading>A session at NeurIPS</Heading>
                        <Body>Demo video coming soon.</Body>
                    </Box>}
            </Card>
        </At>
    </>;
};

// ---------------------------------------------------------------- 4. projects

const useQrCode = (text: string) => {
    const [src, setSrc] = useState<string | null>(null);
    useEffect(() => {
        let live = true;
        QRCode.toDataURL(text, { margin: 1, width: 320, errorCorrectionLevel: 'M' }).then(url => { if (live) setSrc(url); }, () => undefined);
        return () => { live = false; };
    }, [text]);
    return src;
};

interface Project {
    name: string; blurb: string; repo?: string; paper: string; paperTitle: string; authors: string;
    paperThumbnail: string;
    /** Its part in Data Formulator, the colour that marks it, and its sketch. */
    role: string; roleColor: string; sketch: LayerSketchKind;
}

/** Research projects, with papers and repositories where available. */
const PROJECTS: Project[] = [
    {
        name: 'Data Formulator', role: 'the interactive system', roleColor: '#2f6db5', sketch: 'interaction',
        blurb: 'A data thread model to support long-horizon interaction between users and agents.',
        repo: 'microsoft/data-formulator', paper: 'https://arxiv.org/abs/2408.16119',
        paperTitle: 'Data Formulator 2: Iterative Creation of Data Visualizations, with AI Transforming Data Along the Way',
        authors: 'Chenglong Wang, Bongshin Lee, Steven Drucker, Dan Marshall, Jianfeng Gao',
        paperThumbnail: dfPaperThumbnail,
    },
    {
        name: 'Flint', role: 'the visualization language', roleColor: '#d0502a', sketch: 'spec',
        blurb: 'Distills LLM visualization knowledge into a compiler, so agents create expressive charts reliably with a simple language.',
        repo: 'microsoft/flint-chart', paper: 'https://arxiv.org/abs/2607.20775',
        paperTitle: 'Flint: A Semantics-Driven Data Visualization Intermediate Language',
        authors: 'Yunhai Wang, Kecheng Lu, Junhao Chen, Alper Sarikaya, Chenglong Wang',
        paperThumbnail: flintPaperThumbnail,
    },
    {
        name: 'ReUseIt', role: 'the workflow mechanism', roleColor: '#24877b', sketch: 'workflow',
        blurb: 'Distills agent traces into verifiable workflows for future reuse and generalization.',
        paper: 'https://arxiv.org/abs/2510.14308',
        paperTitle: 'ReUseIt: Synthesizing Reusable AI Agent Workflows for Web Automation',
        authors: 'Yimeng Liu, Misha Sra, Jeevana Priya Inala, Chenglong Wang',
        paperThumbnail: reuseitPaperThumbnail,
    },
    {
        name: 'PlugMem', role: 'the memory layer', roleColor: '#a8740f', sketch: 'memory',
        blurb: 'A plug-in memory module that gives AI agents reusable facts and skills.',
        paper: 'https://arxiv.org/abs/2603.03296',
        paperTitle: 'PlugMem: A Task-Agnostic Plugin Memory Module for LLM Agents',
        authors: 'Ke Yang, Zixi Chen, Xuan He, Jize Jiang, Michel Galley, Chenglong Wang, Jianfeng Gao, Jiawei Han, ChengXiang Zhai',
        paperThumbnail: plugmemPaperThumbnail,
    },
];

/** Laid out like the "what" page: DW wide on a 16:9 stage, scaled to fill it. A table of the projects (name, repository,
 *  paper) on the left; what each one does, as a sketched callout pointing at its row, on the right. */
const CHECK_EDGE_X = 64, CHECK_TOP = 48, TABLE_Y = 150;
const TABLE_W = 1040;
/** Each row as tall as it needs: the two with a repository (and QR code) taller than the two with a paper only. */
const ROW_HEIGHTS = [210, 190, 150, 160];
const rowTop = (i: number) => TABLE_Y + ROW_HEIGHTS.slice(0, i).reduce((sum, h) => sum + h, 0);
const NAME_W = 236, QR_COL = 96;
/** Each callout: an arrow back to its row, a sketch of what the project does, and the words for it. */
const SKETCH_X = TABLE_W + CHECK_EDGE_X + 92, SKETCH_W = 112, SKETCH_H = 84;
const NOTE_X = SKETCH_X + SKETCH_W + 18, NOTE_W = DW - CHECK_EDGE_X - NOTE_X;
/** How each callout's arrow curves, so the four don't read as one ruled set. */
const NOTE_BENDS = [-18, 14, -12, 16];

const RepositoryQrCode: React.FC<{ name: string; repo: string; size?: number }> = ({ name, repo, size = 82 }) => {
    const url = `https://github.com/${repo}`;
    const qr = useQrCode(url);
    const accent = useTheme().palette.primary.main;
    return qr && <Box component="a" href={url} target="_blank" rel="noreferrer" aria-label={`Scan ${name} repository`} sx={{
        display: 'block', flexShrink: 0, borderRadius: u(4),
        '&:focus-visible': { outline: `2px solid ${accent}`, outlineOffset: u(4) },
    }}>
        <Box component="img" src={qr} alt={`QR code for ${url}`} sx={{
            display: 'block', width: u(size), height: u(size), border: `1px solid ${LINE}`, borderRadius: u(4),
        }} />
    </Box>;
};

/** One row of the table: the project's name, its repository and paper, and its repository's QR code. */
const ProjectRow: React.FC<{ project: Project; first: boolean }> = ({ project, first }) => {
    const accent = useTheme().palette.primary.main;
    // An icon slot, then the text: the GitHub link's and the paper's text line up.
    const linkSx = {
        display: 'grid', gridTemplateColumns: `${u(40)} minmax(0, 1fr)`, alignItems: 'center', columnGap: u(14),
        color: INK, textDecoration: 'none', minWidth: 0, fontSize: u(20), fontWeight: 500, '&:hover': { color: accent },
        '&:focus-visible': { outline: `2px solid ${accent}`, outlineOffset: u(4) },
    };
    return <Box sx={{
        height: '100%', boxSizing: 'border-box', display: 'grid', alignItems: 'center', columnGap: u(20),
        gridTemplateColumns: `${u(NAME_W)} minmax(0, 1fr) ${u(QR_COL)}`, pr: u(4),
        borderTop: first ? `1px solid ${LINE}` : 'none', borderBottom: `1px solid ${LINE}`,
    }}>
        <Box sx={{ minWidth: 0 }}>
            <Box component="h2" sx={{ m: 0, fontSize: u(30), fontWeight: 650, letterSpacing: '-0.02em', lineHeight: 1.1, color: INK, whiteSpace: 'nowrap' }}>
                {project.name}
            </Box>
            <Box sx={{ mt: u(6), fontSize: u(17), fontWeight: 600, color: project.roleColor, whiteSpace: 'nowrap' }}>
                ({project.role})
            </Box>
        </Box>
        <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: u(16) }}>
            {project.repo && <Box component="a" href={`https://github.com/${project.repo}`} target="_blank" rel="noreferrer"
                aria-label={`${project.name} on GitHub`} sx={linkSx}>
                <GitHubIcon sx={{ fontSize: u(28), justifySelf: 'center' }} />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: u(10), minWidth: 0, whiteSpace: 'nowrap' }}>
                    GitHub: https://github.com/{project.repo}<Stars repo={project.repo} />
                </Box>
            </Box>}
            <Box component="a" href={project.paper} target="_blank" rel="noreferrer" aria-label={project.paperTitle} sx={linkSx}>
                <Box component="img" src={project.paperThumbnail} alt="" sx={{
                    width: u(40), height: u(52), objectFit: 'contain', bgcolor: 'background.paper', border: `1px solid ${LINE}`, borderRadius: u(2),
                }} />
                <Box sx={{ minWidth: 0 }}>
                    <Box sx={{ fontSize: u(19), lineHeight: 1.3, textWrap: 'balance' }}>{project.paperTitle}</Box>
                    <Box sx={{ mt: u(4), fontSize: u(15), lineHeight: 1.4, fontWeight: 400, color: MUTED, textWrap: 'balance' }}>{project.authors}</Box>
                </Box>
            </Box>
        </Box>
        {project.repo ? <RepositoryQrCode name={project.name} repo={project.repo} size={QR_COL} /> : <span />}
    </Box>;
};

const ProjectsPage: React.FC = () => {
    const rowMid = (i: number) => rowTop(i) + ROW_HEIGHTS[i] / 2;
    const pointers: SketchPointer[] = PROJECTS.map((project, i) => ({
        from: [SKETCH_X - 10, rowMid(i)], to: [CHECK_EDGE_X + TABLE_W + 16, rowMid(i)], bend: NOTE_BENDS[i], color: project.roleColor,
    }));
    return <Box sx={{ position: 'absolute', inset: 0, transformOrigin: 'top center', transform: `scale(${WHAT_SCALE})` }}>
        <At x={CHECK_EDGE_X} y={CHECK_TOP} w={DW - 2 * CHECK_EDGE_X}>
            <Box component="h1" sx={{ m: 0, fontSize: u(TYPE.display), fontWeight: 650, letterSpacing: '-0.025em', lineHeight: 1.05, color: INK }}>
                Research behind Data Formulator
            </Box>
        </At>
        {PROJECTS.map((project, i) => <React.Fragment key={project.name}>
            <At x={CHECK_EDGE_X} y={rowTop(i)} w={TABLE_W} h={ROW_HEIGHTS[i]}><ProjectRow project={project} first={i === 0} /></At>
            <At x={SKETCH_X} y={rowMid(i) - SKETCH_H / 2} w={SKETCH_W} h={SKETCH_H}>
                <LayerSketch kind={project.sketch} label={`${project.name}: ${project.role}`} />
            </At>
            <At x={NOTE_X} y={rowTop(i)} w={NOTE_W} h={ROW_HEIGHTS[i]} sx={{ display: 'flex', alignItems: 'center' }}>
                <Body sx={{ fontSize: u(19), lineHeight: 1.45, fontWeight: 500, color: project.roleColor, textWrap: 'pretty' }}>{project.blurb}</Body>
            </At>
        </React.Fragment>)}
        <At x={0} y={0} w={DW} h={WHAT_H} sx={{ pointerEvents: 'none' }}>
            <SketchPointers width={DW} height={WHAT_H} pointers={pointers} />
        </At>
    </Box>;
};

// ---------------------------------------------------------------- the page

const PAGES: { id: string; label: string; Content: React.FC; header?: boolean; slide?: boolean }[] = [
    { id: 'what', label: 'What', Content: WhatPage, header: false, slide: true },
    { id: 'architecture', label: 'Architecture', Content: ArchitecturePage, header: false, slide: true },
    { id: 'neurips', label: 'NeurIPS demo', Content: NeuripsPage, header: false },
    { id: 'resources', label: 'Research', Content: ProjectsPage, header: false, slide: true },
];
export default function DevAboutPage() {
    const { page } = useParams();
    const navigate = useNavigate();
    const current = Math.max(0, PAGES.findIndex(p => p.id === page));
    const { Content } = PAGES[current];
    useEffect(() => { document.title = `${PAGES[current].label} · About Data Formulator`; }, [current]);
    // The arrow keys (or a presenter's clicker, which sends page keys) move a page at a time.
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.metaKey || event.ctrlKey || event.altKey || (event.target as HTMLElement)?.closest?.('input, textarea, [contenteditable]')) return;
            const step = ['ArrowRight', 'PageDown'].includes(event.key) ? 1 : ['ArrowLeft', 'PageUp'].includes(event.key) ? -1 : 0;
            const next = current + step;
            if (step && next >= 0 && next < PAGES.length) {
                event.preventDefault();
                navigate(`/dev/about/${PAGES[next].id}`);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [current, navigate]);
    return <DesignFrame header={PAGES[current].header !== false} aspectRatio={PAGES[current].slide ? WHAT_ASPECT : undefined}>
        <Content />
    </DesignFrame>;
}
