import React from 'react';
import { Box, ButtonBase, Dialog, DialogActions, DialogTitle, IconButton, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { dialogHeight, dialogWidth, iconVar, textVar } from '../app/layout';
import { borderColor } from '../app/tokens';
import { ScrollFadeContainer, ScrollFadeEdge, useScrollFade } from './ScrollFade';

/** Left list column shared by management panels (schedules, workflows, data connectors), with scroll-edge fades. */
export const ListDetailList: React.FC<{
    component?: 'nav' | 'div';
    role?: string;
    'aria-label': string;
    children: React.ReactNode;
}> = ({ component = 'div', role, 'aria-label': ariaLabel, children }) => {
    const scrollRef = React.useRef<HTMLDivElement>(null);
    const { moreAbove, moreBelow, update } = useScrollFade(scrollRef);
    return <Box sx={{ position: 'relative', display: 'flex', flexShrink: 0, minHeight: 0, width: { xs: '100%', sm: 240 },
        borderRight: { xs: 0, sm: `1px solid ${borderColor.divider}` }, borderBottom: { xs: `1px solid ${borderColor.divider}`, sm: 0 } }}>
        <Box ref={scrollRef} component={component} role={role} aria-label={ariaLabel} onScroll={update} sx={{
            flex: 1, minWidth: 0, display: 'flex', flexDirection: { xs: 'row', sm: 'column' }, gap: 0.75,
            px: 1.25, pt: { xs: 1, sm: 0.5 }, pb: { xs: 1, sm: 4 },
            overflowY: { xs: 'hidden', sm: 'auto' }, overflowX: { xs: 'auto', sm: 'hidden' } }}>
            {children}
        </Box>
        <ScrollFadeEdge visible={moreAbove} edge="top" />
        <ScrollFadeEdge visible={moreBelow} />
    </Box>;
};

/** Navigator items share the sidebar card look so a selection reads as the same object. */
export const listDetailItemSx = (selected: boolean) => ({
    display: 'block', flexShrink: 0, width: { xs: 'auto', sm: '100%' }, minWidth: { xs: 'max-content', sm: 0 },
    textAlign: 'left', px: 1.25, py: 0.75, fontSize: textVar.sm, textTransform: 'none',
    border: 1, borderRadius: 1, borderColor: selected ? 'primary.main' : 'divider',
    color: 'text.primary', fontWeight: selected ? 500 : 400,
    bgcolor: selected ? 'rgba(25, 118, 210, 0.04)' : 'background.paper',
    transition: 'border-color 150ms ease, box-shadow 150ms ease',
    '&:hover': selected ? {} : { borderColor: 'rgba(0, 0, 0, 0.18)', boxShadow: '0 2px 8px rgba(32, 33, 36, 0.08)' },
} as const);

export interface ListDetailItem {
    key: string;
    primary: React.ReactNode;
    secondary?: React.ReactNode;
    muted?: boolean;
    icon?: React.ReactNode;
    /** Right-aligned adornment, e.g. a connection status dot. */
    trailing?: React.ReactNode;
}

/** Card navigator shared by list/detail panels: optional dashed create entry, then one card per item. */
export const ListDetailNav: React.FC<{
    listLabel: string;
    items: ListDetailItem[];
    /** `null` selects the create entry. */
    selectedKey: string | null;
    onSelect: (key: string | null) => void;
    createLabel?: string;
    busy?: boolean;
    /** Status content (loading, errors, empty state) shown above the items. */
    children?: React.ReactNode;
}> = ({ listLabel, items, selectedKey, onSelect, createLabel, busy, children }) =>
    <ListDetailList component="nav" aria-label={listLabel}>
        {createLabel && <ButtonBase aria-current={selectedKey === null || undefined} disabled={busy} onClick={() => onSelect(null)}
            sx={{ ...listDetailItemSx(selectedKey === null), display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 0.75,
                color: 'primary.main', borderStyle: 'dashed' }}>
            <AddIcon sx={{ fontSize: iconVar.md }} />{createLabel}
        </ButtonBase>}
        {children}
        {items.map(item => <ButtonBase key={item.key} aria-current={item.key === selectedKey || undefined} disabled={busy}
            onClick={() => onSelect(item.key)} sx={{ ...listDetailItemSx(item.key === selectedKey), display: 'flex', alignItems: 'flex-start', gap: 0.75 }}>
            {item.icon && <Box component="span" sx={{ display: 'inline-flex', mt: 0.25, color: 'text.secondary', '& .MuiSvgIcon-root': { fontSize: iconVar.md } }}>{item.icon}</Box>}
            <Box component="span" sx={{ flex: 1, minWidth: 0 }}>
                <Typography component="span" sx={{ display: 'block', fontSize: 'inherit', fontWeight: 'inherit', overflowWrap: 'anywhere',
                    color: item.muted ? 'text.disabled' : 'inherit' }}>{item.primary}</Typography>
                {item.secondary && <Typography component="span" sx={{ display: 'block', fontSize: textVar.xs, fontWeight: 400,
                    color: 'text.secondary', overflowWrap: 'anywhere' }}>{item.secondary}</Typography>}
            </Box>
            {item.trailing && <Box component="span" sx={{ display: 'inline-flex', alignSelf: 'center', flexShrink: 0 }}>{item.trailing}</Box>}
        </ButtonBase>)}
    </ListDetailList>;

/** Two-pane management panel: selectable items on the left, overview or editor on the right. */
export const ListDetailDialog: React.FC<{
    title: string;
    listLabel: string;
    items: ListDetailItem[];
    /** `null` selects the create entry. */
    selectedKey: string | null;
    onSelect: (key: string | null) => void;
    createLabel?: string;
    busy?: boolean;
    onClose: () => void;
    footer?: React.ReactNode;
    onSubmit?: React.FormEventHandler<HTMLFormElement>;
    onInvalidCapture?: React.FormEventHandler<HTMLFormElement>;
    /** Caps the detail column, e.g. for simple forms; editors may use the full width. */
    contentMaxWidth?: number;
    /** Preferred dialog width; size it to the content so forms are not stretched. */
    width?: number;
    /** Give the detail column a fixed height so an editor can fill it and scroll internally. */
    fillHeight?: boolean;
    children: React.ReactNode;
}> = ({ title, listLabel, items, selectedKey, onSelect, createLabel, busy, onClose, footer, onSubmit, onInvalidCapture, contentMaxWidth, width = 920, fillHeight, children }) => {
    const titleId = React.useId();
    return <Dialog open onClose={() => !busy && onClose()} maxWidth={false} aria-labelledby={titleId}
        sx={{ '& .MuiDialog-paper': { m: 2, width: dialogWidth(width), maxWidth: 'none', height: dialogHeight(640), maxHeight: 'none',
            display: 'flex', flexDirection: 'column' } }}>
        <Box component={onSubmit ? 'form' : 'div'} onSubmit={onSubmit} onInvalidCapture={onInvalidCapture}
            sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden', fontFamily: theme => theme.typography.fontFamily }}>
            <DialogTitle id={titleId} sx={{ display: 'flex', alignItems: 'center', px: 2.5, pt: 1.75, pb: 1, fontSize: textVar.lg, fontWeight: 600 }}>
                <Box component="span" sx={{ flex: 1 }}>{title}</Box>
                <IconButton aria-label="Close" size="small" disabled={busy} onClick={onClose}><CloseRoundedIcon sx={{ fontSize: iconVar.md }} /></IconButton>
            </DialogTitle>
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, flex: 1, minHeight: 0 }}>
                <ListDetailNav listLabel={listLabel} items={items} selectedKey={selectedKey} onSelect={onSelect} createLabel={createLabel} busy={busy} />
                <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                    <ScrollFadeContainer sx={{ px: 3, py: 2,
                        '& .MuiInputBase-root, & .MuiInputLabel-root, & .MuiFormControlLabel-label': { fontSize: textVar.md },
                        '& .MuiFormHelperText-root, & .MuiDivider-root .MuiTypography-root': { fontSize: textVar.xs } }}>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, minHeight: '100%', maxWidth: contentMaxWidth,
                            ...(fillHeight ? { height: '100%' } : {}) }}>
                            {children}
                        </Box>
                    </ScrollFadeContainer>
                    {footer && <DialogActions disableSpacing sx={{ flexShrink: 0, flexWrap: 'wrap', gap: 1, px: 3, pt: 1, pb: 2,
                        '& .MuiButton-root': { fontSize: textVar.md, textTransform: 'none' } }}>{footer}</DialogActions>}
                </Box>
            </Box>
        </Box>
    </Dialog>;
};
