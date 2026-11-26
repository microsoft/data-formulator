// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Roles: what views use to draw lines, quiet text, focus and tinted cards. Each role reads a named value of the
 * active look's spec (looks.ts), never the look's name, so a view says what something is and the look decides how
 * it is drawn. Roles that need no theme (borders, corners, shadows over CSS variables) live in ../tokens.ts.
 */

import { alpha, type Theme } from '@mui/material/styles';

import { borderColor, radius } from '../tokens';
import { LOOKS, type Look, type LookSpec } from './looks';

declare module '@mui/material/styles' {
    interface Theme { look: Look }
    interface ThemeOptions { look?: Look }
}

/** The active look's spec; themes made without one (sandboxed apps, tests) are soft. */
export const lookOf = (theme: Theme): LookSpec => LOOKS[theme.look] ?? LOOKS.soft;

/** A border or outline whose soft-look strength is `soft` (an opacity of the text colour); anchors are near-black
 *  when the look strengthens them, stronger soft lines (a hover) staying blacker. */
export const lineColor = (theme: Theme, soft: number) => {
    const anchor = lookOf(theme).anchorLine;
    return alpha(anchor?.color ?? theme.palette.text.primary, anchor ? Math.min(1, anchor.base + soft * anchor.gain) : soft);
};

/** A line one level below the anchors (a panel, a card, a chip around the anchor): its soft-look strength `soft`,
 *  or the shared frame grey (`view`) or lighter inner line (`divider`) when the look draws frames from tokens. */
export const frameColor = (theme: Theme, soft: number, level: 'view' | 'divider' = 'view') =>
    lookOf(theme).frames === 'tokens' ? borderColor[level] : alpha(theme.palette.text.primary, soft);

/** Quiet text whose soft-look strength is `soft`; darker when the look lifts quiet ink. */
export const inkColor = (theme: Theme, soft: number) => {
    const lift = lookOf(theme).inkLift;
    return alpha(theme.palette.text.primary, soft + (1 - soft) * lift);
};

/** A chat input's focus: a soft blue halo with a lift, or a crisp solid edge (its border doubled to 2px on the
 *  inside, so a container that clips at the box's edge cannot crop it), no glow. */
export const inputFocusShadow = (theme: Theme) => lookOf(theme).focus.input === 'edge'
    ? `inset 0 0 0 1px ${theme.palette.primary.main}`
    : `0 0 0 2px ${alpha(theme.palette.primary.main, 0.15)}, 0 2px 10px rgba(32, 33, 36, 0.14)`;

/** The colour of a selection ring (tokens.ts `selectionRing`) in a palette colour: its lighter shade, or the full one. */
export const focusColor = (theme: Theme, color: { main: string; light: string }) =>
    lookOf(theme).focus.strongRing ? color.main : color.light;

/** A hovered chart card's outline in the accent, if the look draws one (it replaces the soft hover lift). */
export const chartHoverRing = (theme: Theme) => {
    const outline = lookOf(theme).focus.chartHoverOutline;
    return outline === null ? undefined : `0 0 0 1px ${alpha(theme.palette.primary.main, outline)}`;
};

/** The outline of a card tinted in `main` (a user prompt, an artifact): a deeper shade of its own tint, or the grey
 *  component line. */
export const toneLine = (theme: Theme, main: string) => {
    const line = lookOf(theme).tone.line;
    return line === null ? borderColor.component : alpha(main, line);
};

/** A tinted card's hover outline: its full colour, or `undefined` to keep its resting outline. */
export const toneHoverLine = (theme: Theme, main: string) => lookOf(theme).tone.hoverLine ? main : undefined;

/** The hover outline of a card that lifts (example cards): the accent, or a darker grey. */
export const cardHoverLine = (theme: Theme) =>
    lookOf(theme).cardHoverLine === 'accent' ? theme.palette.primary.main : lineColor(theme, 0.16);

/** The outline of the landing page's chat box: tinted with the accent, or an anchor line. */
export const heroInputLine = (theme: Theme) =>
    lookOf(theme).heroInputLine === 'accent' ? alpha(theme.palette.primary.main, 0.38) : lineColor(theme, 0.2);

/** What a sandboxed app needs of the host's look: its name (a React app builds its MUI theme with it) and the CSS
 *  variables that restyle the app kit. */
export const appLook = (theme: Theme): { look: Look; vars: Record<string, string> } =>
    ({ look: LOOKS[theme.look] ? theme.look : 'soft', vars: lookOf(theme).app });

/** Whether an agent step off the focused chain is drawn as a plain dot on the thread rail. */
export const quietOffChainSteps = (theme: Theme) => lookOf(theme).thread.quietOffChain;

/** The fill of a card tinted in a palette colour (an artifact, a table chip): its tint, or `none` (by default
 *  transparent) where the look keeps such cards on the paper. */
export const toneFill = (theme: Theme, color: { main: string; bgcolor?: string }, none = 'transparent', softAlpha = 0.08) =>
    lookOf(theme).tone.fill ? color.bgcolor || alpha(color.main, softAlpha) : none;

/** A user's prompt in the thread, in the user's colour (`color`): a tinted card, or plain text marked by a rule. */
export const userPromptSurface = (theme: Theme, color: { main: string; bgcolor?: string }) =>
    lookOf(theme).userPrompt === 'card'
        ? { backgroundColor: color.bgcolor, border: `1px solid ${toneLine(theme, color.main)}`, borderRadius: radius.sm }
        : { backgroundColor: 'transparent', border: '1px solid transparent', borderLeft: `2px solid ${alpha(color.main, 0.7)}`,
            // Tighter than the card: the rule is the edge, so the text sits one card-padding in from it.
            borderRadius: 0, fontWeight: 500, py: '2px', pl: '6px' };

/** A table column header in its field's colour (`color`): a tinted fill over a 2px rule, or no fill over a 1px rule. */
export const tableHeaderSurface = (theme: Theme, color: { main: string; bgcolor?: string }) =>
    lookOf(theme).tableHeader === 'tinted'
        ? { backgroundColor: color.bgcolor || alpha(color.main, 0.1), borderBottomColor: color.main, borderBottomWidth: '2px' }
        : { backgroundColor: 'transparent', borderBottomColor: color.main, borderBottomWidth: '1px' };
