// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * The app's version, small and muted beside the landing tagline. When a newer release is out (the server checks
 * where this copy came from: GitHub releases for the desktop app, PyPI for a pip or uv install), it becomes an
 * update button that says how to update: the download, or the command to run.
 */

import React, { FC, useEffect, useState } from 'react';
import { Box, Button, ButtonBase, IconButton, Link, Popover, Tooltip, Typography, alpha } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useTranslation } from 'react-i18next';

import { apiRequest } from '../app/apiClient';
import { getUrls } from '../app/utils';
import { identText } from '../app/tokens';

export interface UpdateCheck {
    current: string;
    kind?: 'desktop' | 'uv-tool' | 'pip' | 'source' | 'unknown';
    update_available: boolean;
    latest?: string;
    url?: string;
    download_url?: string;
    command?: string;
}

/** One check per page load: the server keeps its answer for hours, so reopening the landing page asks nothing. */
let checked: Promise<UpdateCheck | null> | null = null;
const checkForUpdate = () => checked ??= apiRequest<UpdateCheck>(getUrls().UPDATE_CHECK, { method: 'GET' })
    .then(({ data }) => data, () => null);

export const VersionTag: FC<{ version?: string }> = ({ version }) => {
    const { t } = useTranslation();
    const [update, setUpdate] = useState<UpdateCheck | null>(null);
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    useEffect(() => {
        if (!version) return;
        let live = true;
        void checkForUpdate().then(result => { if (live && result?.update_available) setUpdate(result); });
        return () => { live = false; };
    }, [version]);
    if (!version) return null;
    if (!update?.latest) {
        return <Box component="span" data-app-version title={`Data Formulator ${version}`}
            sx={{ ml: 1, fontSize: 12, ...identText, lineHeight: 1, color: 'text.disabled', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
            v{version}
        </Box>;
    }
    return <>
        <ButtonBase data-app-version data-update-available onClick={event => setAnchor(event.currentTarget)}
            aria-haspopup="dialog" sx={theme => ({
                ml: 1, px: 0.75, py: '2px', borderRadius: '999px', verticalAlign: 'middle',
                fontSize: 12, lineHeight: 1.4, fontWeight: 500, whiteSpace: 'nowrap', fontFamily: 'inherit',
                color: 'primary.main', bgcolor: alpha(theme.palette.primary.main, 0.08),
                '&:hover, &.Mui-focusVisible': { bgcolor: alpha(theme.palette.primary.main, 0.14) },
            })}>
            {t('landing.updateAvailable', { defaultValue: 'Update to v{{version}}', version: update.latest })}
        </ButtonBase>
        <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} transformOrigin={{ vertical: 'top', horizontal: 'center' }}
            slotProps={{ paper: { sx: { mt: 1, p: 2, width: 320, textAlign: 'left' } } }}>
            <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
                {t('landing.updateTitle', { defaultValue: 'Data Formulator {{version}} is available', version: update.latest })}
            </Typography>
            <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25 }}>
                {t('landing.updateCurrent', { defaultValue: 'You have {{version}}.', version: update.current })}
            </Typography>
            {update.command ? <>
                <Typography sx={{ fontSize: 13, mt: 1.5 }}>{t('landing.updateRun', { defaultValue: 'Run this, then restart Data Formulator:' })}</Typography>
                <Box sx={theme => ({ mt: 0.75, display: 'flex', alignItems: 'center', gap: 0.5, pl: 1, pr: 0.25, py: 0.25, borderRadius: 1,
                    bgcolor: alpha(theme.palette.text.primary, 0.05), fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 })}>
                    <Box component="code" sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{update.command}</Box>
                    <Tooltip title={t('landing.updateCopy', { defaultValue: 'Copy' })}>
                        <IconButton size="small" aria-label={t('landing.updateCopy', { defaultValue: 'Copy' })}
                            onClick={() => void navigator.clipboard?.writeText(update.command!).catch(() => undefined)}>
                            <ContentCopyIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                    </Tooltip>
                </Box>
            </> : update.download_url ? <Button variant="contained" size="small" disableElevation href={update.download_url}
                target="_blank" rel="noopener noreferrer" sx={{ mt: 1.5, textTransform: 'none' }}>
                {t('landing.updateDownload', { defaultValue: 'Download the update' })}
            </Button> : null}
            {update.url && <Box sx={{ mt: 1.5 }}>
                <Link href={update.url} target="_blank" rel="noopener noreferrer" underline="hover" sx={{ fontSize: 12 }}>
                    {t('landing.updateNotes', { defaultValue: "What's new" })}
                </Link>
            </Box>}
        </Popover>
    </>;
};

export default VersionTag;
