import React from 'react';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '../../../../src/app/store';
import { dfActions } from '../../../../src/app/dfSlice';
import { apiRequest } from '../../../../src/app/apiClient';
import { onTurnResumeRequest, type AccountState, type SignInSpec } from '../../../../src/app/accounts';
import { SignInFormCard } from '../../../../src/components/SignInFormCard';
import type { SignInFormArtifact, TextTurn } from '../../../../src/components/ComponentType';

vi.mock('../../../../src/app/apiClient', async importOriginal => ({
    ...await importOriginal<typeof import('../../../../src/app/apiClient')>(),
    apiRequest: vi.fn(),
}));

const HF: SignInSpec = { id: 'huggingface', name: 'Hugging Face', send_to: ['huggingface.co', 'hf.co', 'datasets-server.huggingface.co'],
    auth: { type: 'bearer', secret_label: 'Hugging Face token' }, get_token: 'https://huggingface.co/settings/tokens',
    verified: true, methods: ['reuse', 'device', 'token'], domains: ['huggingface.co', 'hf.co'] };
const KAGGLE: SignInSpec = { id: 'kaggle', name: 'Kaggle', send_to: ['www.kaggle.com'],
    auth: { type: 'basic', username_label: 'Kaggle username', secret_label: 'API key' },
    get_token: 'https://www.kaggle.com/settings', instructions: 'Settings, API, Create New Token.',
    verified: false, methods: ['token'], domains: ['kaggle.com'] };
const account = (spec: SignInSpec, extra: Partial<AccountState> = {}): AccountState => ({
    ...spec, signed_in: false, login: null, secret_hint: null, source: null, scope: null, reusable_login: null, ...extra });
const hfOut = account(HF, { reusable_login: 'ada' });
const hfIn = account(HF, { signed_in: true, login: 'ada', source: 'token', scope: 'user', reusable_login: null });

const formOf = (spec: SignInSpec, steps: SignInFormArtifact['signin']['steps'] = [],
    extra: Partial<SignInFormArtifact['signin']> = {}): SignInFormArtifact => ({
    kind: 'signin', title: `Sign in to ${spec.name}`, signin: {
        provider: spec.id, providerName: spec.name, spec, verified: spec.verified, reason: 'gated', status: 'pending', steps,
        explanation: 'meta-llama/Llama-3.1-8B-Instruct-evals is gated.', unlocks: 'Preview 5 rows', ...extra,
    },
});

let turnCount = 0;
const show = (form: SignInFormArtifact, content = 'Signing in would let me continue.', embedded = false) => {
    const turn = { kind: 'text', id: `signin-turn-${++turnCount}`, displayId: 'signin', textKind: 'explain', content,
        parentNodeId: 'root', createdAt: Date.now(), form } as TextTurn;
    store.dispatch(dfActions.addTextTurn(turn));
    render(<Provider store={store}><SignInFormCard turn={turn} form={form} embedded={embedded} /></Provider>);
    return turn.id;
};
const stored = (id: string) => store.getState().textTurns.find(turn => turn.id === id)?.form as SignInFormArtifact;
const answer = (url: string, data: unknown) => ({ url, data });
const serve = (...routes: { url: string; data: unknown }[]) => vi.mocked(apiRequest).mockImplementation(async url => {
    const route = routes.find(item => item.url === url);
    if (!route) throw new Error(`No sign-in named ${url}`);
    return { data: route.data } as any;
});

describe('sign-in card', () => {
    const resumed: [string, string][] = [];
    let unsubscribe = () => {};
    let accepting = true;
    beforeEach(() => {
        resumed.length = 0;
        accepting = true;
        unsubscribe = onTurnResumeRequest((id, message) => { if (accepting) resumed.push([id, message]); return accepting; });
    });
    afterEach(() => { unsubscribe(); vi.mocked(apiRequest).mockReset(); });

    it("shows the agent's words apart from the app's controls, and continues without signing in", async () => {
        serve(answer('/api/accounts/huggingface', hfOut));
        const id = show(formOf(HF, [{ text: 'Accept the terms', url: 'https://huggingface.co/datasets/meta-llama/x' },
            { text: 'Ignore this link', url: 'javascript:alert(1)' }, { text: 'Confirm your token', url: 'https://hf-login.example/confirm' }],
        { prefer: 'token' }));
        expect(screen.getByRole('region', { name: 'From the agent' })).toHaveTextContent('is gated.');
        expect(screen.getByText('Signing in lets it: Preview 5 rows')).toBeVisible();
        expect(await screen.findByRole('link', { name: 'huggingface.co/datasets/meta-llama/x' })).toHaveAttribute('target', '_blank');
        // Off the service's own sites, a step stays text.
        expect(screen.queryByRole('link', { name: /alert|hf-login/ })).toBeNull();
        expect(document.querySelector('[data-signin-destination]')).toHaveTextContent('huggingface.co, hf.co, datasets-server.huggingface.co');
        // The agent preferred a pasted token: it comes first, as the outlined choice.
        const buttons = screen.getAllByRole('button', { name: /Paste a token|Use @ada|Sign in with Hugging Face/ });
        expect(buttons.map(button => button.textContent)).toEqual(['Paste a token', 'Use @ada from this computer', 'Sign in with Hugging Face']);
        fireEvent.click(screen.getByRole('button', { name: 'Continue without signing in' }));
        expect(resumed).toEqual([[id, "I won't sign in to Hugging Face. Continue without it."]]);
        expect(stored(id).signin.status).toBe('declined');
    });

    it("leaves out an explanation the agent's message already gives", async () => {
        serve(answer('/api/accounts/huggingface', hfOut));
        show(formOf(HF, [], { unlocks: undefined }), 'meta-llama/Llama-3.1-8B-Instruct-evals is gated. Sign in below.');
        await screen.findByRole('button', { name: 'Paste a token' });
        expect(screen.queryByRole('region', { name: 'From the agent' })).toBeNull();
    });

    it("inside the agent's message, keeps only the steps and the controls", async () => {
        serve(answer('/api/accounts/huggingface', hfOut));
        show(formOf(HF, [{ text: 'Accept the terms', url: 'https://huggingface.co/datasets/meta-llama/x' }]), 'Use the card below.', true);
        expect(await screen.findByRole('link', { name: 'huggingface.co/datasets/meta-llama/x' })).toBeVisible();
        expect(screen.queryByText(/is gated\./)).toBeNull();
        expect(screen.queryByText(/Signing in lets it/)).toBeNull();
        expect(screen.getByRole('button', { name: 'Continue without signing in' })).toBeVisible();
    });

    it('continues the run once the user signs in, with only the account name kept', async () => {
        serve(answer('/api/accounts/huggingface', hfOut), answer('/api/accounts/huggingface/token', hfIn));
        const id = show(formOf(HF));
        fireEvent.click(await screen.findByRole('button', { name: 'Paste a token' }));
        fireEvent.change(screen.getByLabelText('Hugging Face token'), { target: { value: 'hf_secret' } });
        fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
        await waitFor(() => expect(resumed).toEqual([[id, 'Signed in to Hugging Face as @ada. Continue.']]));
        const [, options] = vi.mocked(apiRequest).mock.calls.find(([url]) => url === '/api/accounts/huggingface/token')!;
        // Kept for this session: the server's default, so the card sends no scope.
        expect(JSON.parse(String(options?.body))).toEqual({ token: 'hf_secret' });
        expect(stored(id).signin).toMatchObject({ status: 'signed_in', login: 'ada' });
        expect(JSON.stringify(store.getState().textTurns)).not.toContain('hf_secret');
    });

    it("signs in to a service the agent set up: shows where the key goes, checks and keeps it for all sessions when asked", async () => {
        serve(answer('/api/accounts/custom', account(KAGGLE, { signed_in: true, login: 'ada', source: 'token', scope: 'user' })));
        const id = show(formOf(KAGGLE, [], { reason: 'unauthorized', explanation: 'Competition data needs a key.', unlocks: undefined }));
        expect(await screen.findByText('Your key is sent only to', { exact: false })).toHaveTextContent(/^Your key is sent only to www\.kaggle\.com$/);
        expect(screen.queryByText(/Built in|Set up by the agent/)).toBeNull();
        // The site's own icon, from the site the key goes to; the generic icon if it does not load.
        const icon = document.querySelector('[data-signin-site-icon]')!;
        expect(icon).toHaveAttribute('src', 'https://kaggle.com/favicon.ico');
        fireEvent.error(icon);
        expect(document.querySelector('[data-signin-site-icon]')).toBeNull();
        expect(screen.getByRole('link', { name: 'Get it on www.kaggle.com' })).toHaveAttribute('href', 'https://www.kaggle.com/settings');
        fireEvent.change(screen.getByLabelText('Kaggle username'), { target: { value: 'ada' } });
        fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'k-123456789' } });
        fireEvent.click(screen.getByLabelText('Keep for all sessions'));
        fireEvent.click(screen.getByRole('button', { name: 'Check and save' }));
        await waitFor(() => expect(resumed).toEqual([[id, 'Signed in to Kaggle as @ada. Continue.']]));
        const [, options] = vi.mocked(apiRequest).mock.calls.find(([url]) => url === '/api/accounts/custom')!;
        const sent = JSON.parse(String(options?.body));
        expect(sent).toMatchObject({ secret: { username: 'ada', key: 'k-123456789' }, scope: 'user',
            spec: { id: 'kaggle', send_to: ['www.kaggle.com'], auth: { type: 'basic' } } });
        expect(JSON.stringify(store.getState().textTurns)).not.toContain('k-123456789');
    });

    it('refuses a spec from a saved session that would send a key off its own site', async () => {
        serve();
        show(formOf({ ...KAGGLE, send_to: ['api.evil.com'] }, [{ text: 'Get a key', url: 'https://www.kaggle.com/settings' }]));
        expect(await screen.findByText(/send a key outside the service/)).toBeVisible();
        expect(screen.queryByLabelText('API key')).toBeNull();
        expect(screen.queryByRole('link', { name: /kaggle/ })).toBeNull();
        expect(screen.getByRole('button', { name: 'Continue without signing in' })).toBeVisible();
    });

    it('waits for the steps on the service site before continuing a signed-in user', async () => {
        serve(answer('/api/accounts/huggingface', hfIn));
        const id = show(formOf(HF, [{ text: 'Accept the terms', url: 'https://huggingface.co/datasets/meta-llama/x' }]));
        fireEvent.click(await screen.findByRole('button', { name: 'Done, continue' }));
        expect(resumed).toEqual([[id, 'Signed in to Hugging Face as @ada, and done with the steps. Continue.']]);
    });

    it('stays unanswered when the chat is busy, so the user can answer again', async () => {
        serve(answer('/api/accounts/huggingface', hfOut));
        accepting = false;
        const id = show(formOf(HF));
        fireEvent.click(await screen.findByRole('button', { name: 'Continue without signing in' }));
        expect(stored(id).signin.status).toBe('pending');
        expect(screen.getByText(/working on another request/)).toBeVisible();
        accepting = true;
        fireEvent.click(screen.getByRole('button', { name: 'Continue without signing in' }));
        expect(resumed).toEqual([[id, "I won't sign in to Hugging Face. Continue without it."]]);
        expect(stored(id).signin.status).toBe('declined');
    });

    it("shows what it reads on this computer and where the key goes, and reads it only when chosen", async () => {
        const github: SignInSpec = { id: 'github', name: 'GitHub', send_to: ['api.github.com'], auth: { type: 'bearer' },
            get_token: 'https://github.com/settings/tokens', local: { command: ['gh', 'auth', 'token'] }, verified: false,
            methods: ['reuse', 'token'], domains: ['github.com'] };
        serve(answer('/api/accounts/custom/reuse', account(github, { signed_in: true, source: 'local', scope: 'user', secret_hint: '…1234' })));
        const id = show(formOf(github, [], { reason: 'unauthorized' }));
        expect(await screen.findByText('gh auth token')).toBeVisible();
        expect(document.querySelector('[data-signin-destination]')).toHaveTextContent('Your key is sent only to api.github.com');
        expect(vi.mocked(apiRequest).mock.calls.some(([url]) => url === '/api/accounts/custom/reuse')).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'Use the login on this computer' }));
        await waitFor(() => expect(resumed).toEqual([[id, 'Signed in to GitHub. Continue.']]));
        const [, options] = vi.mocked(apiRequest).mock.calls.find(([url]) => url === '/api/accounts/custom/reuse')!;
        expect(JSON.parse(String(options?.body))).toMatchObject({ spec: { id: 'github', local: { command: ['gh', 'auth', 'token'] } } });
    });

    it('shows how an answered request ended', () => {
        serve(answer('/api/accounts/huggingface', hfIn));
        show(formOf(HF, [], { status: 'signed_in', login: 'ada' }));
        expect(screen.getByText('Signed in as @ada')).toBeVisible();
        show(formOf(HF, [], { status: 'declined' }));
        expect(screen.getByText('Continued without signing in')).toBeVisible();
        show(formOf(HF, [], { status: 'replied' }));
        expect(screen.getByText('Not signed in · replied in chat')).toBeVisible();
        expect(screen.queryByText('Answered')).toBeNull();
    });
});
