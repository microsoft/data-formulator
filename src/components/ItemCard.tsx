// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Compact item cards shared by sidebar libraries (workflows, schedules) and
 * agent setup panels (sessions). One small vocabulary — title, title chip,
 * metadata chips, a note, trailing actions, and a tone — so panels look alike
 * and a future declarative panel spec can target the same building blocks.
 */

import React from 'react';
import { Box, ButtonBase, Typography } from '@mui/material';
import { textVar } from '../app/layout';
import { sidebarRowTitleSx } from '../app/tokens';

// Transform and shadow only, so hovering never reflows neighbouring cards.
export const cardHoverSx = {
    transition: 'box-shadow 150ms ease, transform 150ms ease, border-color 150ms ease',
    '&:hover': { borderColor: 'rgba(0, 0, 0, 0.18)', boxShadow: '0 2px 8px rgba(32, 33, 36, 0.08)', transform: 'translateY(-1px)' },
    '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:hover': { transform: 'none' } },
} as const;

/** Filled background shared by run chips, metadata chips, and title tags. */
export const mutedChipBg = 'rgba(0, 0, 0, 0.045)';

/** Small filled chip that prefixes a card title (e.g. the schedule clock or the demo tag). */
export const titleChipSx = { display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle', mr: 0.75, px: 0.5, borderRadius: 0.5,
    bgcolor: mutedChipBg, color: 'text.secondary', fontSize: textVar.xxs, fontWeight: 400, lineHeight: 1.6 } as const;

/** An inert metadata chip: optional icon plus short text. */
export const MetaChip: React.FC<{ icon?: React.ReactNode; children: React.ReactNode; label?: string }> = ({ icon, children, label }) =>
    <Box component="span" aria-label={label} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, minWidth: 0, px: 0.625,
        borderRadius: 0.5, bgcolor: mutedChipBg, fontFamily: theme => theme.typography.fontFamily,
        fontSize: textVar.xs, lineHeight: 1.7, color: 'text.secondary', fontVariantNumeric: 'tabular-nums',
        '& .MuiSvgIcon-root': { fontSize: 13 } }}>
        {icon}<span>{children}</span>
    </Box>;

export type ItemCardTone = 'default' | 'muted' | 'danger';

export interface ItemCardProps {
    /** Title text, or an inline editor while renaming. */
    title: React.ReactNode;
    titleChip?: React.ReactNode;
    meta?: React.ReactNode;
    note?: React.ReactNode;
    /** Trailing icon actions; clicks do not open the card. */
    actions?: React.ReactNode;
    tone?: ItemCardTone;
    /** Opening the card's primary target; the title becomes its accessible button. */
    onOpen?: () => void;
    openLabel?: string;
}

export const ItemCard: React.FC<ItemCardProps> = ({ title, titleChip, meta, note, actions, tone = 'default', onOpen, openLabel }) => {
    const titleText = <Typography component="span" sx={{ ...sidebarRowTitleSx, display: 'block', overflowWrap: 'anywhere',
        color: tone === 'muted' ? 'text.disabled' : 'text.primary', textDecoration: tone === 'muted' ? 'line-through' : 'none' }}>
        {titleChip && <Box component="span" sx={{ ...titleChipSx, py: 0.25 }}>{titleChip}</Box>}{title}
    </Typography>;
    return <Box component="article" sx={{ px: 1, py: 0.75, border: 1, borderRadius: 1, minWidth: 0,
        fontFamily: theme => theme.typography.fontFamily,
        borderColor: tone === 'danger' ? 'error.light' : 'divider',
        bgcolor: tone === 'danger' ? 'rgba(211, 47, 47, 0.04)' : 'background.paper',
        display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', columnGap: 0.5, alignItems: 'start',
        ...(onOpen ? cardHoverSx : {}) }}>
        <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
            {onOpen ? <ButtonBase aria-label={openLabel} onClick={onOpen} sx={{ display: 'block', textAlign: 'left', borderRadius: 0.5,
                '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main' } }}>{titleText}</ButtonBase> : titleText}
            {meta && <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5 }}>{meta}</Box>}
            {note && <Typography component="div" sx={{ fontSize: textVar.xs, lineHeight: 1.5, color: 'text.secondary', overflowWrap: 'anywhere' }}>{note}</Typography>}
        </Box>
        {actions && <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }} onClick={event => event.stopPropagation()}>{actions}</Box>}
    </Box>;
};
