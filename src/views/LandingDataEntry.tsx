import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, Menu, MenuItem, Tooltip, Typography } from '@mui/material';
import type { LiveQuestion, livePickCopy } from '../app/liveDataPick';
import type { Theme } from '@mui/material/styles';
import BoltOutlinedIcon from '@mui/icons-material/BoltOutlined';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import AddIcon from '@mui/icons-material/Add';
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder';
import { useTranslation } from 'react-i18next';
import { AgentChatInput } from './AgentChatInput';
import { ToolsAccessButton } from '../components/ToolsAccess';
import { buildDataLoadingQuickActions, buildDataLoadingSuggestions, QuickActionContext } from './dataLoadingSuggestions';
import { ConnectorInstance } from '../components/ComponentType';
import { apiRequest } from '../app/apiClient';
import { getUrls } from '../app/utils';
import { iconVar, textVar } from '../app/layout';
import { frameColor, heroInputLine, inkColor } from '../app/look';
import { SPACE_COLUMN, spaceText } from '../spaces/layout';
import { ambientShadow, cardRadius, metaText, paper, weight } from '../app/tokens';

/** A space's landing (design-docs/69): its own suggested questions and chat placeholder. */
export interface LandingSpace {
    /** Short questions offered as chips; sending one starts the chat with it. */
    suggestions: string[];
    placeholder?: string;
}

/** How many chips, in order, fit on one row of ``available`` px with ``gap`` between them: all of them, else as many
 *  as fit beside the "More" chip (``more`` px wide), and always at least one. */
export const chipsThatFit = (widths: number[], more: number, available: number, gap: number): number => {
    const total = widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, widths.length - 1);
    if (total <= available) return widths.length;
    let used = more;
    let count = 0;
    for (const width of widths) {
        if (used + gap + width > available) break;
        used += gap + width;
        count += 1;
    }
    return Math.max(1, count);
};

const chipSx = (space: boolean) => {
    // Opaque, so the canvas behind doesn't show through; hover and focus tint it from above.
    const tinted = { bgcolor: paper(), backgroundImage: (theme: Theme) => `linear-gradient(${theme.palette.action.hover}, ${theme.palette.action.hover})` };
    return {
        fontSize: space ? spaceText.body : textVar.md, minHeight: space ? 34 : 30, height: { xs: 'auto', sm: space ? 34 : 30 }, maxWidth: '100%',
        borderRadius: cardRadius('8px'), bgcolor: paper(),
        // Sharp: the input below is the one near-black box; its suggestions sit a level lighter, as in the workspace.
        color: space ? (theme: Theme) => inkColor(theme, 0.8) : 'text.secondary', borderColor: (theme: Theme) => frameColor(theme, 0.12, 'divider'),
        '& .MuiChip-label': space ? { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } : { whiteSpace: 'normal' },
        '& .MuiChip-icon': { fontSize: textVar.lg, ml: 0.5, color: 'text.disabled' },
        // `&&` outranks MUI's clickable-chip hover and focus fills, which are translucent.
        '&&:hover': { ...tinted, borderColor: (theme: Theme) => frameColor(theme, 0.2) },
        '&&.Mui-focusVisible': tinted,
    };
};

const CHIP_GAP = 6;

/**
 * A space's questions on one row, so every space's chat (and the title above it) sits at the same height: the ones
 * that fit, then "More" with the rest in a menu.
 */
const SpaceSuggestions: React.FC<{ suggestions: string[]; disabled: boolean; onPick: (text: string) => void }> = ({
    suggestions, disabled, onPick,
}) => {
    const { t } = useTranslation();
    const rowRef = useRef<HTMLDivElement>(null);
    const measureRef = useRef<HTMLDivElement>(null);
    const [shown, setShown] = useState(suggestions.length);
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const moreText = t('landing.moreQuestions', { defaultValue: 'More' });
    const moreLabel = <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
        {moreText}<KeyboardArrowDownIcon sx={{ fontSize: textVar.lg, color: 'text.disabled', mr: -0.5 }} />
    </Box>;
    useLayoutEffect(() => {
        const row = rowRef.current;
        const measure = measureRef.current;
        if (!row || !measure) return;
        const fit = () => {
            const widths = [...measure.children].map(child => (child as HTMLElement).offsetWidth);
            const more = widths.pop() ?? 0;
            setShown(row.clientWidth ? chipsThatFit(widths, more, row.clientWidth, CHIP_GAP) : suggestions.length);
        };
        fit();
        const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(fit);
        observer?.observe(row);
        return () => observer?.disconnect();
    }, [suggestions, moreText]);
    const hidden = suggestions.slice(shown);
    const chip = (text: string) => <Chip key={text} icon={<BoltOutlinedIcon />} label={text} title={text} onClick={() => onPick(text)}
        disabled={disabled} variant="outlined" size="small" sx={{ ...chipSx(true), minWidth: 0, flexShrink: 1 }} />;
    return <Box ref={rowRef} sx={{ position: 'relative', mb: 1.75, display: 'flex', alignItems: 'center', flexWrap: 'nowrap', gap: `${CHIP_GAP}px`, minWidth: 0 }}>
        {/* Every chip at its full width, unseen, to work out how many fit. */}
        <Box ref={measureRef} aria-hidden sx={{ position: 'absolute', visibility: 'hidden', pointerEvents: 'none', display: 'flex', gap: `${CHIP_GAP}px`, top: 0, left: 0 }}>
            {suggestions.map(text => <Chip key={text} icon={<BoltOutlinedIcon />} label={text} variant="outlined" size="small" sx={{ ...chipSx(true), flexShrink: 0, maxWidth: 'none' }} />)}
            <Chip label={moreLabel} variant="outlined" size="small" sx={{ ...chipSx(true), flexShrink: 0 }} />
        </Box>
        {suggestions.slice(0, shown).map(chip)}
        {hidden.length > 0 && <>
            <Chip label={moreLabel} aria-label={moreText} variant="outlined" size="small" disabled={disabled} aria-haspopup="menu"
                onClick={event => setAnchor(event.currentTarget)} sx={{ ...chipSx(true), flexShrink: 0 }} />
            <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
                {hidden.map(text => <MenuItem key={text} sx={{ fontSize: spaceText.body }} onClick={() => { setAnchor(null); onPick(text); }}>
                    <BoltOutlinedIcon sx={{ fontSize: textVar.lg, mr: 1, color: 'text.disabled' }} />{text}
                </MenuItem>)}
            </Menu>
        </>}
    </Box>;
};

interface LandingDataEntryProps {
    onStartChat: (prompt: string, images: string[], attachments: string[]) => void;
    ensureActiveWorkspace: () => void;
    onUpload?: () => void;
    onConnect?: () => void;
    onLinkFolder?: () => void;
    onSelectConnector: (connector: ConnectorInstance) => void;
    connectors: ConnectorInstance[];
    readOnly?: boolean;
    quickActionContext?: QuickActionContext;
    space?: LandingSpace;
}

export const LandingDataEntry: React.FC<LandingDataEntryProps> = ({
    onStartChat, ensureActiveWorkspace, onUpload, onConnect, onLinkFolder, onSelectConnector, connectors, readOnly = false, quickActionContext, space,
}) => {
    const { t } = useTranslation();
    const [input, setInput] = useState('');
    const [images, setImages] = useState<string[]>([]);
    const [attachments, setAttachments] = useState<string[]>([]);
    const [uploadCount, setUploadCount] = useState(0);
    const [error, setError] = useState('');
    // One pick per visit, so the second quick action doesn't change while the user reads it.
    const [quickActionSeed] = useState(() => Math.random());
    const disabled = readOnly || uploadCount > 0;
    const submit = (text: string, imageValues: string[], attachmentValues: string[]) => {
        if (disabled || (!text.trim() && !imageValues.length && !attachmentValues.length)) return;
        onStartChat(text.trim(), imageValues, attachmentValues);
        setInput('');
        setImages([]);
        setAttachments([]);
    };
    const suggestionArgs = {
        t, setInput, setImages, setAttachments, ensureActiveWorkspace,
        requestAutoSend: (payload: { text: string; images: string[]; attachments: string[] }) =>
            submit(payload.text, payload.images, payload.attachments),
    };
    return <Box sx={{ width: '100%', maxWidth: space ? SPACE_COLUMN : 800, mx: 'auto', textAlign: 'left' }}>
        {space
            ? <SpaceSuggestions suggestions={space.suggestions} disabled={disabled} onPick={text => submit(text, [], [])} />
            : <Box sx={{ mb: 1.75, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.75 }}>
                {buildDataLoadingQuickActions(suggestionArgs, quickActionContext, quickActionSeed).map(action => <Chip key={action.kind}
                    icon={<BoltOutlinedIcon />} label={action.label} onClick={action.onClick} disabled={disabled}
                    variant="outlined" size="small" sx={chipSx(false)} />)}
            </Box>}
        {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 1 }}>{error}</Alert>}
        <AgentChatInput value={input} onChange={setInput} images={images} onImagesChange={setImages}
            trailingSlot={<ToolsAccessButton />}
            onSend={() => submit(input, images, attachments)} disabled={disabled} layout="stacked" minRows={space ? 3 : 4}
            attachments={attachments} onAttachmentsChange={setAttachments}
            onNonImageFile={async file => {
                if (readOnly) return;
                ensureActiveWorkspace();
                setUploadCount(count => count + 1);
                setError('');
                try {
                    const formData = new FormData();
                    formData.append('file', file);
                    const { data } = await apiRequest(getUrls().SCRATCH_UPLOAD_URL, { method: 'POST', body: formData });
                    const name = (data?.path || `scratch/${file.name}`).replace(/^scratch\//, '');
                    setAttachments(previous => [...previous, name]);
                } catch (reason) { setError(String(reason)); }
                finally { setUploadCount(count => count - 1); }
            }}
            tabSuggestion={space ? space.suggestions[0] : t('upload.agentChatTabSuggestion', { defaultValue: 'What dataset do we have here?' })}
            focusSuggestionsLabel={t('upload.agentChatSuggestionsLabel', { defaultValue: 'Try asking' })}
            focusSuggestions={space ? undefined : buildDataLoadingSuggestions(suggestionArgs)}
            placeholder={space ? space.placeholder || t('upload.demoChatPlaceholder', { defaultValue: 'Ask a question about the data…' })
                : t('upload.agentChatPlaceholder', { defaultValue: 'Load or connect data, then ask for charts, maps, dashboards or reports…' })}
            sendTooltip={t('upload.agentChatSendTooltip', { defaultValue: 'Start chatting with the agent' })}
            sx={{ borderColor: (theme: Theme) => heroInputLine(theme),
                ...(space && { '& textarea': { fontSize: spaceText.input } }),
                boxShadow: ambientShadow('0 5px 18px rgba(32, 33, 36, 0.11), 0 1px 4px rgba(32, 33, 36, 0.07)'),
                '&:hover': { boxShadow: ambientShadow('0 6px 20px rgba(32, 33, 36, 0.11), 0 2px 6px rgba(32, 33, 36, 0.06)') } }} />
        {!space && <LandingSources connectors={connectors} onSelectConnector={onSelectConnector} onUpload={onUpload}
            onLinkFolder={onLinkFolder} onConnect={onConnect} />}
    </Box>;
};

type LandingSourcesProps = Pick<LandingDataEntryProps, 'connectors' | 'onSelectConnector' | 'onUpload' | 'onLinkFolder' | 'onConnect'>;

/** Up to four things to ask the agent, as a block of chips two to a row, in equal columns so the block stays
 *  balanced (a long one wraps in its chip); picking one sends it. */
export const QuickChatOptions: React.FC<{ onPick: (text: string) => void; suggestions: string[] }> = ({ onPick, suggestions }) => {
    return <Box sx={{ mt: 1.5, display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 0.75 }}>
        {suggestions.slice(0, 4).map(text => <Chip key={text} label={text} title={text} onClick={() => onPick(text)}
            variant="outlined" size="small" sx={{ ...chipSx(false), fontSize: textVar.xs, minHeight: 26, height: 'auto', py: 0.5,
                justifyContent: 'flex-start', textAlign: 'left',
                '& .MuiChip-label': { whiteSpace: 'normal', lineHeight: 1.4, px: 1.25 } }} />)}
    </Box>;
};

// Line glyphs on a 12-unit grid, drawn like the sharp look's (components/look/SharpGlyphs): one stroke weight, no fills.
const LIVE_GLYPHS: Record<LiveQuestion, React.ReactNode> = {
    umbrella: <><path d="M1.25 6.5a4.75 4.75 0 0 1 9.5 0z" /><path d="M6 6.5v3.25a1.1 1.1 0 0 1-2.2 0" /></>,
    warmer: <><path d="M4.9 7.4V2.4a1.1 1.1 0 0 1 2.2 0v5" /><circle cx="6" cy="8.9" r="1.85" /></>,
    daylight: <><path d="M1 9.75h10" /><path d="M3.25 9.75a2.75 2.75 0 0 1 5.5 0" /><path d="M6 3.5v1.5M2.4 5.3l1 1M9.6 5.3l-1 1" /></>,
    wiki: <><path d="M6 3.25C4.75 2.4 3.1 2.1 1.5 2.4v7c1.6-.3 3.25 0 4.5.85 1.25-.85 2.9-1.15 4.5-.85v-7C8.9 2.1 7.25 2.4 6 3.25z" /><path d="M6 3.25v7" /></>,
    // A globe, as on the sharp look's map glyph.
    countries: <><circle cx="6" cy="6" r="4.4" /><ellipse cx="6" cy="6" rx="1.9" ry="4.4" /><path d="M1.6 6h8.8" /></>,
    // A crescent moon.
    moon: <><path d="M8.9 8.5A4.6 4.6 0 0 1 4.1 1.6a4.6 4.6 0 1 0 6.3 6.1 4.6 4.6 0 0 1-1.5.8z" /></>,
};
const LiveGlyph: React.FC<{ question: LiveQuestion }> = ({ question }) =>
    <Box component="svg" viewBox="0 0 12 12" aria-hidden sx={{ width: 14, height: 14, flexShrink: 0, overflow: 'visible' }}
        fill="none" stroke="currentColor" strokeWidth={1.1} strokeLinecap="round" strokeLinejoin="round">{LIVE_GLYPHS[question]}</Box>;

/** A blank session's live-data pick, under its chips: an everyday question (`copy`) that loads a live dataset and has
 *  the agent chart it (`onRun`). */
export const LiveDataPick: React.FC<{ onRun: () => Promise<void>; copy: ReturnType<typeof livePickCopy>; onBusy?: (busy: boolean) => void }> = ({
    onRun, copy, onBusy,
}) => {
    const { t } = useTranslation();
    const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');
    const run = async () => {
        if (state === 'busy') return;
        setState('busy');
        onBusy?.(true);
        try { await onRun(); setState('idle'); }
        catch (error) { console.warn('Live data pick failed:', error); setState('failed'); }
        finally { onBusy?.(false); }
    };
    return <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', minWidth: 0 }}>
        <Tooltip describeChild title={copy.hint} placement="bottom-start">
            <Button disableRipple onClick={run} disabled={state === 'busy'} startIcon={<LiveGlyph question={copy.question} />} sx={{
                p: 0, minWidth: 0, textTransform: 'none', fontSize: textVar.xs, fontWeight: weight(500), color: 'text.secondary',
                '& .MuiButton-startIcon': { mr: 0.75, ml: 0, '& svg': { transition: 'transform 0.25s ease' } },
                '&:hover': { background: 'none', color: 'primary.main' },
                // The glyph tips when pointed at, and rocks while the data loads.
                '&:hover .MuiButton-startIcon svg': { transform: 'rotate(-10deg)' },
                '&.Mui-disabled': { color: 'text.secondary' },
                '&.Mui-disabled .MuiButton-startIcon svg': { animation: 'liveWobble 0.6s ease-in-out infinite alternate' },
                '@keyframes liveWobble': { from: { transform: 'rotate(-10deg)' }, to: { transform: 'rotate(10deg)' } },
            }}>
                {state === 'busy' ? copy.busy : copy.ask}
            </Button>
        </Tooltip>
        {state === 'failed' && <Typography sx={{ fontSize: textVar.xs, color: 'text.disabled' }}>
            {t('upload.livePick.failed', { defaultValue: "That didn't come through. Try again in a bit." })}
        </Typography>}
    </Box>;
};

const CAROUSEL_MS = 5000;

/**
 * The live-data questions one at a time, in an order shuffled for each visit, under a blank session's chips. They
 * turn every few seconds, but not while pointed at, focused, or loading.
 */
export const LiveQuestionCarousel: React.FC<{
    questions: LiveQuestion[];
    copyFor: (question: LiveQuestion) => ReturnType<typeof livePickCopy>;
    onRun: (question: LiveQuestion) => Promise<void>;
}> = ({ questions, copyFor, onRun }) => {
    const [order] = useState(() => {
        const shuffled = [...questions];
        for (let index = shuffled.length - 1; index > 0; index--) {
            const other = Math.floor(Math.random() * (index + 1));
            [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
        }
        return shuffled;
    });
    const [index, setIndex] = useState(0);
    const [held, setHeld] = useState(false);
    const [busy, setBusy] = useState(false);
    const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    useEffect(() => {
        if (held || busy || order.length < 2 || reduceMotion) return;
        const timer = window.setTimeout(() => setIndex(current => (current + 1) % order.length), CAROUSEL_MS);
        return () => window.clearTimeout(timer);
    }, [index, held, busy, order.length, reduceMotion]);
    if (!order.length) return null;
    const question = order[index % order.length];
    return <Box sx={{ mt: 1.25, display: 'flex', alignItems: 'center', gap: 1.25, minHeight: 22 }}
        onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)}
        onFocus={() => setHeld(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setHeld(false); }}>
        <Box key={question} sx={{ minWidth: 0, animation: reduceMotion ? 'none' : 'liveTurn 0.35s ease-out',
            '@keyframes liveTurn': { from: { opacity: 0, transform: 'translateY(4px)' }, to: { opacity: 1, transform: 'none' } } }}>
            <LiveDataPick copy={copyFor(question)} onRun={() => onRun(question)} onBusy={setBusy} />
        </Box>
    </Box>;
};

/** Under the landing chat: the sources it is connected to, and the ways to add data this deployment allows. A space
 *  page places it after its centred chat, and gets only the space's sources (the server limits them). */
export const LandingSources: React.FC<LandingSourcesProps> = ({ connectors, onSelectConnector, onUpload, onLinkFolder, onConnect }) => {
    const { t } = useTranslation();
    const linkStyle = {
        display: 'inline-flex', alignItems: 'center', gap: 0.5, p: 0, border: 'none', borderRadius: 0,
        background: 'none', maxWidth: '100%', minWidth: 0, minHeight: 0, textTransform: 'none', whiteSpace: 'normal',
        fontWeight: weight(400), fontSize: '0.8125rem', lineHeight: 1.4, textAlign: 'left', overflowWrap: 'anywhere',
        color: (theme: Theme) => inkColor(theme, 0.76), transition: 'color 120ms ease',
        '& .MuiButton-startIcon': { m: 0, flexShrink: 0, '& .MuiSvgIcon-root': { fontSize: iconVar.md } },
        '&:hover': { background: 'none', color: 'primary.main', textDecoration: 'underline', textUnderlineOffset: 2 },
    } as const;
    const labelStyle = { fontWeight: weight(600), ...metaText({ fontSize: '0.8rem' }),
        color: (theme: Theme) => inkColor(theme, 0.72), mr: 0.25, flexShrink: 0 } as const;
    if (!connectors.length && !onUpload && !onLinkFolder && !onConnect) return null;
    return <Box sx={{ mt: 4, display: 'flex', flexDirection: 'column', gap: 1 }}>
        {connectors.length > 0 && <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1.5, rowGap: 0.75 }}>
            <Typography variant="body2" sx={labelStyle}>
                {t('upload.dataSourcesLabel', { defaultValue: 'Connected to:' })}
            </Typography>
            {connectors.map(connector => <Button disableRipple key={connector.id} onClick={() => onSelectConnector(connector)}
                title={connector.connection_identity || connector.display_name} sx={linkStyle}
                startIcon={<Box sx={{ width: 7, height: 7, borderRadius: '50%',
                    bgcolor: connector.connected || connector.sso_auto_connect ? 'success.main' : 'error.main' }} />}>
                {connector.display_name}
            </Button>)}
        </Box>}
        {(onUpload || onLinkFolder || onConnect) && <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1.5, rowGap: 0.75 }}>
            <Typography variant="body2" sx={labelStyle}>
                {t('upload.addSourceLabel', { defaultValue: 'Add data:' })}
            </Typography>
            {onUpload && <Button disableRipple startIcon={<UploadFileIcon />} onClick={onUpload} sx={linkStyle}>
                {t('upload.uploadData', { defaultValue: 'Upload data' })}
            </Button>}
            {onLinkFolder && <Button disableRipple startIcon={<CreateNewFolderIcon />} onClick={onLinkFolder} sx={linkStyle}>
                {t('upload.localFolder', { defaultValue: 'Link local folder' })}
            </Button>}
            {onConnect && <Button disableRipple startIcon={<AddIcon />} onClick={onConnect} sx={linkStyle}>
                {t('upload.addConnection', { defaultValue: 'Connect databases' })}
            </Button>}
        </Box>}
    </Box>;
};
