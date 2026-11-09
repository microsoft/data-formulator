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
import { textVar } from '../app/layout';
import 'katex/dist/katex.min.css';
import { InlineMath, BlockMath } from 'react-katex';

import LightbulbIcon from '@mui/icons-material/Lightbulb';
import InfoIcon from '@mui/icons-material/Info';

type MathPart = { type: 'text' | 'inline' | 'block' | 'code', content: string };

// Split text into plain text, inline/block LaTeX, and `code` spans.
const parseMathParts = (text: string): MathPart[] => {

    const parts: MathPart[] = [];
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

    return parts;
};

// Models emphasise key terms with markdown `**bold**`; render it rather than
// showing literal asterisks.
const renderTextWithBold = (text: string, key: React.Key) => {
    const segments = text.split(/\*\*(.+?)\*\*/g);
    if (segments.length === 1) {
        return <span key={key}>{text}</span>;
    }
    return (
        <span key={key}>
            {segments.map((segment, i) => (i % 2 === 1
                ? <Box component="strong" key={i} sx={{ fontWeight: 600 }}>{segment}</Box>
                : segment))}
        </span>
    );
};

// Helper function to render text with LaTeX math expressions
const renderWithMath = (text: string) => {
    return parseMathParts(text).map((part, index) => {
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
                        fontFamily: 'var(--df-font-mono)',
                        fontSize: '0.92em',
                        px: 0.5,
                        py: '1px',
                        borderRadius: '3px',
                        backgroundColor: (theme) => alpha(theme.palette.text.primary, 0.045),
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
            return renderTextWithBold(part.content, index);
        }
    });
};

export interface FormulaStatement {
    lhs: string;
    rhs: string;
    /** Further cases of a piecewise definition, one per line. */
    continuations?: string[];
}

export interface ParsedFormula {
    /** Lead-in text before the formulas, e.g. "Within each category:". */
    note?: string;
    statements: FormulaStatement[];
}

const OPENERS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

// Split on `separator` only when it is outside brackets and quotes, so
// `fillna('a; b')` or `f(x; y)` stay intact.
const splitTopLevel = (text: string, separator: string): string[] => {
    const pieces: string[] = [];
    const closers: string[] = [];
    let quote: string | null = null;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quote) {
            if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") {
            quote = ch;
        } else if (OPENERS[ch]) {
            closers.push(OPENERS[ch]);
        } else if (ch === closers[closers.length - 1]) {
            closers.pop();
        } else if (ch === separator && closers.length === 0) {
            pieces.push(text.slice(start, i));
            start = i + 1;
        }
    }
    pieces.push(text.slice(start));
    return pieces;
};

// Split `lhs = rhs` at the first top-level `=` that is not part of a
// comparison operator (==, <=, >=, !=).
const splitAssignment = (statement: string): FormulaStatement | null => {
    const closers: string[] = [];
    let quote: string | null = null;
    for (let i = 0; i < statement.length; i++) {
        const ch = statement[i];
        if (quote) {
            if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") {
            quote = ch;
        } else if (OPENERS[ch]) {
            closers.push(OPENERS[ch]);
        } else if (ch === closers[closers.length - 1]) {
            closers.pop();
        } else if (ch === '=' && closers.length === 0) {
            const prev = statement[i - 1];
            const next = statement[i + 1];
            if ((prev && '<>!='.includes(prev)) || next === '=') {
                // Skip the second character of `==` as well.
                if (next === '=') i++;
                continue;
            }
            const lhs = statement.slice(0, i).trim();
            const rhs = statement.slice(i + 1).trim();
            // Left-hand sides are field names, not expressions or literals.
            if (!lhs || !rhs || lhs.length > 80 || /[()'"<>!]/.test(lhs)) return null;
            return { lhs, rhs };
        }
    }
    return null;
};

/**
 * Recognise explanations that are purely `field = expression` code spans
 * (optionally after a short lead-in) so they can be laid out as aligned
 * statements. Returns null for prose, LaTeX, or anything else.
 */
export const parseFormulaStatements = (explanation: string): ParsedFormula | null => {
    let note = '';
    const statements: FormulaStatement[] = [];
    for (const part of parseMathParts(explanation)) {
        if (part.type === 'text') {
            if (statements.length === 0) {
                note += part.content;
            } else if (!/^[\s;,.]*(and)?[\s;,.]*$/i.test(part.content)) {
                return null;
            }
        } else if (part.type === 'code') {
            for (const raw of splitTopLevel(part.content.replace(/\\_/g, '_'), ';')) {
                const piece = raw.trim();
                if (!piece) continue;
                const statement = splitAssignment(piece);
                if (statement) {
                    statements.push(statement);
                } else if (statements.length > 0) {
                    // `x = 'a' if ...; 'b' if ...` lists cases of one definition.
                    const previous = statements[statements.length - 1];
                    previous.continuations = [...(previous.continuations ?? []), piece];
                } else {
                    return null;
                }
            }
        } else {
            return null;
        }
    }
    if (statements.length === 0) return null;
    const trimmedNote = note.trim();
    return trimmedNote ? { note: trimmedNote, statements } : { statements };
};

// Styled components for the concept explanation entries.
// Rendered as lightweight metadata rows (label + formula) rather than boxed
// cards, so they read as inline annotations on the derived table.
const ConceptExplanationCard = styled(Box)(() => ({
    gridColumn: '1 / -1',
    minWidth: 0,
}));

const ConceptName = styled(Typography, {
    shouldForwardProp: (prop) => prop !== 'secondary',
})<{ secondary: boolean }>(({ theme, secondary }) => ({
    fontSize: textVar.xs,
    fontWeight: 600,
    color: secondary ? theme.palette.secondary.main : theme.palette.primary.main,
    marginBottom: '2px',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    fontFamily: 'var(--df-font-mono)',
    letterSpacing: '0.01em',
}));

const ConceptExplanation = styled(Typography)(({ theme }) => ({
    fontSize: textVar.xs,
    lineHeight: 1.5,
    minWidth: 0,
    color: theme.palette.text.primary,
    '& .katex': {
        fontSize: textVar.xs,
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
        fontSize: textVar.xl,
        lineHeight: 1.5,
    },
// styled() drops Typography's polymorphic `component` prop from the type.
})) as typeof Typography;

const formulaMonoSx = {
    fontFamily: 'var(--df-font-mono)',
    fontSize: textVar.xs,
    lineHeight: 1.6,
    minWidth: 0,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
} as const;

const FormulaGroupDivider = styled(Box)(() => ({
    gridColumn: '1 / -1',
    borderTop: `1px solid ${alpha('#000', 0.06)}`,
    margin: '4px 0',
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
            {/* One grid for every concept so `=` lines up across groups:
                field name | = | expression. Prose and LaTeX explanations
                span the full row under their field label. */}
            <Box sx={{
                    display: 'grid',
                    gridTemplateColumns: 'fit-content(40%) auto minmax(0, 1fr)',
                    columnGap: 1,
                    rowGap: '2px',
                    alignItems: 'baseline',
                    width: '100%',
                    minWidth: 0,
                }}>
                    {displayConcepts.map((concept, index) => {
                        const secondary = concept.field == "Statistical Analysis";
                        const parsed = secondary ? null : parseFormulaStatements(concept.explanation);
                        const key = `${concept.field}-${index}`;
                        return (
                            <React.Fragment key={key}>
                                {index > 0 && <FormulaGroupDivider />}
                                {parsed ? (
                                    <>
                                        {parsed.note && (
                                            <Typography sx={{
                                                gridColumn: '1 / -1',
                                                fontSize: textVar.xs,
                                                color: 'text.secondary',
                                            }}>
                                                {renderWithMath(parsed.note)}
                                            </Typography>
                                        )}
                                        {parsed.statements.map((statement, i) => (
                                            <React.Fragment key={i}>
                                                <Box component="span" sx={{ ...formulaMonoSx, fontWeight: 600, color: 'primary.main' }}>
                                                    {statement.lhs}
                                                </Box>
                                                <Box component="span" sx={{ ...formulaMonoSx, color: 'text.disabled' }}>=</Box>
                                                <Box component="span" sx={{ ...formulaMonoSx, color: 'text.primary' }}>
                                                    {statement.rhs}
                                                </Box>
                                                {statement.continuations?.map((line, j) => (
                                                    <React.Fragment key={j}>
                                                        <span />
                                                        <span />
                                                        <Box component="span" sx={{ ...formulaMonoSx, color: 'text.primary' }}>
                                                            {line}
                                                        </Box>
                                                    </React.Fragment>
                                                ))}
                                            </React.Fragment>
                                        ))}
                                    </>
                                ) : (
                                    <ConceptExplanationCard>
                                        <ConceptName secondary={secondary}>
                                            {concept.field.replace(/\\_/g, '_')}
                                        </ConceptName>
                                        {/* div, not p: block math renders a <div>. */}
                                        <ConceptExplanation component="div">
                                            {renderWithMath(concept.explanation)}
                                        </ConceptExplanation>
                                    </ConceptExplanationCard>
                                )}
                            </React.Fragment>
                        );
                    })}
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
                                    fontSize: textVar.xxs,
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
                    fontSize: textVar.lg, 
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
