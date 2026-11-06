// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Drag-and-drop file intake for chat composers. `useFileDrop` gives the box its
 * drag handlers and an `active` flag for `FileDropOverlay`. While any composer is
 * mounted, a file dropped elsewhere on the page is ignored rather than opened by
 * the browser, which would navigate away from the app.
 */

import React, { useEffect, useState } from 'react';
import { Box, Typography, alpha, useTheme } from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { useTranslation } from 'react-i18next';
import { radius, transition } from '../app/tokens';

const hasFiles = (event: { dataTransfer: DataTransfer | null }) => Array.from(event.dataTransfer?.types ?? []).includes('Files');

// Runs after the page's own drop zones (React handles events below the window), so it only catches unhandled drops.
const ignoreStrayFileDrop = (event: DragEvent) => {
    if (!hasFiles(event) || event.defaultPrevented) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
};

let guardedComposers = 0;

function useStrayFileDropGuard() {
    useEffect(() => {
        if (guardedComposers++ === 0) {
            window.addEventListener('dragover', ignoreStrayFileDrop);
            window.addEventListener('drop', ignoreStrayFileDrop);
        }
        return () => {
            if (--guardedComposers === 0) {
                window.removeEventListener('dragover', ignoreStrayFileDrop);
                window.removeEventListener('drop', ignoreStrayFileDrop);
            }
        };
    }, []);
}

/** Drag handlers for a box that takes dropped files; `enabled: false` refuses drops (no-drop cursor). */
export function useFileDrop({ enabled, onFiles }: { enabled: boolean; onFiles: (files: File[]) => void }) {
    useStrayFileDropGuard();
    const [dragging, setDragging] = useState(false);
    const active = dragging && enabled;

    const handlers = {
        onDragEnter: (event: React.DragEvent) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            setDragging(true);
        },
        onDragOver: (event: React.DragEvent) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = enabled ? 'copy' : 'none';
        },
        onDragLeave: (event: React.DragEvent) => {
            // Leaving into a child element is still inside the box.
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
            setDragging(false);
        },
        onDrop: (event: React.DragEvent) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            setDragging(false);
            const files = Array.from(event.dataTransfer.files ?? []);
            if (enabled && files.length > 0) onFiles(files);
        },
    };
    return { active, handlers };
}

/**
 * Shown over a composer while files are dragged onto it: the drop-zone look (2px dashed primary,
 * tinted fill) inset from the box edge. It ignores pointer events so the drop lands on the box.
 */
export const FileDropOverlay: React.FC<{ active: boolean; zIndex?: number }> = ({ active, zIndex = 2 }) => {
    const theme = useTheme();
    const { t } = useTranslation();
    if (!active) return null;
    return <Box sx={{
        position: 'absolute', inset: 4, zIndex,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1,
        pointerEvents: 'none',
        border: `2px dashed ${theme.palette.primary.main}`,
        borderRadius: radius.md,
        // Opaque paper under a primary wash, so the text underneath is masked but the tint still reads.
        bgcolor: theme.palette.background.paper,
        backgroundImage: `linear-gradient(${alpha(theme.palette.primary.main, 0.08)}, ${alpha(theme.palette.primary.main, 0.08)})`,
        transition: transition.normal,
    }}>
        <UploadFileIcon sx={{ fontSize: 22, color: 'primary.main' }} />
        <Typography variant="body2" sx={{ fontWeight: 500, color: 'primary.main' }}>
            {t('dataLoading.dropToAttach', { defaultValue: 'Drop file to attach' })}
        </Typography>
    </Box>;
};
