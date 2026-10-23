// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { useEffect, useRef, useState } from 'react';
import { Box, ButtonBase, Link } from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import AddIcon from '@mui/icons-material/Add';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import InsertChartOutlinedIcon from '@mui/icons-material/InsertChartOutlined';
import AccountBalanceOutlinedIcon from '@mui/icons-material/AccountBalanceOutlined';
import SchoolOutlinedIcon from '@mui/icons-material/SchoolOutlined';
import ScienceOutlinedIcon from '@mui/icons-material/ScienceOutlined';
import TableChartOutlinedIcon from '@mui/icons-material/TableChartOutlined';
import { fontSans } from '../app/tokens';
import { apiRequest } from '../app/apiClient';
import type { SiteConfig, SiteLandingProps, SiteStarter, SiteStory } from './types';

// The built-in site front page, laid out from the site's profile (see demos/README.md).
// Each dataset is one block: the dataset, then example analyses an AI analyst ran on it (the lead one
// large, with a stack of its findings) and a dashed card to start a new session from the dataset. Type, colours, borders and buttons follow the Flint site
// (flint-chart/site): one sans-serif face, hairline borders, no shadows, ink primary / outlined buttons.
const TEXT = '#1f2328';
const MUTED = '#4b525a';
const ACCENT = '#0078d4';
const HAIRLINE = 'rgba(0, 0, 0, 0.10)';
const RADIUS = '6px';
// Sections open with a strong rule, as on the Flint site.
const SECTION_RULE = `2px solid ${TEXT}`;
const GRID = 'linear-gradient(90deg, rgba(0,0,0,0.02) 1px, transparent 1px), linear-gradient(0deg, rgba(0,0,0,0.02) 1px, transparent 1px)';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const prose = { fontSize: '16.5px', lineHeight: 1.65, color: TEXT, m: 0 } as const;

/** Icons a starter can name for its quick link (`icon` in the profile); any other name gets the table. */
const STARTER_ICONS: Record<string, typeof TableChartOutlinedIcon> = {
    school: SchoolOutlinedIcon, science: ScienceOutlinedIcon, landmark: AccountBalanceOutlinedIcon,
    chart: InsertChartOutlinedIcon, table: TableChartOutlinedIcon,
};
const starterIcon = (icon?: string) => (icon && STARTER_ICONS[icon]) || TableChartOutlinedIcon;

/** Profile links may go to web pages, email or this site; anything else (e.g. javascript:) is not linked. */
export const safeUrl = (url?: string) => {
    const value = (url || '').trim();
    return /^(https?:\/\/|mailto:|#|\/(?!\/))/i.test(value) ? value : undefined;
};

/** "2026-02" → "February 2026"; anything else as given. */
const releaseName = (release: string) => {
    const match = /^(\d{4})-(\d{2})$/.exec(release);
    return match && MONTHS[Number(match[2]) - 1] ? `${MONTHS[Number(match[2]) - 1]} ${match[1]}` : release;
};

// Every chart card has this shape; each chart is scaled down, whole, to fit it.
const CARD_RATIO = '4 / 3';

/** The story's cover chart, whole (title, axes, legend), scaled down to fit a box of a fixed shape. */
const Cover: React.FC<{ story: SiteStory }> = ({ story }) =>
    <Box className="cover-frame" sx={{ width: '100%', aspectRatio: CARD_RATIO, borderRadius: RADIUS, overflow: 'hidden', bgcolor: 'white',
        border: `1px solid ${HAIRLINE}`, p: 1, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'border-color 0.12s, box-shadow 0.12s' }}>
        {story.image
            ? <Box component="img" src={story.image} alt="" loading="lazy"
                sx={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }} />
            : <Box aria-hidden="true" sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.75, color: 'rgba(0,0,0,0.22)' }}>
                <InsertChartOutlinedIcon sx={{ fontSize: 36 }} />
                <Box component="span" sx={{ fontSize: '12px' }}>Chart preview</Box>
            </Box>}
    </Box>;

// The lead session's findings as overlapping cards, as on the Flint site: the first finding in front,
// each one behind stepping up and right. Hovering opens the stack like a hand of cards: the cards slide
// apart along their diagonal, a little smaller, so most of every chart shows, in the same order,
// so every chart shows. They act as one: the same session, opened by a click anywhere on them, all with
// the same lifted border. Pointing at a card floats it on top so its chart can be read whole.
const STACK_ROTATE = [-1, 0.5, 1.6];
const OPEN_ROTATE = [-2.5, 0, 2.5];
const STACK_CARD = 76;
const STACK_STEP_X = 12;
const STACK_STEP_Y = 9;
const STACK_HEIGHT = STACK_CARD * 3 / 4 + 2 * STACK_STEP_Y;
// Open: smaller cards and longer steps, still filling the same box.
const OPEN_CARD = 60;
const OPEN_STEP_X = (100 - OPEN_CARD) / 2;
const OPEN_STEP_Y = (STACK_HEIGHT - OPEN_CARD * 3 / 4) / 2;

const StoryStack: React.FC<{ story: SiteStory }> = ({ story }) => {
    const cards = (story.stack || []).slice(0, STACK_ROTATE.length);
    const [open, setOpen] = useState(false);
    const [onTop, setOnTop] = useState<number | null>(null);
    // Each chart's width / height, once its image loads; until then a card takes the slot's 4:3 shape.
    const [ratios, setRatios] = useState<Record<string, number>>({});
    return <Box aria-hidden="true" onMouseEnter={() => setOpen(true)} onMouseLeave={() => { setOpen(false); setOnTop(null); }}
        sx={{ position: 'relative', zIndex: open ? 5 : 'auto', width: '100%', aspectRatio: `100 / ${STACK_HEIGHT}`,
            // Open, one contour traces the outline of all the cards together (overlaps inside show no edge),
            // so they read as a single session about to open: four unblurred shadows, one each way, make the line.
            filter: open ? ['1.5px 0', '-1.5px 0', '0 1.5px', '0 -1.5px'].map(offset => `drop-shadow(${offset} 0 ${ACCENT})`).join(' ') : 'none',
            transition: 'filter 0.25s' }}>
        {cards.map((card, index) => {
            const back = cards.length - 1 - index;
            // A card fits its chart within the slot: as wide as the slot unless the chart is taller than 4:3,
            // then narrower, so no card ever runs past the stack (and over the caption below).
            const slotWidth = open ? OPEN_CARD : STACK_CARD;
            const ratio = ratios[card.image] ?? 4 / 3;
            const width = Math.min(slotWidth, slotWidth * ratio * 3 / 4);
            const left = index * (open ? OPEN_STEP_X : STACK_STEP_X);
            const top = back * (open ? OPEN_STEP_Y : STACK_STEP_Y);
            const rotate = open ? OPEN_ROTATE[index] : STACK_ROTATE[index];
            return <Box key={card.image} onMouseEnter={() => setOnTop(index)} sx={{
                position: 'absolute', left: `${left + (slotWidth - width) / 2}%`, top: `${(top / STACK_HEIGHT) * 100}%`, width: `${width}%`,
                // Each card takes its chart's own shape: a fixed width, its height from the image.
                zIndex: onTop === index ? cards.length + 1 : cards.length - index,
                transform: `rotate(${rotate}deg) translateY(${open ? '-4px' : '0px'})`,
                boxSizing: 'border-box', p: 1, borderRadius: RADIUS, bgcolor: 'white', overflow: 'hidden',
                border: `1px solid ${HAIRLINE}`,
                boxShadow: open ? 'none' : index === 0 ? SOFT_SHADOW : FLAT_SHADOW,
                opacity: index === 0 || open ? 1 : 0.92, filter: index === 0 || open ? 'none' : 'brightness(0.98) saturate(0.95)',
                transition: 'left 0.45s cubic-bezier(.2,.8,.2,1), top 0.45s cubic-bezier(.2,.8,.2,1), width 0.45s cubic-bezier(.2,.8,.2,1), transform 0.45s cubic-bezier(.2,.8,.2,1), opacity 0.25s, box-shadow 0.2s, border-color 0.2s, filter 0.25s',
            }}>
                <Box component="img" src={card.image} alt="" loading="lazy"
                    onLoad={(event: React.SyntheticEvent<HTMLImageElement>) => {
                        const { naturalWidth: w, naturalHeight: h } = event.currentTarget;
                        if (w && h) setRatios(previous => previous[card.image] === w / h ? previous : { ...previous, [card.image]: w / h });
                    }}
                    sx={{ display: 'block', width: '100%', height: 'auto' }} />
            </Box>;
        })}
    </Box>;
};

const SOFT_SHADOW = '0 10px 30px rgba(0, 0, 0, 0.13)';
const FLAT_SHADOW = '0 1px 2px rgba(0, 0, 0, 0.05)';

const tile = {
    display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-start', textAlign: 'left', width: '100%', height: '100%',
    borderRadius: RADIUS, fontFamily: 'inherit',
    '& .story-headline, & .story-dek': { transition: 'color 0.12s' },
    '&:hover .story-headline, &.Mui-focusVisible .story-headline': { color: ACCENT },
    '&:hover .story-dek, &.Mui-focusVisible .story-dek': { color: 'rgba(0, 120, 212, 0.85)' },
    '& .open-arrow': { transition: 'transform 0.15s' },
    '&:hover .open-arrow, &.Mui-focusVisible .open-arrow': { transform: 'translateX(3px)' },
    '&:hover .cover-frame, &.Mui-focusVisible .cover-frame': { borderColor: ACCENT, boxShadow: `0 0 0 1px ${ACCENT}` },
    '&.Mui-focusVisible': { outline: `2px solid ${ACCENT}`, outlineOffset: '4px' },
} as const;

/** The question the story starts from: answered in its saved session, or asked live. */
const StoryPrompt: React.FC<{ prompt: string }> = ({ prompt }) =>
    <Box component="p" className="story-prompt" sx={{ m: 0, mt: 1, pl: 1.25, borderLeft: `2px solid ${HAIRLINE}`,
        fontSize: '13.5px', lineHeight: 1.55, color: MUTED }}>
        <Box component="span" sx={{ fontWeight: 600, color: TEXT }}>Question: </Box>{prompt}
    </Box>;

/** The dataset's lead example analysis: its findings as a stack of charts, with its headline, summary and prompt. */
const FeaturedSession: React.FC<{ story: SiteStory; disabled?: boolean; onOpen: () => void }> = ({ story, disabled, onOpen }) =>
    <ButtonBase disabled={disabled} onClick={onOpen} aria-label={story.headline} sx={tile}>
        <Box sx={{ position: 'relative' }}>
            {story.stack?.length ? <StoryStack story={story} /> : <Cover story={story} />}
        </Box>
        <Box component="h3" className="story-headline" sx={{ m: 0, mt: 1.75, fontSize: '17px', fontWeight: 600, lineHeight: 1.4, color: TEXT }}>
            {story.headline}
            <ArrowForwardIcon className="open-arrow" aria-hidden="true" sx={{ fontSize: 18, ml: 0.75, verticalAlign: '-3px' }} />
        </Box>
        {story.dek && <Box component="p" className="story-dek" sx={{ m: 0, mt: 0.5, fontSize: '14.5px', lineHeight: 1.6, color: MUTED }}>{story.dek}</Box>}
        <StoryPrompt prompt={story.prompt} />
    </ButtonBase>;

/** Another example analysis: its cover chart and headline; hovering shows what it asks. */
const SessionCard: React.FC<{ story: SiteStory; disabled?: boolean; onOpen: () => void }> = ({ story, disabled, onOpen }) =>
    <ButtonBase disabled={disabled} onClick={onOpen} aria-label={story.headline} title={`Question: ${story.prompt}`} sx={tile}>
        <Box sx={{ position: 'relative' }}>
            <Cover story={story} />
        </Box>
        <Box component="h4" className="story-headline" sx={{ m: 0, mt: 1, fontSize: '14px', fontWeight: 400, lineHeight: 1.5, color: TEXT }}>
            {story.headline}
        </Box>
    </ButtonBase>;

/** "Heritage spending" → "heritage spending" mid-sentence; acronyms ("SDG 4 education") stay as they are. */
const inSentence = (name: string) => /^[A-Z][a-z]/.test(name) ? name[0].toLowerCase() + name.slice(1) : name;

/** A new session from the dataset alone, to ask your own questions; shaped like a session card. */
const StartCard: React.FC<{ starter: SiteStarter; disabled?: boolean; onOpen: () => void }> = ({ starter, disabled, onOpen }) =>
    <ButtonBase disabled={disabled} onClick={onOpen} sx={{
        ...tile,
        '& .start-frame': { transition: 'border-color 0.12s, background 0.12s, color 0.12s' },
        '&:hover .start-frame, &.Mui-focusVisible .start-frame': { borderColor: ACCENT, bgcolor: 'rgba(0, 120, 212, 0.03)', color: ACCENT },
    }}>
        <Box className="start-frame" sx={{ width: '100%', aspectRatio: CARD_RATIO, boxSizing: 'border-box', borderRadius: RADIUS,
            border: '1.5px dashed rgba(0, 0, 0, 0.22)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 0.5, p: 2, textAlign: 'center', color: MUTED }}>
            <AddIcon sx={{ fontSize: 26 }} />
            <Box component="span" sx={{ fontSize: '14px', fontWeight: 500, lineHeight: 1.4, color: TEXT }}>New session</Box>
            <Box component="span" sx={{ fontSize: '12.5px', lineHeight: 1.45 }}>{starter.start_note || 'Start from the full dataset'}</Box>
        </Box>
        <Box component="span" className="story-headline" sx={{ mt: 1, fontSize: '14px', lineHeight: 1.5, color: MUTED }}>
            Create your own analysis of {inSentence(starter.kicker || starter.title)}
        </Box>
    </ButtonBase>;

/** Before a starter has stories: its suggested questions. */
const QuestionList: React.FC<{ starter: SiteStarter; disabled?: boolean; onOpen: (question: string) => void }> = ({ starter, disabled, onOpen }) =>
    <Box component="ul" aria-label="Starter analyses" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        {starter.questions.map(question => <Box component="li" key={question}>
            <ButtonBase disabled={disabled} onClick={() => onOpen(question)} sx={{
                width: '100%', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1.5, textAlign: 'left',
                px: 1.75, py: 1.25, borderRadius: RADIUS, border: `1px solid ${HAIRLINE}`, bgcolor: 'white',
                fontFamily: 'inherit', fontSize: '15px', lineHeight: 1.55, color: TEXT,
                '& .starter-arrow': { color: MUTED, transition: 'color 0.12s, transform 0.12s' },
                '&:hover, &.Mui-focusVisible': { borderColor: 'rgba(0, 0, 0, 0.24)', bgcolor: '#f6f8fa' },
                '&:hover .starter-arrow, &.Mui-focusVisible .starter-arrow': { color: ACCENT, transform: 'translateX(2px)' },
            }}>
                <span>{question}</span>
                <ArrowForwardIcon className="starter-arrow" sx={{ fontSize: 18, mt: '3px', flexShrink: 0 }} />
            </ButtonBase>
        </Box>)}
    </Box>;

/** A "#" link to the section, shown beside its heading on hover, so each dataset has a URL to share. */
const SectionAnchor: React.FC<{ id: string }> = ({ id }) =>
    <Box component="a" href={`#${id}`} className="section-anchor" aria-label="Link to this section"
        sx={{ position: { xs: 'static', md: 'absolute' }, left: '-1.1em', mr: { xs: 0.75, md: 0 }, opacity: { xs: 0.5, md: 0 },
            fontSize: '22px', lineHeight: 1.35, fontWeight: 400, color: MUTED, textDecoration: 'none', transition: 'opacity 0.12s', '&:hover': { color: ACCENT } }}>
        #
    </Box>;

const DatasetBlock: React.FC<{ starter: SiteStarter; disabled?: boolean; onOpenStarter: SiteLandingProps['onOpenStarter'];
    onOpenStory: SiteLandingProps['onOpenStory'] }> = ({ starter, disabled, onOpenStarter, onOpenStory }) => {
    const stories = starter.stories || [];
    const featured = stories.find(story => story.featured) || stories[0];
    const more = stories.filter(story => story !== featured);
    const unavailable = disabled || !starter.available;
    const start = <StartCard starter={starter} disabled={unavailable} onOpen={() => onOpenStarter(starter)} />;
    return <Box component="section" id={starter.id} aria-labelledby={`starter-${starter.id}`} sx={{
        mt: { xs: 8, md: 11 }, pt: 4, borderTop: SECTION_RULE, opacity: starter.available ? 1 : 0.65, scrollMarginTop: '8px',
    }}>
        <Box component="header" sx={{ mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', position: 'relative',
                '&:hover .section-anchor, & .section-anchor:focus-visible': { opacity: 1 } }}>
                <SectionAnchor id={starter.id} />
                <Box component="h2" id={`starter-${starter.id}`} sx={{ m: 0, fontSize: '22px', fontWeight: 700, lineHeight: 1.35, color: TEXT }}>
                    {starter.title}
                </Box>
            </Box>
            <Box sx={{ mt: 1.25, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', columnGap: 4, rowGap: 1.5, flexWrap: { xs: 'wrap', md: 'nowrap' } }}>
                {starter.description && <Box component="p" sx={{ ...prose, fontSize: '16px', flex: 1, minWidth: 0, maxWidth: 820 }}>{starter.description}</Box>}
                {safeUrl(starter.source_url) && <Box component="a" href={safeUrl(starter.source_url)} target="_blank" rel="noopener noreferrer" sx={{
                    ...heroButton('secondary'), flexShrink: 0, minHeight: 38, px: '14px', fontSize: '14px', mt: '2px' }}>
                    View the source
                    <OpenInNewIcon sx={{ fontSize: 16, color: MUTED }} />
                </Box>}
            </Box>
        </Box>

        {featured
            // The lead session takes the left half; the others and the start card fill a 2 x 2 grid beside it.
            ? <Box role="list" aria-label="Example analyses" sx={{ display: 'grid', alignItems: 'start', columnGap: { xs: 2.5, md: 3 }, rowGap: 3,
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' } }}>
                <Box role="listitem" sx={{ gridColumn: { sm: 'span 2' }, gridRow: { md: 'span 2' } }}>
                    <FeaturedSession story={featured} disabled={unavailable} onOpen={() => onOpenStory(starter, featured)} />
                </Box>
                {more.map(story => <Box role="listitem" key={story.id}>
                    <SessionCard story={story} disabled={unavailable} onOpen={() => onOpenStory(starter, story)} />
                </Box>)}
                <Box role="listitem">{start}</Box>
            </Box>
            : <>
                <QuestionList starter={starter} disabled={unavailable} onOpen={question => onOpenStarter(starter, question)} />
                <Box sx={{ mt: 2.5, maxWidth: 240 }}>{start}</Box>
            </>}
        {!starter.available && <Box component="p" sx={{ m: 0, mt: 2, fontSize: '13px', color: MUTED }}>Not available yet</Box>}
    </Box>;
};

/** Profile text with [label](url) links, opened in a new tab. */
const LinkedText: React.FC<{ text: string }> = ({ text }) => <>
    {text.split(/(\[[^\]]+\]\([^)\s]+\))/).map((part, index) => {
        const match = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
        const href = match ? safeUrl(match[2]) : undefined;
        return match && href
            ? <Link key={index} href={href} target="_blank" rel="noopener noreferrer"
                sx={{ fontFamily: 'inherit', color: TEXT, fontWeight: 500, textDecorationColor: 'rgba(0, 0, 0, 0.3)', textUnderlineOffset: '3px',
                    '&:hover': { color: ACCENT, textDecorationColor: 'currentColor' } }}>{match[1]}</Link>
            : <React.Fragment key={index}>{match ? match[1] : part}</React.Fragment>;
    })}
</>;

/** "{release}" in profile text, as the release's month and year. */
const fillRelease = (text: string, release?: string) => text.split('{release}').join(releaseName(release || ''));

const heroButton = (variant: 'primary' | 'secondary') => ({
    display: 'inline-flex', alignItems: 'center', gap: 0.875, minHeight: 42, px: '16px', whiteSpace: 'nowrap', borderRadius: RADIUS, border: '1px solid',
    fontFamily: 'inherit', fontSize: '14.5px', fontWeight: 600, textDecoration: 'none', boxSizing: 'border-box',
    transition: 'background 0.12s, border-color 0.12s, transform 0.12s',
    '&.Mui-focusVisible, &:focus-visible': { outline: `2px solid ${ACCENT}`, outlineOffset: '2px' },
    ...(variant === 'primary'
        ? { color: 'white', bgcolor: TEXT, borderColor: TEXT, '&:hover': { bgcolor: '#000', borderColor: '#000', transform: 'translateY(-1px)' } }
        : { color: TEXT, bgcolor: 'white', borderColor: 'rgba(0, 0, 0, 0.24)', '&:hover': { bgcolor: 'rgba(0, 0, 0, 0.04)', borderColor: 'rgba(0, 0, 0, 0.42)', transform: 'translateY(-1px)' } }),
});

/** The app at work, framed as a browser window: the front page's hero picture. */
const AppWindow: React.FC<{ image: string }> = ({ image }) =>
    <Box aria-hidden="true" sx={{ minWidth: 0, borderRadius: '10px', overflow: 'hidden', bgcolor: 'white', border: `1px solid ${HAIRLINE}`,
        boxShadow: '0 24px 60px -18px rgba(15, 23, 42, 0.28), 0 2px 6px rgba(15, 23, 42, 0.06)' }}>
        <Box sx={{ height: 14, display: 'flex', alignItems: 'center', gap: '4px', px: 1, bgcolor: '#f3f4f6', borderBottom: `1px solid ${HAIRLINE}` }}>
            {['#ff5f57', '#febc2e', '#28c840'].map(color => <Box key={color} sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: color, opacity: 0.85 }} />)}
        </Box>
        <Box component="img" src={image} alt="" sx={{ display: 'block', width: '100%', height: 'auto' }} />
    </Box>;

interface InstallStatus {
    status: 'ready' | 'not_installed';
    can_install: boolean;
    job: { state: 'running' | 'done' | 'failed'; error?: string | null; log: string[] } | null;
}

/** Before a demo's content is on this server: install it (local installs) or say it is not available. */
export const DemoInstall: React.FC<{ site: SiteConfig }> = ({ site }) => {
    const url = `/api/demos/${encodeURIComponent(site.id)}/install`;
    const [install, setInstall] = useState<InstallStatus | null>(null);
    const [error, setError] = useState<string | null>(null);
    const running = install?.job?.state === 'running';

    const request = async (options?: RequestInit) => {
        try {
            const { data } = await apiRequest<InstallStatus>(url, options);
            setInstall(data);
            setError(null);
            // The page reloads with the demo's datasets and stories.
            if (data.status === 'ready' && data.job?.state === 'done') window.location.reload();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    };
    useEffect(() => { void request(); }, [url]);
    useEffect(() => {
        if (!running) return;
        const timer = window.setInterval(() => void request(), 1500);
        return () => window.clearInterval(timer);
    }, [running, url]);

    const canInstall = install?.can_install ?? site.can_install;
    const failed = install?.job?.state === 'failed';
    const log = install?.job?.log ?? [];
    return <Box component="section" aria-labelledby="demo-install" sx={{ mt: { xs: 6, md: 8 }, mx: 'auto', maxWidth: 1000, p: { xs: 2.5, sm: 3.5 },
        border: `1px solid ${HAIRLINE}`, borderRadius: RADIUS, bgcolor: 'white' }}>
        <Box component="h2" id="demo-install" sx={{ m: 0, fontSize: '22px', fontWeight: 700, lineHeight: 1.35, color: TEXT }}>
            {canInstall ? 'Install this demo' : 'This demo is not available yet'}
        </Box>
        <Box component="p" sx={{ ...prose, mt: 1, color: MUTED }}>
            {canInstall
                ? site.install_note || 'Installing downloads the demo\'s data and builds its example sessions on this computer.'
                : 'Its data has not been installed on this server.'}
        </Box>
        {canInstall && <Box sx={{ mt: 2.5, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <ButtonBase disabled={running} onClick={() => void request({ method: 'POST' })}
                sx={{ ...heroButton('primary'), ...(running && { opacity: 0.6 }) }}>
                {running ? 'Installing…' : failed ? 'Try again' : 'Install demo'}
            </ButtonBase>
            {running && <Box component="span" sx={{ fontSize: '14px', color: MUTED }}>This takes a minute or two; you can leave this page open.</Box>}
        </Box>}
        {(failed || error) && <Box component="p" role="alert" sx={{ ...prose, mt: 2, fontSize: '14.5px', color: '#b42318' }}>
            {failed ? `The install stopped: ${install?.job?.error}` : `Could not reach the server: ${error}`}
        </Box>}
        {log.length > 0 && <Box component="pre" aria-label="Install progress" sx={{ mt: 2, mb: 0, p: 1.5, maxHeight: 180, overflow: 'auto',
            fontSize: '12.5px', lineHeight: 1.5, color: MUTED, bgcolor: '#f6f8fa', borderRadius: RADIUS, whiteSpace: 'pre-wrap' }}>
            {log.slice(-12).join('\n')}
        </Box>}
    </Box>;
};

const SitePage: React.FC<SiteLandingProps> = ({ site, onOpenStarter, onOpenStory, sessions, footer, disabled }) => {
    const scroller = useRef<HTMLDivElement>(null);
    // Opening the page at #<dataset> scrolls to it once the datasets are on the page.
    const installed = !site.status || site.status === 'ready';
    const hasStarters = installed && site.starters.length > 0;
    useEffect(() => {
        const id = decodeURIComponent(window.location.hash.slice(1));
        if (id && hasStarters) scroller.current?.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView();
    }, [hasStarters]);
    return <Box ref={scroller} sx={{ flex: 1, minWidth: 0, height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column', scrollBehavior: 'smooth',
        fontFamily: fontSans, color: TEXT, bgcolor: 'white', backgroundImage: GRID, backgroundSize: '24px 24px',
        // Thinner, crisper type on macOS, as on the Flint site; the denser app keeps the platform default.
        WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale' }}>
        <Box component="main" sx={{ mx: 'auto', width: '100%', maxWidth: 1200, px: { xs: 2.5, sm: 4 }, pt: { xs: 6, md: 10 }, pb: 10, boxSizing: 'border-box' }}>
            {/* Hero, after the Flint home page: the logo and title, a line naming the source and release, then the
                introduction on the left and a stack of buttons into the datasets on the right. */}
            <Box component="header" sx={{ mx: 'auto', maxWidth: 1000 }}>
                {/* Title centred, as a front page; the introduction below reads left-aligned. */}
                <Box sx={{ textAlign: 'center' }}>
                    <Box component="h1" sx={{ m: 0, fontSize: { xs: '34px', sm: '46px', lg: '54px' }, fontWeight: 700, lineHeight: 1.1,
                        letterSpacing: '-0.03em', color: TEXT, textWrap: 'balance' }}>
                        {site.headline || site.name}
                        {/* Rides on the title's last word, so it wraps with it. */}
                        {site.badge && <Box component="span" sx={{ display: 'inline-block', ml: { xs: 1, sm: 1.5 }, px: 1, py: '3px',
                            verticalAlign: 'middle', position: 'relative', top: '-0.12em',
                            fontSize: { xs: '12px', sm: '14px' }, fontWeight: 600, lineHeight: 1.3, letterSpacing: 0,
                            color: ACCENT, borderRadius: '6px', bgcolor: 'rgba(0, 120, 212, 0.1)' }}>
                            {site.badge}
                        </Box>}
                    </Box>
                </Box>
                <Box sx={{ mt: { xs: 5, md: 7 }, display: 'grid', alignItems: 'start', columnGap: { md: 7 }, rowGap: 4,
                    gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 250px' } }}>
                    <Box sx={{ minWidth: 0, fontSize: '17px', lineHeight: 1.65, color: TEXT }}>
                        {site.tagline && <Box component="p" sx={{ m: 0, mb: 1.5, fontSize: '18px', fontWeight: 600 }}>{site.tagline}</Box>}
                        {!!site.about?.length && <Box component="ul" sx={{ m: 0, pl: 2.75, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                            {site.about.map(item => <li key={item}><LinkedText text={fillRelease(item, site.release)} /></li>)}
                        </Box>}
                        {site.intro && <Box component="p" sx={{ m: 0, mt: 1.5 }}><LinkedText text={fillRelease(site.intro, site.release)} /></Box>}
                    </Box>
                    {/* Jump to each dataset's section below. */}
                    {installed && site.starters.length > 1 && <Box component="nav" aria-label="Datasets" sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, pt: { md: '4px' } }}>
                        {site.starters.map(starter => {
                            const Icon = starterIcon(starter.icon);
                            return <Box component="a" key={starter.id} href={`#${starter.id}`} sx={{ ...heroButton('secondary'), justifyContent: 'center', width: '100%' }}>
                                <Icon sx={{ fontSize: 18, color: MUTED }} />
                                {starter.kicker || starter.title}
                            </Box>;
                        })}
                    </Box>}
                </Box>
            </Box>
            {site.hero_image && <Box sx={{ mt: { xs: 6, md: 9 }, mx: 'auto', maxWidth: 1000 }}><AppWindow image={site.hero_image} /></Box>}

            {installed ? site.starters.map(starter => <DatasetBlock key={starter.id} starter={starter} disabled={disabled}
                onOpenStarter={onOpenStarter} onOpenStory={onOpenStory} />) : <DemoInstall site={site} />}

            {sessions && <Box component="section" aria-labelledby="site-sessions" sx={{ mt: 5, pt: 4, borderTop: SECTION_RULE }}>
                <Box component="h2" id="site-sessions" sx={{ m: 0, mb: 2, fontSize: '22px', fontWeight: 700, lineHeight: 1.35, color: TEXT }}>
                    Your sessions
                </Box>
                {sessions}
            </Box>}

            <Box component="section" aria-label="About the data" sx={{ mt: 6, pt: 3, borderTop: `1px solid ${HAIRLINE}`, maxWidth: 800 }}>
                {site.attribution && <Box component="p" sx={{ m: 0, fontSize: '14px', lineHeight: 1.6, color: TEXT }}>{site.attribution}</Box>}
                {!!site.links?.length && <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', columnGap: 2.5, rowGap: 0.5 }}>
                    {site.links.filter(link => safeUrl(link.url)).map(link => <Link key={link.url} href={safeUrl(link.url)} target="_blank" rel="noopener noreferrer"
                        sx={{ fontFamily: 'inherit', fontSize: '14px', color: ACCENT, textUnderlineOffset: '3px' }}>{link.label}</Link>)}
                </Box>}
                <Box component="p" sx={{ m: 0, mt: 1.5, fontSize: '13px', color: MUTED, lineHeight: 1.6 }}>
                    Powered by{' '}
                    <Link href="https://github.com/microsoft/data-formulator" target="_blank" rel="noopener noreferrer"
                        sx={{ fontFamily: 'inherit', color: ACCENT, textUnderlineOffset: '3px' }}>Data Formulator</Link>
                    .{' '}{site.disclaimer ? <LinkedText text={site.disclaimer} />
                        : 'Example analyses were written by an AI analyst and can be wrong; check results against the source data.'}
                </Box>
            </Box>
        </Box>
        <Box sx={{ mt: 'auto' }}>{footer}</Box>
    </Box>;
};

export default SitePage;
