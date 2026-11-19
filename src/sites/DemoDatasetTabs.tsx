// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { useEffect, useState } from 'react';
import { Box, Button, ButtonBase, Chip, Link, Tab, Tabs, Typography, alpha, type Theme } from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import InsertChartOutlinedIcon from '@mui/icons-material/InsertChartOutlined';
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined';
import MapOutlinedIcon from '@mui/icons-material/MapOutlined';
import AutoStoriesOutlinedIcon from '@mui/icons-material/AutoStoriesOutlined';
import { iconVar } from '../app/layout';
import { cardHoverLine, frameColor, inkColor } from '../app/look';
import { starterIcon } from './icons';
import { safeUrl } from './links';
import { demoText } from './layout';
import type { SiteStarter, SiteStory } from './types';
import { ambientShadow, cardRadius, hoverLift } from '../app/tokens';

// Under a demo's chat (design-docs/69): a tab per dataset with what it holds, a button to start a session
// with it loaded, and its example sessions as picture cards to open.

/**
 * "Research and development" → "research and development" mid-sentence; acronyms ("SDG 4 education") and names with
 * another capital word, likely proper names ("Microsoft at NeurIPS"), stay as they are.
 */
export const inSentence = (name: string) => /^[A-Z][a-z]/.test(name) && !/\s[A-Z]/.test(name) ? name[0].toLowerCase() + name.slice(1) : name;

/** An example session: one card holding its picture and, under it, what it shows (the finding on hover); opening it
 *  loads the saved session. Hover lifts the card. */
const ExampleCard: React.FC<{ story: SiteStory; disabled?: boolean; onOpen: () => void }> = ({ story, disabled, onOpen }) =>
    <ButtonBase disabled={disabled} onClick={onOpen} aria-label={story.title || story.headline}
        title={story.title ? `${story.headline}\nQuestion: ${story.prompt}` : `Question: ${story.prompt}`} sx={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'stretch', textAlign: 'left',
        borderRadius: cardRadius('6px'), overflow: 'hidden', bgcolor: 'background.paper',
        border: 1, borderColor: theme => frameColor(theme, 0.1),
        transition: 'transform 0.15s, box-shadow 0.15s, border-color 0.15s',
        '& .example-headline': { transition: 'color 0.15s' },
        '&:hover:not(.Mui-disabled), &.Mui-focusVisible': {
            // The outline darkens on hover; where it is already dark it turns the accent, with the title.
            transform: hoverLift(2), borderColor: theme => cardHoverLine(theme),
            boxShadow: ambientShadow('0 6px 16px rgba(32, 33, 36, 0.10)') },
        '&:hover:not(.Mui-disabled) .example-headline, &.Mui-focusVisible .example-headline': { color: 'primary.main' },
        '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
        '&.Mui-disabled': { opacity: 0.6 },
    }}>
        {/* Covers are pictures on white (a map cropped to its countries, an app's top), so they fill the top as they are. */}
        <Box sx={{ aspectRatio: '16 / 10', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderBottom: 1, borderColor: theme => frameColor(theme, 0.05, 'divider') }}>
            {story.image
                ? <Box component="img" src={story.image} alt="" loading="lazy" sx={{ display: 'block', width: '100%', height: '100%',
                    objectFit: 'cover' }} />
                : <InsertChartOutlinedIcon aria-hidden="true" sx={{ fontSize: 28, color: 'text.disabled' }} />}
        </Box>
        {/* The padding is on a wrapper: on the clamped text itself it would show an extra line. */}
        <Box sx={{ px: 1.25, pt: 0.75, pb: 1, flex: 1 }}>
            <Typography className="example-headline" sx={{ fontSize: demoText.small, lineHeight: 1.35,
                color: theme => inkColor(theme, 0.82),
                display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {story.title || story.headline}
            </Typography>
        </Box>
    </ButtonBase>;

/** The line around the dataset panel and its tabs: muted, or the frame grey in the sharp look (the input above is the anchor). */
const panelLine = (theme: Theme) => frameColor(theme, 0.12);

const CHAPTER_ICONS: Record<string, typeof InsertChartOutlinedIcon> = {
    story: AutoStoriesOutlinedIcon, dashboard: DashboardOutlinedIcon, map: MapOutlinedIcon, chart: InsertChartOutlinedIcon,
};

/** A session holding several findings, as one card that opens it: its cover, its headline, and each of its stories'
 *  and maps' key figure. */
const TopicCard: React.FC<{ story: SiteStory; disabled?: boolean; onOpen: () => void }> = ({ story, disabled, onOpen }) =>
    <ButtonBase disabled={disabled} onClick={onOpen} aria-label={`Open: ${story.headline}`} sx={{
        width: '100%', display: 'grid', gap: { xs: 1.5, md: 3 }, alignItems: 'start', textAlign: 'left', borderRadius: cardRadius('6px'),
        gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 7fr) minmax(0, 5fr)' },
        '& .topic-cover': { transition: 'transform 0.2s, box-shadow 0.2s' },
        '& .topic-title, & .topic-open': { transition: 'color 0.15s' },
        '&:hover:not(.Mui-disabled) .topic-cover, &.Mui-focusVisible .topic-cover': {
            transform: hoverLift(2), boxShadow: ambientShadow('0 8px 20px rgba(32, 33, 36, 0.14)') },
        '&:hover:not(.Mui-disabled) .topic-title, &:hover:not(.Mui-disabled) .topic-open, &.Mui-focusVisible .topic-open':
            { color: 'primary.main' },
        '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 4 },
        '&.Mui-disabled': { opacity: 0.6 },
    }}>
        {/* The cover is the session's picture; the card itself has no frame of its own. */}
        <Box className="topic-cover" sx={{ aspectRatio: '16 / 10', borderRadius: cardRadius('6px'), overflow: 'hidden', display: 'flex',
            alignItems: 'center', justifyContent: 'center', boxShadow: ambientShadow('0 1px 4px rgba(32, 33, 36, 0.12)') }}>
            {story.image
                ? <Box component="img" src={story.image} alt="" sx={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />
                : <InsertChartOutlinedIcon aria-hidden="true" sx={{ fontSize: 36, color: 'text.disabled' }} />}
        </Box>
        <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <Typography component="h3" className="topic-title" sx={{ fontSize: demoText.lead, fontWeight: 600, lineHeight: 1.3 }}>
                {story.headline}
            </Typography>
            {story.dek && <Typography sx={{ mt: 0.75, fontSize: demoText.small, lineHeight: 1.5,
                color: theme => inkColor(theme, 0.72) }}>{story.dek}</Typography>}
            {/* Its findings at a glance: each chapter's key figure, large, with the short message it goes with (one
                grid: figures flush left with the title, messages in one column, centred on their figure); a chapter
                without one shows its name and headline. */}
            <Box role="list" aria-label="Inside this session" sx={{ mt: 2, display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)',
                columnGap: 2, rowGap: 1.25, alignItems: 'center' }}>
                {(story.chapters || []).map(chapter => {
                    const Icon = CHAPTER_ICONS[chapter.kind || ''] || InsertChartOutlinedIcon;
                    return <Box role="listitem" key={chapter.label} title={chapter.headline || undefined}
                        sx={{ display: 'grid', gridColumn: '1 / -1', gridTemplateColumns: 'subgrid', alignItems: 'center' }}>
                        {chapter.stat
                            ? <Typography sx={{ fontSize: '1.5rem', fontWeight: 600, lineHeight: 1.1, letterSpacing: '-0.01em',
                                fontVariantNumeric: 'tabular-nums', color: 'primary.main' }}>{chapter.stat}</Typography>
                            : <Icon aria-hidden="true" sx={{ fontSize: iconVar.md, color: 'text.secondary' }} />}
                        <Typography sx={{ minWidth: 0, fontSize: demoText.small, lineHeight: 1.4, color: theme => inkColor(theme, 0.78), textWrap: 'pretty',
                            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                            {chapter.stat
                                ? chapter.message || chapter.label
                                : <><Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>{chapter.label}</Box>
                                    {chapter.headline ? ` · ${chapter.headline}` : ''}</>}
                        </Typography>
                    </Box>;
                })}
            </Box>
            <Typography className="topic-open" sx={{ mt: 2.25, display: 'inline-flex', alignItems: 'center', gap: 0.5,
                fontSize: demoText.body, fontWeight: 600, color: 'text.primary', transition: 'color 0.15s' }}>
                Open the session <ArrowForwardIcon sx={{ fontSize: iconVar.md }} />
            </Typography>
        </Box>
    </ButtonBase>;

const pillSx = {
    height: 'auto', minHeight: 30, maxWidth: '100%', borderRadius: cardRadius('16px'), fontSize: demoText.small, color: 'text.primary',
    borderColor: (theme: Theme) => frameColor(theme, 0.16, 'divider'), bgcolor: 'background.paper',
    '& .MuiChip-label': { whiteSpace: 'normal', py: 0.5, lineHeight: 1.35 },
    '& .MuiChip-icon': { fontSize: iconVar.sm, color: 'text.disabled', ml: 0.75 },
    '&:hover': { borderColor: 'primary.light', bgcolor: (theme: any) => alpha(theme.palette.primary.main, 0.04) },
    '&:hover .MuiChip-icon': { color: 'primary.main' },
} as const;

export const DemoDatasetTabs: React.FC<{
    starters: SiteStarter[];
    disabled?: boolean;
    /** Opens a new session with the dataset loaded; with a question, asks it there. */
    onLoad: (starter: SiteStarter, question?: string) => void;
    /** Opens an example session. */
    onOpenStory: (starter: SiteStarter, story: SiteStory) => void;
    /** Told which dataset is shown, when the tabs open and on every change. */
    onSelect?: (starter: SiteStarter) => void;
}> = ({ starters, disabled, onLoad, onOpenStory, onSelect }) => {
    // `#<dataset id>` in the address opens on that dataset.
    const linked = () => starters.find(starter => starter.id === decodeURIComponent(window.location.hash.slice(1)))?.id;
    const [selected, setSelected] = useState(() => linked() || (starters.find(starter => starter.available) || starters[0])?.id);
    useEffect(() => {
        const follow = () => { const id = linked(); if (id) setSelected(id); };
        window.addEventListener('hashchange', follow);
        return () => window.removeEventListener('hashchange', follow);
    }, [starters]);
    const starter = starters.find(item => item.id === selected) || starters[0];
    useEffect(() => { if (starter) onSelect?.(starter); }, [starter?.id]);
    if (!starter) return null;
    const allStories = [...(starter.stories || [])].sort((a, b) => Number(!!b.featured) - Number(!!a.featured));
    // Sessions holding several findings show as large cards; single-finding ones as the grid of example cards.
    const topics = allStories.filter(story => story.chapters?.length);
    const stories = allStories.filter(story => !story.chapters?.length);
    const source = safeUrl(starter.source_url);
    const unavailable = disabled || !starter.available;
    // Under the first tab, opened, the panel's corner squares off so the tab's edge runs straight down.
    const firstOpen = starters[0]?.id === starter.id;
    return <Box id="datasets" sx={{ mt: 4, textAlign: 'left' }}>
        {/* Folder tabs over the panel's top line (they lap 1px onto it): the selected one is open into the panel (its
            paper covers the line), the others sit on it. */}
        <Tabs value={starter.id} onChange={(_, value) => setSelected(value)} variant="scrollable" scrollButtons={false}
            aria-label="Datasets" sx={{ minHeight: 46, mb: '-1px', position: 'relative', zIndex: 1,
                '& .MuiTabs-indicator': { display: 'none' },
                '& .MuiTabs-flexContainer': { alignItems: 'flex-end' } }}>
            {starters.map(item => {
                const Icon = starterIcon(item.icon);
                return <Tab key={item.id} value={item.id} id={`dataset-tab-${item.id}`} aria-controls="dataset-panel"
                    icon={<Icon sx={{ fontSize: iconVar.lg }} />} iconPosition="start" label={item.kicker || item.title}
                    sx={{ minHeight: 46, py: 1, px: 1.75, textTransform: 'none', fontSize: demoText.body, fontWeight: 500,
                        color: theme => inkColor(theme, 0.6),
                        border: 1, borderColor: 'transparent',
                        borderTopLeftRadius: cardRadius('10px'), borderTopRightRadius: cardRadius('10px'),
                        transition: 'color 0.15s, background-color 0.15s',
                        '&:hover:not(.Mui-selected)': { color: 'text.primary', bgcolor: theme => alpha(theme.palette.text.primary, 0.03) },
                        '&.Mui-selected': { color: 'text.primary', bgcolor: 'background.paper', borderColor: panelLine,
                            borderBottomColor: 'transparent' } }} />;
            })}
        </Tabs>
        <Box role="tabpanel" id="dataset-panel" aria-labelledby={`dataset-tab-${starter.id}`} sx={{ px: { xs: 2, sm: 3 }, py: 2.5,
            // The open folder under the tabs: a thin muted line all round. Its top corners stay square in the soft
            // look; sharp rounds the far one like every other outlined corner.
            bgcolor: 'background.paper', border: 1, borderColor: panelLine,
            borderTopLeftRadius: firstOpen ? 0 : 'var(--df-card-radius, 0px)', borderTopRightRadius: 'var(--df-card-radius, 0px)',
            borderBottomLeftRadius: cardRadius('10px'), borderBottomRightRadius: cardRadius('10px') }}>
            {/* The title with its source, what the dataset holds, its example sessions (the way in), then starting one's
                own analysis. */}
            <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 2, rowGap: 1 }}>
                <Typography component="h2" sx={{ flex: '1 1 auto', minWidth: 0, fontSize: demoText.lead, fontWeight: 600 }}>
                    {starter.title}
                </Typography>
                <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', columnGap: 2, flexShrink: 0 }}>
                    {!starter.available && <Typography variant="caption" color="text.secondary">Not available yet</Typography>}
                    {/* A reference, not an action: muted, turning to the link colour on hover; its full name as the tooltip. */}
                    {source && <Link href={source} target="_blank" rel="noopener noreferrer" underline="hover" title={starter.source_name || undefined}
                        sx={{ fontSize: demoText.small, whiteSpace: 'nowrap', color: 'text.secondary', textDecorationColor: 'currentColor',
                            '&:hover': { color: 'primary.main' } }}>
                        View source
                    </Link>}
                </Box>
            </Box>
            {/* What the dataset holds, in a short sentence (its summary, else the description); the full
                description (UIS's own) on hover. */}
            {(starter.summary || starter.description) && <Typography variant="body2" title={starter.description}
                sx={{ mt: 0.75, fontSize: demoText.body, lineHeight: 1.55, color: theme => inkColor(theme, 0.78) }}>
                {starter.summary || starter.description}
            </Typography>}
            {!allStories.length && <Button variant="contained" disableElevation disabled={unavailable} onClick={() => onLoad(starter)}
                size="small" sx={{ mt: 1.5, textTransform: 'none', fontSize: demoText.body, px: 1.75 }}>
                Start an analysis with this dataset
            </Button>}
            {topics.map(story => <Box key={story.id} sx={{ mt: 2.5 }}>
                <TopicCard story={story} disabled={unavailable} onOpen={() => onOpenStory(starter, story)} />
            </Box>)}
            {stories.length > 0 && <Box sx={{ mt: 2.5 }}>
                <Typography sx={{ fontSize: demoText.small, fontWeight: 500, color: 'text.secondary', mb: 1 }}>Example sessions</Typography>
                <Box role="list" aria-label="Example sessions" sx={{ display: 'grid', columnGap: 2, rowGap: 1.5,
                    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))' }}>
                    {stories.map(story => <Box role="listitem" key={story.id}>
                        <ExampleCard story={story} disabled={unavailable} onOpen={() => onOpenStory(starter, story)} />
                    </Box>)}
                </Box>
            </Box>}
            {!allStories.length && starter.questions.length > 0 && <Box sx={{ mt: 1.5, display: 'flex', alignItems: 'baseline', gap: 1.25 }}>
                <Typography sx={{ fontSize: demoText.small, color: 'text.secondary', flexShrink: 0 }}>Try:</Typography>
                <Box role="list" aria-label="Questions" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                    {starter.questions.map(question => <Box role="listitem" key={question} sx={{ maxWidth: '100%' }}>
                        <Chip variant="outlined" label={question} disabled={unavailable} onClick={() => onLoad(starter, question)} sx={pillSx} />
                    </Box>)}
                </Box>
            </Box>}
            {allStories.length > 0 && <Button variant="text" size="small" disabled={unavailable} onClick={() => onLoad(starter)}
                endIcon={<ArrowForwardIcon sx={{ fontSize: `${iconVar.sm} !important` }} />}
                sx={{ mt: 1.25, ml: -0.75, px: 0.75, textTransform: 'none', fontSize: demoText.small, fontWeight: 400 }}>
                Or start your own analysis with this dataset
            </Button>}
        </Box>
    </Box>;
};
