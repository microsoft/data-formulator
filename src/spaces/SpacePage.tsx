// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { useEffect, useState } from 'react';
import { Box, ButtonBase, Link, Typography } from '@mui/material';
import { apiRequest } from '../app/apiClient';
import { textVar } from '../app/layout';
import { SPACE_COLUMN, spaceText } from './layout';
import { inkColor } from '../app/look';

import { safeUrl } from './links';
import type { SpaceConfig, SpaceLandingProps } from './types';
import { weight } from '../app/tokens';

export { safeUrl };

// A space's front page below the chat and its dataset tabs (design-docs/69): the visitor's own sessions,
// then what the space is built from (or, before it is installed, the install box). The title, chat and
// dataset tabs with their example sessions are above it (DataFormulator.tsx, SpaceDatasetTabs).

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-02" → "February 2026"; anything else as given. */
const releaseName = (release: string) => {
    const match = /^(\d{4})-(\d{2})$/.exec(release);
    return match && MONTHS[Number(match[2]) - 1] ? `${MONTHS[Number(match[2]) - 1]} ${match[1]}` : release;
};

/** "{release}" in profile text, as the release's month and year. */
const fillRelease = (text: string, release?: string) => text.split('{release}').join(releaseName(release || ''));

/** Profile text with [label](url) links, opened in a new tab. */
export const LinkedText: React.FC<{ text: string }> = ({ text }) => <>
    {text.split(/(\[[^\]]+\]\([^)\s]+\))/).map((part, index) => {
        const match = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
        const href = match ? safeUrl(match[2]) : undefined;
        return match && href
            ? <Link key={index} href={href} target="_blank" rel="noopener noreferrer" underline="hover">{match[1]}</Link>
            : <React.Fragment key={index}>{match ? match[1] : part}</React.Fragment>;
    })}
</>;

interface InstallStatus {
    status: 'ready' | 'not_installed';
    can_install: boolean;
    job: { state: 'running' | 'done' | 'failed'; error?: string | null; log: string[] } | null;
}

/** Before a space's content is on this server: install it (local installs) or say it is not available. */
export const SpaceInstall: React.FC<{ space: SpaceConfig }> = ({ space }) => {
    const url = `/api/spaces/${encodeURIComponent(space.id)}/install`;
    const [install, setInstall] = useState<InstallStatus | null>(null);
    const [error, setError] = useState<string | null>(null);
    const running = install?.job?.state === 'running';

    const request = async (options?: RequestInit) => {
        try {
            const { data } = await apiRequest<InstallStatus>(url, options);
            setInstall(data);
            setError(null);
            // The page reloads with the space's datasets and stories.
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

    const canInstall = install?.can_install ?? space.can_install;
    const failed = install?.job?.state === 'failed';
    const log = install?.job?.log ?? [];
    return <Box component="section" aria-labelledby="space-install" sx={{ p: { xs: 2, sm: 3 }, border: '1px solid', borderColor: 'divider',
        borderRadius: 1, bgcolor: 'background.paper', textAlign: 'left' }}>
        <Typography component="h2" id="space-install" sx={{ fontSize: textVar.xl, fontWeight: weight(400) }}>
            {canInstall ? 'Install this space' : 'This space is not available yet'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {canInstall
                ? space.install_note || 'Installing downloads the space\'s data and builds its example sessions on this computer.'
                : 'Its data has not been installed on this server.'}
        </Typography>
        {canInstall && <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <ButtonBase disabled={running} onClick={() => void request({ method: 'POST' })} sx={{ px: 2, py: 1, borderRadius: 1,
                bgcolor: 'text.primary', color: 'background.paper', fontSize: textVar.md, fontWeight: weight(500), ...(running && { opacity: 0.6 }) }}>
                {running ? 'Installing…' : failed ? 'Try again' : 'Install space'}
            </ButtonBase>
            {running && <Typography variant="body2" color="text.secondary">This takes a minute or two; you can leave this page open.</Typography>}
        </Box>}
        {(failed || error) && <Typography role="alert" variant="body2" color="error" sx={{ mt: 2 }}>
            {failed ? `The install stopped: ${install?.job?.error}` : `Could not reach the server: ${error}`}
        </Typography>}
        {log.length > 0 && <Box component="pre" aria-label="Install progress" sx={{ mt: 2, mb: 0, p: 1.5, maxHeight: 180, overflow: 'auto',
            fontSize: textVar.xs, lineHeight: 1.5, color: 'text.secondary', bgcolor: 'action.hover', borderRadius: 1, whiteSpace: 'pre-wrap' }}>
            {log.slice(-12).join('\n')}
        </Box>}
    </Box>;
};

const sectionTitleSx = { fontSize: textVar.xl, fontWeight: weight(400), minHeight: 40, display: 'flex', alignItems: 'center' } as const;

const SpacePage: React.FC<SpaceLandingProps> = ({ space, sessions }) => {
    const installed = !space.status || space.status === 'ready';
    // The chat's column, so everything on the page shares one centre line and one pair of edges.
    return <Box data-space-library sx={{ mx: 'auto', width: '100%', maxWidth: SPACE_COLUMN, textAlign: 'left' }}>
        {!installed && <SpaceInstall space={space} />}

        {sessions && <Box component="section" aria-labelledby="space-sessions" sx={{ mt: installed ? 2 : 5 }}>
            <Typography component="h2" id="space-sessions" sx={{ ...sectionTitleSx, mb: 1.5 }}>Your sessions</Typography>
            {sessions}
        </Box>}

        <Box component="section" aria-label="About this space" sx={{ mt: 6, pt: 3, borderTop: '1px solid', borderColor: 'divider',
            color: theme => inkColor(theme, 0.8), fontSize: spaceText.small, lineHeight: 1.65 }}>
            {!!space.about?.length && <Box component="ul" sx={{ m: 0, pl: 2.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                {space.about.map(item => <li key={item}><LinkedText text={fillRelease(item, space.release)} /></li>)}
            </Box>}
            {space.intro && <Box component="p" sx={{ m: 0, mt: 1 }}><LinkedText text={fillRelease(space.intro, space.release)} /></Box>}
            {space.attribution && <Box component="p" sx={{ m: 0, mt: 1.5 }}>{space.attribution}</Box>}
            {!!space.links?.length && <Box sx={{ mt: 0.75, display: 'flex', flexWrap: 'wrap', columnGap: 2.5, rowGap: 0.5 }}>
                {space.links.filter(link => safeUrl(link.url)).map(link => <Link key={link.url} href={safeUrl(link.url)}
                    target="_blank" rel="noopener noreferrer" underline="hover">{link.label}</Link>)}
            </Box>}
            <Box component="p" sx={{ m: 0, mt: 1.5, fontSize: textVar.xs, color: 'text.secondary' }}>
                Powered by{' '}
                <Link href="https://github.com/microsoft/data-formulator" target="_blank" rel="noopener noreferrer" underline="hover">Data Formulator</Link>
                .{' '}{space.disclaimer ? <LinkedText text={space.disclaimer} />
                    : 'Example analyses were written by an AI analyst and can be wrong; check results against the source data.'}
            </Box>
        </Box>
    </Box>;
};

export default SpacePage;
