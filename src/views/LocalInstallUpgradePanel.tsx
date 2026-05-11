// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * LocalInstallUpgradePanel — shown when DISABLE_DATA_CONNECTORS is true.
 *
 * Hosted/anonymous deployments turn off database connectors for security
 * (browser-supplied identity is spoofable). This panel explains that and
 * tells visitors how to install Data Formulator locally to unlock the
 * full feature set.
 */

import * as React from 'react';
import {
    Box,
    Button,
    Link,
    Paper,
    Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import StorageIcon from '@mui/icons-material/Storage';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import VpnKeyOutlinedIcon from '@mui/icons-material/VpnKeyOutlined';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import GitHubIcon from '@mui/icons-material/GitHub';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import { useTranslation } from 'react-i18next';

const PIP_INSTALL_CMD = 'pip install data-formulator';
const RUN_CMD = 'python -m data_formulator';
const REPO_URL = 'https://github.com/microsoft/data-formulator';
const PYPI_URL = 'https://pypi.org/project/data-formulator/';

interface FeatureRow {
    icon: React.ReactNode;
    title: string;
    desc?: string;
}

interface LocalInstallUpgradePanelProps {
    /** Compact version for narrow sidebars. */
    compact?: boolean;
}

const CommandRow: React.FC<{
    cmd: string;
    copied: boolean;
    onCopy: () => void;
    copyLabel: string;
    copiedLabel: string;
}> = ({ cmd, copied, onCopy, copyLabel, copiedLabel }) => (
    <Paper
        variant="outlined"
        sx={{
            display: 'flex',
            alignItems: 'center',
            px: 1,
            py: 0.5,
            borderRadius: 1,
            bgcolor: 'grey.50',
            gap: 0.5,
            minWidth: 0,
        }}
    >
        <Box
            component="code"
            sx={{
                flex: 1,
                minWidth: 0,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 12,
                color: 'text.primary',
                overflow: 'auto',
                whiteSpace: 'nowrap',
                userSelect: 'all',
            }}
        >
            {cmd}
        </Box>
        <Button
            size="small"
            onClick={onCopy}
            startIcon={
                copied ? (
                    <CheckIcon sx={{ fontSize: 14 }} />
                ) : (
                    <ContentCopyIcon sx={{ fontSize: 14 }} />
                )
            }
            sx={{
                fontSize: 12,
                textTransform: 'none',
                minWidth: 'auto',
                color: copied ? 'success.main' : 'text.secondary',
            }}
        >
            {copied ? copiedLabel : copyLabel}
        </Button>
    </Paper>
);

export const LocalInstallUpgradePanel: React.FC<LocalInstallUpgradePanelProps> = ({
    compact = false,
}) => {
    const { t } = useTranslation();
    // Track which command was most recently copied so the success state
    // toggles per-row instead of glowing on both buttons at once.
    const [copiedCmd, setCopiedCmd] = React.useState<string | null>(null);

    const handleCopy = React.useCallback((cmd: string) => {
        navigator.clipboard?.writeText(cmd).then(() => {
            setCopiedCmd(cmd);
            window.setTimeout(() => {
                setCopiedCmd(prev => (prev === cmd ? null : prev));
            }, 1500);
        }).catch(() => { /* clipboard unavailable */ });
    }, []);

    const features: FeatureRow[] = [
        {
            icon: <StorageIcon sx={{ fontSize: 18 }} />,
            title: t('upload.upgrade.featureDb', { defaultValue: 'Connect to live databases' }),
            desc: t('upload.upgrade.featureDbDesc', {
                defaultValue: 'MySQL, Postgres, Kusto, BigQuery, MongoDB, S3, and more.',
            }),
        },
        {
            icon: <FolderOpenIcon sx={{ fontSize: 18 }} />,
            title: t('upload.upgrade.featureLocalFolder', { defaultValue: 'Browse local folders & large files' }),
        },
        {
            icon: <SaveOutlinedIcon sx={{ fontSize: 18 }} />,
            title: t('upload.upgrade.featureWorkspaces', { defaultValue: 'Persistent workspaces & agent knowledge' }),
        },
        {
            icon: <VpnKeyOutlinedIcon sx={{ fontSize: 18 }} />,
            title: t('upload.upgrade.featureCredentials', { defaultValue: 'Bring your own model keys' }),
        },
    ];

    return (
        <Box
            sx={{
                p: compact ? 1.5 : 3,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                maxWidth: compact ? '100%' : 640,
                mx: compact ? 0 : 'auto',
                minWidth: 0,
                boxSizing: 'border-box',
                fontSize: 13,
            }}
        >
            <Box>
                <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 0.5 }}>
                    {t('upload.upgrade.title', {
                        defaultValue: 'Data connectors require a local install',
                    })}
                </Typography>
                <Typography sx={{ fontSize: 13, color: 'text.secondary', lineHeight: 1.5 }}>
                    {t('upload.upgrade.subtitle', {
                        defaultValue:
                            'Database connectors are disabled in browser-only mode. Install locally for the full experience.',
                    })}
                </Typography>
            </Box>

            {/* Feature list */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                {features.map((f, i) => (
                    <Box
                        key={i}
                        sx={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 1,
                            minWidth: 0,
                            px: 1,
                            py: 0.75,
                            borderRadius: 1,
                            bgcolor: (theme) => alpha(theme.palette.primary.light, 0.08),
                        }}
                    >
                        <Box sx={{ color: 'text.secondary', mt: '2px', flexShrink: 0 }}>
                            {f.icon}
                        </Box>
                        <Box sx={{ minWidth: 0, flex: 1, overflowWrap: 'anywhere' }}>
                            <Typography sx={{ fontSize: 13, lineHeight: 1.4 }}>
                                {f.title}
                            </Typography>
                            {f.desc && (
                                <Typography sx={{ fontSize: 13, color: 'text.secondary', lineHeight: 1.4 }}>
                                    {f.desc}
                                </Typography>
                            )}
                        </Box>
                    </Box>
                ))}
            </Box>

            {/* Install + launch */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
                    {t('upload.upgrade.installHeading', { defaultValue: 'Install & launch' })}
                </Typography>
                <CommandRow
                    cmd={PIP_INSTALL_CMD}
                    copied={copiedCmd === PIP_INSTALL_CMD}
                    onCopy={() => handleCopy(PIP_INSTALL_CMD)}
                    copyLabel={t('upload.upgrade.copy', { defaultValue: 'Copy' })}
                    copiedLabel={t('upload.upgrade.copied', { defaultValue: 'Copied' })}
                />
                <CommandRow
                    cmd={RUN_CMD}
                    copied={copiedCmd === RUN_CMD}
                    onCopy={() => handleCopy(RUN_CMD)}
                    copyLabel={t('upload.upgrade.copy', { defaultValue: 'Copy' })}
                    copiedLabel={t('upload.upgrade.copied', { defaultValue: 'Copied' })}
                />
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                    {t('upload.upgrade.pythonHint', {
                        defaultValue: 'Requires Python 3.11 or newer.',
                    })}
                </Typography>
            </Box>

            {/* Links */}
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                <Link
                    href={REPO_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    underline="hover"
                    sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 0.5,
                        color: 'text.secondary',
                        '&:hover': { color: 'primary.main' },
                    }}
                >
                    <GitHubIcon sx={{ fontSize: 16 }} />
                    <Typography component="span" sx={{ fontSize: 13, lineHeight: 1.4 }}>
                        {t('upload.upgrade.viewOnGithub', { defaultValue: 'View on GitHub' })}
                    </Typography>
                </Link>
                <Link
                    href={PYPI_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    underline="hover"
                    sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 0.5,
                        color: 'text.secondary',
                        '&:hover': { color: 'primary.main' },
                    }}
                >
                    <Box
                        component="img"
                        src="/pip-logo.svg"
                        alt=""
                        sx={{ width: 16, height: 16 }}
                    />
                    <Typography component="span" sx={{ fontSize: 13, lineHeight: 1.4 }}>
                        {t('upload.upgrade.viewOnPypi', { defaultValue: 'PyPI package' })}
                    </Typography>
                </Link>
            </Box>
        </Box>
    );
};

export default LocalInstallUpgradePanel;
