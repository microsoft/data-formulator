import React, { useEffect, useRef, useState } from 'react';
import { Alert, Box, CircularProgress, alpha } from '@mui/material';
import jsPreviewExcel from '@js-preview/excel';
import '@js-preview/excel/lib/index.css';
import '@fontsource/source-sans-pro/400.css';
import { textVar } from '../app/layout';

export const WorkspaceWorkbookPreview: React.FC<{ file: Blob; fileName: string; errorLabel: string }> = ({ file, fileName, errorLabel }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        let cancelled = false;
        let viewer: ReturnType<typeof jsPreviewExcel.init> | undefined;
        setLoading(true);
        setFailed(false);
        const preview = async () => {
            if (document.fonts) {
                await Promise.allSettled([
                    document.fonts.load('500 12px "Source Sans Pro"'),
                    document.fonts.load('400 12px Roboto'),
                    document.fonts.load('700 12px Roboto'),
                ]);
            }
            if (cancelled) return;
            const options = {
                showContextmenu: false,
                minRowLength: 0,
                minColLength: 0,
                xls: /\.xls$/i.test(fileName),
                transformData: (sheets: Array<{
                    rows?: { len: number; [row: number]: { height?: number; hide?: boolean; cells?: Record<number, unknown> } };
                    cols?: { len: number; [column: number]: { width?: number; hide?: boolean } };
                    styles?: Array<{ font?: { name?: string } }>;
                }>) => {
                    for (const sheet of sheets) {
                        if (sheet.rows) {
                            const rows = sheet.rows;
                            rows.len = Number.isFinite(rows.len) ? rows.len : 0;
                            let usedHeight = 0;
                            for (let row = 0; row < rows.len; row++) {
                                if (!rows[row]?.hide) usedHeight += rows[row]?.height || 24;
                            }
                            const remainingHeight = container.clientHeight - 41 - 25 - 1 - usedHeight;
                            if (remainingHeight > 0) {
                                const fillerCount = Math.max(1, Math.floor(remainingHeight / 24));
                                for (let row = 0; row < fillerCount; row++) {
                                    rows[rows.len + row] = { height: remainingHeight / fillerCount, cells: {} };
                                }
                                rows.len += fillerCount;
                            }
                            rows.len = Math.max(1, rows.len);
                        }
                        if (sheet.cols) {
                            const columns = sheet.cols;
                            columns.len = Number.isFinite(columns.len) ? columns.len : 0;
                            let usedWidth = 0;
                            for (let column = 0; column < columns.len; column++) {
                                if (!columns[column]?.hide) usedWidth += columns[column]?.width || 80;
                            }
                            const remainingWidth = container.clientWidth - 60 - 1 - usedWidth;
                            if (remainingWidth > 0) {
                                const fillerCount = Math.max(1, Math.floor(remainingWidth / 80));
                                for (let column = 0; column < fillerCount; column++) {
                                    columns[columns.len + column] = { width: remainingWidth / fillerCount };
                                }
                                columns.len += fillerCount;
                            }
                            columns.len = Math.max(1, columns.len);
                        }
                        for (const style of sheet.styles ?? []) {
                            if (style.font) {
                                style.font.name = `${JSON.stringify(style.font.name || 'Roboto')}, Roboto, sans-serif`;
                            }
                        }
                    }
                    return sheets;
                },
            };
            viewer = jsPreviewExcel.init(container, options);
            await viewer.preview(file);
        };
        preview().catch(() => {
            if (!cancelled) setFailed(true);
        }).finally(() => {
            if (!cancelled) setLoading(false);
        });
        return () => {
            cancelled = true;
            viewer?.destroy();
        };
    }, [file, fileName]);

    return <Box sx={{ height: '100%', minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        <Box ref={containerRef} aria-label="Workbook preview"
            onMouseDownCapture={event => {
                const target = event.target as HTMLElement;
                if (target.closest('.x-spreadsheet-sheet') && !target.closest('.x-spreadsheet-scrollbar')) {
                    event.stopPropagation();
                    event.preventDefault();
                }
            }}
            onClickCapture={event => {
                if ((event.target as HTMLElement).closest('.x-spreadsheet-sheet')) event.stopPropagation();
            }}
            onKeyDownCapture={event => {
                if ((event.target as HTMLElement).closest('.x-spreadsheet-sheet')) event.stopPropagation();
            }}
            sx={theme => ({
            height: '100%', width: '100%',
            '& .x-spreadsheet, & .x-spreadsheet textarea': {
                fontFamily: theme.typography.fontFamily, fontSize: textVar.sm, letterSpacing: 0,
                color: theme.palette.text.primary,
            },
            '& .x-spreadsheet-bottombar': {
                backgroundColor: theme.palette.background.paper,
                borderTop: `1px solid ${theme.palette.divider}`,
                boxShadow: 'none',
            },
            '& .x-spreadsheet-menu > li:not(:first-of-type)': {
                position: 'relative', boxSizing: 'border-box',
                padding: '0 16px', maxWidth: 240,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                fontSize: textVar.sm, fontWeight: 500, letterSpacing: 0,
                color: theme.palette.text.secondary,
                borderRight: `1px solid ${theme.palette.divider}`,
                backgroundColor: 'transparent',
                '&:hover': { backgroundColor: theme.palette.action.hover, color: theme.palette.text.primary },
                '&.active': {
                    color: theme.palette.primary.main,
                    backgroundColor: alpha(theme.palette.primary.main, 0.04),
                    boxShadow: `inset 0 -2px ${theme.palette.primary.main}`,
                },
            },
            '& .x-spreadsheet-selector, & .x-spreadsheet-resizer': { display: 'none' },
            '& .x-spreadsheet-overlayer': { cursor: 'default' },
            '& .x-spreadsheet-scrollbar': {
                backgroundColor: theme.palette.background.paper, opacity: 1,
                scrollbarColor: `${alpha(theme.palette.text.primary, 0.22)} ${theme.palette.background.paper}`,
                '&::-webkit-scrollbar': { width: 6, height: 6 },
                '&::-webkit-scrollbar-track': { backgroundColor: theme.palette.background.paper },
                '&::-webkit-scrollbar-thumb': { backgroundColor: alpha(theme.palette.text.primary, 0.22), borderRadius: 3 },
                '&::-webkit-scrollbar-thumb:hover': { backgroundColor: alpha(theme.palette.text.primary, 0.38) },
            },
            '& .x-spreadsheet-dropdown-content, & .x-spreadsheet-contextmenu': {
                color: theme.palette.text.primary, backgroundColor: theme.palette.background.paper,
                border: `1px solid ${theme.palette.divider}`, borderRadius: 1,
                boxShadow: theme.shadows[3], padding: '4px 0',
            },
            '& .x-spreadsheet-item': {
                fontSize: textVar.sm, color: theme.palette.text.primary,
                '&:hover': { backgroundColor: theme.palette.action.hover },
                '&.active': { backgroundColor: theme.palette.action.selected },
            },
        })} />
        {loading && <Box role="status" sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', bgcolor: 'background.default' }}>
            <CircularProgress size={28} />
        </Box>}
        {failed && <Alert severity="info" sx={{ position: 'absolute', inset: '0 0 auto' }}>{errorLabel}</Alert>}
    </Box>;
};