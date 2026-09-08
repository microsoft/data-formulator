import React, { FC, useEffect, useRef, useState } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import { Document, Page, pdfjs } from 'react-pdf';
import { Virtuoso } from 'react-virtuoso';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

import { textVar } from '../app/layout';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
).toString();

interface WorkspacePdfPreviewProps {
    file: Blob;
    errorLabel: string;
    pageCount: number;
    scale: number;
    onPageCountChange: (pageCount: number) => void;
    onVisiblePageChange: (pageNumber: number) => void;
}

export const WorkspacePdfPreview: FC<WorkspacePdfPreviewProps> = ({
    file,
    errorLabel,
    pageCount,
    scale,
    onPageCountChange,
    onVisiblePageChange,
}) => {
    const viewportRef = useRef<HTMLDivElement>(null);
    const [pageWidth, setPageWidth] = useState(720);

    useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        const updateWidth = () => setPageWidth(Math.max(320, Math.min(viewport.clientWidth - 32, 960)));
        updateWidth();
        const observer = new ResizeObserver(updateWidth);
        observer.observe(viewport);
        return () => observer.disconnect();
    }, []);

    return (
        <Box ref={viewportRef} sx={{
            height: '100%', minHeight: 0, bgcolor: 'action.hover',
            '& .react-pdf__Document': { height: '100%' },
        }}>
            <Document
                file={file}
                onLoadSuccess={({ numPages }) => onPageCountChange(numPages)}
                loading={<Box sx={{ py: 8, display: 'grid', placeItems: 'center' }}><CircularProgress size={28} /></Box>}
                error={<Typography sx={{ py: 8, px: 3, textAlign: 'center', fontSize: textVar.md, color: 'text.secondary' }}>{errorLabel}</Typography>}
            >
                {pageCount > 0 && (
                    <Virtuoso
                        style={{ height: '100%' }}
                        totalCount={pageCount}
                        increaseViewportBy={600}
                        rangeChanged={({ startIndex }) => onVisiblePageChange(startIndex + 1)}
                        itemContent={(index) => (
                            <Box sx={{ width: 'fit-content', mx: 'auto', py: 1, boxSizing: 'border-box' }}>
                                <Box sx={{ boxShadow: 1 }}>
                                    <Page pageNumber={index + 1} width={pageWidth} scale={scale} />
                                </Box>
                            </Box>
                        )}
                    />
                )}
            </Document>
        </Box>
    );
};