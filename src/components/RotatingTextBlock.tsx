import React, { useEffect, useState } from 'react';
import { Box, SxProps } from '@mui/material';

interface RotatingTextBlockProps {
    texts: string[];
    typingSpeed?: number;
    rotationInterval?: number;
    transitionDuration?: number;
    sx?: SxProps;
}

export const RotatingTextBlock: React.FC<RotatingTextBlockProps> = ({
    texts,
    typingSpeed = 50,
    rotationInterval = 5000,
    transitionDuration = 300,
    sx
}) => {
    const [currentTextIndex, setCurrentTextIndex] = useState(0);
    const [isTransitioning, setIsTransitioning] = useState(false);
    const [displayedText, setDisplayedText] = useState('');
    const [isTyping, setIsTyping] = useState(false);

    // Effect for typing animation
    useEffect(() => {
        if (isTransitioning) {
            setDisplayedText('');
            setIsTyping(false);
            return;
        }

        const currentText = texts[currentTextIndex];
        if (displayedText.length < currentText.length) {
            setIsTyping(true);
            const timer = setTimeout(() => {
                setDisplayedText(currentText.slice(0, displayedText.length + 1));
            }, typingSpeed);

            return () => clearTimeout(timer);
        } else {
            setIsTyping(false);
        }
    }, [displayedText, currentTextIndex, isTransitioning, texts, typingSpeed]);

    // Effect for rotating text
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
                opacity: isTransitioning ? 0 : 1,
                transform: isTransitioning ? 'translateY(-10px)' : 'translateY(0)',
                transition: 'opacity 0.3s ease-in-out, transform 0.3s ease-in-out',
                fontWeight: 500,
                display: 'inline',
                ...sx
            }}
        >
            {displayedText}
            {isTyping && (
                <Box
                    component="span"
                    sx={{
                        display: 'inline-block',
                        width: '2px',
                        height: '1.2em',
                        backgroundColor: 'currentColor',
                        marginLeft: '2px',
                        animation: 'blink 1s infinite',
                        '@keyframes blink': {
                            '0%, 50%': { opacity: 1 },
                            '51%, 100%': { opacity: 0 }
                        }
                    }}
                />
            )}
        </Box>
    );
};
