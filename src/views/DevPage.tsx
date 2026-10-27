// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React from 'react';
import { Box, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import PersonIcon from '@mui/icons-material/Person';
import ArticleIcon from '@mui/icons-material/Article';
import { AgentToyIcon } from './AgentToyIcon';
import { iconTone } from '../app/tokens';
import {
    AgentIcon, BooleanIcon, FormIcon, chartFamily, CONNECTOR_ICON_MAP, DatabaseIcon, DatabaseViewIcon, DateIcon,
    DateTimeIcon, DurationIcon, FileTypeIcon, FolderOpenIcon, InsightIcon, NumericalIcon, RelationalDBIcon, StreamIcon,
    StringIcon, TableIcon, TimeIcon, UnknownIcon,
} from '../icons';
import { CHART_ICONS } from '../components/ChartTemplates';
import { CONNECTOR_BRANDS } from '../connectorBrands';
import { ConnectorFormCard } from '../components/ConnectorFormCard';
import { ArtifactDeleteButton, ThreadArtifactCard } from './DataThreadCards';
import { MiniPage, MiniWindow } from '../components/ArtifactMiniatures';
import { ThreadDeck, ThreadOutput } from '../components/ThreadDeck';

const FILES = [
    'a.py', 'a.ipynb', 'a.sql', 'a.md', 'a.r', 'a.ts', 'a.tsx', 'a.js', 'a.css', 'a.php', 'a.html', 'a.app.jsx',
    'a.json', 'a.csv', 'a.parquet', 'a.xlsx', 'a.txt', 'a.yaml', 'a.toml', 'a.sh', 'a.png', 'a.svg', 'a.pdf',
    'a.docx', 'a.zip', 'a.mp3', 'a.mp4', 'a.xml', 'a.java', 'a.c', 'a.cpp', 'a.rb', 'a',
];
const TONE_FILES = ['a.py', 'a.sql', 'a.csv', 'a.md', 'a.json', 'a.html', 'a'];
const CHART_TYPES = Object.keys(CHART_ICONS);
const CONNECTORS = Object.keys(CONNECTOR_ICON_MAP);
const DOMAIN: [string, React.ElementType][] = [
    ['Table', TableIcon], ['Form', FormIcon], ['Stream', StreamIcon], ['Agent', AgentIcon], ['Insight', InsightIcon],
    ['FolderOpen', FolderOpenIcon], ['Database', DatabaseIcon], ['RelationalDB', RelationalDBIcon], ['DatabaseView', DatabaseViewIcon],
];
const DATA_TYPES: [string, React.ElementType][] = [
    ['boolean', BooleanIcon], ['number', NumericalIcon], ['string', StringIcon], ['date', DateIcon],
    ['datetime', DateTimeIcon], ['time', TimeIcon], ['duration', DurationIcon], ['unknown', UnknownIcon],
];
const SIZES = [14, 20, 40];

const Cell: React.FC<{ label: string; children: (size: number) => React.ReactNode }> = ({ label, children }) =>
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, p: 1, width: 120, border: 1, borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, height: 44, color: 'text.secondary' }}>
            {SIZES.map(size => <Box key={size} sx={{ display: 'flex', outline: '1px dotted', outlineColor: 'divider' }}>{children(size)}</Box>)}
        </Box>
        <Box sx={{ fontSize: 11, fontFamily: 'var(--df-font-mono, monospace)', color: 'text.secondary' }}>{label}</Box>
    </Box>;

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => <>
    <Box sx={{ fontSize: 12, fontWeight: 600, mt: 2, mb: 1 }}>{title}</Box>
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>{children}</Box>
</>;

const slotSx = { display: 'flex', outline: '1px dotted', outlineColor: 'divider' } as const;

/** An icon at rest (14, 20) and in its reserved colour (20). */
const Swatch: React.FC<{ label: string; proposed: (size: number, active: boolean) => React.ReactNode }> = ({ label, proposed }) =>
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, p: 1, width: 150, border: 1, borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, height: 28, color: iconTone.rest }}>
            <Box sx={slotSx}>{proposed(14, false)}</Box>
            <Box sx={slotSx}>{proposed(20, false)}</Box>
            <Box sx={slotSx}>{proposed(20, true)}</Box>
        </Box>
        <Box sx={{ fontSize: 11, fontFamily: 'var(--df-font-mono, monospace)', color: 'text.secondary', whiteSpace: 'nowrap' }}>{label}</Box>
    </Box>;

type MockItem = { kind: 'user' | 'agent' | 'table' | 'derived' | 'chart' | 'file' | 'report'; label: string; chart?: string; path?: string };
const MOCK_THREAD: MockItem[] = [
    { kind: 'user', label: 'Show budgets by genre' },
    { kind: 'table', label: 'Movies' },
    { kind: 'chart', chart: 'Bar Chart', label: 'Budget by genre' },
    { kind: 'chart', chart: 'Line Chart', label: 'Revenue over time' },
    { kind: 'user', label: 'Where are they made?' },
    { kind: 'derived', label: 'Films by country' },
    { kind: 'chart', chart: 'World Map', label: 'Films by country' },
    { kind: 'chart', chart: 'Scatter Plot', label: 'Budget vs revenue' },
    { kind: 'chart', chart: 'Boxplot', label: 'Rating by genre' },
    { kind: 'agent', label: 'Ratings are similar across genres.' },
    { kind: 'file', path: 'lib/movie_cohorts.py', label: 'Movie cohort rules' },
    { kind: 'chart', chart: 'Area Chart', label: 'Releases per year' },
    { kind: 'chart', chart: 'Pie Chart', label: 'Share by genre' },
    { kind: 'report', label: 'Movie industry report' },
];
const MOCK_FOCUS = 8;
type MockVariant = 'standard' | 'tinted';
const MOCK_VARIANTS: [MockVariant, string][] = [['standard', 'standard'], ['tinted', 'tinted (reserved colours)']];

/** A thread rail as DataThread draws it, with chart glyphs coloured per variant. */
const MockThread: React.FC<{ variant: MockVariant }> = ({ variant }) => {
    const theme = useTheme();
    const primary = theme.palette.primary.main;
    return <Box sx={{ width: 240 }}>
        {MOCK_THREAD.map((item, index) => {
            const onChain = index <= MOCK_FOCUS;
            const focused = index === MOCK_FOCUS;
            const color = onChain ? primary : iconTone.muted;
            const glyph = { width: 14, height: 14, color };
            let icon: React.ReactNode;
            switch (item.kind) {
                case 'user': icon = <PersonIcon sx={{ width: 18, height: 18, color: onChain ? theme.palette.custom.main : iconTone.muted }} />; break;
                case 'agent': icon = <AgentToyIcon sx={{ width: 18, height: 18, color }} />; break;
                case 'table': icon = <TableIcon sx={glyph} />; break;
                case 'derived': icon = <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: color }} />; break;
                case 'file': icon = <FileTypeIcon path={item.path!} size={14} active={variant === 'tinted' && onChain} sx={glyph} />; break;
                case 'report': icon = <ArticleIcon sx={{ ...glyph, color: onChain ? theme.palette.secondary.main : iconTone.muted }} />; break;
                case 'chart': {
                    const { Icon, color: familyColor } = chartFamily(item.chart!);
                    icon = <Icon sx={{ ...glyph, ...(variant === 'tinted' && onChain ? { color: familyColor } : {}) }} />;
                }
            }
            const lineColor = (chain: boolean) => chain ? alpha(primary, 0.6) : 'rgba(0,0,0,0.1)';
            return <Box key={index} sx={{ display: 'flex', alignItems: 'stretch' }}>
                <Box sx={{ width: 18, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <Box sx={{ flex: 1, minHeight: 4, borderLeft: `2px solid ${lineColor(onChain)}` }} />
                    <Box sx={{ display: 'flex' }}>{icon}</Box>
                    <Box sx={{ flex: 1, minHeight: 4, borderLeft: `2px solid ${lineColor(index < MOCK_FOCUS)}` }} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0, py: '3px', pl: 1 }}>
                    <Box sx={{ px: 1, py: 0.5, fontSize: 12, borderRadius: 1, border: 1,
                        borderColor: focused ? 'primary.main' : 'divider', bgcolor: item.kind === 'user' ? alpha(theme.palette.custom.main, 0.08) : 'background.paper',
                        color: onChain ? 'text.primary' : 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.label}
                    </Box>
                </Box>
            </Box>;
        })}
    </Box>;
};

const iconCells = (icons: [string, React.ElementType][]) => icons.map(([label, Icon]) =>
    <Cell key={label} label={label}>{size => <Icon sx={{ width: size, height: size, fontSize: size }} />}</Cell>);

const REPORT_TITLE = 'U.S. gasoline grade prices and premium surcharge';
const ARTIFACT_CARDS: [string, React.ReactNode][] = [
    ['report', <ThreadArtifactCard key="report" artifactType="report" title={REPORT_TITLE} selected={false} onClick={() => {}} actions={<ArtifactDeleteButton label="Delete" onClick={() => {}} />}
        preview={<MiniPage chartSrc="/demos/gas_prices-thumbnail.webp" />} />],
    ['report · writing', <ThreadArtifactCard key="report · writing" artifactType="report" title={REPORT_TITLE} selected={false} onClick={() => {}} actions={<ArtifactDeleteButton label="Delete" onClick={() => {}} />}
        preview={<MiniPage />} notes="Composing…" />],
    ['report · selected', <ThreadArtifactCard key="report · selected" artifactType="report" title={REPORT_TITLE} selected onClick={() => {}} actions={<ArtifactDeleteButton label="Delete" onClick={() => {}} />}
        preview={<MiniPage chartSrc="/demos/movies-thumbnail.webp" />} />],
    ['table', <ThreadArtifactCard key="table" artifactType="table" title="Premium Surcharge by Decade" selected={false} onClick={() => {}}
        actions={<ArtifactDeleteButton label="Delete" onClick={() => {}} />} />],
    ['app · filters, KPIs, main grid', <ThreadArtifactCard key="app-a" artifactType="app" title="Sales explorer" selected={false} onClick={() => {}}
        preview={<MiniWindow layout={[{ kind: 'filters', count: 2 }, { kind: 'kpis', count: 3 }, { kind: 'cells', cells: ['chart', 'table'], main: true }]} />} />],
    ['app · charts and a table', <ThreadArtifactCard key="app-b" artifactType="app" title="Gas price explorer" selected={false} onClick={() => {}}
        preview={<MiniWindow layout={[{ kind: 'filters', count: 1 }, { kind: 'cells', cells: ['chart', 'chart'] }, { kind: 'cells', cells: ['table'] }]} />} />],
    ['app · one big chart', <ThreadArtifactCard key="app-c" artifactType="app" title="Earthquake map" selected={false} onClick={() => {}}
        preview={<MiniWindow layout={[{ kind: 'tabs' }, { kind: 'cells', cells: ['chart'] }]} />} />],
    ['app', <ThreadArtifactCard key="app" artifactType="app" title="Earthquake explorer" selected={false} onClick={() => {}} actions={<ArtifactDeleteButton label="Delete" onClick={() => {}} />} preview={<MiniWindow />} />],
];

const DECK_IMAGES = ['unemployment', 'global_energy', 'screenshot-stock-price-live', 'movies', 'gas_prices'];
const deckOutputs = (count: number): ThreadOutput[] => [
    ...Array.from({ length: count }, (_, index) => ({ id: `${index}`, src: `/demos/${DECK_IMAGES[index % DECK_IMAGES.length]}-thumbnail.webp` })),
    ...(count % 2 ? [] : [{ kind: 'report' as const, id: 'report', title: 'U.S. gasoline grade prices and premium surcharge', chartIds: [] },
        { kind: 'app' as const, id: 'app', title: 'Gas price and premium surcharge explorer', path: 'apps/gas.app.jsx' }]),
];

export default function DevPage() {
    return <Box sx={{ p: 2, height: '100vh', overflow: 'auto', boxSizing: 'border-box', bgcolor: 'background.default' }}>
        <Section title="files">
            {FILES.map(path => <Cell key={path} label={path}>{size => <FileTypeIcon path={path} size={size} sx={{ color: iconTone.rest }} />}</Cell>)}
        </Section>
        <Section title="files · active">
            {FILES.map(path => <Cell key={path} label={path}>{size => <FileTypeIcon path={path} size={size} active />}</Cell>)}
        </Section>
        <Section title="tones">
            {(['muted', 'rest', 'active'] as const).map(tone => <Box key={tone} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1, border: 1, borderColor: 'divider' }}>
                <Box sx={{ fontSize: 11, width: 44, fontFamily: 'var(--df-font-mono, monospace)', color: 'text.secondary' }}>{tone}</Box>
                <TableIcon sx={{ width: 14, height: 14, color: tone === 'active' ? 'primary.main' : iconTone[tone] }} />
                {TONE_FILES.map(path => <FileTypeIcon key={path} path={path} size={14} active={tone === 'active'}
                    sx={{ color: tone === 'active' ? undefined : iconTone[tone] }} />)}
            </Box>)}
        </Section>
        <Section title="report & app cards">
            {ARTIFACT_CARDS.map(([label, card]) => <Box key={label} sx={{ width: 230, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                <Box sx={{ fontSize: 11, fontFamily: 'var(--df-font-mono, monospace)', color: 'text.secondary' }}>{label}</Box>{card}
            </Box>)}
        </Section>
        <Section title="thread deck">
            {[0, 1, 2, 3, 4, 5, 6, 9].map(count => <Box key={count} sx={{ width: 270, p: 1.5, border: 1, borderColor: 'divider' }}>
                <ThreadDeck outputs={deckOutputs(count)} heading="How have gas prices changed over the last two decades, and which grades moved most?"
                    onSelect={() => {}} />
            </Box>)}
        </Section>
        <Section title="connector form · canvas">
            {['mssql', 'azure_blob'].map(type => <Box key={type} sx={{ width: 560, p: 2, border: 1, borderColor: 'divider' }}>
                <ConnectorFormCard messageId={`dev-${type}`} prompt={{ sourceType: type }} variant="bare" onResolved={() => {}} />
            </Box>)}
        </Section>
        <Section title="thread rail">
            {MOCK_VARIANTS.map(([variant, label]) => <Box key={variant} sx={{ p: 1.5, border: 1, borderColor: 'divider' }}>
                <Box sx={{ fontSize: 11, mb: 1, fontFamily: 'var(--df-font-mono, monospace)', color: 'text.secondary' }}>{label}</Box>
                <MockThread variant={variant} />
            </Box>)}
        </Section>
        <Section title="charts · rest, reserved colour">
            {CHART_TYPES.map(type => { const { Icon, color } = chartFamily(type);
                return <Swatch key={type} label={type}
                    proposed={(size, active) => <Icon sx={{ width: size, height: size, ...(active ? { color } : {}) }} />} />; })}
        </Section>
        <Section title="connectors · rest, reserved colour">
            {CONNECTORS.map(type => { const Icon = CONNECTOR_ICON_MAP[type]; const color = CONNECTOR_BRANDS[type]?.color;
                return <Swatch key={type} label={type}
                    proposed={(size, active) => <Icon sx={{ width: size, height: size, ...(active && color ? { color } : {}) }} />} />; })}
        </Section>
        <Section title="domain">{iconCells(DOMAIN)}</Section>
        <Section title="data types">{iconCells(DATA_TYPES)}</Section>
    </Box>;
}
