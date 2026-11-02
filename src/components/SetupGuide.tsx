// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React from 'react';
import Markdown from 'markdown-to-jsx';
import { Box, Typography } from '@mui/material';

// Code, link targets and bare URLs keep their underscores; everything else is prose.
const MARKDOWN_LITERAL = /(```[\s\S]*?```|`[^`\n]*`|\]\([^)]*\)|https?:\/\/\S+)/;

/** Underscores inside names (`aws_access_key_id`) are literal in setup guides, not emphasis. */
export function escapeIntrawordUnderscores(markdown: string): string {
    return markdown.split(MARKDOWN_LITERAL)
        .map((part, index) => index % 2 ? part : part.replace(/(?<=[A-Za-z0-9])_(?=[A-Za-z0-9])/g, '\\_'))
        .join('');
}

export type SetupGuideBlock =
    | { kind: 'section'; label: string; body: string }
    | { kind: 'example'; label: string; pairs: [string, string][] }
    | { kind: 'text'; body: string };

// "**Local setup:** …" (label and text in one paragraph) or "**Local setup**" on its own line.
// Chinese guides end the label with a full-width colon.
const LABELLED = /^\*\*([^*]+?)[:：]\*\*\s*([\s\S]*)$/;
const HEADING = /^\*\*([^*]+?)[:：]?\*\*$/;
// A parameter name and its value, e.g. "region_name: `us-east-1`".
const PAIR = /^([A-Za-z][\w.-]*):\s+(\S[\s\S]*)$/;
/** Guide text after this line is for the agent only (engine internals), not the setup panel. */
export const AGENT_NOTES_MARKER = /^<!--\s*agent-notes\s*-->[\s\S]*$/m;

const examplePairs = (paragraph: string): [string, string][] | undefined => {
    const parts = paragraph.split(' · ').map(part => part.trim().match(PAIR));
    if (!parts.every(Boolean)) return undefined;
    // One pair counts only with a code value, so a sentence like "Note: …" stays prose.
    if (parts.length === 1 && !parts[0]![2].startsWith('`')) return undefined;
    return parts.map(match => [match![1], match![2]]);
};

/**
 * Guides are sections led by a bold label, either inline ("**Local setup:** …") or on its own line
 * with the text in the paragraphs after it. A section whose text is one line of `name: value` pairs
 * joined by " · " is an example — recognised by that shape, so it works in every language.
 */
export function parseSetupGuide(markdown: string): SetupGuideBlock[] {
    const blocks: SetupGuideBlock[] = [];
    let current: { label: string; paragraphs: string[] } | undefined;
    const close = () => {
        if (!current) return;
        const pairs = current.paragraphs.length === 1 ? examplePairs(current.paragraphs[0]) : undefined;
        blocks.push(pairs ? { kind: 'example', label: current.label, pairs }
            : { kind: 'section', label: current.label, body: current.paragraphs.join('\n\n') });
        current = undefined;
    };
    for (const raw of markdown.replace(AGENT_NOTES_MARKER, '').trim().split(/\n\s*\n/)) {
        const paragraph = raw.trim();
        if (!paragraph) continue;
        const heading = paragraph.match(HEADING);
        const labelled = !heading && paragraph.match(LABELLED);
        if (heading || labelled) {
            close();
            current = { label: (heading || labelled as RegExpMatchArray)[1], paragraphs: labelled ? [labelled[2].trim()] : [] };
        } else if (current) {
            current.paragraphs.push(paragraph);
        } else {
            blocks.push({ kind: 'text', body: paragraph });
        }
    }
    close();
    return blocks;
}

const markdownOptions = {
    overrides: { a: { props: { target: '_blank', rel: 'noopener noreferrer' } } },
};

const GuideMarkdown: React.FC<{ children: string; inline?: boolean }> = ({ children, inline }) =>
    <Markdown options={{ ...markdownOptions, ...(inline ? { forceInline: true } : {}) }}>
        {escapeIntrawordUnderscores(children)}
    </Markdown>;

/** A connector's setup guide: labelled sections, with examples laid out as name/value rows. */
export const SetupGuide: React.FC<{ content: string }> = ({ content }) => {
    const blocks = parseSetupGuide(content);
    const labelSx = { fontSize: 'inherit', fontWeight: 600, color: 'text.primary', mb: 0.25 } as const;
    return <Box sx={{ display: 'grid', gap: 1.75 }}>
        {blocks.map((block, index) => {
            if (block.kind === 'text') return <Box key={index}><GuideMarkdown>{block.body}</GuideMarkdown></Box>;
            if (block.kind === 'section') return <Box key={index}>
                <Typography sx={labelSx}>{block.label}</Typography>
                <Box><GuideMarkdown>{block.body}</GuideMarkdown></Box>
            </Box>;
            return <Box key={index}>
                <Typography sx={labelSx}>{block.label}</Typography>
                <Box component="dl" sx={{ m: 0, mt: 0.5, display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', columnGap: 1.5, rowGap: 0.5 }}>
                    {block.pairs.map(([name, value]) => <React.Fragment key={name}>
                        <Box component="dt" sx={{ color: 'text.secondary', fontFamily: 'var(--df-font-mono)', fontSize: '0.92em !important' }}>{name}</Box>
                        {/* Values read as plain monospace; the grid already marks them as values. */}
                        <Box component="dd" sx={{ m: 0, minWidth: 0, '& code': { backgroundColor: 'transparent !important', padding: '0 !important' } }}>
                            <GuideMarkdown inline>{value}</GuideMarkdown>
                        </Box>
                    </React.Fragment>)}
                </Box>
            </Box>;
        })}
    </Box>;
};
