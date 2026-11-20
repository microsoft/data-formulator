// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
//
// A large text paste in a chat box becomes an attached document (uploaded to
// the workspace scratch/ folder) instead of message text, so the agent reads
// it with its file tools on demand rather than resending it on every model
// call, and the user can still type a question about it.

/** Pastes at least this long are attached as a document (~1K tokens). */
export const LARGE_PASTE_MIN_CHARS = 4000;

const parseJson = (text: string): { value: unknown } | null => {
    const trimmed = text.trim();
    if (!/^[[{]/.test(trimmed)) return null;
    try {
        return { value: JSON.parse(trimmed) };
    } catch {
        return null;
    }
};

// Spreadsheet copies are tab-separated with the same column count on each line.
const looksLikeTsv = (text: string): boolean => {
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length < 2) return false;
    const columns = lines[0].split('\t').length;
    if (columns < 2) return false;
    return lines.filter(line => line.split('\t').length === columns).length >= lines.length * 0.9;
};

/** The file a pasted text becomes, or null when it is short enough to stay in the message. */
export function pastedTextFile(text: string, index = 1): File | null {
    if (text.length < LARGE_PASTE_MIN_CHARS) return null;
    const json = parseJson(text);
    if (json) {
        // The agent's read_file pages by line, so minified JSON is indented to be read in parts.
        const content = text.trim().includes('\n') ? text : JSON.stringify(json.value, null, 2);
        return new File([content], `pasted-text-${index}.json`, { type: 'application/json' });
    }
    const [extension, type] = looksLikeTsv(text) ? ['tsv', 'text/tab-separated-values'] : ['txt', 'text/plain'];
    return new File([text], `pasted-text-${index}.${extension}`, { type });
}
