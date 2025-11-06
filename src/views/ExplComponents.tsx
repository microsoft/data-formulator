// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC, useState } from 'react';
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
import 'katex/dist/katex.min.css';
import { InlineMath, BlockMath } from 'react-katex';

import LightbulbIcon from '@mui/icons-material/Lightbulb';
import InfoIcon from '@mui/icons-material/Info';

// Helper function to render text with LaTeX math expressions
const renderWithMath = (text: string) => {

    const parts: Array<{ type: 'text' | 'inline' | 'block', content: string }> = [];
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
        } else {
            return <span key={index}>{part.content}</span>;
        }
    });
};

// Styled components for the concept explanation cards
const ConceptExplanationCard = styled(Card, {
    shouldForwardProp: (prop) => prop !== 'secondary',
})<{ secondary: boolean }>(({ theme, secondary}) => ({
    minWidth: 360,  // Increased from 300
    maxWidth: 480,  // Increased from 360
    margin: '4px',

    borderRadius: '6px',
    border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
    transition: 'all 0.2s ease-in-out',
    backgroundColor: alpha(theme.palette.background.paper, 0.9),
    '&:hover': {
        boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
        borderColor: !secondary ? theme.palette.primary.light : theme.palette.secondary.light, 
        transform: 'translateY(-1px)',
    },
}));

const ConceptName = styled(Typography, {
    shouldForwardProp: (prop) => prop !== 'secondary',
})<{ secondary: boolean }>(({ theme, secondary }) => ({
    fontSize: '12px',
    fontWeight: 600,
    color: secondary ? theme.palette.secondary.main : theme.palette.primary.main,
    marginBottom: '3px',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
}));

const ConceptExplanation = styled(Typography)(({ theme }) => ({
    fontSize: '11px',
    lineHeight: 1.4,
    overflow: 'auto',
    color: theme.palette.text.primary,
    fontStyle: 'italic',
    '& .katex': {
        fontSize: '12px',
        lineHeight: 1.2,
    },
    '& .katex-display': {
        margin: '4px 0',
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
    const [expanded, setExpanded] = useState(false);

    if (!concepts || concepts.length === 0) {
        return null;
    }

    const displayConcepts = expanded ? concepts : concepts.slice(0, maxCards);
    const hasMoreConcepts = concepts.length > maxCards;


    return (
        <Box sx={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
            {/* Concepts Grid */}
            <Box sx={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',  // Increased from 180px
                    gap: 1,
                    overflow: 'hidden',
                }}>
                    {displayConcepts.map((concept, index) => {
                        let secondary = concept.field == "Statistical Analysis";
                        return (
                        <ConceptExplanationCard key={`${concept.field}-${index}`} secondary={secondary}>
                            <CardContent sx={{ padding: '6px !important' }}>
                                <ConceptName secondary={secondary}>
                                    {concept.field}
                                </ConceptName>
                                <ConceptExplanation>
                                    {renderWithMath(concept.explanation)}
                                </ConceptExplanation>
                            </CardContent>
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
                        borderTop: '1px solid',
                        borderColor: 'divider',
                    }}>
                        <Tooltip title={expanded ? "Show fewer concepts" : "Show all concepts"}>
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
                                        ? `Show first ${maxCards} concepts` 
                                        : `Show all ${concepts.length} concepts`
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
    transformationIndicatorText: string;
}> = ({ title, icon, children, transformationIndicatorText }) => (
    <Card 
        variant="outlined"
        sx={{
            minWidth: "280px", 
            maxWidth: "1200px", 
            display: "flex", 
            flexGrow: 1, 
            margin: 0,
            borderRadius: 2,
            border: '1px solid',
            borderColor: 'divider',
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            transition: 'all 0.2s ease-in-out',
            '&:hover': {
                boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
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
                {title} ({transformationIndicatorText})
            </Typography>
            <Box 
                sx={{
                    display: 'flex', 
                    flexDirection: "row", 
                    alignItems: "flex-start", 
                    flex: 'auto', 
                    padding: 1.5, 
                    background: 'background.default',
                    borderTop: '1px solid',
                    borderColor: 'divider',
                    borderRadius: '0 0 8px 8px'
                }}
            >
                {children}
            </Box>
        </CardContent>
    </Card>
);
