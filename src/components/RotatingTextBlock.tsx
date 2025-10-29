import React, { useEffect, useState } from 'react';
import { Box, SxProps } from '@mui/material';

interface RotatingTextBlockProps {
    texts: string[];
    rotationInterval?: number;
    transitionDuration?: number;
    sx?: SxProps;
}

export const RotatingTextBlock: React.FC<RotatingTextBlockProps> = ({
    texts,
    rotationInterval = 3000,
    transitionDuration = 500,
    sx
}) => {
    const [currentTextIndex, setCurrentTextIndex] = useState(0);
    const [isTransitioning, setIsTransitioning] = useState(false);

    // Effect for rotating text with carousel transition
    useEffect(() => {
        const interval = setInterval(() => {
            setIsTransitioning(true);
            setTimeout(() => {
                setCurrentTextIndex((prevIndex) => (prevIndex + 1) % texts.length);
                setIsTransitioning(false);
            }, transitionDuration);
        }, rotationInterval);

        return () => clearInterval(interval);
    }, [texts.length, rotationInterval, transitionDuration]);

    return (
        <Box
            component="span"
            sx={{
                display: 'inline',
                position: 'relative',
                fontWeight: 500,
                opacity: isTransitioning ? 0 : 1,
                transition: `opacity ${transitionDuration}ms ease-in-out`,
                ...sx
            }}
        >
            {texts[currentTextIndex]}
        </Box>
    );
};
