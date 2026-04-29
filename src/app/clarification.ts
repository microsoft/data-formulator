import {
    ClarificationAutoSelect,
    ClarificationOption,
    ClarificationQuestion,
    ClarificationResponse,
} from '../components/ComponentType';
import { translateBackend } from './utils';

export interface NormalizedClarification {
    questions: ClarificationQuestion[];
    summary: string;
    autoSelect?: ClarificationAutoSelect;
}

function normalizeOption(raw: any, index: number): ClarificationOption | null {
    if (!raw || typeof raw !== 'object') return null;

    const label = translateBackend(
        String(raw.label || ''),
        typeof raw.label_code === 'string' ? raw.label_code : undefined,
    ).trim();
    if (!label) return null;

    return {
        id: String(raw.id || `option_${index + 1}`),
        label,
        ...(typeof raw.label_code === 'string' ? { label_code: raw.label_code } : {}),
    };
}

function normalizeQuestion(raw: any, index: number): ClarificationQuestion | null {
    if (!raw || typeof raw !== 'object') return null;

    const text = translateBackend(
        String(raw.text || ''),
        typeof raw.text_code === 'string' ? raw.text_code : undefined,
        raw.text_params && typeof raw.text_params === 'object' ? raw.text_params : undefined,
    ).trim();
    if (!text) return null;

    const rawOptions = Array.isArray(raw.options) ? raw.options : [];
    const options = rawOptions
        .map((option: any, optionIndex: number) => normalizeOption(option, optionIndex))
        .filter((option: ClarificationOption | null): option is ClarificationOption => option !== null);
    const responseType = raw.responseType === 'free_text' ? 'free_text' : 'single_choice';

    return {
        id: String(raw.id || `question_${index + 1}`),
        text,
        ...(typeof raw.text_code === 'string' ? { text_code: raw.text_code } : {}),
        ...(raw.text_params && typeof raw.text_params === 'object' ? { text_params: raw.text_params } : {}),
        responseType,
        required: raw.required !== false,
        ...(options.length > 0 ? { options } : {}),
    };
}

export function buildClarificationSummary(questions: ClarificationQuestion[]): string {
    if (questions.length === 1) return questions[0].text;
    return questions.map((question, index) => `${index + 1}. ${question.text}`).join('\n');
}

export function normalizeClarifyEvent(result: any): NormalizedClarification {
    const rawQuestions = Array.isArray(result?.questions) ? result.questions : [];
    const questions = rawQuestions
        .map((question: any, index: number) => normalizeQuestion(question, index))
        .filter((question: ClarificationQuestion | null): question is ClarificationQuestion => question !== null);

    if (questions.length === 0) {
        throw new Error('Clarify event requires non-empty questions[]');
    }

    const rawAutoSelect = result?.auto_select;
    const autoSelect = rawAutoSelect && typeof rawAutoSelect === 'object'
        ? {
            question_id: String(rawAutoSelect.question_id || ''),
            option_id: String(rawAutoSelect.option_id || ''),
            timeout_ms: Number(rawAutoSelect.timeout_ms || 0) || undefined,
        }
        : undefined;

    return {
        questions,
        summary: buildClarificationSummary(questions),
        ...(autoSelect?.question_id && autoSelect?.option_id ? { autoSelect } : {}),
    };
}

export function formatClarificationResponsesForDisplay(
    responses: ClarificationResponse[],
    questions: ClarificationQuestion[],
): string {
    const questionTextById = new Map(questions.map(question => [question.id, question.text]));
    if (responses.length === 1 && responses[0].source === 'freeform') {
        return responses[0].answer;
    }

    return responses
        .map(response => {
            if (response.question_id === '__freeform__') return response.answer;
            const label = questionTextById.get(response.question_id) || response.question_id;
            return `${label}: ${response.answer}`;
        })
        .join('\n');
}
