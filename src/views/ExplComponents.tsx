// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Box,
    Card,
    CardContent,
    Typography,
    IconButton,
    Tooltip,
    Chip,
} from '@mui/material';
import { styled } from '@mui/material/styles';
import { alpha } from '@mui/material/styles';
import { borderColor, shadow, transition, radius } from '../app/tokens';
import 'katex/dist/katex.min.css';
import { InlineMath, BlockMath } from 'react-katex';

import LightbulbIcon from '@mui/icons-material/Lightbulb';
import InfoIcon from '@mui/icons-material/Info';

// Helper function to render text with LaTeX math expressions
const renderWithMath = (text: string) => {

    const parts: Array<{ type: 'text' | 'inline' | 'block' | 'code', content: string }> = [];
    let currentIndex = 0;
    let currentText = '';
    
    while (currentIndex < text.length) {
        // Check for block math \[ ... \]
        if (text.slice(currentIndex, currentIndex + 2) === '\\[') {
            // Save any accumulated text
            if (currentText) {
                parts.push({ type: 'text', content: currentText });
                currentText = '';
            }
            
            // Find the closing \]
            let blockEnd = currentIndex + 2;
            let braceCount = 0;
            while (blockEnd < text.length) {
                if (text.slice(blockEnd, blockEnd + 2) === '\\]') {
                    break;
                }
                if (text[blockEnd] === '{') braceCount++;
                if (text[blockEnd] === '}') braceCount--;
                blockEnd++;
            }
            
            if (blockEnd < text.length) {
                // Found complete block math
                const mathContent = text.slice(currentIndex + 2, blockEnd);
                parts.push({ type: 'block', content: mathContent });
                currentIndex = blockEnd + 2;
            } else {
                // No closing bracket found, treat as text
                currentText += text[currentIndex];
                currentIndex++;
            }
        }
        // Check for inline math \( ... \)
        else if (text.slice(currentIndex, currentIndex + 2) === '\\(') {
            // Save any accumulated text
            if (currentText) {
                parts.push({ type: 'text', content: currentText });
                currentText = '';
            }
            
            // Find the closing \)
            let inlineEnd = currentIndex + 2;
            let braceCount = 0;
            while (inlineEnd < text.length) {
                if (text.slice(inlineEnd, inlineEnd + 2) === '\\)') {
                    break;
                }
                if (text[inlineEnd] === '{') braceCount++;
                if (text[inlineEnd] === '}') braceCount--;
                inlineEnd++;
            }
            
            if (inlineEnd < text.length) {
                // Found complete inline math
                const mathContent = text.slice(currentIndex + 2, inlineEnd);
                parts.push({ type: 'inline', content: mathContent });
                currentIndex = inlineEnd + 2;
            } else {
                // No closing bracket found, treat as text
                currentText += text[currentIndex];
                currentIndex++;
            }
        }
        // Check for inline code `...`
        else if (text[currentIndex] === '`') {
            // Find the closing backtick
            let codeEnd = currentIndex + 1;
            while (codeEnd < text.length && text[codeEnd] !== '`') {
                codeEnd++;
            }

            if (codeEnd < text.length) {
                // Found complete inline code span
                if (currentText) {
                    parts.push({ type: 'text', content: currentText });
                    currentText = '';
                }
                const codeContent = text.slice(currentIndex + 1, codeEnd);
                parts.push({ type: 'code', content: codeContent });
                currentIndex = codeEnd + 1;
            } else {
                // No closing backtick found, treat as text
                currentText += text[currentIndex];
                currentIndex++;
            }
        }
        // Regular character
        else {
            currentText += text[currentIndex];
            currentIndex++;
        }
    }
    
    // Add any remaining text
    if (currentText) {
        parts.push({ type: 'text', content: currentText });
    }
    
    return parts.map((part, index) => {
        if (part.type === 'inline') {
            try {
                return <InlineMath key={index} math={part.content} />;
            } catch (error) {
                return <span key={index}>{`\\(${part.content}\\)`}</span>;
            }
        } else if (part.type === 'block') {
            try {
                return <BlockMath key={index} math={part.content} />;
            } catch (error) {
                return <span key={index}>{`\\[${part.content}\\]`}</span>;
            }
        } else if (part.type === 'code') {
            return (
                <Box
                    component="code"
                    key={index}
                    sx={{
                        fontFamily: 'monospace',
                        fontSize: '0.92em',
                        px: 0.5,
                        py: 0.1,
                        borderRadius: '4px',
                        backgroundColor: (theme) => alpha(theme.palette.text.primary, 0.06),
                        color: 'text.primary',
                        // Allow long code spans (e.g. summed field lists) to wrap
                        // instead of overflowing the card horizontally.
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'anywhere',
                        wordBreak: 'break-word',
                    }}
                >
                    {part.content}
                </Box>
            );
        } else {
            return <span key={index}>{part.content}</span>;
        }
    });
};

// Styled components for the concept explanation entries.
// Rendered as lightweight metadata rows (label + formula) rather than boxed
// cards, so they read as inline annotations on the derived table.
const ConceptExplanationCard = styled(Box, {
    shouldForwardProp: (prop) => prop !== 'secondary',
})<{ secondary: boolean }>(() => ({
    minWidth: 0,
    padding: '2px 0',
}));

const ConceptName = styled(Typography, {
    shouldForwardProp: (prop) => prop !== 'secondary',
})<{ secondary: boolean }>(({ theme, secondary }) => ({
    fontSize: '11px',
    fontWeight: 600,
    color: secondary ? theme.palette.secondary.main : theme.palette.text.secondary,
    marginBottom: '1px',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    fontFamily: 'monospace',
    letterSpacing: '0.01em',
}));

const ConceptExplanation = styled(Typography)(({ theme }) => ({
    fontSize: '11px',
    lineHeight: 1.5,
    minWidth: 0,
    color: theme.palette.text.primary,
    '& .katex': {
        fontSize: '11px',
        lineHeight: 1.2,
    },
    // KaTeX block-math defaults to `overflow-x: auto` with vertical padding
    // that reserves room for a scrollbar even when the formula fits.  Drop
    // the bottom padding and only show the scrollbar if it's actually needed
    // (and hide its track to keep the card clean).
    '& .katex-display': {
        margin: '10px 0',
        paddingBottom: 0,
        overflowX: 'auto',
        overflowY: 'hidden',
        scrollbarWidth: 'none',
        '&::-webkit-scrollbar': { display: 'none' },
    },
    // Block-displayed formulas (fractions, sums, roots) need more height and
    // a slightly larger glyph size than inline math so stacked structure is
    // legible — inline `\(...\)` stays compact at 11px above.
    '& .katex-display > .katex': {
        fontSize: '15px',
        lineHeight: 1.5,
    },
}));

export interface ConceptExplanationItem {
    field: string;
    explanation: string;
}

export interface ConceptExplCardsProps {
    concepts: ConceptExplanationItem[];
    title?: string;
    maxCards?: number;
}

export const ConceptExplCards: FC<ConceptExplCardsProps> = ({ 
    concepts, 
    maxCards = 8 
}) => {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(false);

    if (!concepts || concepts.length === 0) {
        return null;
    }

    const displayConcepts = expanded ? concepts : concepts.slice(0, maxCards);
    const hasMoreConcepts = concepts.length > maxCards;


    return (
        <Box sx={{ position: 'relative', display: 'flex', flexDirection: 'column', width: '100%' }}>
            {/* Formulas as a metadata list — one per row, separated by hairline
                dividers so they read as annotations rather than boxed cards. */}
            <Box sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    width: '100%',
                    minWidth: 0,
                    '& > *:not(:last-child)': {
                        borderBottom: `1px solid ${alpha('#000', 0.06)}`,
                    },
                }}>
                    {displayConcepts.map((concept, index) => {
                        let secondary = concept.field == "Statistical Analysis";
                        return (
                        <ConceptExplanationCard key={`${concept.field}-${index}`} secondary={secondary}>
                            <ConceptName secondary={secondary}>
                                {concept.field.replace(/\\_/g, '_')}
                            </ConceptName>
                            <ConceptExplanation>
                                {renderWithMath(concept.explanation)}
                            </ConceptExplanation>
                        </ConceptExplanationCard>
                    )})}
                </Box>

                {/* Show More/Less Button */}
                {hasMoreConcepts && (
                    <Box sx={{ 
                        display: 'flex', 
                        justifyContent: 'center', 
                        marginTop: 1,
                        paddingTop: 1,
                        borderTop: `1px solid ${borderColor.divider}`,
                    }}>
                        <Tooltip title={expanded ? t('concepts.showFewer') : t('concepts.showAll')}>
                            <IconButton
                                size="small"
                                onClick={() => setExpanded(!expanded)}
                                sx={{
                                    fontSize: '10px',
                                    color: 'text.secondary',
                                    '&:hover': {
                                        backgroundColor: 'action.hover',
                                    },
                                }}
                            >
                                <Typography variant="caption">
                                    {expanded 
                                        ? t('concepts.showFirstN', { count: maxCards })
                                        : t('concepts.showAllN', { count: concepts.length })
                                    }
                                </Typography>
                            </IconButton>
                        </Tooltip>
                </Box>
            )}
        </Box>
    );
};

// Helper function to extract concept explanations from table derivation
export const extractConceptExplanations = (table: any): ConceptExplanationItem[] => {
    if (!table?.derive?.explanation?.concepts) {
        return [];
    }

    return table.derive.explanation.concepts.map((concept: any) => ({
        field: concept.field,
        explanation: concept.explanation,
    }));
}; 


// Shared component for data transformation cards
export const CodeExplanationCard: FC<{
    title: string;
    icon: React.ReactNode;
    children: React.ReactNode;
}> = ({ title, icon, children }) => (
    <Card 
        variant="outlined"
        sx={{
            minWidth: "280px", 
            maxWidth: "1200px", 
            display: "flex", 
            flexGrow: 1, 
            margin: 0,
            borderRadius: radius.md,
            border: `1px solid ${borderColor.divider}`,
            boxShadow: shadow.sm,
            transition: transition.normal,
            '&:hover': {
                boxShadow: shadow.lg,
                borderColor: 'primary.main',
            }
        }}
    >
        <CardContent 
            sx={{
                display: "flex", 
                flexDirection: "column", 
                flexGrow: 1, 
                padding: 0,
                overflow: 'auto',
                '&:last-child': { paddingBottom: 0 }
            }}
        >
            <Typography 
                sx={{ 
                    fontSize: 14, 
                    margin: 1.5,
                    fontWeight: 500,
                    color: 'text.primary',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5

                }}
                gutterBottom
            >
                {icon}
                {title}
            </Typography>
            <Box 
                sx={{
                    display: 'flex', 
                    flexDirection: "row", 
                    alignItems: "flex-start", 
                    flex: 'auto', 
                    padding: 1.5, 
                    background: 'background.default',
                    borderTop: `1px solid ${borderColor.divider}`,
                    borderRadius: '0 0 8px 8px'
                }}
            >
                {children}
            </Box>
        </CardContent>
    </Card>
);
