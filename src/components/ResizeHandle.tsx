// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ResizeHandle — a draggable edge that lets users resize a panel.
 *
 * Usage:
 *   <ResizeHandle
 *       direction="horizontal"
 *       onResize={(delta) => setWidth(prev => clamp(prev + delta, MIN, MAX))}
 *   />
 *
 * The handle renders a thin, transparent strip that highlights on hover and
 * changes the cursor.  It attaches pointer-level listeners on drag start so
 * the resize continues even when the pointer leaves the strip.
 */

import React, { useCallback, useRef } from 'react';
import { Box } from '@mui/material';

export interface ResizeHandleProps {
    /** 'horizontal' = left/right resize, 'vertical' = top/bottom resize */
    direction: 'horizontal' | 'vertical';
    /** Called continuously during drag with the pixel delta since last call */
    onResize: (delta: number) => void;
    /** Called once when drag ends */
    onResizeEnd?: () => void;
    /** Total thickness of the hit-target area (default 6) */
    thickness?: number;
}

export const ResizeHandle: React.FC<ResizeHandleProps> = ({
    direction,
    onResize,
    onResizeEnd,
    thickness = 6,
}) => {
    const lastPos = useRef(0);

    const handlePointerDown = useCallback((e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        lastPos.current = direction === 'horizontal' ? e.clientX : e.clientY;
    }, [direction]);

    const handlePointerMove = useCallback((e: React.PointerEvent) => {
        if (!e.buttons) return;
        const current = direction === 'horizontal' ? e.clientX : e.clientY;
        const delta = current - lastPos.current;
        if (delta !== 0) {
            lastPos.current = current;
            onResize(delta);
        }
    }, [direction, onResize]);

    const handlePointerUp = useCallback(() => {
        onResizeEnd?.();
    }, [onResizeEnd]);

    const isHorizontal = direction === 'horizontal';

    return (
        <Box
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            sx={{
                position: 'absolute',
                ...(isHorizontal
                    ? { top: 0, bottom: 0, right: 0, width: thickness, cursor: 'col-resize' }
                    : { left: 0, right: 0, bottom: 0, height: thickness, cursor: 'row-resize' }),
                zIndex: 2,
                '&::after': {
                    content: '""',
                    position: 'absolute',
                    ...(isHorizontal
                        ? { top: 0, bottom: 0, left: '50%', width: 2, transform: 'translateX(-50%)' }
                        : { left: 0, right: 0, top: '50%', height: 2, transform: 'translateY(-50%)' }),
                    borderRadius: 1,
                    bgcolor: 'transparent',
                    transition: 'background-color 0.15s',
                },
                '&:hover::after, &:active::after': {
                    bgcolor: 'primary.main',
                    opacity: 0.5,
                },
            }}
        />
    );
};
