export const explanationContent = (content: string, answer?: string) =>
    answer ? `${content}\n\n> ↳ ${answer}` : content;

export const shouldPreviewExplanationInCanvas = (content: string) =>
    content.length > 1000 || content.split('\n').length > 14;