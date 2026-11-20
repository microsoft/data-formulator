// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Share an app, map or chart as an image to post. The picture is drawn as the person sees it, extra sharp
 * (AgentViewHost), and laid out as a card (shareCard.ts) whose shape and words the person can change. It can be
 * downloaded, copied or shared from here; on hosted Data Formulator it can also be put on the web when asked: a
 * QR code then opens it on the person's phone with buttons to post it (data_formulator/shares.py).
 */

import React, { FC, Suspense, useEffect, useMemo, useState } from 'react';
import { Box, Button, CircularProgress, Dialog, DialogContent, DialogTitle, IconButton, Input, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DownloadIcon from '@mui/icons-material/Download';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import IosShareIcon from '@mui/icons-material/IosShare';
import CheckIcon from '@mui/icons-material/Check';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import FitScreenIcon from '@mui/icons-material/FitScreen';
import CropLandscapeIcon from '@mui/icons-material/CropLandscape';
import CropSquareIcon from '@mui/icons-material/CropSquare';
import CropPortraitIcon from '@mui/icons-material/CropPortrait';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';

import { DataFormulatorState } from '../app/dfSlice';
import { apiRequest } from '../app/apiClient';
import { getUrls } from '../app/utils';
import { CARD_SHAPES, CardShape, composeShareCard, pictureSizeFor, ShareCard } from '../app/shareCard';
import { iconVar, textVar } from '../app/layout';
import type { ViewTarget } from '../views/agentView';
import dfLogo from '../assets/df-logo.svg';
import { ink, paper, weight } from '../app/tokens';

const AgentViewHost = React.lazy(() => import('../views/AgentViewHost'));

/** The pictures are drawn this sharp (pixels per CSS pixel), so they stay crisp when the card enlarges them. */
const PICTURE_SCALE = 4;

/** A drawn picture; a map's, with the card shape it was drawn for. */
type Picture = { image: string; density?: number; drawnFor?: CardShape };
type Online = { step: 'idle' } | { step: 'uploading' } | { step: 'ready'; card: string; link: string; qr: string } | { step: 'failed'; message: string };

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

const fileName = (title: string) => `${(title || 'share').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'share'}.png`;

const barLabelSx = { pr: 0.75, color: 'text.secondary', fontSize: textVar.xxs, whiteSpace: 'nowrap', fontWeight: weight(500), userSelect: 'none' } as const;
const underlineSx = {
    fontSize: textVar.xs, color: 'text.secondary',
    '&:before': { borderBottomColor: ink(0.2) },
    '&:hover:not(.Mui-disabled):before': { borderBottomColor: ink(0.42) },
    '&:after': { borderBottomColor: ink(0.42) },
} as const;

const SHAPE_ICONS: Record<CardShape, React.ReactElement> = {
    fit: <FitScreenIcon sx={{ fontSize: iconVar.md }} />,
    wide: <CropLandscapeIcon sx={{ fontSize: iconVar.md }} />,
    square: <CropSquareIcon sx={{ fontSize: iconVar.md }} />,
    tall: <CropPortraitIcon sx={{ fontSize: iconVar.md }} />,
};

export const ShareDialog: FC<{ open: boolean; onClose: () => void; target: ViewTarget; title: string }> = ({ open, onClose, target, title }) => {
    const { t } = useTranslation();
    const site = useSelector((state: DataFormulatorState) => state.serverConfig.SITE);
    const sharesOnline = useSelector((state: DataFormulatorState) => !!state.serverConfig.SHARE_LINKS);
    const [picture, setPicture] = useState<Picture | null>(null);
    const [failure, setFailure] = useState<string | null>(null);
    // The card's shape (the one the picture fills best until one is picked) and words (its title to start with).
    const [shape, setShape] = useState<CardShape | undefined>(undefined);
    const [words, setWords] = useState(title);
    const [settledWords, setSettledWords] = useState(title);
    const [card, setCard] = useState<ShareCard | null>(null);
    const [online, setOnline] = useState<Online>({ step: 'idle' });
    const [copied, setCopied] = useState(false);
    // A new request each time the dialog opens, so the picture is the current one.
    const [round, setRound] = useState(0);
    useEffect(() => {
        if (!open) return;
        setPicture(null); setFailure(null); setCard(null); setShape(undefined); setWords(title); setSettledWords(title);
        setOnline({ step: 'idle' }); setCopied(false); setRound(value => value + 1);
    }, [open]);
    // A map can take any shape: it is drawn for the card's, shortened to the map (a card that fits it then fits the
    // map), and drawn again when the shape changes. Other pictures keep their own.
    const isMap = target.kind === 'map';
    const mapShape = isMap ? shape ?? 'fit' : undefined;
    const request = useMemo(() => ({ id: `share-${round}${mapShape ? `-${mapShape}` : ''}`,
        targets: [mapShape ? { ...target, ...pictureSizeFor(mapShape), fitHeight: true } : target] }), [round, target.path, mapShape]);
    useEffect(() => {
        if (mapShape && picture && picture.drawnFor !== mapShape) { setPicture(null); setCard(null); }
    }, [mapShape]);

    useEffect(() => {
        const timer = window.setTimeout(() => setSettledWords(words), 250);
        return () => window.clearTimeout(timer);
    }, [words]);

    useEffect(() => {
        if (!picture) return;
        let cancelled = false;
        composeShareCard({ picture: picture.image, density: picture.density, crop: target.kind === 'app', shape,
            title: settledWords, brand: site?.name || 'Data Formulator', logos: [...(site?.logo ? [site.logo] : []), dfLogo] })
            .then(made => { if (!cancelled) { setCard(made); setCopied(false); } },
                error => { if (!cancelled) setFailure(message(error)); });
        return () => { cancelled = true; };
    }, [picture, shape, settledWords, site?.name, site?.logo, target.kind]);

    /** The card's link on the web (put online now, unless it already is); undefined when that failed. */
    const putOnline = async (): Promise<string | undefined> => {
        if (!card) return undefined;
        if (online.step === 'ready' && online.card === card.url) return online.link;
        setOnline({ step: 'uploading' });
        try {
            const { data } = await apiRequest<{ path: string }>(getUrls().SHARES, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: card.url, title: settledWords || title }) });
            const link = `${window.location.origin}${data.path}`;
            setOnline({ step: 'ready', card: card.url, link, qr: await QRCode.toDataURL(link, { margin: 1, width: 360, errorCorrectionLevel: 'M' }) });
            return link;
        } catch (reason) {
            setOnline({ step: 'failed', message: message(reason) });
            return undefined;
        }
    };

    const blob = async () => (await fetch(card!.url)).blob();
    const download = () => {
        const anchor = document.createElement('a');
        anchor.href = card!.url;
        anchor.download = fileName(settledWords || title);
        anchor.click();
    };
    const copy = async () => {
        try {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': await blob() })]);
            setCopied(true);
            return true;
        } catch { return false; /* clipboard images are not allowed here; Download still works */ }
    };
    const canShare = typeof navigator !== 'undefined' && !!navigator.share;
    const shareHere = async () => {
        try {
            const file = new File([await blob()], fileName(settledWords || title), { type: 'image/png' });
            const link = online.step === 'ready' ? online.link : undefined;
            if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: settledWords || title });
            else await navigator.share({ title: settledWords || title, ...(link ? { url: link } : {}) });
        } catch { /* dismissed */ }
    };

    const drawing = !failure && (!picture || !card);
    // The QR code leads to the card as it was put online: once the card changes it can be put online again.
    const stale = online.step === 'ready' && !!card && online.card !== card.url;
    const shapeLabels: Record<CardShape, string> = {
        fit: t('share.fit', { defaultValue: 'Fit the picture' }),
        wide: t('share.wide', { defaultValue: 'Wide' }),
        square: t('share.square', { defaultValue: 'Square' }),
        tall: t('share.tall', { defaultValue: 'Tall' }),
    };

    return <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth aria-labelledby="share-dialog-title">
        <DialogTitle id="share-dialog-title" sx={{ pr: 6, fontSize: 18 }}>
            {t('share.title', { defaultValue: 'Share as an image' })}
            <IconButton aria-label={t('app.close', { defaultValue: 'Close' })} onClick={onClose} sx={{ position: 'absolute', right: 12, top: 12 }}>
                <CloseIcon />
            </IconButton>
        </DialogTitle>
        <DialogContent>
            {open && !picture && !failure && <Suspense fallback={null}>
                <AgentViewHost key={request.id} request={request} scale={PICTURE_SCALE}
                    onDone={([result]) => result?.image ? setPicture({ image: result.image, density: result.density, drawnFor: mapShape })
                        : setFailure(result?.error || t('share.notDrawn', { defaultValue: 'It could not be drawn.' }))} />
            </Suspense>}
            {drawing && <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 6, justifyContent: 'center', color: 'text.secondary' }}>
                <CircularProgress size={20} />
                <Typography sx={{ fontSize: 14 }}>{t('share.drawing', { defaultValue: 'Making the image…' })}</Typography>
            </Box>}
            {failure && <Typography role="alert" sx={{ py: 4, color: 'error.main', fontSize: 14 }}>
                {t('share.failed', { defaultValue: 'The image could not be made: {{reason}}', reason: failure })}
            </Typography>}
            {!drawing && !failure && card && <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start', flexDirection: { xs: 'column', sm: 'row' } }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'center', bgcolor: 'action.hover', borderRadius: 1.5, p: 1.5 }}>
                        <Box component="img" src={card.url} alt={settledWords || title} data-share-card data-shape={card.shape}
                            sx={{ display: 'block', maxWidth: '100%', maxHeight: '52vh', width: 'auto', height: 'auto',
                                aspectRatio: `${card.width} / ${card.height}`, borderRadius: 1, boxShadow: '0 1px 6px rgba(0,0,0,.12)', bgcolor: paper() }} />
                    </Box>
                    {/* The card's settings in one quiet bar, like a chart's property bar (ChartQuickConfig). */}
                    <Box data-share-bar sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 18px', mt: 1.5,
                        px: 1.5, py: 0.5, borderRadius: 2, backgroundColor: ink(0.025) }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', minHeight: 28 }}>
                            <Typography id="share-layout-label" sx={barLabelSx}>{t('share.layout', { defaultValue: 'Layout' })}</Typography>
                            <ToggleButtonGroup size="small" exclusive value={card.shape} onChange={(_, value) => value && setShape(value)}
                                aria-labelledby="share-layout-label" sx={{ gap: 0.25, '& .MuiToggleButton-root': {
                                    border: 'none', borderRadius: '4px !important', p: '3px 5px', color: 'text.secondary',
                                    '&.Mui-selected': { color: 'primary.main', backgroundColor: 'rgba(25,118,210,0.1)' },
                                } }}>
                                {CARD_SHAPES.map(value => <Tooltip key={value} title={shapeLabels[value]}>
                                    <ToggleButton value={value} aria-label={shapeLabels[value]}>{SHAPE_ICONS[value]}</ToggleButton>
                                </Tooltip>)}
                            </ToggleButtonGroup>
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 200, minHeight: 28 }}>
                            <Input id="share-words" value={words} placeholder={t('share.words', { defaultValue: 'Words on the card' })}
                                inputProps={{ 'aria-label': t('share.words', { defaultValue: 'Words on the card' }) }} onChange={event => setWords(event.target.value.slice(0, 200))}
                                fullWidth sx={{ ...underlineSx, flex: 1, '& input': { padding: '1px 2px' } }} />
                        </Box>
                    </Box>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mt: 1.5 }}>
                        <Button variant="contained" disableElevation startIcon={<DownloadIcon />} onClick={download} sx={{ textTransform: 'none' }}>
                            {t('share.download', { defaultValue: 'Download image' })}
                        </Button>
                        {typeof ClipboardItem !== 'undefined' && <Button variant="outlined" onClick={() => void copy()} sx={{ textTransform: 'none' }}
                            startIcon={copied ? <CheckIcon /> : <ContentCopyIcon />} color={copied ? 'success' : 'primary'}>
                            {copied ? t('share.copied', { defaultValue: 'Copied' }) : t('share.copy', { defaultValue: 'Copy image' })}
                        </Button>}
                        {canShare && <Button variant="text" startIcon={<IosShareIcon />} onClick={() => void shareHere()} sx={{ textTransform: 'none' }}>
                            {t('share.shareHere', { defaultValue: 'Share…' })}
                        </Button>}
                    </Box>
                </Box>
                {sharesOnline && <Box data-share-qr sx={{ width: 220, flexShrink: 0, textAlign: 'center', alignSelf: { xs: 'center', sm: 'flex-start' } }}>
                    {online.step === 'ready'
                        ? <Box component="img" src={online.qr} alt={online.link}
                            sx={{ display: 'block', width: 200, height: 200, mx: 'auto', opacity: stale ? 0.25 : 1 }} />
                        : <Box sx={{ width: 200, height: 200, mx: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            border: 1, borderColor: 'divider', borderRadius: 1.5, color: 'text.disabled' }}>
                            {online.step === 'uploading' ? <CircularProgress size={24} /> : <QrCode2Icon sx={{ fontSize: 96 }} />}
                        </Box>}
                    {online.step === 'ready' && !stale
                        ? <>
                            <Typography sx={{ mt: 1, fontSize: 15, fontWeight: weight(600) }}>{t('share.scan', { defaultValue: 'Scan to post from your phone' })}</Typography>
                            <Typography sx={{ mt: 0.5, fontSize: 12, color: 'text.secondary' }}>
                                {t('share.scanDetail', { defaultValue: 'It opens this image with buttons to share it. Only the image goes on the web, for a limited time.' })}
                            </Typography>
                        </>
                        : <>
                            <Button variant="contained" size="small" startIcon={<QrCode2Icon />} disabled={online.step === 'uploading'}
                                onClick={() => void putOnline()} sx={{ mt: 1.25, textTransform: 'none' }}>
                                {stale ? t('share.updateQr', { defaultValue: 'Update the QR code' }) : t('share.makeQr', { defaultValue: 'Get a QR code' })}
                            </Button>
                            <Typography sx={{ mt: 0.75, fontSize: 12, color: online.step === 'failed' ? 'error.main' : 'text.secondary' }}>
                                {online.step === 'failed' ? online.message
                                    : t('share.makeQrDetail', { defaultValue: 'Puts this image on the web for a limited time, with a page to post it from your phone.' })}
                            </Typography>
                        </>}
                </Box>}
            </Box>}
        </DialogContent>
    </Dialog>;
};

export default ShareDialog;
