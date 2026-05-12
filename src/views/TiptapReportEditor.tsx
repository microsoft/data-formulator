// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useEffect, useCallback, useRef, useState as useStateReact } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditor, EditorContent, NodeViewWrapper, NodeViewProps, ReactNodeViewRenderer } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { Markdown } from 'tiptap-markdown';
import { Box, Button, IconButton, Menu, MenuItem, Tooltip, Divider, useTheme, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { WritingPencil, ShimmerText, WritingIndicator } from '../components/FunComponents';
import FormatBoldIcon from '@mui/icons-material/FormatBold';
import FormatItalicIcon from '@mui/icons-material/FormatItalic';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered';
import FormatQuoteIcon from '@mui/icons-material/FormatQuote';
import TitleIcon from '@mui/icons-material/Title';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ImageIcon from '@mui/icons-material/Image';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import DownloadIcon from '@mui/icons-material/Download';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

export interface TiptapReportEditorProps {
    content: string;           // HTML content (from processReport)
    editable?: boolean;
    reportId?: string;         // triggers re-focus when switching reports
    onUpdate?: (html: string) => void;
    onCopyContent?: () => void | Promise<void>;
    onCopyImage?: () => void | Promise<void>;
    onDownloadPng?: () => void | Promise<void>;
    onExportPdf?: () => void | Promise<void>;
    copyContentSuccess?: boolean;
    copyImageSuccess?: boolean;
}

/** Resizable image node view — drag bottom-right corner to resize */
const ResizableImageView: FC<NodeViewProps> = ({ node, updateAttributes, selected }) => {
    const { src, alt, width, height } = node.attrs;
    const containerRef = useRef<HTMLDivElement>(null);
    const [isResizing, setIsResizing] = useStateReact(false);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startWidth = containerRef.current?.offsetWidth || width || 300;
        const aspectRatio = (height && width) ? height / width : undefined;

        const onMouseMove = (moveEvent: MouseEvent) => {
            const newWidth = Math.max(100, startWidth + (moveEvent.clientX - startX));
            const attrs: Record<string, any> = { width: Math.round(newWidth) };
            if (aspectRatio) {
                attrs.height = Math.round(newWidth * aspectRatio);
            }
            updateAttributes(attrs);
        };

        const onMouseUp = () => {
            setIsResizing(false);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        setIsResizing(true);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }, [width, height, updateAttributes]);

    return (
        <NodeViewWrapper style={{ display: 'block', margin: '0.5em 0' }}>
            <Box
                ref={containerRef}
                sx={{
                    display: 'inline-block',
                    position: 'relative',
                    maxWidth: '100%',
                    border: selected ? '2px solid' : '2px solid transparent',
                    borderColor: selected ? 'primary.main' : 'transparent',
                    borderRadius: '4px',
                    '&:hover .resize-handle': { opacity: 1 },
                }}
            >
                <img
                    src={src}
                    alt={alt || ''}
                    width={width || undefined}
                    height={height || undefined}
                    style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
                    draggable={false}
                />
                <Box
                    className="resize-handle"
                    onMouseDown={handleMouseDown}
                    sx={{
                        position: 'absolute',
                        bottom: 0,
                        right: 0,
                        width: 14,
                        height: 14,
                        cursor: 'nwse-resize',
                        opacity: 0,
                        transition: 'opacity 0.15s',
                        '&::after': {
                            content: '""',
                            position: 'absolute',
                            bottom: 2,
                            right: 2,
                            width: 8,
                            height: 8,
                            borderRight: '2px solid rgba(0,0,0,0.4)',
                            borderBottom: '2px solid rgba(0,0,0,0.4)',
                        },
                    }}
                />
            </Box>
        </NodeViewWrapper>
    );
};

/** Custom Image extension with resizable node view */
const ResizableImage = Image.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            width: { default: null, parseHTML: el => el.getAttribute('width') },
            height: { default: null, parseHTML: el => el.getAttribute('height') },
            'data-chart-id': { 
                default: null, 
                parseHTML: el => el.getAttribute('data-chart-id'),
                renderHTML: (attributes) => {
                    if (!attributes['data-chart-id']) return {};
                    return { 'data-chart-id': attributes['data-chart-id'] };
                },
            },
        };
    },
    addNodeView() {
        return ReactNodeViewRenderer(ResizableImageView);
    },
});

const ToolbarButton: FC<{
    onClick: () => void;
    isActive?: boolean;
    title: string;
    children: React.ReactNode;
}> = ({ onClick, isActive, title, children }) => {
    const theme = useTheme();
    return (
        <Tooltip title={title} placement="top">
            <IconButton
                size="small"
                onClick={onClick}
                sx={{
                    p: '3px',
                    borderRadius: '4px',
                    color: isActive ? theme.palette.primary.main : 'text.secondary',
                    backgroundColor: isActive ? alpha(theme.palette.primary.main, 0.08) : 'transparent',
                    '&:hover': {
                        backgroundColor: alpha(theme.palette.primary.main, 0.12),
                    },
                }}
            >
                {children}
            </IconButton>
        </Tooltip>
    );
};

export const TiptapReportEditor: FC<TiptapReportEditorProps> = ({
    content,
    editable = true,
    reportId,
    onUpdate,
    onCopyContent,
    onCopyImage,
    onDownloadPng,
    onExportPdf,
    copyContentSuccess = false,
    copyImageSuccess = false,
}) => {
    const theme = useTheme();
    const { t } = useTranslation();
    const isFocused = useRef(false);
    const [imageMenuAnchor, setImageMenuAnchor] = useStateReact<null | HTMLElement>(null);

    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                heading: { levels: [1, 2, 3] },
            }),
            ResizableImage.configure({
                inline: false,
            }),
            Markdown.configure({
                html: true,
                transformPastedText: true,
            }),
        ],
        content,
        editable,
        onUpdate: ({ editor }) => {
            if (isFocused.current) {
                onUpdate?.(editor.getHTML());
            }
        },
        onFocus: () => {
            isFocused.current = true;
        },
        onBlur: () => {
            isFocused.current = false;
        },
    });

    // Sync editable prop
    useEffect(() => {
        if (editor) {
            editor.setEditable(editable);
        }
    }, [editor, editable]);

    // Auto-focus the editor when it becomes editable or when the viewed report changes
    useEffect(() => {
        if (editor && editable) {
            // Small delay to let the DOM settle after content streaming finishes
            const timer = setTimeout(() => {
                editor.commands.focus('start');
            }, 100);
            return () => clearTimeout(timer);
        }
    }, [editor, editable, reportId]);

    // Sync content when it changes externally (streaming or loading a different report)
    // Always sync if the content contains new images (img tags) that aren't in the editor yet
    useEffect(() => {
        if (!editor) return;
        if (!isFocused.current) {
            editor.commands.setContent(content, { emitUpdate: false });
        } else {
            // Even when focused, sync if new images arrived (user isn't typing image tags)
            const currentHtml = editor.getHTML();
            const newImgCount = (content.match(/<img /g) || []).length;
            const currentImgCount = (currentHtml.match(/<img /g) || []).length;
            if (newImgCount > currentImgCount) {
                editor.commands.setContent(content, { emitUpdate: false });
            }
        }
    }, [editor, content]);

    const copyAsRichText = useCallback(async () => {
        if (!editor) return;
        const html = editor.getHTML();
        try {
            await navigator.clipboard.write([
                new ClipboardItem({
                    'text/html': new Blob([html], { type: 'text/html' }),
                    'text/plain': new Blob([editor.getText()], { type: 'text/plain' }),
                }),
            ]);
        } catch (e) {
            console.warn('Failed to copy as rich text:', e);
        }
    }, [editor]);

    if (!editor) return null;

    const iconSx = { fontSize: 16 };
    const exportIconSx = { fontSize: 15 };
    const exportButtonSx = {
        minWidth: 0,
        height: 26,
        px: 0.75,
        py: 0,
        borderRadius: '4px',
        textTransform: 'none',
        fontSize: 12,
        fontWeight: 400,
        lineHeight: 1,
        color: 'text.secondary',
        borderColor: 'transparent',
        backgroundColor: 'transparent',
        '& .MuiButton-startIcon': {
            mr: 0.5,
            ml: 0,
            color: 'inherit',
        },
        '&:hover': {
            color: 'primary.main',
            borderColor: alpha(theme.palette.primary.main, 0.08),
            backgroundColor: alpha(theme.palette.primary.main, 0.08),
        },
    };
    const exportMenuItemSx = {
        minHeight: 30,
        px: 1.25,
        py: 0.5,
        fontSize: 12,
        color: 'text.secondary',
        '& .MuiSvgIcon-root': {
            fontSize: 15,
            mr: 0.75,
            color: 'text.disabled',
        },
    };
    const hasExportActions = !!(onCopyContent || onCopyImage || onDownloadPng || onExportPdf);
    const imageMenuOpen = Boolean(imageMenuAnchor);

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
            {/* Toolbar — always visible, disabled during generation */}
            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                gap: '2px',
                px: 1,
                py: 2,
                borderBottom: `1px solid ${alpha(theme.palette.divider, 0.3)}`,
                flexShrink: 0,
                position: 'sticky',
                top: 0,
                zIndex: 5,
                backgroundColor: 'background.paper',
                opacity: editable ? 1 : 0.5,
            }}
                data-report-toolbar
            >
                <Box sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '2px',
                    pointerEvents: editable ? 'auto' : 'none',
                }}>
                    <ToolbarButton
                        onClick={() => editor.chain().focus().toggleBold().run()}
                        isActive={editor.isActive('bold')}
                        title={t('editor.bold')}
                    >
                        <FormatBoldIcon sx={iconSx} />
                    </ToolbarButton>
                    <ToolbarButton
                        onClick={() => editor.chain().focus().toggleItalic().run()}
                        isActive={editor.isActive('italic')}
                        title={t('editor.italic')}
                    >
                        <FormatItalicIcon sx={iconSx} />
                    </ToolbarButton>
                    <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
                    <ToolbarButton
                        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                        isActive={editor.isActive('heading', { level: 1 })}
                        title={t('editor.heading1')}
                    >
                        <TitleIcon sx={iconSx} />
                    </ToolbarButton>
                    <ToolbarButton
                        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                        isActive={editor.isActive('heading', { level: 2 })}
                        title={t('editor.heading2')}
                    >
                        <TitleIcon sx={{ ...iconSx, fontSize: 14 }} />
                    </ToolbarButton>
                    <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
                    <ToolbarButton
                        onClick={() => editor.chain().focus().toggleBulletList().run()}
                        isActive={editor.isActive('bulletList')}
                        title={t('editor.bulletList')}
                    >
                        <FormatListBulletedIcon sx={iconSx} />
                    </ToolbarButton>
                    <ToolbarButton
                        onClick={() => editor.chain().focus().toggleOrderedList().run()}
                        isActive={editor.isActive('orderedList')}
                        title={t('editor.numberedList')}
                    >
                        <FormatListNumberedIcon sx={iconSx} />
                    </ToolbarButton>
                    <ToolbarButton
                        onClick={() => editor.chain().focus().toggleBlockquote().run()}
                        isActive={editor.isActive('blockquote')}
                        title={t('editor.quote')}
                    >
                        <FormatQuoteIcon sx={iconSx} />
                    </ToolbarButton>
                </Box>
                {hasExportActions && editable && (
                    <Box sx={{
                        ml: 'auto',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.75,
                        pointerEvents: editable ? 'auto' : 'none',
                    }}>
                        {onCopyContent && (
                            <Button
                                size="small"
                                variant="text"
                                startIcon={copyContentSuccess ? <CheckCircleIcon sx={exportIconSx} /> : <ContentCopyIcon sx={exportIconSx} />}
                                onClick={onCopyContent}
                                color={copyContentSuccess ? 'success' : 'primary'}
                                sx={{
                                    ...exportButtonSx,
                                    ...(copyContentSuccess ? {
                                        color: 'success.main',
                                        backgroundColor: alpha(theme.palette.success.main, 0.08),
                                    } : {}),
                                }}
                            >
                                {copyContentSuccess ? t('report.copied') : t('report.copyContent')}
                            </Button>
                        )}
                        {(onCopyImage || onDownloadPng) && (
                            <>
                                <Button
                                    size="small"
                                    variant="text"
                                    startIcon={copyImageSuccess ? <CheckCircleIcon sx={exportIconSx} /> : <ImageIcon sx={exportIconSx} />}
                                    onClick={(event) => setImageMenuAnchor(event.currentTarget)}
                                    color={copyImageSuccess ? 'success' : 'primary'}
                                    sx={{
                                        ...exportButtonSx,
                                        ...(copyImageSuccess ? {
                                            color: 'success.main',
                                            backgroundColor: alpha(theme.palette.success.main, 0.08),
                                        } : {}),
                                    }}
                                >
                                    {copyImageSuccess ? t('report.copied') : t('report.imageActions')}
                                </Button>
                                <Menu
                                    anchorEl={imageMenuAnchor}
                                    open={imageMenuOpen}
                                    onClose={() => setImageMenuAnchor(null)}
                                    anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                                    transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                                    slotProps={{
                                        paper: {
                                            sx: {
                                                mt: 0.5,
                                                borderRadius: '6px',
                                                boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
                                                border: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
                                            }
                                        }
                                    }}
                                >
                                    {onCopyImage && (
                                        <MenuItem
                                            onClick={() => {
                                                setImageMenuAnchor(null);
                                                void onCopyImage();
                                            }}
                                            sx={exportMenuItemSx}
                                        >
                                            <ContentCopyIcon />
                                            {t('report.copyImage')}
                                        </MenuItem>
                                    )}
                                    {onDownloadPng && (
                                        <MenuItem
                                            onClick={() => {
                                                setImageMenuAnchor(null);
                                                void onDownloadPng();
                                            }}
                                            sx={exportMenuItemSx}
                                        >
                                            <DownloadIcon />
                                            {t('report.downloadPng')}
                                        </MenuItem>
                                    )}
                                </Menu>
                            </>
                        )}
                        {onExportPdf && (
                            <Button
                                size="small"
                                variant="text"
                                startIcon={<PictureAsPdfIcon sx={exportIconSx} />}
                                onClick={onExportPdf}
                                sx={exportButtonSx}
                            >
                                {t('report.exportPdf')}
                            </Button>
                        )}
                    </Box>
                )}
                    {!editable && (
                        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.75, pointerEvents: 'none' }}>
                            <Box sx={{
                                width: 6, height: 6, borderRadius: '50%',
                                backgroundColor: 'primary.main',
                                animation: 'pulse-dot 1.2s ease-in-out infinite',
                                '@keyframes pulse-dot': {
                                    '0%, 100%': { opacity: 0.3 },
                                    '50%': { opacity: 1 },
                                },
                            }} />
                            <ShimmerText>{t('editor.generating')}</ShimmerText>
                        </Box>
                    )}
            </Box>
            {/* Editor */}
            <Box sx={{
                flex: 1,
                overflowY: 'auto',
                position: 'relative',
                '& .tiptap': {
                    outline: 'none',
                    padding: '16px 24px',
                    minHeight: '100%',
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
                    fontSize: '0.95rem',
                    lineHeight: 1.7,
                    color: 'rgb(55, 53, 47)',
                    '& h1': {
                        fontSize: '1.75rem',
                        fontWeight: 700,
                        lineHeight: 1.25,
                        letterSpacing: '-0.02em',
                        marginTop: '1.5em',
                        marginBottom: '0.5em',
                    },
                    '& h2': {
                        fontSize: '1.4rem',
                        fontWeight: 600,
                        lineHeight: 1.3,
                        marginTop: '1.25em',
                        marginBottom: '0.4em',
                    },
                    '& h3': {
                        fontSize: '1.15rem',
                        fontWeight: 600,
                        lineHeight: 1.4,
                        marginTop: '1em',
                        marginBottom: '0.3em',
                    },
                    '& p': {
                        marginBottom: '0.75em',
                    },
                    '& img': {
                        maxWidth: '100%',
                        height: 'auto',
                        borderRadius: '4px',
                        margin: '0.5em 0',
                    },
                    '& blockquote': {
                        borderLeft: '3px solid',
                        borderColor: alpha(theme.palette.text.disabled, 0.3),
                        paddingLeft: '1em',
                        margin: '0.75em 0',
                        fontStyle: 'italic',
                        color: 'rgb(73, 73, 73)',
                    },
                    '& ul, & ol': {
                        paddingLeft: '1.5em',
                        marginBottom: '0.75em',
                    },
                    '& li': {
                        marginBottom: '0.25em',
                    },
                    '& strong': {
                        fontWeight: 600,
                    },
                    '& code': {
                        backgroundColor: 'rgba(247, 246, 243, 1)',
                        padding: '0.15em 0.4em',
                        borderRadius: '3px',
                        fontSize: '0.85em',
                        fontFamily: '"SFMono-Regular", Menlo, Monaco, Consolas, monospace',
                    },
                    '& pre': {
                        backgroundColor: 'rgba(247, 246, 243, 1)',
                        padding: '0.75em 1em',
                        borderRadius: '4px',
                        overflow: 'auto',
                        '& code': {
                            backgroundColor: 'transparent',
                            padding: 0,
                        },
                    },
                    '& hr': {
                        border: 'none',
                        borderTop: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
                        margin: '1.5em 0',
                    },
                },
            }}>
                <EditorContent editor={editor} />
                {/* Shimmer overlay while generating */}
                {!editable && (
                    <Box sx={{
                        position: 'absolute',
                        bottom: 0,
                        left: 0,
                        right: 0,
                        height: '40%',
                        pointerEvents: 'none',
                        background: `linear-gradient(to bottom, transparent 0%, ${alpha(theme.palette.background.paper, 0.6)} 40%, ${theme.palette.background.paper} 100%)`,
                        display: 'flex',
                        alignItems: 'flex-end',
                        justifyContent: 'center',
                        pb: 6,
                    }}>
                        <WritingIndicator label={t('editor.writingReport')} fontSize="0.85rem" />
                    </Box>
                )}
            </Box>
        </Box>
    );
};
