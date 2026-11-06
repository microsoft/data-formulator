// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { useEffect, useState } from 'react';
import { Box, Button, ButtonBase, Chip, Link, Tab, Tabs, Typography, alpha } from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import InsertChartOutlinedIcon from '@mui/icons-material/InsertChartOutlined';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { iconVar, textVar } from '../app/layout';
import { starterIcon } from './icons';
import { safeUrl } from './links';
import { demoText } from './layout';
import type { SiteStarter, SiteStory } from './types';

// Under a demo's chat (design-docs/69): a tab per dataset with what it holds, a button to start a session
// with it loaded, and its example sessions as picture cards to open.

/** "Research and development" → "research and development" mid-sentence; acronyms ("SDG 4 education") stay as they are. */
export const inSentence = (name: string) => /^[A-Z][a-z]/.test(name) ? name[0].toLowerCase() + name.slice(1) : name;

/** An example session: its chart on a soft tile and its headline below, without outlines; opening it loads
 *  the saved session. Hover lifts the tile and shows that it opens a session. */
const ExampleCard: React.FC<{ story: SiteStory; disabled?: boolean; onOpen: () => void }> = ({ story, disabled, onOpen }) =>
    <ButtonBase disabled={disabled} onClick={onOpen} aria-label={story.headline} title={`Question: ${story.prompt}`} sx={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'stretch', textAlign: 'left',
        borderRadius: 1.5,
        '& .example-tile': { transition: 'transform 0.15s, box-shadow 0.15s, background-color 0.15s' },
        '& .example-headline': { transition: 'color 0.15s' },
        '& .open-hint': { opacity: 0, transition: 'opacity 0.15s' },
        '&:hover:not(.Mui-disabled) .example-tile, &.Mui-focusVisible .example-tile': {
            transform: 'translateY(-2px)', bgcolor: 'background.paper', boxShadow: '0 6px 16px rgba(32, 33, 36, 0.12)' },
        '&:hover:not(.Mui-disabled) .example-headline, &.Mui-focusVisible .example-headline': { color: 'primary.main' },
        '&:hover .open-hint, &.Mui-focusVisible .open-hint': { opacity: 1 },
        '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
        '&.Mui-disabled': { opacity: 0.6 },
    }}>
        <Box className="example-tile" sx={{ aspectRatio: '16 / 10', p: 1, boxSizing: 'border-box', borderRadius: 1.5,
            bgcolor: theme => alpha(theme.palette.text.primary, 0.035), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {story.image
                ? <Box component="img" src={story.image} alt="" loading="lazy" sx={{ display: 'block', width: '100%', height: '100%',
                    objectFit: 'contain', mixBlendMode: 'multiply' }} />
                : <InsertChartOutlinedIcon aria-hidden="true" sx={{ fontSize: 28, color: 'text.disabled' }} />}
        </Box>
        <Box sx={{ pt: 1, px: 0.25, display: 'flex', flexDirection: 'column' }}>
            <Typography className="example-headline" sx={{ fontSize: demoText.small, lineHeight: 1.4, color: 'text.primary',
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{story.headline}</Typography>
            <Box className="open-hint" sx={{ pt: 0.25, display: 'flex', alignItems: 'center', gap: 0.5, fontSize: textVar.xs, color: 'primary.main' }}>
                {story.available ? 'Opens session' : 'Asks the analyst'}
                <ArrowForwardIcon sx={{ fontSize: iconVar.xs }} />
            </Box>
        </Box>
    </ButtonBase>;

const pillSx = {
    height: 'auto', minHeight: 30, maxWidth: '100%', borderRadius: 4, fontSize: demoText.small, color: 'text.primary',
    borderColor: (theme: any) => alpha(theme.palette.text.primary, 0.16), bgcolor: 'background.paper',
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
    const stories = [...(starter.stories || [])].sort((a, b) => Number(!!b.featured) - Number(!!a.featured));
    const source = safeUrl(starter.source_url);
    const unavailable = disabled || !starter.available;
    return <Box id="datasets" sx={{ mt: 4, textAlign: 'left' }}>
        <Tabs value={starter.id} onChange={(_, value) => setSelected(value)} variant="scrollable" scrollButtons="auto"
            aria-label="Datasets" sx={{ minHeight: 38, '& .MuiTabs-flexContainer': { justifyContent: 'center' } }}>
            {starters.map(item => {
                const Icon = starterIcon(item.icon);
                return <Tab key={item.id} value={item.id} id={`dataset-tab-${item.id}`} aria-controls="dataset-panel"
                    icon={<Icon sx={{ fontSize: iconVar.md }} />} iconPosition="start" label={item.kicker || item.title}
                    sx={{ minHeight: 38, py: 0.5, px: 1.5, textTransform: 'none', fontSize: demoText.body, fontWeight: 400 }} />;
            })}
        </Tabs>
        <Box role="tabpanel" id="dataset-panel" aria-labelledby={`dataset-tab-${starter.id}`} sx={{ mt: 1, px: { xs: 2, sm: 3 }, py: 2.5,
            // A sheet lifted off the page's grid by a soft shadow rather than framed by an outline.
            borderRadius: 2, bgcolor: 'background.paper',
            boxShadow: '0 1px 2px rgba(32, 33, 36, 0.05), 0 10px 30px -12px rgba(32, 33, 36, 0.16)' }}>
            <Box>
                <Box sx={{ minWidth: 0 }}>
                    <Typography component="h2" sx={{ fontSize: demoText.lead, fontWeight: 600 }}>{starter.title}</Typography>
                    {starter.description && <Typography variant="body2" color="text.secondary" title={starter.description} sx={{ mt: 0.5, fontSize: demoText.body,
                        lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {starter.description}
                    </Typography>}
                    <Box sx={{ mt: 1.25, display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 2, rowGap: 1 }}>
                        <Button variant="contained" disableElevation disabled={unavailable} onClick={() => onLoad(starter)}
                            size="small" sx={{ textTransform: 'none', fontSize: demoText.body, px: 1.75 }}>
                            Load dataset
                        </Button>
                        {source && <Link href={source} target="_blank" rel="noopener noreferrer" underline="hover"
                            sx={{ fontSize: demoText.body, display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                            View the source <OpenInNewIcon sx={{ fontSize: iconVar.sm }} />
                        </Link>}
                        {!starter.available && <Typography variant="caption" color="text.secondary">Not available yet</Typography>}
                    </Box>
                </Box>
            </Box>
            {stories.length > 0 && <Box sx={{ mt: 2.5 }}>
                <Typography sx={{ fontSize: demoText.small, color: 'text.secondary', mb: 1 }}>Example sessions</Typography>
                <Box role="list" aria-label="Example sessions" sx={{ display: 'grid', columnGap: 2, rowGap: 1.5,
                    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))' }}>
                    {stories.map(story => <Box role="listitem" key={story.id}>
                        <ExampleCard story={story} disabled={unavailable} onOpen={() => onOpenStory(starter, story)} />
                    </Box>)}
                </Box>
            </Box>}
            {!stories.length && starter.questions.length > 0 && <Box sx={{ mt: 1.5, display: 'flex', alignItems: 'baseline', gap: 1.25 }}>
                <Typography sx={{ fontSize: demoText.small, color: 'text.secondary', flexShrink: 0 }}>Try:</Typography>
                <Box role="list" aria-label="Questions" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                    {starter.questions.map(question => <Box role="listitem" key={question} sx={{ maxWidth: '100%' }}>
                        <Chip variant="outlined" label={question} disabled={unavailable} onClick={() => onLoad(starter, question)} sx={pillSx} />
                    </Box>)}
                </Box>
            </Box>}
        </Box>
    </Box>;
};
