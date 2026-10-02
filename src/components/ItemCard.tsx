// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The item card shared by sessions, workflows, and schedules: a title with inline
 * badges (or a rename field), caption lines, an optional meta row (chips or run
 * links), and icon actions. `compact` suits sidebar libraries; `mini` renders
 * the same parts as a one-line sidebar row. Hover-only actions never take space
 * from the title.
 */

import React, { createContext, useContext } from 'react';
import { Box, ButtonBase, IconButton, TextField, Tooltip, TooltipProps, Typography } from '@mui/material';
import { iconVar, textVar } from '../app/layout';
import { sidebarRowActionSx, sidebarRowDangerActionSx, sidebarRowMetaSx, sidebarRowSx, sidebarRowTitleSx } from '../app/tokens';

// Transform and shadow only, so hovering never reflows neighbouring cards.
export const cardHoverSx = {
    transition: 'box-shadow 90ms ease, transform 90ms ease, border-color 90ms ease',
    '&:hover': { borderColor: 'rgba(0, 0, 0, 0.18)', boxShadow: '0 2px 8px rgba(32, 33, 36, 0.08)', transform: 'translateY(-1px)' },
    '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:hover': { transform: 'none' } },
} as const;

/** Filled background shared by run chips and metadata chips. */
export const mutedChipBg = 'rgba(0, 0, 0, 0.045)';

/** An inert metadata chip: optional icon plus short text. */
export const MetaChip: React.FC<{ icon?: React.ReactNode; children: React.ReactNode; label?: string }> = ({ icon, children, label }) =>
    <Box component="span" aria-label={label} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, minWidth: 0, px: 0.625,
        borderRadius: 0.5, bgcolor: mutedChipBg, fontFamily: theme => theme.typography.fontFamily,
        fontSize: textVar.xs, lineHeight: 1.7, color: 'text.secondary', fontVariantNumeric: 'tabular-nums',
        '& .MuiSvgIcon-root': { fontSize: 13 } }}>
        {icon}<span>{children}</span>
    </Box>;

/**
 * Hover surface for information about an item (counts, description, fields), as opposed to
 * the default dark tooltip, which only names an action. A paper card with an arrow at its source.
 */
export const metadataTooltipSlotProps: TooltipProps['slotProps'] = {
    tooltip: { sx: {
        maxWidth: 320, p: 0, maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', overscrollBehavior: 'contain',
        bgcolor: 'background.paper', color: 'text.primary', border: '1px solid', borderColor: 'divider',
        boxShadow: '0 4px 18px rgba(32, 33, 36, 0.14), 0 1px 3px rgba(32, 33, 36, 0.08)', borderRadius: 1,
    } },
    arrow: { sx: { color: 'background.paper', '&::before': { border: '1px solid', borderColor: 'divider', boxSizing: 'border-box' } } },
    popper: { modifiers: [{ name: 'offset', options: { offset: [0, 2] } }] },
};

export const MetadataTooltip: React.FC<{ title: React.ReactNode; children: React.ReactElement; placement?: TooltipProps['placement'] }>
    = ({ title, children, placement = 'right-start' }) =>
    <Tooltip title={title ?? ''} placement={placement} arrow enterDelay={300} enterNextDelay={100} slotProps={metadataTooltipSlotProps}>
        {children}
    </Tooltip>;

/** Content for a metadata hover card: title, one summary line, an optional description, then details (e.g. chips). */
export const MetadataCard: React.FC<{ title: React.ReactNode; summary?: React.ReactNode; description?: React.ReactNode; children?: React.ReactNode }>
    = ({ title, summary, description, children }) =>
    <Box sx={{ p: 1.25 }}>
        <Typography sx={{ fontSize: textVar.sm, fontWeight: 600, color: 'text.primary', overflowWrap: 'anywhere' }}>{title}</Typography>
        {summary && <Typography sx={{ fontSize: textVar.xs, color: 'text.secondary', mt: 0.5 }}>{summary}</Typography>}
        {description && <Typography sx={{ fontSize: textVar.xs, lineHeight: 1.55, color: 'text.secondary', mt: 0.5,
            whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{description}</Typography>}
        {children && <Box sx={{ mt: 0.75 }}>{children}</Box>}
    </Box>;

/** Compact name/detail chips for a metadata card, e.g. columns with types or workflow inputs. */
export const MetadataChips: React.FC<{ items: { name: string; detail?: string }[]; total?: number; limit?: number }>
    = ({ items, total = items.length, limit = 24 }) =>
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        {items.slice(0, limit).map((item, index) => <Box key={`${item.name}-${index}`} component="span" sx={{
            fontSize: textVar.xxs, lineHeight: 1.5, px: 0.5, borderRadius: 0.5, bgcolor: 'action.hover', color: 'text.secondary',
            maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.name}{item.detail && <Box component="span" sx={{ color: 'text.disabled', ml: 0.5 }}>{item.detail}</Box>}
        </Box>)}
        {total > limit && <Box component="span" sx={{ fontSize: textVar.xxs, lineHeight: 1.5, px: 0.5, color: 'text.disabled' }}>+{total - limit}</Box>}
    </Box>;

/** Text link beside a panel title that opens the panel's full view; text avoids clashing with the collapse chevron. */
export const ViewAllButton: React.FC<{ label: string; onClick: () => void; disabled?: boolean }> = ({ label, onClick, disabled }) =>
    <ButtonBase aria-label={label} title={label} disabled={disabled} onClick={onClick}
        sx={{ ml: 0.75, px: 0.5, borderRadius: 0.5, fontFamily: theme => theme.typography.fontFamily, fontSize: textVar.xs, lineHeight: 1.6,
            color: 'text.secondary', '&:hover': { color: 'primary.main', bgcolor: 'action.hover' },
            '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main' }, '&.Mui-disabled': { color: 'text.disabled' } }}>
        View all
    </ButtonBase>;

/** Grid for item cards: as many ~220px columns as fit. */
export const itemCardGridSx = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))',
    gap: 1.5,
} as const;

// Sidebar-sized cards and rows use accent row actions; regular cards use muted ones.
const RowActionContext = createContext(false);

/** Icon action for an item card; `danger` for destructive, `menu` when it opens a menu. */
export const ItemCardAction: React.FC<{ label: string; icon: React.ReactNode; onClick: (anchor: HTMLElement) => void; disabled?: boolean; danger?: boolean;
    menu?: boolean }> = ({ label, icon, onClick, disabled, danger, menu }) => {
    const rowStyle = useContext(RowActionContext);
    return <Tooltip title={label}><span>
        <IconButton size="small" aria-label={label} aria-haspopup={menu ? 'menu' : undefined} disabled={disabled}
            sx={rowStyle ? (danger ? sidebarRowDangerActionSx : sidebarRowActionSx)
                : { p: 0.5, color: danger ? 'error.main' : 'text.secondary', '& .MuiSvgIcon-root': { fontSize: iconVar.md } }}
            onClick={event => { event.stopPropagation(); onClick(event.currentTarget); }}>{icon}</IconButton>
    </span></Tooltip>;
};

export interface ItemCardProps {
    title: React.ReactNode;
    /** Small markers after the title, e.g. a scheduled clock or a demo tag. */
    badges?: React.ReactNode;
    /** Small caption lines under the title; one trailing meta line when `mini`. */
    captions?: React.ReactNode[];
    /** A row under the captions, e.g. metadata chips or run links. */
    meta?: React.ReactNode;
    /** Inline rename editor; replaces the title while present. */
    rename?: { value: string; label: string; onChange: (value: string) => void; onCommit: () => void; onCancel: () => void };
    actions?: React.ReactNode;
    /** Keep actions visible beside the title instead of revealing them on hover. */
    persistentActions?: boolean;
    onOpen?: () => void;
    /** Accessible name of the title button that opens the item. */
    openLabel?: string;
    /** Cmd/Ctrl-click or middle-click, like a link. */
    onOpenInNewTab?: () => void;
    /** Metadata shown in a hover card, usually a `MetadataCard`. */
    tooltip?: React.ReactNode;
    /** Dimmed and inert, e.g. after deletion. */
    inactive?: boolean;
    /** The open item: marked and not clickable. */
    current?: boolean;
    /** Keep the hover state, e.g. while the item's menu is open. */
    active?: boolean;
    /** Sidebar-sized card with wrapping titles. */
    compact?: boolean;
    /** One-line sidebar row. */
    mini?: boolean;
}

const RenameField: React.FC<{ rename: NonNullable<ItemCardProps['rename']>; mini: boolean }> = ({ rename, mini }) =>
    <TextField autoFocus fullWidth variant="standard" value={rename.value} sx={mini ? { flex: 1 } : undefined}
        onChange={event => rename.onChange(event.target.value)} onClick={event => event.stopPropagation()}
        onBlur={rename.onCommit}
        onKeyDown={event => {
            if (event.key === 'Enter') { event.preventDefault(); rename.onCommit(); }
            else if (event.key === 'Escape') { event.preventDefault(); rename.onCancel(); }
        }}
        slotProps={{ htmlInput: { 'aria-label': rename.label, maxLength: 120 },
            input: { sx: { fontSize: textVar.sm, ...(mini ? { fontWeight: 500, py: 0 } : {}) } } }} />;

// Hidden actions take no width; hover, keyboard focus (not a mouse click), or `active` reveal them.
const revealSx = {
    '& .item-actions': { display: 'inline-flex', flexShrink: 0, width: 0, overflow: 'hidden' },
    '&:hover .item-actions, &:has(:focus-visible) .item-actions, &.item-active .item-actions': { width: 'auto', overflow: 'visible' },
    '&:hover .item-meta, &:has(:focus-visible) .item-meta, &.item-active .item-meta': { display: 'none' },
    '@media (hover: none)': { '& .item-actions': { width: 'auto', overflow: 'visible' }, '& .item-meta': { display: 'none' } },
} as const;

const stopClick = (event: React.MouseEvent) => event.stopPropagation();

export const ItemCard: React.FC<ItemCardProps> = ({ title, badges, captions = [], meta, rename, actions, persistentActions = false,
    onOpen, openLabel, onOpenInNewTab, tooltip, inactive = false, current = false, active = false, compact = false, mini = false }) => {
    const clickable = !!onOpen && !rename && !inactive && !current;
    const handleClick = (event: React.MouseEvent) => {
        if (rename || inactive) return;
        if ((event.metaKey || event.ctrlKey) && onOpenInNewTab) { onOpenInNewTab(); return; }
        if (clickable) onOpen!();
    };
    const handleAuxClick = (event: React.MouseEvent) => {
        if (event.button === 1 && onOpenInNewTab && !rename && !inactive) { event.preventDefault(); onOpenInNewTab(); }
    };
    const visibleCaptions = captions.filter(Boolean);
    const showActions = !!actions && !inactive && !rename;
    const titleColor = current ? 'primary.main' : 'text.primary';

    if (mini) {
        return <RowActionContext.Provider value>
            <MetadataTooltip title={rename ? '' : tooltip}>
                <Box onClick={handleClick} onAuxClick={handleAuxClick} className={active ? 'item-active sidebar-row-active' : undefined}
                    sx={{ ...sidebarRowSx, ...revealSx, cursor: clickable ? 'pointer' : 'default', opacity: inactive ? 0.55 : 1 }}>
                    {current && <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: 'primary.main', flexShrink: 0 }} />}
                    {rename ? <RenameField rename={rename} mini /> : <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Typography noWrap sx={{ ...sidebarRowTitleSx, flex: '0 1 auto',
                            color: titleColor, textDecoration: inactive ? 'line-through' : 'none' }}>{title}</Typography>
                        {badges}
                    </Box>}
                    {!rename && visibleCaptions.length > 0 && <Typography className={showActions ? 'item-meta' : undefined} sx={{ ...sidebarRowMetaSx, ml: 0.5 }}>
                        {visibleCaptions.map((caption, index) => <React.Fragment key={index}>{index > 0 && ' · '}{caption}</React.Fragment>)}
                    </Typography>}
                    {/* The action zone, including the gaps around its icons, never opens the item. */}
                    {showActions && <Box className="item-actions" onClick={stopClick} onAuxClick={stopClick}
                        sx={{ alignSelf: 'stretch', alignItems: 'center', gap: 0.25, my: -0.5, pl: 0.75, cursor: 'default' }}>{actions}</Box>}
                </Box>
            </MetadataTooltip>
        </RowActionContext.Provider>;
    }

    const titleContent = <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
        <Typography component="span" noWrap={!compact} sx={{ color: titleColor, textDecoration: inactive ? 'line-through' : 'none',
            ...(compact ? { ...sidebarRowTitleSx, flex: '0 1 auto', overflowWrap: 'anywhere' } : { minWidth: 0, fontSize: '0.875rem', lineHeight: 1.43 }) }}>{title}</Typography>
        {badges}
    </Box>;
    const card = <Box component="article" onClick={handleClick} onAuxClick={handleAuxClick} className={active ? 'item-active' : undefined} sx={{
        position: 'relative', minWidth: 0, textAlign: 'left', fontFamily: theme => theme.typography.fontFamily,
        border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper',
        px: compact ? 1 : 2, py: compact ? 0.75 : 1.5, display: 'flex', flexDirection: 'column', gap: compact ? 0.25 : 0,
        cursor: clickable ? 'pointer' : 'default', opacity: inactive ? 0.55 : 1,
        ...(clickable ? cardHoverSx : {}),
        '& .item-overlay-actions': { opacity: 0, transition: 'opacity 90ms' },
        '&:hover .item-overlay-actions, &:has(:focus-visible) .item-overlay-actions, &.item-active .item-overlay-actions': { opacity: 1 },
        '@media (hover: none)': { '& .item-overlay-actions': { opacity: 1 } },
    }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, minWidth: 0 }}>
            {rename ? <RenameField rename={rename} mini={false} />
                : clickable ? <ButtonBase aria-label={openLabel} onClick={event => { event.stopPropagation(); handleClick(event); }}
                    sx={{ flex: 1, minWidth: 0, display: 'block', textAlign: 'left', borderRadius: 0.5,
                        '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main' } }}>{titleContent}</ButtonBase>
                : <Box sx={{ flex: 1, minWidth: 0 }}>{titleContent}</Box>}
            {showActions && persistentActions && <RowActionContext.Provider value={compact}>
                <Box onClick={stopClick} sx={{ display: 'inline-flex', flexShrink: 0, alignItems: 'center', gap: 0.25, cursor: 'default' }}>{actions}</Box>
            </RowActionContext.Provider>}
        </Box>
        {visibleCaptions.map((caption, index) => <Typography key={index} component="div"
            sx={{ fontSize: textVar.xs, lineHeight: 1.5, color: 'text.secondary', overflowWrap: 'anywhere' }}>{caption}</Typography>)}
        {meta && <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5 }}>{meta}</Box>}
        {showActions && !persistentActions && <RowActionContext.Provider value={compact}>
            <Box className="item-overlay-actions" onClick={stopClick} onAuxClick={stopClick}
                sx={{ position: 'absolute', bottom: 4, right: 4, display: 'flex', alignItems: 'center', gap: 0.25, cursor: 'default' }}>{actions}</Box>
        </RowActionContext.Provider>}
    </Box>;
    return tooltip && !rename ? <MetadataTooltip title={tooltip} placement={compact ? 'right-start' : 'bottom-start'}>{card}</MetadataTooltip> : card;
};
