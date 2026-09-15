import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelSelectionButton, parseAzureTargetUri } from '../../../../src/views/ModelSelectionDialog';
import { dataFormulatorReducer, dfActions, ModelConfig } from '../../../../src/app/dfSlice';
import { apiRequest, ApiRequestError } from '../../../../src/app/apiClient';
import modelStrings from '../../../../src/i18n/locales/en/model.json';
import commonStrings from '../../../../src/i18n/locales/en/common.json';
import { buildDistillModelConfig } from '../../../../src/views/workflowContext';

vi.mock('react-i18next', async importOriginal => ({
    ...await importOriginal<object>(),
    useTranslation: () => ({
        t: (key: string) => key.startsWith('model.')
            ? modelStrings.model[key.slice(6) as keyof typeof modelStrings.model] || key
            : key === 'app.copy' ? commonStrings.app.copy : key,
    }),
}));

vi.mock('../../../../src/app/apiClient', async importOriginal => ({
    ...await importOriginal<object>(),
    apiRequest: vi.fn(),
}));

vi.mock('../../../../src/views/LogViewerDialog', () => ({ LogViewerDialog: () => null }));

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('Model connection form', () => {
    beforeEach(() => {
        vi.spyOn(window, 'focus').mockImplementation(() => undefined);
        vi.mocked(apiRequest).mockReset();
        vi.mocked(apiRequest).mockImplementation(async url => ({
            data: url === '/api/local/azure-status'
                ? { installed: true, signed_in: true, account: { user: 'test-account' } }
                : [],
        }) as any);
    });

    const openForm = (model?: ModelConfig) => {
        const initial = dataFormulatorReducer(undefined, { type: 'test/init' });
        const store = configureStore({
            reducer: dataFormulatorReducer,
            preloadedState: { ...initial, models: model && !model.is_global ? [model] : [],
                globalModels: model?.is_global ? [model] : [], selectedModelId: model?.id,
                serverConfig: { ...initial.serverConfig, IS_LOCAL_MODE: true } },
        });
        render(<Provider store={store}><ModelSelectionButton /></Provider>);
        fireEvent.click(screen.getByRole('button', { name: 'Select a model' }));
        return store;
    };

    const chooseProvider = async (label: string) => {
        fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Provider' }));
        fireEvent.click(await screen.findByRole('option', { name: label, exact: true }));
    };

    const mockOpenRouter = (connected = false, complete = true) => {
        const base = '/api/model-endpoints/connections/openrouter';
        let activeFlow = false;
        vi.mocked(apiRequest).mockImplementation(async (url) => {
            if (url === `${base}/start`) {
                activeFlow = true;
                return { data: { flow_id: 'test-flow', authorization_url: 'https://openrouter.ai/auth?test-flow', expires_in: 600 } };
            }
            if (url === base) {
                if (activeFlow && complete) connected = true;
                return { data: { id: 'openrouter', connected, flow: activeFlow
                    ? { id: 'test-flow', status: complete ? 'connected' : 'pending' } : null } };
            }
            if (url === `${base}/cancel`) activeFlow = false;
            if (url === `${base}/disconnect`) connected = false;
            if (url === `${base}/models`) return { data: {
                models: [{ id: 'openai/test-model', name: 'Test Model' }],
                connection: { creator_user_id: 'user_test_creator', settings_url: 'https://openrouter.ai/keys/test-hash' },
            } };
            return { data: [] };
        });
        return base;
    };

    it('groups providers by Sign in and API and skips headings during keyboard navigation', async () => {
        openForm();
        fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Provider' }));
        const listbox = await screen.findByRole('listbox');
        expect(Array.from(listbox.children).map(child => child.textContent)).toEqual([
            'Sign in', 'OpenRouter', 'GitHub Copilot', 'ChatGPT', 'API', 'OpenAI', 'Azure', 'Anthropic', 'Google Gemini', 'Ollama', 'OrcaRouter',
        ]);
        expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual([
            'OpenRouter', 'GitHub Copilot', 'ChatGPT', 'OpenAI', 'Azure', 'Anthropic', 'Google Gemini', 'Ollama', 'OrcaRouter',
        ]);
        const openRouter = screen.getByRole('option', { name: 'OpenRouter' });
        act(() => openRouter.focus());
        fireEvent.keyDown(openRouter, { key: 'ArrowDown' });
        const copilot = screen.getByRole('option', { name: 'GitHub Copilot' });
        expect(copilot).toHaveFocus();
        fireEvent.keyDown(copilot, { key: 'ArrowDown' });
        const chatgpt = screen.getByRole('option', { name: 'ChatGPT' });
        expect(chatgpt).toHaveFocus();
        fireEvent.keyDown(chatgpt, { key: 'ArrowDown' });
        expect(screen.getByRole('option', { name: 'OpenAI' })).toHaveFocus();
        fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
        expect(chatgpt).toHaveFocus();
        fireEvent.click(screen.getByRole('option', { name: 'OpenAI' }));
        expect(screen.getByLabelText('API Key')).toBeVisible();
    });

    const mockCopilot = (connected = false, complete = true, provider = 'github_copilot') => {
        const base = `/api/model-endpoints/connections/${provider}`;
        vi.mocked(apiRequest).mockImplementation(async url => {
            if (url === base + '/start') return { data: { flow_id: 'copilot-flow', user_code: 'ABCD-1234',
                authorization_url: provider === 'chatgpt' ? 'https://auth.openai.com/codex/device' : 'https://github.com/login/device', interval: 5, expires_in: 900 } };
            if (url === base + '/poll') {
                if (complete) connected = true;
                return { data: { id: provider, flow: { id: 'copilot-flow', status: complete ? 'connected' : 'pending' } } };
            }
            if (url === base + '/disconnect') connected = false;
            if (url === base) return { data: { id: provider, connected, flow: null } };
            if (url === base + '/models') return { data: { models: [{ id: 'gpt-4.1', name: 'GPT 4.1' }],
                connection: { login: 'test-user', settings_url: provider === 'chatgpt' ? 'https://chatgpt.com/#settings' : 'https://github.com/settings/copilot' } } };
            return { data: [] };
        });
        return base;
    };

    it.each(['github_copilot', 'chatgpt'])('connects %s and saves a secret-free account reference for the agent harness', async provider => {
        const isChatGPT = provider === 'chatgpt';
        const base = mockCopilot(false, true, provider);
        vi.spyOn(window, 'open').mockReturnValue(null);
        const store = openForm();
        await chooseProvider(isChatGPT ? 'ChatGPT' : 'GitHub Copilot');
        const connect = screen.getByRole('button', { name: isChatGPT ? 'Sign in with ChatGPT' : 'Connect GitHub Copilot' });
        await waitFor(() => expect(connect).toBeEnabled());
        expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument();
        fireEvent.click(connect);
        const picker = await screen.findByRole('combobox', { name: /^Model/ });
        await waitFor(() => expect(picker).toBeEnabled());
        if (!isChatGPT) expect(await screen.findByText('@test-user')).toBeVisible();
        fireEvent.change(picker, { target: { value: 'GPT' } });
        fireEvent.click(await screen.findByRole('option', { name: /GPT 4.1/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Test and save' }));
        await waitFor(() => expect(store.getState().models).toHaveLength(1));
        const saved = store.getState().models[0];
        expect(saved).toMatchObject({ endpoint: provider, connection_id: provider, auth_mode: 'account', model: 'gpt-4.1' });
        const payload = JSON.parse(JSON.stringify(buildDistillModelConfig(saved)));
        expect(payload.connection_id).toBe(provider);
        expect(payload).not.toHaveProperty('api_key');
        expect(payload).not.toHaveProperty('api_base');
        expect(screen.getByRole('link', { name: isChatGPT ? 'Manage on ChatGPT' : 'Manage on GitHub' })).toHaveAttribute('href',
            isChatGPT ? 'https://chatgpt.com/#settings' : 'https://github.com/settings/copilot');
        expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
        fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
        expect(screen.getByText(isChatGPT ? 'Disconnect ChatGPT?' : 'Disconnect GitHub Copilot?')).toBeVisible();
        fireEvent.click(screen.getAllByRole('button', { name: 'Disconnect' }).at(-1)!);
        await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(base + '/disconnect', expect.anything()));
        expect(store.getState().models).toHaveLength(1);
    });

    it('displays and copies the Copilot device code and cancels the right provider when switching', async () => {
        const base = mockCopilot(false, false);
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
        vi.spyOn(window, 'open').mockReturnValue(null);
        openForm();
        await chooseProvider('GitHub Copilot');
        const connect = screen.getByRole('button', { name: 'Connect GitHub Copilot' });
        await waitFor(() => expect(connect).toBeEnabled());
        fireEvent.click(connect);
        expect(await screen.findByLabelText('Device code')).toHaveTextContent('ABCD-1234');
        expect(screen.getByRole('link', { name: 'Open GitHub' })).toHaveAttribute('href', 'https://github.com/login/device');
        fireEvent.click(screen.getByRole('button', { name: 'Copy device code' }));
        expect(writeText).toHaveBeenCalledWith('ABCD-1234');
        expect(screen.getByRole('button', { name: 'Test and save' })).toBeDisabled();
        await chooseProvider('OpenRouter');
        expect(apiRequest).toHaveBeenCalledWith(base + '/cancel', expect.objectContaining({ body: JSON.stringify({ flow_id: 'copilot-flow' }) }));
        expect(screen.queryByLabelText('Device code')).not.toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Manage on GitHub' })).not.toBeInTheDocument();
    });

    it('cancels a late Copilot authorization start without touching the new provider', async () => {
        const base = mockCopilot(false, false);
        const original = vi.mocked(apiRequest).getMockImplementation()!;
        let finishStart!: (value: any) => void;
        vi.mocked(apiRequest).mockImplementation((url, options) => url === base + '/start'
            ? new Promise(resolve => { finishStart = resolve; }) : original(url, options));
        vi.spyOn(window, 'open').mockReturnValue(null);
        openForm();
        await chooseProvider('GitHub Copilot');
        const connect = screen.getByRole('button', { name: 'Connect GitHub Copilot' });
        await waitFor(() => expect(connect).toBeEnabled());
        fireEvent.click(connect);
        await chooseProvider('OpenAI');
        await act(async () => finishStart({ data: { flow_id: 'late-copilot', user_code: 'ABCD-1234', authorization_url: 'https://github.com/login/device' } }));
        expect(apiRequest).toHaveBeenCalledWith(base + '/cancel', expect.objectContaining({ body: JSON.stringify({ flow_id: 'late-copilot' }) }));
        expect(screen.queryByLabelText('Device code')).not.toBeInTheDocument();
        expect(screen.getByLabelText('API Key')).toBeVisible();
    });

    it('connects OpenRouter and saves only a shared connection reference', async () => {
        const base = mockOpenRouter();
        const popup = { opener: window, location: { href: '' }, close: vi.fn() };
        vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
        const store = openForm();
        await chooseProvider('OpenRouter');
        const connect = screen.getByRole('button', { name: 'Connect OpenRouter' });
        await waitFor(() => expect(connect).toBeEnabled());
        expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument();
        expect(screen.queryByRole('textbox', { name: 'Base URL' })).not.toBeInTheDocument();
        fireEvent.click(connect);
        const model = await screen.findByRole('combobox', { name: /^Model/ });
        await waitFor(() => expect(model).toBeEnabled());
        expect(popup.location.href).toBe('https://openrouter.ai/auth?test-flow');
        expect(popup.opener).toBeNull();
        expect(popup.close).toHaveBeenCalled();
        expect(window.focus).toHaveBeenCalled();
        fireEvent.change(model, { target: { value: 'Test' } });
        fireEvent.click(await screen.findByRole('option', { name: /Test Model/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Test and save' }));
        await waitFor(() => expect(store.getState().models).toHaveLength(1));
        const saved = store.getState().models[0];
        expect(saved).toMatchObject({ endpoint: 'openrouter', model: 'openai/test-model', connection_id: 'openrouter', auth_mode: 'account' });
        const payload = JSON.parse(JSON.stringify(buildDistillModelConfig(saved)));
        expect(payload.connection_id).toBe('openrouter');
        expect(payload).not.toHaveProperty('api_key');
        expect(payload).not.toHaveProperty('api_base');
        const calls = vi.mocked(apiRequest).mock.calls;
        expect(calls.some(([url, options]) => url.includes('test-model') && JSON.parse(options!.body as string).model.connection_id === 'openrouter')).toBe(true);
        expect(calls.some(([url]) => url === base + '/disconnect')).toBe(false);
    });

    it('offers an authorization link for blocked popups and cancels without disconnecting', async () => {
        const base = mockOpenRouter(false, false);
        vi.spyOn(window, 'open').mockReturnValue(null);
        openForm();
        await chooseProvider('OpenRouter');
        const connect = screen.getByRole('button', { name: 'Connect OpenRouter' });
        await waitFor(() => expect(connect).toBeEnabled());
        fireEvent.click(connect);
        expect(await screen.findByRole('link', { name: 'Open OpenRouter' })).toHaveAttribute('href', 'https://openrouter.ai/auth?test-flow');
        expect(screen.getByRole('button', { name: 'Test and save' })).toBeDisabled();
        fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0]);
        await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(base + '/cancel', expect.objectContaining({
            body: JSON.stringify({ flow_id: 'test-flow' }),
        })));
        expect(screen.queryByText('Waiting for authorization...')).not.toBeInTheDocument();
        expect(vi.mocked(apiRequest).mock.calls.some(([url]) => url === base + '/disconnect')).toBe(false);
    });

    it('resumes authorization in the existing popup after signup', async () => {
        const base = mockOpenRouter(false, false);
        const popup = { opener: window, closed: false, location: { href: '' }, close: vi.fn(), focus: vi.fn() };
        const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
        openForm();
        await chooseProvider('OpenRouter');
        const connect = screen.getByRole('button', { name: 'Connect OpenRouter' });
        await waitFor(() => expect(connect).toBeEnabled());
        fireEvent.click(connect);
        const resume = await screen.findByRole('link', { name: 'Open OpenRouter' });
        popup.location.href = 'https://openrouter.ai/workspaces/default';
        fireEvent.click(resume);
        expect(popup.location.href).toBe('https://openrouter.ai/auth?test-flow');
        expect(popup.focus).toHaveBeenCalled();
        expect(open).toHaveBeenCalledTimes(1);
        expect(vi.mocked(apiRequest).mock.calls.filter(([url]) => url === base + '/start')).toHaveLength(1);
    });

    it('tracks a replacement popup when the initial window was closed', async () => {
        mockOpenRouter(false, false);
        const initial = { opener: window, closed: false, location: { href: '' }, close: vi.fn() };
        const replacement = { opener: window, close: vi.fn() };
        vi.spyOn(window, 'open').mockReturnValueOnce(initial as unknown as Window)
            .mockReturnValueOnce(replacement as unknown as Window);
        openForm();
        await chooseProvider('OpenRouter');
        const connect = screen.getByRole('button', { name: 'Connect OpenRouter' });
        await waitFor(() => expect(connect).toBeEnabled());
        fireEvent.click(connect);
        const resume = await screen.findByRole('link', { name: 'Open OpenRouter' });
        initial.closed = true;
        fireEvent.click(resume);
        expect(replacement.opener).toBeNull();
        fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0]);
        expect(replacement.close).toHaveBeenCalled();
    });

    it('verifies callback notifications with the backend before completing authorization', async () => {
        const base = mockOpenRouter(false, false);
        const original = vi.mocked(apiRequest).getMockImplementation()!;
        let completed = false;
        vi.mocked(apiRequest).mockImplementation((url, options) => completed && url === base
            ? Promise.resolve({ data: { id: 'openrouter', connected: true, flow: { id: 'test-flow', status: 'connected' } } })
            : original(url, options));
        let channel!: { onmessage: (() => void) | null; close: ReturnType<typeof vi.fn> };
        vi.stubGlobal('BroadcastChannel', class {
            onmessage = null;
            close = vi.fn();
            constructor(public name: string) {
                expect(name).toBe('df-model-auth:test-flow');
                channel = this;
            }
        });
        vi.spyOn(window, 'open').mockReturnValue(null);
        openForm();
        await chooseProvider('OpenRouter');
        const connect = screen.getByRole('button', { name: 'Connect OpenRouter' });
        await waitFor(() => expect(connect).toBeEnabled());
        fireEvent.click(connect);
        await screen.findByRole('link', { name: 'Open OpenRouter' });
        await act(async () => { channel.onmessage?.(); });
        expect(screen.getByText('Waiting for authorization...')).toBeVisible();
        completed = true;
        await act(async () => { channel.onmessage?.(); });
        expect(await screen.findByText('Connected')).toBeVisible();
        expect(channel.close).toHaveBeenCalled();
        expect(window.focus).toHaveBeenCalled();
    });

    it('checks authorization immediately when the application regains focus', async () => {
        const base = mockOpenRouter(false, false);
        vi.spyOn(window, 'open').mockReturnValue(null);
        openForm();
        await chooseProvider('OpenRouter');
        const connect = screen.getByRole('button', { name: 'Connect OpenRouter' });
        await waitFor(() => expect(connect).toBeEnabled());
        fireEvent.click(connect);
        await screen.findByRole('link', { name: 'Open OpenRouter' });
        await act(async () => undefined);
        const before = vi.mocked(apiRequest).mock.calls.filter(([url]) => url === base).length;
        await act(async () => { fireEvent.focus(window); });
        expect(vi.mocked(apiRequest).mock.calls.filter(([url]) => url === base)).toHaveLength(before + 1);
    });

    it('cancels a late authorization start after switching provider', async () => {
        const base = mockOpenRouter(false, false);
        const original = vi.mocked(apiRequest).getMockImplementation()!;
        let finishStart!: (value: any) => void;
        vi.mocked(apiRequest).mockImplementation((url, options) => url === base + '/start'
            ? new Promise(resolve => { finishStart = resolve; }) : original(url, options));
        vi.spyOn(window, 'open').mockReturnValue(null);
        openForm();
        await chooseProvider('OpenRouter');
        const connect = screen.getByRole('button', { name: 'Connect OpenRouter' });
        await waitFor(() => expect(connect).toBeEnabled());
        fireEvent.click(connect);
        await chooseProvider('OpenAI');
        await act(async () => finishStart({ data: { flow_id: 'late-flow', authorization_url: 'https://openrouter.ai/auth' } }));
        expect(apiRequest).toHaveBeenCalledWith(base + '/cancel', expect.objectContaining({ body: JSON.stringify({ flow_id: 'late-flow' }) }));
        expect(screen.queryByRole('link', { name: 'Open OpenRouter' })).not.toBeInTheDocument();
        expect(screen.getByLabelText('API Key')).toBeVisible();
    });

    it('retains the account when a model is removed and prevents duplicate copies', async () => {
        const base = mockOpenRouter(true);
        const store = openForm({ id: 'account-model', endpoint: 'openrouter', model: 'openai/test-model',
            connection_id: 'openrouter', auth_mode: 'account' });
        await screen.findByText('Connected');
        fireEvent.click(screen.getByRole('button', { name: 'Copy details' }));
        expect(screen.getByRole('button', { name: 'Test and save' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Remove Model' }));
        expect(store.getState().models).toHaveLength(0);
        expect(vi.mocked(apiRequest).mock.calls.some(([url]) => url === base + '/disconnect')).toBe(false);
    });

    it('confirms disconnect and retains model configurations with reset test status', async () => {
        const base = mockOpenRouter(true);
        const store = openForm({ id: 'account-model', endpoint: 'openrouter', model: 'openai/test-model',
            connection_id: 'openrouter', auth_mode: 'account' });
        await screen.findByText('Connected');
        act(() => store.dispatch(dfActions.updateModelStatus({ id: 'account-model', status: 'ok', message: '' })));
        expect(screen.getByRole('link', { name: 'Manage on OpenRouter' })).toBeVisible();
        expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
        expect(screen.getByRole('button', { name: 'Disconnect' })).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
        fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
        expect(screen.getByText('Disconnect OpenRouter?')).toBeVisible();
        fireEvent.click(screen.getAllByRole('button', { name: 'Disconnect' }).at(-1)!);
        await waitFor(() => expect(apiRequest).toHaveBeenCalledWith(base + '/disconnect', expect.anything()));
        await waitFor(() => expect(screen.queryByText('Connected')).not.toBeInTheDocument());
        expect(store.getState().models).toHaveLength(1);
        expect(store.getState().testedModels.find(model => model.id === 'account-model')?.status).toBe('unknown');
    });

    it('shows discovery failure with retry and never enables an unverified selection', async () => {
        const base = mockOpenRouter(true);
        const original = vi.mocked(apiRequest).getMockImplementation()!;
        vi.mocked(apiRequest).mockImplementation((url, options) => url === base + '/models'
            ? Promise.reject(new Error('Discovery unavailable')) : original(url, options));
        openForm();
        await chooseProvider('OpenRouter');
        expect(await screen.findByRole('alert')).toHaveTextContent('Discovery unavailable');
        expect(screen.queryByText('Connected')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
        expect(screen.queryByRole('button', { name: 'Reconnect' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Test and save' })).toBeDisabled();
    });

    it('shows two inline account actions beside the status and keeps model refresh separate', async () => {
        const base = mockOpenRouter(true, false);
        openForm();
        await chooseProvider('OpenRouter');
        await screen.findByText('Connected');
        expect(screen.queryByText(/user_test_creator/)).not.toBeInTheDocument();
        expect(screen.getByText('Connected').parentElement?.querySelector('svg')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Reconnect' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Authorize again...' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Connection actions' })).not.toBeInTheDocument();
        const manage = screen.getByRole('link', { name: 'Manage on OpenRouter' });
        const disconnect = screen.getByRole('button', { name: 'Disconnect' });
        const actions = screen.getByRole('group', { name: 'Connection actions' });
        expect(actions).toContainElement(manage);
        expect(actions).toContainElement(disconnect);
        expect(actions).not.toContainElement(screen.getByText('Connected'));
        expect(manage).toHaveTextContent('Manage');
        expect(disconnect).toHaveTextContent('Disconnect');
        expect(disconnect.querySelector('[data-testid="LinkOffIcon"]')).not.toBeNull();
        expect(manage).toHaveAttribute('href', 'https://openrouter.ai/keys/test-hash');
        expect(manage).toHaveAttribute('target', '_blank');
        expect(manage).toHaveAttribute('rel', 'noopener noreferrer');
        expect(disconnect).toBeEnabled();
        const connectionRow = screen.getByText('Connected').parentElement?.parentElement?.parentElement;
        expect(connectionRow).toContainElement(manage);
        expect(connectionRow).toContainElement(disconnect);
        const refresh = screen.getByRole('button', { name: 'Refresh models' });
        expect(connectionRow).not.toContainElement(refresh);
        expect(refresh.parentElement?.parentElement).toContainElement(screen.getByRole('combobox', { name: /^Model/ }));
        fireEvent.click(refresh);
        await screen.findByText('Connected');
        expect(vi.mocked(apiRequest).mock.calls.filter(([url]) => url === base + '/models')).toHaveLength(2);
        expect(vi.mocked(apiRequest).mock.calls.some(([url]) => url === base + '/start')).toBe(false);
    });

    it('offers reconnect only for an authorization failure', async () => {
        const base = mockOpenRouter(true, false);
        const original = vi.mocked(apiRequest).getMockImplementation()!;
        vi.mocked(apiRequest).mockImplementation((url, options) => url === base + '/models'
            ? Promise.reject(new ApiRequestError({ code: 'AUTH_EXPIRED', message: 'Connect again.' }, 401)) : original(url, options));
        openForm();
        await chooseProvider('OpenRouter');
        expect(await screen.findByText('Authorization expired')).toBeVisible();
        expect(screen.getByRole('button', { name: 'Reconnect' })).toBeEnabled();
        expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: /^Model/ })).toBeDisabled();
        vi.spyOn(window, 'open').mockReturnValue(null);
        fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
        expect(await screen.findByRole('link', { name: 'Open OpenRouter' })).toBeVisible();
    });

    it('shows server-managed details without disabled form controls and preserves copying', async () => {
        openForm({ id: 'managed', endpoint: 'azure', model: 'team-assistant',
            api_base: 'https://resource.example', api_version: '2025-04-01-preview',
            api_key: '', auth_mode: 'azure_identity', is_global: true });
        expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
        expect(screen.queryByRole('group', { name: 'Authentication' })).not.toBeInTheDocument();
        expect(screen.getByText('https://resource.example')).toBeVisible();
        expect(screen.getByText('2025-04-01-preview')).toBeVisible();
        expect(screen.getByRole('button', { name: 'Test model' })).toBeEnabled();
        fireEvent.click(screen.getByRole('button', { name: 'Copy details' }));
        expect(screen.getByRole('textbox', { name: /Endpoint URL/ })).toBeEnabled();
        expect(screen.getByRole('textbox', { name: /Model deployment/ })).toHaveValue('team-assistant');
    });

    it('never renders a saved key in details and preserves editing and cancel', async () => {
        openForm({ id: 'personal', endpoint: 'openai', model: 'my-model',
            api_key: 'saved-secret', api_base: '', api_version: '' });
        expect(screen.queryByDisplayValue('saved-secret')).not.toBeInTheDocument();
        expect(screen.getByText('API Key')).toBeVisible();
        expect(screen.getByText('https://api.openai.com/v1')).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
        expect(screen.getByLabelText('API Key')).toHaveValue('saved-secret');
        expect(screen.getByLabelText('API Key')).toHaveAttribute('type', 'password');
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
        expect(screen.queryByDisplayValue('saved-secret')).not.toBeInTheDocument();
    });

    it('starts with just the provider selection', () => {
        openForm();
        expect(screen.getByRole('combobox', { name: 'Provider' })).toBeVisible();
        expect(screen.queryByRole('textbox', { name: /^Model/ })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Test and save' })).toBeDisabled();
        expect(screen.queryByRole('button', { name: 'Use recent' })).not.toBeInTheDocument();
    });

    it.each([
        ['OpenAI', 'gpt-5.6-terra'],
        ['Anthropic', 'claude-sonnet-5'],
        ['Google Gemini', 'gemini-3.8-flash'],
        ['Azure', 'team-assistant'],
        ['Ollama', 'qwen3.8:27b'],
        ['OrcaRouter', 'auto'],
    ])('%s shows a provider-specific example without selecting a model', async (provider, example) => {
        openForm();
        await chooseProvider(provider);
        const model = screen.getByRole('textbox', { name: /^Model/ });
        expect(model).toHaveAttribute('placeholder', example);
        expect(model).toHaveValue('');
        expect(screen.getByRole('button', { name: 'Test and save' })).toBeDisabled();
    });

    it('offers recent configurations as a separate menu that prefills the new model form', async () => {
        vi.mocked(apiRequest).mockResolvedValue({ data: [{ endpoint: 'azure', model: 'recent-deployment',
            api_base: 'https://recent.example', api_version: '2025-04-01-preview', auth_mode: 'key' }] } as any);
        openForm();
        const recent = await screen.findByRole('button', { name: 'Use recent' });
        expect(screen.getAllByRole('combobox')).toHaveLength(1);
        expect(screen.getByRole('combobox', { name: 'Provider' })).toBeVisible();
        fireEvent.click(recent);
        fireEvent.click(screen.getByRole('menuitem', { name: /Azure \/ recent-deployment/ }));
        expect(screen.getByRole('textbox', { name: /Model deployment/ })).toHaveValue('recent-deployment');
        expect(screen.getByRole('textbox', { name: /Endpoint URL/ })).toHaveValue('https://recent.example');
        expect(screen.getByRole('textbox', { name: 'API Version' })).toHaveValue('2025-04-01-preview');
        expect(screen.getByLabelText('API Key', { selector: 'input' })).toHaveValue('');
        expect(screen.getByRole('button', { name: 'Test and save' })).toBeDisabled();
        expect(recent).toHaveAttribute('aria-expanded', 'false');
    });

    it('does not offer recent configurations when editing an existing model', async () => {
        vi.mocked(apiRequest).mockResolvedValue({ data: [{ endpoint: 'openai', model: 'recent-model',
            api_base: '', api_version: '', auth_mode: 'key' }] } as any);
        openForm({ id: 'existing', endpoint: 'openai', model: 'existing-model', api_key: 'key', api_base: '', api_version: '' });
        await waitFor(() => expect(apiRequest).toHaveBeenCalled());
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
        expect(screen.queryByRole('button', { name: 'Use recent' })).not.toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: /^Model/ })).toHaveValue('existing-model');
        fireEvent.click(screen.getByRole('button', { name: 'Add Model' }));
        expect(await screen.findByRole('button', { name: 'Use recent' })).toBeVisible();
    });

    it('copies a personal model without modifying the original', async () => {
        const original: ModelConfig = { id: 'original', endpoint: 'openai', model: 'original-model',
            api_key: 'saved-secret', api_base: 'https://custom.example/v1', api_version: '' };
        const store = openForm(original);
        const edit = screen.getByRole('button', { name: 'Edit' });
        const copy = screen.getByRole('button', { name: 'Copy details' });
        expect(edit).toBeVisible();
        expect(copy).toHaveTextContent(/^Copy$/);
        expect(edit.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(edit.parentElement).toBe(copy.parentElement);
        expect(edit.parentElement?.querySelector('.MuiDivider-vertical')).not.toBeNull();
        fireEvent.click(copy);
        expect(screen.getByRole('textbox', { name: /^Model/ })).toHaveValue('original-model');
        expect(screen.getByLabelText('Base URL')).toHaveValue(original.api_base);
        expect(screen.getByLabelText('API Key')).toHaveValue('saved-secret');
        expect(screen.getByLabelText('API Key')).toHaveAttribute('type', 'password');
        expect(screen.getByRole('button', { name: 'Test and save' })).toBeDisabled();
        fireEvent.change(screen.getByRole('textbox', { name: /^Model/ }), { target: { value: 'copied-model' } });
        fireEvent.click(screen.getByRole('button', { name: 'Test and save' }));
        await waitFor(() => expect(store.getState().models).toHaveLength(2));
        expect(store.getState().models.find(model => model.id === original.id)).toEqual(original);
        expect(store.getState().models.find(model => model.id !== original.id))
            .toMatchObject({ model: 'copied-model', endpoint: original.endpoint, api_base: original.api_base });
    });

    it('uses icons for untested, pending and passed states, and a labeled retry for failure', async () => {
        const model: ModelConfig = { id: 'status-model', endpoint: 'openai', model: 'my-model',
            api_key: 'test-key', api_base: '', api_version: '' };
        const store = openForm(model);
        const setStatus = (status: 'ok' | 'error' | 'testing') => act(() => {
            store.dispatch(dfActions.updateModelStatus({ id: model.id, status, message: '' }));
        });

        expect(screen.getByRole('button', { name: 'Test model' })).toHaveTextContent('');
        expect(screen.queryByText('Test model')).not.toBeInTheDocument();

        setStatus('testing');
        expect(screen.getByRole('button', { name: 'Testing…' })).toBeDisabled();
        expect(screen.getByRole('progressbar')).toBeInTheDocument();

        setStatus('ok');
        const passed = screen.getByRole('button', { name: 'Test passed' });
        expect(passed).toHaveClass('MuiIconButton-colorSuccess');
        expect(passed.querySelector('[data-testid="CheckCircleOutlineIcon"]')).not.toBeNull();
        expect(screen.queryByText('Test passed')).not.toBeInTheDocument();

        setStatus('error');
        const retry = screen.getByRole('button', { name: 'Test failed, retry' });
        expect(retry).toHaveTextContent('Test');
        expect(retry.querySelector('[data-testid="PlayCircleOutlineIcon"]')).not.toBeNull();
        fireEvent.click(retry);
        expect(screen.getByRole('button', { name: 'Testing…' })).toBeDisabled();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Test passed' })).toBeEnabled());
    });

    it('orders Azure endpoint before deployment and parses a pasted Target URI', async () => {
        openForm();
        await chooseProvider('Azure');
        const endpoint = screen.getByRole('textbox', { name: /Endpoint URL/ });
        const deployment = screen.getByRole('textbox', { name: /Model deployment/ });
        expect(endpoint.compareDocumentPosition(deployment) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        fireEvent.paste(endpoint, { clipboardData: { getData: () =>
            'https://resource.openai.azure.com/openai/deployments/team-assistant/chat/completions?api-version=2025-04-01-preview',
        } });
        expect(endpoint).toHaveValue('https://resource.openai.azure.com');
        expect(deployment).toHaveValue('team-assistant');
        expect(screen.getByRole('textbox', { name: 'API Version' })).toHaveValue('2025-04-01-preview');
        expect(screen.getByRole('button', { name: 'Test and save' })).toBeEnabled();
    });

    it('requires both endpoint and key in Azure API-key mode', async () => {
        openForm();
        await chooseProvider('Azure');
        fireEvent.click(screen.getByRole('button', { name: 'API Key' }));
        fireEvent.change(screen.getByRole('textbox', { name: /Model deployment/ }), { target: { value: 'deployment' } });
        fireEvent.change(screen.getByLabelText('API Key', { selector: 'input' }), { target: { value: 'test-secret' } });
        expect(screen.getByRole('button', { name: 'Test and save' })).toBeDisabled();
        fireEvent.change(screen.getByRole('textbox', { name: /Endpoint URL/ }), { target: { value: 'https://resource.example' } });
        expect(screen.getByRole('button', { name: 'Test and save' })).toBeEnabled();
        fireEvent.change(screen.getByLabelText('API Key', { selector: 'input' }), { target: { value: '' } });
        expect(screen.getByRole('button', { name: 'Test and save' })).toBeDisabled();
    });

    it('allows Ollama with only a model and keeps its optional key under Advanced', async () => {
        const store = openForm();
        await chooseProvider('Ollama');
        expect(screen.getByRole('textbox', { name: 'Base URL' })).toHaveAttribute('placeholder', 'http://localhost:11434');
        expect(screen.getByLabelText('API key (optional)')).not.toBeVisible();
        fireEvent.change(screen.getByRole('textbox', { name: /^Model/ }), { target: { value: 'llama3.2' } });
        fireEvent.click(screen.getByRole('button', { name: 'Test and save' }));
        await waitFor(() => expect(store.getState().models).toHaveLength(1));
        expect(store.getState().models[0]).toMatchObject({ endpoint: 'ollama', model: 'llama3.2', api_key: '', api_base: '' });
    });

    it.each(['OpenAI', 'Anthropic', 'Google Gemini', 'OrcaRouter'])('%s keeps optional URL overrides under Advanced', async provider => {
        openForm();
        await chooseProvider(provider);
        expect(screen.getByLabelText('Base URL')).not.toBeVisible();
        expect(screen.getByLabelText('API Key')).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: 'Advanced settings' }));
        expect(await screen.findByRole('textbox', { name: 'Base URL' })).toBeVisible();
    });

    it('clears credentials and incompatible values when switching providers', async () => {
        openForm();
        await chooseProvider('OpenAI');
        fireEvent.change(screen.getByRole('textbox', { name: /^Model/ }), { target: { value: 'previous-model' } });
        fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'test-secret' } });
        fireEvent.click(screen.getByRole('button', { name: 'Show API keys' }));
        fireEvent.click(screen.getByRole('button', { name: 'Advanced settings' }));
        fireEvent.change(screen.getByRole('textbox', { name: 'Base URL' }), { target: { value: 'https://previous.example' } });
        await chooseProvider('Anthropic');
        expect(screen.getByRole('textbox', { name: /^Model/ })).toHaveValue('');
        expect(screen.getByLabelText('API Key')).toHaveValue('');
        expect(screen.getByLabelText('API Key')).toHaveAttribute('type', 'password');
        expect(screen.getByLabelText('Base URL')).toHaveValue('');
        await waitFor(() => expect(screen.getByLabelText('Base URL')).not.toBeVisible());
    });
});

describe('Model connection Target URI', () => {
    it('extracts the endpoint, deployment and API version', () => {
        expect(parseAzureTargetUri(
            ' https://resource.openai.azure.com/openai/deployments/team-assistant/chat/completions?api-version=2025-04-01-preview ',
        )).toEqual({
            apiBase: 'https://resource.openai.azure.com',
            model: 'team-assistant',
            apiVersion: '2025-04-01-preview',
        });
    });

    it('supports missing versions and encoded deployment names', () => {
        expect(parseAzureTargetUri('https://resource.example/openai/deployments/team%20model/responses'))
            .toEqual({ apiBase: 'https://resource.example', model: 'team model', apiVersion: null });
    });

    it.each([
        'https://resource.openai.azure.com',
        'https://resource.openai.azure.com/openai/v1/',
        'https://resource.example/custom/deployments/model/chat/completions',
        'https://user:secret@resource.example/openai/deployments/model/chat/completions',
        'https://resource.example/openai/deployments/%zz/chat/completions',
        'not a URL',
    ])('leaves other inputs untouched: %s', value => {
        expect(parseAzureTargetUri(value)).toBeNull();
    });
});