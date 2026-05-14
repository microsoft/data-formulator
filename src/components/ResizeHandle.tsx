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
    /** Which edge of the parent the handle attaches to.
     *  horizontal: 'end' = right edge (default), 'start' = left edge.
     *  vertical:   'end' = bottom edge (default), 'start' = top edge. */
    edge?: 'start' | 'end';
    /** Called continuously during drag with the pixel delta since last call.
     *  Sign convention: positive = pointer moved right/down (raw screen delta).
     *  For a 'start'-anchored panel, the caller typically subtracts delta from width. */
    onResize: (delta: number) => void;
    /** Called once when drag ends */
    onResizeEnd?: () => void;
    /** Total thickness of the hit-target area (default 6) */
    thickness?: number;
    /** Minimum pixels of movement before resize begins (default 4, prevents accidental drags) */
    deadZone?: number;
}

export const ResizeHandle: React.FC<ResizeHandleProps> = ({
    direction,
    edge = 'end',
    onResize,
    onResizeEnd,
    thickness = 6,
    deadZone = 4,
}) => {
    const lastPos = useRef(0);
    const startPos = useRef(0);
    const activated = useRef(false);

    const handlePointerDown = useCallback((e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        const pos = direction === 'horizontal' ? e.clientX : e.clientY;
        startPos.current = pos;
        lastPos.current = pos;
        activated.current = false;
    }, [direction]);

    const handlePointerMove = useCallback((e: React.PointerEvent) => {
        if (!e.buttons) return;
        const current = direction === 'horizontal' ? e.clientX : e.clientY;

        if (!activated.current) {
            if (Math.abs(current - startPos.current) < deadZone) return;
            activated.current = true;
            lastPos.current = current;
        }

        const delta = current - lastPos.current;
        if (delta !== 0) {
            lastPos.current = current;
            onResize(delta);
        }
    }, [direction, onResize, deadZone]);

    const handlePointerUp = useCallback(() => {
        if (activated.current) onResizeEnd?.();
        activated.current = false;
    }, [onResizeEnd]);

    const isHorizontal = direction === 'horizontal';
    const isStart = edge === 'start';

    // Position the hit-target on the requested edge of the parent.
    const hitPosition = isHorizontal
        ? { top: 0, bottom: 0, ...(isStart ? { left: 0 } : { right: 0 }), width: thickness, cursor: 'col-resize' }
        : { left: 0, right: 0, ...(isStart ? { top: 0 } : { bottom: 0 }), height: thickness, cursor: 'row-resize' };

    // Visible 2px indicator hugs the same edge as the hit-target so it
    // visually aligns with the panel border instead of floating in the middle.
    const indicatorPosition = isHorizontal
        ? { top: 0, bottom: 0, ...(isStart ? { left: 0 } : { right: 0 }), width: 2 }
        : { left: 0, right: 0, ...(isStart ? { top: 0 } : { bottom: 0 }), height: 2 };

    return (
        <Box
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            sx={{
                position: 'absolute',
                ...hitPosition,
                zIndex: 2,
                '&::after': {
                    content: '""',
                    position: 'absolute',
                    ...indicatorPosition,
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
