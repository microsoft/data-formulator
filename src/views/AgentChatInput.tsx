// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
//
// Shared chat-style input box for agent surfaces. Renders a rounded
// border with focus glow, an inline image-preview row, a file-attach
// affordance, a multiline `InputBase`, and a send/stop button. Used by
// both the in-chat `DataLoadingChat` and the landing-page Data Loading
// Agent quick-start box so they look and behave identically (paste
// image, drag attach, Shift+Enter, etc.).

import * as React from 'react';
import { useRef, useState } from 'react';
import {
    Box,
    IconButton,
    InputBase,
    Tooltip,
    Typography,
    alpha,
    useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded';
import StopIcon from '@mui/icons-material/Stop';
import { useTranslation } from 'react-i18next';
import { borderColor, transition } from '../app/tokens';

export interface AgentChatInputProps {
    value: string;
    onChange: (v: string) => void;
    images: string[];
    onImagesChange: React.Dispatch<React.SetStateAction<string[]>>;
    onSend: () => void;
    onStop?: () => void;
    inProgress?: boolean;
    placeholder?: string;
    autoFocus?: boolean;
    /**
     * What `<input type="file">` accepts. Defaults to images + common
     * tabular text files.
     */
    fileAccept?: string;
    /**
     * Called when the user attaches a non-image file. If omitted,
     * non-image files are silently ignored (image-only mode).
     */
    onNonImageFile?: (file: File) => void;
    /**
     * Optional list of attached non-image files (e.g. uploaded Excel/CSV).
     * Rendered as removable chips above the input — mirrors the
     * image-preview row. The parent owns the array and handles
     * upload/removal side effects (e.g. stripping the matching
     * `[Uploaded: name]` mention from the prompt).
     */
    attachments?: string[];
    onAttachmentsChange?: (names: string[]) => void;
    sendTooltip?: string;
    stopTooltip?: string;
    attachTooltip?: string;
    inputRef?: React.Ref<HTMLTextAreaElement>;
    /** Min visible rows for the text area. Defaults to 1. */
    minRows?: number;
    /** Max visible rows for the text area. Defaults to 8. */
    maxRows?: number;
    /**
     * Optional leading slot rendered to the left of the attach button —
     * used by surfaces (e.g. landing page) that want a branded icon
     * instead of, or in addition to, the attach affordance.
     */
    leadingSlot?: React.ReactNode;
    /**
     * If false, the attach button is hidden (paste of images still works).
     */
    showAttachButton?: boolean;
    /**
     * Layout style.
     *  - 'inline'  (default): leading slot, attach, input, send share a single row.
     *  - 'stacked': input occupies its own row; the leading slot + attach button
     *               sit in a bottom-left toolbar, send button in bottom-right.
     *               Recommended when `minRows > 1`.
     */
    layout?: 'inline' | 'stacked';
    /**
     * Optional content rendered above the input (e.g. a chip bar of
     * available data sources). Only used in `'stacked'` layout.
     */
    topSlot?: React.ReactNode;
    /**
     * When set and the input is empty, pressing Tab fills the input
     * with this string (acts as an accept-suggestion shortcut).
     */
    tabSuggestion?: string;
    /**
     * When provided and the input is focused & empty, surfaces these
     * prompts as a Google-style overlay dropdown below the input.
     * Each item's `onClick` is invoked when the user picks it — the
     * caller is responsible for filling text / attaching images so
     * suggestions can hand off arbitrary state (e.g. a sample image
     * plus a long prompt). Does not push surrounding content.
     */
    focusSuggestions?: Array<{ label: string; onClick: () => void; kind?: string; icon?: React.ReactNode }>;
    /**
     * Optional header label shown above the focus-suggestion list.
     * Defaults to "Try asking".
     */
    focusSuggestionsLabel?: string;
    /**
     * Where to anchor the focus-suggestion overlay relative to the input.
     *  - 'bottom' (default): drops down below the input.
     *  - 'top': pops up above the input. Use when the input is pinned to
     *    the bottom of its container and downward overlays would clip.
     */
    focusSuggestionsPlacement?: 'top' | 'bottom';
    sx?: any;
}

export const AgentChatInput: React.FC<AgentChatInputProps> = ({
    value,
    onChange,
    images,
    onImagesChange,
    onSend,
    onStop,
    inProgress = false,
    placeholder,
    autoFocus = false,
    fileAccept = 'image/*,.csv,.json,.xlsx,.xls,.txt,.tsv',
    onNonImageFile,
    attachments,
    onAttachmentsChange,
    sendTooltip,
    stopTooltip,
    attachTooltip,
    inputRef,
    minRows,
    maxRows = 8,
    leadingSlot,
    showAttachButton = true,
    layout = 'inline',
    topSlot,
    tabSuggestion,
    focusSuggestions,
    focusSuggestionsLabel,
    focusSuggestionsPlacement = 'bottom',
    sx,
}) => {
    const theme = useTheme();
    const { t } = useTranslation();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const localInputRef = useRef<HTMLTextAreaElement>(null);
    const actualInputRef = (inputRef as React.RefObject<HTMLTextAreaElement>) || localInputRef;
    const [focused, setFocused] = useState(false);
    const showFocusSuggestions = focused
        && value.length === 0
        && !!focusSuggestions
        && focusSuggestions.length > 0;

    React.useEffect(() => {
        if (autoFocus) actualInputRef.current?.focus();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const canSend = (value.trim().length > 0 || images.length > 0) && !inProgress;

    const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
        if (e.clipboardData?.files?.length) {
            const imageFiles = Array.from(e.clipboardData.files).filter(f => f.type.startsWith('image/'));
            if (imageFiles.length > 0) {
                e.preventDefault();
                imageFiles.forEach(file => {
                    const reader = new FileReader();
                    reader.onload = () => {
                        if (reader.result) onImagesChange(prev => [...prev, reader.result as string]);
                    };
                    reader.readAsDataURL(file);
                });
            }
        }
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = () => {
                if (reader.result) onImagesChange(prev => [...prev, reader.result as string]);
            };
            reader.readAsDataURL(file);
        } else if (onNonImageFile) {
            onNonImageFile(file);
        }
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (canSend) onSend();
            return;
        }
        if (e.key === 'Tab' && !e.shiftKey && tabSuggestion && value.length === 0) {
            e.preventDefault();
            onChange(tabSuggestion);
        }
    };

    const attachButton = showAttachButton ? (
        <Tooltip title={attachTooltip ?? t('dataLoading.attachTooltip')} placement="top">
            <IconButton size="small" onClick={() => fileInputRef.current?.click()}
                disabled={inProgress}
                sx={{ color: 'text.secondary' }}>
                <AddIcon sx={{ fontSize: 20 }} />
            </IconButton>
        </Tooltip>
    ) : null;

    const sendButton = inProgress && onStop ? (
        <Tooltip title={stopTooltip ?? t('dataLoading.stopTooltip')} placement="top">
            <IconButton size="small" onClick={onStop}
                sx={{
                    width: 28, height: 28,
                    bgcolor: 'transparent',
                    color: 'error.main',
                    '&:hover': {
                        bgcolor: alpha(theme.palette.error.main, 0.08),
                        color: 'error.dark',
                    },
                }}>
                <StopIcon sx={{ fontSize: 14 }} />
            </IconButton>
        </Tooltip>
    ) : (
        <Tooltip title={sendTooltip ?? t('dataLoading.sendTooltip')} placement="top">
            <span>
                <IconButton size="small" onClick={onSend} disabled={!canSend}
                    aria-label={sendTooltip ?? t('dataLoading.sendTooltip')}
                    sx={{
                        width: 28, height: 28,
                        bgcolor: canSend ? 'primary.main' : 'transparent',
                        color: canSend ? 'white' : 'text.disabled',
                        '&:hover': { bgcolor: canSend ? 'primary.dark' : 'transparent' },
                        '&.Mui-disabled': { bgcolor: 'transparent', color: 'text.disabled' },
                    }}>
                    <ArrowUpwardRoundedIcon sx={{ fontSize: 18 }} />
                </IconButton>
            </span>
        </Tooltip>
    );

    const hiddenFileInput = (
        <input type="file" ref={fileInputRef} style={{ display: 'none' }}
            accept={fileAccept}
            onChange={handleFileUpload} />
    );

    const inputField = (
        <InputBase
            inputRef={actualInputRef}
            multiline
            minRows={minRows}
            maxRows={maxRows}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={() => setFocused(true)}
            // Delay blur so a mousedown on a suggestion can fire first.
            // Suggestion items also call preventDefault on mousedown, so
            // in practice the textarea stays focused while we fill it.
            onBlur={() => window.setTimeout(() => setFocused(false), 120)}
            placeholder={placeholder}
            disabled={inProgress}
            sx={{
                flex: 1,
                width: '100%',
                px: 1,
                py: 0.75,
                fontSize: 14,
                lineHeight: 1.5,
                alignItems: 'flex-start',
                '& .MuiInputBase-input': { width: '100%' },
            }}
        />
    );


    return (
        <Box sx={{ position: 'relative', width: '100%' }}>
            <Box
                sx={{
                    border: `1px solid ${borderColor.divider}`,
                    borderRadius: '12px',
                    bgcolor: theme.palette.background.paper,
                    boxShadow: '0 1px 6px rgba(32, 33, 36, 0.10), 0 1px 2px rgba(32, 33, 36, 0.06)',
                    transition: transition.fast,
                    '&:hover': {
                        boxShadow: '0 2px 10px rgba(32, 33, 36, 0.14), 0 1px 3px rgba(32, 33, 36, 0.08)',
                    },
                    '&:focus-within': {
                        borderColor: theme.palette.primary.main,
                        boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.15)}, 0 2px 10px rgba(32, 33, 36, 0.14)`,
                    },
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    ...sx,
                }}
            >
                {/* Top slot (e.g. data-source chip bar) sits flush with the
                    input area below — no divider, same background. */}
                {topSlot && (
                    <Box sx={{ px: 1, pt: 0.75, pb: 0.25 }}>
                        {topSlot}
                    </Box>
                )}

                {/* Image previews */}
                {images.length > 0 && (
                    <Box sx={{ display: 'flex', gap: 0.75, p: 1, pb: 0, flexWrap: 'wrap' }}>
                        {images.map((img, i) => (
                            <Box key={i} sx={{ position: 'relative', flexShrink: 0 }}>
                                <Box component="img" src={img}
                                    sx={{
                                        width: 56, height: 56, objectFit: 'cover',
                                        borderRadius: 1, border: `1px solid ${borderColor.component}`,
                                    }} />
                                <IconButton size="small"
                                    onClick={() => onImagesChange(prev => prev.filter((_, idx) => idx !== i))}
                                    sx={{
                                        position: 'absolute', top: -4, right: -4,
                                        width: 18, height: 18,
                                        bgcolor: 'rgba(0,0,0,0.55)', color: 'white',
                                        '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' },
                                    }}>
                                    <CloseIcon sx={{ fontSize: 12 }} />
                                </IconButton>
                            </Box>
                        ))}
                    </Box>
                )}

                {/* Attached non-image file chips (Excel, CSV, JSON, …) */}
                {attachments && attachments.length > 0 && (
                    <Box sx={{ display: 'flex', gap: 0.5, px: 1, pt: 1, pb: 0, flexWrap: 'wrap' }}>
                        {attachments.map((name, i) => (
                            <Box key={`${name}-${i}`} sx={{
                                display: 'inline-flex', alignItems: 'center', gap: 0.5,
                                pl: 0.75, pr: 0.25, py: 0.25,
                                color: 'text.secondary',
                                bgcolor: alpha(theme.palette.text.primary, 0.04),
                                border: `1px solid ${borderColor.divider}`,
                                borderRadius: 1,
                                maxWidth: 220,
                            }}>
                                <InsertDriveFileOutlinedIcon sx={{ fontSize: 13, color: 'text.disabled', flexShrink: 0 }} />
                                <Typography
                                    variant="caption"
                                    title={name}
                                    sx={{
                                        fontSize: 11, lineHeight: 1.4,
                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    }}
                                >
                                    {name}
                                </Typography>
                                {onAttachmentsChange && (
                                    <IconButton size="small"
                                        onClick={() => onAttachmentsChange(attachments.filter((_, idx) => idx !== i))}
                                        sx={{ width: 16, height: 16, p: 0, color: 'text.disabled',
                                            '&:hover': { color: 'text.primary', bgcolor: alpha(theme.palette.text.primary, 0.06) } }}>
                                        <CloseIcon sx={{ fontSize: 11 }} />
                                    </IconButton>
                                )}
                            </Box>
                        ))}
                    </Box>
                )}

                {hiddenFileInput}

                {layout === 'stacked' ? (
                    <>
                        {/* Input takes its own row so multi-line text aligns naturally. */}
                        <Box sx={{ px: 1, pt: 0.5, width: '100%', display: 'flex' }}>
                            {inputField}
                        </Box>
                        {/* Bottom toolbar: leading slot + attach on the left, send on the right. */}
                        <Box sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            px: 0.75,
                            pb: 0.5,
                            pt: 0.25,
                            gap: 0.5,
                        }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                                {leadingSlot}
                                {attachButton}
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                {sendButton}
                            </Box>
                        </Box>
                    </>
                ) : (
                    /* Inline layout: everything on a single row. */
                    <Box sx={{ display: 'flex', alignItems: 'flex-end', px: 1, py: 0.5 }}>
                        {leadingSlot}
                        {showAttachButton && (
                            <Box sx={{ mb: 0.25 }}>{attachButton}</Box>
                        )}
                        {inputField}
                        <Box sx={{ mb: 0.25 }}>{sendButton}</Box>
                    </Box>
                )}
            </Box>

            {/* Google-style suggestion overlay. Anchored to the outer
                relative wrapper so it overlays content below instead of
                pushing layout. */}
            {showFocusSuggestions && (
                <Box
                    sx={{
                        position: 'absolute',
                        ...(focusSuggestionsPlacement === 'top'
                            ? { bottom: 'calc(100% + 4px)' }
                            : { top: 'calc(100% + 4px)' }),
                        left: 0,
                        right: 0,
                        zIndex: 20,
                        borderRadius: '12px',
                        border: `1px solid ${borderColor.divider}`,
                        bgcolor: theme.palette.background.paper,
                        boxShadow: '0 4px 16px rgba(32, 33, 36, 0.16), 0 2px 6px rgba(32, 33, 36, 0.08)',
                        py: 0.5,
                        overflow: 'hidden',
                    }}
                >
                    <Typography
                        variant="caption"
                        sx={{
                            display: 'block',
                            px: 1.5,
                            py: 0.5,
                            color: 'text.secondary',
                            fontSize: '0.7rem',
                            letterSpacing: '0.02em',
                        }}
                    >
                        {focusSuggestionsLabel ?? 'Try asking'}
                    </Typography>
                    {focusSuggestions!.map((s, i) => (
                        <Box
                            key={i}
                            onMouseDown={(e) => {
                                // Prevent the textarea from blurring so the
                                // overlay doesn't disappear mid-click.
                                e.preventDefault();
                                s.onClick();
                                actualInputRef.current?.focus();
                            }}
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1,
                                px: 1.5,
                                py: 0.5,
                                cursor: 'pointer',
                                color: 'text.primary',
                                '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
                            }}
                        >
                            {s.icon ? (
                                <Box
                                    aria-hidden
                                    sx={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        width: 16, flexShrink: 0,
                                        color: 'text.secondary',
                                    }}
                                >
                                    {s.icon}
                                </Box>
                            ) : null}
                            <Typography
                                variant="body2"
                                sx={{
                                    flex: 1, minWidth: 0,
                                    fontSize: 14,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    color: 'inherit',
                                    ...(s.icon ? {} : {
                                        '&::before': {
                                            content: '"–"',
                                            display: 'inline-block',
                                            width: '1em',
                                            color: 'text.disabled',
                                        },
                                    }),
                                }}
                            >
                                {s.label}
                            </Typography>
                        </Box>
                    ))}
                </Box>
            )}
        </Box>
    );
};
