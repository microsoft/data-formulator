import {
    ClarificationOption,
    ClarificationQuestion,
    ClarificationResponse,
} from '../components/ComponentType';
import { translateBackend } from './utils';

export interface NormalizedClarification {
    questions: ClarificationQuestion[];
    summary: string;
}

/** Resolve an option's user-visible label.
 *  Accepts a bare string or a `{label, label_code?}` dict; returns null
 *  if no usable label can be produced. The `label_code` is a backend i18n
 *  key consumed by `translateBackend`; we don't keep it on the normalized
 *  output because nothing downstream reads it. */
function normalizeOption(raw: any): ClarificationOption | null {
    if (typeof raw === 'string') {
        const label = raw.trim();
        return label ? { label } : null;
    }
    if (!raw || typeof raw !== 'object') return null;

    const label = translateBackend(
        String(raw.label || ''),
        typeof raw.label_code === 'string' ? raw.label_code : undefined,
    ).trim();
    return label ? { label } : null;
}

/** Resolve a question's translated text + its options. The `*_code` /
 *  `text_params` keys are i18n inputs only — they're not preserved on the
 *  normalized output. `responseType` defaults to `single_choice` when
 *  options exist, else `free_text` (mirrors the backend default). */
function normalizeQuestion(raw: any): ClarificationQuestion | null {
    if (!raw || typeof raw !== 'object') return null;

    const text = translateBackend(
        String(raw.text || ''),
        typeof raw.text_code === 'string' ? raw.text_code : undefined,
        raw.text_params && typeof raw.text_params === 'object' ? raw.text_params : undefined,
    ).trim();
    if (!text) return null;

    const rawOptions = Array.isArray(raw.options) ? raw.options : [];
    const options = rawOptions
        .map((option: any) => normalizeOption(option))
        .filter((option: ClarificationOption | null): option is ClarificationOption => option !== null);

    const responseType = raw.responseType === 'free_text' || raw.responseType === 'single_choice'
        ? raw.responseType
        : (options.length > 0 ? 'single_choice' : 'free_text');

    return {
        text,
        responseType,
        ...(options.length > 0 ? { options } : {}),
    };
}

export function normalizeClarifyEvent(result: any): NormalizedClarification {
    const rawQuestions = Array.isArray(result?.questions) ? result.questions : [];
    const questions = rawQuestions
        .map((question: any) => normalizeQuestion(question))
        .filter((question: ClarificationQuestion | null): question is ClarificationQuestion => question !== null);

    if (questions.length === 0) {
        throw new Error('Clarify event requires non-empty questions[]');
    }

    // Summary feeds the agent's clarify InteractionEntry content (shown
    // when the user expands the timeline entry).
    const summary = questions.length === 1
        ? questions[0].text
        : questions.map((q: ClarificationQuestion, i: number) => `${i + 1}. ${q.text}`).join('\n');

    return { questions, summary };
}

/**
 * Build the user's reply string from a list of clarification responses.
 * Used for both the timeline bubble and the user message sent to the agent
 * (the same string powers both surfaces).
 *
 *   - single response (any source) → just the answer
 *   - multiple selections          → "1. <a1>; 2. <a2>"
 *   - selections + freeform text   → "1. <a1>; 2. <a2>\n<freeform>"
 *
 * The 1-based index is the user's `question_index + 1` from the agent's
 * `questions[]` order, so the LLM can correlate responses back to the
 * questions in the immediately preceding assistant message.
 */
export function formatClarificationResponses(
    responses: ClarificationResponse[],
): string {
    if (responses.length === 0) return '';
    if (responses.length === 1) return responses[0].answer;

    const selections: string[] = [];
    const freeformChunks: string[] = [];
    for (const r of responses) {
        const answer = r.answer.trim();
        if (!answer) continue;
        if (r.source === 'freeform' || r.question_index < 0) {
            freeformChunks.push(answer);
        } else {
            selections.push(`${r.question_index + 1}. ${answer}`);
        }
    }
    const parts: string[] = [];
    if (selections.length > 0) parts.push(selections.join('; '));
    if (freeformChunks.length > 0) parts.push(freeformChunks.join(' '));
    return parts.join('\n');
}
