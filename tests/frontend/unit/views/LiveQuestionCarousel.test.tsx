import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { LiveQuestionCarousel } from '../../../../src/views/LandingDataEntry';
import type { LiveQuestion } from '../../../../src/app/liveDataPick';

const copyFor = (question: LiveQuestion) => ({ question, ask: `Ask ${question}`, busy: `Loading ${question}`, hint: `About ${question}` });
const shown = () => screen.getAllByRole('button').map(button => button.textContent).find(text => text?.startsWith('Ask'));

describe('LiveQuestionCarousel', () => {
    afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

    it('shows one question at a time, turning on its own unless held', () => {
        vi.useFakeTimers();
        vi.spyOn(Math, 'random').mockReturnValue(0.999);
        const onRun = vi.fn(() => Promise.resolve());
        render(<LiveQuestionCarousel questions={['umbrella', 'moon', 'wiki']} copyFor={copyFor} onRun={onRun} />);

        // A shuffle that keeps the order, with this random number.
        expect(shown()).toBe('Ask umbrella');
        act(() => { vi.advanceTimersByTime(5000); });
        expect(shown()).toBe('Ask moon');

        const carousel = screen.getByText('Ask moon').closest('button')!.parentElement!.parentElement!.parentElement!;
        fireEvent.mouseEnter(carousel);
        act(() => { vi.advanceTimersByTime(20_000); });
        expect(shown()).toBe('Ask moon');
        fireEvent.mouseLeave(carousel);
        act(() => { vi.advanceTimersByTime(5000); });
        expect(shown()).toBe('Ask wiki');
        act(() => { vi.advanceTimersByTime(5000); });
        expect(shown()).toBe('Ask umbrella');

        fireEvent.click(screen.getByText('Ask umbrella'));
        expect(onRun).toHaveBeenCalledWith('umbrella');
    });
});
