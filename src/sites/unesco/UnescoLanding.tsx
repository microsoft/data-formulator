// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React from 'react';
import { Box, ButtonBase, Link } from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import type { SiteLandingProps, SiteStarter } from '../types';

// A quiet, blog-like page in the style of the Flint site: one reading column on
// a faint grid, numbered sections divided by hairlines, muted secondary text.
const FONT = 'Inter, -apple-system, "Segoe UI", system-ui, Roboto, "Helvetica Neue", sans-serif';
const INK = 'rgb(31, 35, 40)';
const BODY = 'rgb(64, 71, 78)';
const MUTED = 'rgb(107, 113, 120)';
const RULE = 'rgb(216, 222, 228)';
const LINK = 'rgb(0, 120, 212)';
const GRID = 'linear-gradient(90deg, rgba(0,0,0,0.02) 1px, transparent 1px), linear-gradient(0deg, rgba(0,0,0,0.02) 1px, transparent 1px)';

const prose = { fontSize: '16.5px', lineHeight: 1.65, color: INK, m: 0 } as const;

const StarterSection: React.FC<{ starter: SiteStarter; number: number; disabled?: boolean;
    onOpen: (starter: SiteStarter, question?: string) => void }> = ({ starter, number, disabled, onOpen }) => {
    const unavailable = disabled || !starter.available;
    return <Box component="section" aria-labelledby={`starter-${starter.id}`}
        sx={{ py: 3, borderTop: number > 1 ? `1px solid ${RULE}` : 'none', opacity: starter.available ? 1 : 0.6 }}>
        <Box component="h3" id={`starter-${starter.id}`} sx={{ m: 0, mb: '6px', fontSize: '18px', fontWeight: 700, color: INK, lineHeight: 1.35 }}>
            {number}. {starter.title}
        </Box>
        {starter.subtitle && <Box component="p" sx={{ m: 0, mb: 1.25, fontSize: '14px', color: MUTED }}>{starter.subtitle}</Box>}
        {starter.description && <Box component="p" sx={{ ...prose, fontSize: '16px', color: BODY, mb: 2 }}>{starter.description}</Box>}
        {starter.questions.length > 0 && <Box component="ul" aria-label="Starter analyses"
            sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
            {starter.questions.map(question => <Box component="li" key={question}>
                <ButtonBase disabled={unavailable} onClick={() => onOpen(starter, question)} sx={{
                    width: '100%', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1.5, textAlign: 'left',
                    px: 1.75, py: 1.25, borderRadius: '6px', border: `1px solid ${RULE}`, bgcolor: 'rgba(255,255,255,0.85)',
                    fontFamily: 'inherit', fontSize: '15px', lineHeight: 1.55, color: INK,
                    transition: 'border-color 0.12s, background-color 0.12s',
                    '& .starter-arrow': { color: MUTED, transition: 'color 0.12s, transform 0.12s' },
                    '&:hover, &.Mui-focusVisible': { borderColor: 'rgba(0,0,0,0.24)', bgcolor: 'rgb(246, 248, 250)' },
                    '&:hover .starter-arrow, &.Mui-focusVisible .starter-arrow': { color: LINK, transform: 'translateX(2px)' },
                }}>
                    <span>{question}</span>
                    <ArrowForwardIcon className="starter-arrow" sx={{ fontSize: 18, mt: '3px', flexShrink: 0 }} />
                </ButtonBase>
            </Box>)}
        </Box>}
        <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <ButtonBase disabled={unavailable} onClick={() => onOpen(starter)} sx={{
                gap: 1, px: 2, py: '9px', borderRadius: '6px', border: '1px solid rgba(0,0,0,0.24)', bgcolor: 'white',
                fontFamily: 'inherit', fontSize: '14.5px', fontWeight: 600, color: INK,
                '&:hover, &.Mui-focusVisible': { bgcolor: 'rgb(246, 248, 250)' },
            }}>
                <ChatBubbleOutlineIcon sx={{ fontSize: 17 }} />
                Open and ask your own question
            </ButtonBase>
            {!starter.available && <Box component="span" sx={{ fontSize: '13px', color: MUTED }}>Not available yet</Box>}
        </Box>
    </Box>;
};

const UnescoLanding: React.FC<SiteLandingProps> = ({ site, onOpenStarter, sessions, footer, disabled }) => {
    return <Box sx={{ flex: 1, minWidth: 0, height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column',
        fontFamily: FONT, color: INK, bgcolor: 'white', backgroundImage: GRID, backgroundSize: '24px 24px' }}>
        <Box component="main" sx={{ mx: 'auto', width: '100%', maxWidth: 832, px: { xs: 2.5, sm: 3 }, pt: { xs: 6, sm: 9 }, pb: 8, boxSizing: 'border-box' }}>
            <Box component="header">
                <Box component="p" sx={{ m: 0, fontSize: '13px', color: MUTED, letterSpacing: '0.01em' }}>
                    UNESCO Institute for Statistics{site.release ? ` · ${site.release} release` : ''}
                </Box>
                <Box component="h1" sx={{ m: 0, mt: 1.5, fontSize: { xs: '30px', sm: '36px' }, fontWeight: 700, lineHeight: 1.2, color: INK }}>
                    {site.name}
                </Box>
                {site.tagline && <Box component="p" sx={{ ...prose, mt: 3 }}>{site.tagline}</Box>}
                {site.intro && <Box component="p" sx={{ ...prose, mt: 2 }}>{site.intro}</Box>}
            </Box>

            <Box component="h2" sx={{ m: 0, mt: 6, mb: 1, fontSize: '22px', fontWeight: 700, lineHeight: 1.35, color: INK }}>
                Datasets
            </Box>
            {site.starters.map((starter, index) =>
                <StarterSection key={starter.id} starter={starter} number={index + 1} disabled={disabled} onOpen={onOpenStarter} />)}

            {sessions && <Box component="section" aria-labelledby="site-sessions" sx={{ mt: 3, pt: 3, borderTop: `1px solid ${RULE}` }}>
                <Box component="h2" id="site-sessions" sx={{ m: 0, mb: 2, fontSize: '22px', fontWeight: 700, lineHeight: 1.35, color: INK }}>
                    Your sessions
                </Box>
                {sessions}
            </Box>}

            <Box component="section" aria-label="About the data" sx={{ mt: 3, pt: 3, borderTop: `1px solid ${RULE}` }}>
                {site.attribution && <Box component="p" sx={{ m: 0, fontSize: '14px', lineHeight: 1.6, color: BODY }}>{site.attribution}</Box>}
                {!!site.links?.length && <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', columnGap: 2.5, rowGap: 0.5 }}>
                    {site.links.map(link => <Link key={link.url} href={link.url} target="_blank" rel="noopener noreferrer"
                        sx={{ fontFamily: 'inherit', fontSize: '14px', color: LINK, textUnderlineOffset: '2px' }}>{link.label}</Link>)}
                </Box>}
                <Box component="p" sx={{ m: 0, mt: 1.5, fontSize: '13px', color: MUTED, lineHeight: 1.6 }}>
                    Powered by{' '}
                    <Link href="https://github.com/microsoft/data-formulator" target="_blank" rel="noopener noreferrer"
                        sx={{ fontFamily: 'inherit', color: LINK, textUnderlineOffset: '2px' }}>Data Formulator</Link>
                    . AI-generated analyses can be wrong; check results against the UIS data browser.
                </Box>
            </Box>
        </Box>
        <Box sx={{ mt: 'auto' }}>{footer}</Box>
    </Box>;
};

export default UnescoLanding;
