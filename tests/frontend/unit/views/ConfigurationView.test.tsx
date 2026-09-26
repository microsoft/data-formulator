import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConfigurationView } from '../../../../src/views/ConfigurationView';
import { apiRequest } from '../../../../src/app/apiClient';

vi.mock('../../../../src/app/apiClient', () => ({ apiRequest: vi.fn() }));
vi.mock('../../../../src/app/store', () => ({ store: { dispatch: vi.fn() } }));
vi.mock('../../../../src/app/dfSlice', () => ({ dfActions: { setServerConfig: vi.fn() }, fetchGlobalModelList: vi.fn() }));
vi.mock('react-router-dom', () => ({ useBlocker: () => ({ state: 'unblocked' }),
    Link: React.forwardRef<HTMLAnchorElement, React.ComponentProps<'a'> & { to: string }>(({ to, ...props }, ref) => <a ref={ref} href={to} {...props} />) }));
vi.mock('../../../../src/views/ModelSelectionDialog', () => ({ ModelSelectionButton: ({ initialDefinition, onStageConnection }: any) =>
    <button onClick={() => onStageConnection({ ...initialDefinition, model: 'updated-model' }).catch(() => undefined)}>Test model connection</button> }));
vi.mock('../../../../src/views/DBTableManager', () => ({ DataLoaderForm: ({ initialConnectionParams, onStageConnection, formFieldsBefore, loaderType }: any) =>
    <div data-testid="connector-form" data-loader-type={loaderType}>{formFieldsBefore}
        <button onClick={() => onStageConnection({ ...initialConnectionParams, host: 'updated-host' })}>Test data connection</button></div> }));
vi.mock('../../../../src/components/ScrollFade', () => ({
    ScrollFadeContainer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../../src/components/MarkdownEditor', () => ({
    MarkdownEditor: ({ value, onChange, readOnly, fileName }: { value: string; onChange: (value: string) => void; readOnly: boolean; fileName?: string }) =>
        <textarea aria-label={fileName === 'configuration.json' ? 'Configuration JSON' : 'Workflow YAML'} value={value} readOnly={readOnly} onChange={event => onChange(event.target.value)} />,
}));

const snapshot = { revision: 2, overrides: {}, catalogs: { models: [], workflows: [],
    connectors: [{ id: 'warehouse', display_name: 'Warehouse' }] },
    limits: { max_display_rows: { value: 50, locked: true, source: 'Environment' } } };
beforeEach(() => { vi.mocked(apiRequest).mockReset(); vi.mocked(apiRequest).mockResolvedValue({ data: snapshot }); });
afterEach(cleanup);

it('saves virtual table thresholds in rows and bytes and resets the draft', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: { ...snapshot, limits: {
        external_table_max_rows: { value: 1000000, default: 1000000, locked: false, source: 'Default' },
        external_table_max_bytes: { value: 512 * 1048576, default: 512 * 1048576, locked: false, source: 'Default' },
    } } });
    render(<ConfigurationView />);
    const rows = await screen.findByRole('spinbutton', { name: 'Virtual table threshold (rows)' });
    const size = screen.getByRole('spinbutton', { name: 'Virtual table threshold (MiB)' });
    expect(rows).toHaveValue(1000000);
    expect(size).toHaveValue(512);
    fireEvent.change(rows, { target: { value: '250000' } });
    fireEvent.change(size, { target: { value: '64' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset external_table_max_rows' }));
    expect(rows).toHaveValue(1000000);
    fireEvent.change(rows, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/configurations', expect.objectContaining({
        method: 'PUT', body: JSON.stringify({ revision: 2, overrides: { limits: {
            external_table_max_bytes: 64 * 1048576, external_table_max_rows: 0,
        } } }),
    })));
});

it('locks virtual table thresholds supplied by the environment', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: { ...snapshot,
        overrides: { limits: { external_table_max_rows: 200 } }, limits: {
            external_table_max_rows: { value: 50, default: 50, locked: true, source: 'Environment' },
        },
    } });
    render(<ConfigurationView />);
    const rows = await screen.findByRole('spinbutton', { name: 'Virtual table threshold (rows)' });
    expect(rows).toHaveValue(50);
    expect(rows).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reset external_table_max_rows' })).toBeDisabled();
});

it('saves the custom name and tagline through the administration draft', async () => {
    render(<ConfigurationView />);
    fireEvent.change(await screen.findByRole('textbox', { name: 'App name' }), { target: { value: 'Team Analytics' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Tagline' }), { target: { value: 'Explore our data.' } });
    const preview = screen.getByRole('figure', { name: 'Appearance preview' });
    expect(within(preview).getByText('Team Analytics')).toBeTruthy();
    expect(within(preview).getByText('Explore our data.')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'App name' })).toHaveAccessibleDescription('Customize the front page appearance.');
    expect(apiRequest).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/configurations', expect.objectContaining({
        method: 'PUT', body: JSON.stringify({ revision: 2, overrides: { app_name: 'Team Analytics', app_tagline: 'Explore our data.' } }),
    })));
});

it('shows default branding in the preview when appearance fields are cleared', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: { ...snapshot, overrides: { app_name: 'Team', app_tagline: 'Team data' } } });
    render(<ConfigurationView />);
    fireEvent.change(await screen.findByRole('textbox', { name: 'App name' }), { target: { value: '' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Tagline' }), { target: { value: '' } });
    const preview = screen.getByRole('figure', { name: 'Appearance preview' });
    expect(within(preview).getByText('Data Formulator')).toBeTruthy();
    expect(within(preview).getByText('Explore data with visualizations, powered by AI agents.')).toBeTruthy();
    expect(apiRequest).toHaveBeenCalledTimes(1);
});

it('switches to inline saved JSON without losing unsaved form changes', async () => {
    const definition = { endpoint: 'azure', model: 'deployment', api_base: 'https://example.openai.azure.com' };
    const saved = { ...snapshot, catalogs: { ...snapshot.catalogs, models: [{ id: 'global-example', ...definition, definition }] } };
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: saved });
    render(<ConfigurationView />);
    await screen.findByRole('tab', { name: 'JSON' });
    expect(screen.getByText(definition.api_base)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Disable user-created models' }));
    fireEvent.click(screen.getByRole('tab', { name: 'JSON' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('tabpanel', { name: 'JSON' })).toBeTruthy();
    const json = screen.getByRole('textbox', { name: 'Configuration JSON' });
    expect(json).toHaveAttribute('readonly');
    expect(JSON.parse((json as HTMLTextAreaElement).value).overrides).toEqual(saved.overrides);
    expect(screen.getByText('Unsaved form changes are not included.')).toBeTruthy();
    expect(screen.getByText(/encrypted in the server credential store/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Form' }));
    expect(screen.getByRole('radio', { name: 'Disable user-created models' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    expect(apiRequest).toHaveBeenCalledTimes(1);
});

it('shows editable managed defaults before the first configuration save', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: { ...snapshot, revision: 0,
        user_models: { disabled: true, locked: false }, user_connectors: { disabled: true, locked: false } } });
    render(<ConfigurationView />);
    expect(await screen.findByRole('heading', { name: 'Administration', level: 1 })).toBeTruthy();
    const models = await screen.findByRole('radio', { name: 'Disable user-created models' });
    expect(models).toBeChecked();
    expect(models).toBeEnabled();
    const connectors = screen.getByRole('checkbox', { name: 'Disable user-created connections' });
    expect(connectors).toBeChecked();
    expect(connectors).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'No restriction' }));
    fireEvent.click(connectors);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/configurations', expect.objectContaining({ method: 'PUT',
        body: JSON.stringify({ revision: 0, overrides: { disable_user_models: false, disable_user_connectors: false } }) })));
});

it('uses the shared type picker for new connections and hides it for edits', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: { ...snapshot,
        catalogs: { ...snapshot.catalogs, connectors: [{ id: 'installation-warehouse', display_name: 'Warehouse', type: 'mysql' }] },
        overrides: { connections: { connectors: { 'installation-warehouse': 'reference' } } },
        loader_types: ['mysql', 'postgresql'].map(type => ({ type, name: type, params: [], auth_mode: 'credentials' })),
    } });
    render(<ConfigurationView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add data connection' }));
    expect(screen.queryByLabelText('Display name')).toBeNull();
    const picker = screen.getByRole('group', { name: 'Data Sources' });
    expect(within(picker).getByRole('button', { name: 'mysql' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(picker).getByRole('button', { name: 'postgresql' }));
    expect(screen.getByTestId('connector-form')).toHaveAttribute('data-loader-type', 'postgresql');
    expect(within(picker).getByRole('button', { name: 'postgresql' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Edit Warehouse' }));
    expect(screen.queryByRole('group', { name: 'Data Sources' })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByTestId('connector-form')).toHaveAttribute('data-loader-type', 'mysql');
    expect(screen.getByLabelText('Display name')).toHaveValue('Warehouse');
    expect(apiRequest).toHaveBeenCalledTimes(1);
});

it('tests environment connections by ID and saves metadata from the dialog', async () => {
    render(<ConfigurationView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Warehouse' }));
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Finance' } });
    expect(apiRequest).toHaveBeenCalledTimes(1);
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: { id: 'warehouse' } })
        .mockResolvedValueOnce({ data: { ...snapshot, revision: 3, overrides: { connectors: { warehouse: { display_name: 'Finance', description: '' } } } } });
    expect(screen.queryByRole('button', { name: 'Apply to draft' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Test and save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await screen.findByText('Connection saved');
    expect(apiRequest).toHaveBeenCalledWith('/api/configurations/test-connection', expect.objectContaining({
        body: JSON.stringify({ section: 'connectors', id: 'warehouse' }),
    }));
    expect(apiRequest).toHaveBeenCalledWith('/api/configurations', expect.objectContaining({ method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-DF-Configuration': '1' },
        body: JSON.stringify({ revision: 2, overrides: { connectors: { warehouse: { display_name: 'Finance', description: '' } } } }) }));
});

it('preserves a rejected draft and allows discarding before reloading', async () => {
    render(<ConfigurationView />);
    fireEvent.click(await screen.findByRole('radio', { name: 'Disable user-created models' }));
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error('Configuration changed. Reload before saving.'));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Configuration changed. Reload before saving.');
    expect(screen.getByRole('radio', { name: 'Disable user-created models' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByRole('button', { name: 'Edit Warehouse' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Disable user-created models' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Reload configuration' }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(3));
});

it('does not permit editing environment-controlled limits', async () => {
    render(<ConfigurationView />);
    await screen.findByRole('button', { name: 'Edit Warehouse' });
    expect((screen.getByLabelText('Maximum preview rows') as HTMLInputElement).disabled).toBe(true);
});

it('stages the user connector restriction until Save', async () => {
    render(<ConfigurationView />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Disable user-created connections' }));
    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Add data connection' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/configurations', expect.objectContaining({
        method: 'PUT', body: JSON.stringify({ revision: 2, overrides: { disable_user_connectors: true } }),
    })));
});

it('cannot override a deployment restriction on user connectors', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: { ...snapshot,
        overrides: { disable_user_connectors: false }, user_connectors: { disabled: true, locked: true } } });
    render(<ConfigurationView />);
    const checkbox = await screen.findByRole('checkbox', { name: 'Disable user-created connections' }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(checkbox.disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Add data connection' })).toBeTruthy();
});

it('stages the user model restriction while keeping administrator setup available', async () => {
    render(<ConfigurationView />);
    const policy = await screen.findByRole('radiogroup', { name: 'User models' });
    expect(within(policy).getAllByRole('radio')).toHaveLength(3);
    expect(policy).toHaveAccessibleDescription('Users can add their own models and custom endpoint URLs.');
    fireEvent.click(await screen.findByRole('radio', { name: 'Disable user-created models' }));
    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Add model' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/configurations', expect.objectContaining({
        method: 'PUT', body: JSON.stringify({ revision: 2, overrides: { disable_user_models: true } }),
    })));
});

it('combines the restricted model explanation below the endpoint field', async () => {
    render(<ConfigurationView />);
    fireEvent.click(await screen.findByRole('radio', { name: 'Restrict endpoint URLs' }));
    const explanation = 'Enter one allowed endpoint URL per line; use * as a wildcard. Leave empty to allow only provider-default endpoints.';
    const field = screen.getByRole('textbox', { name: 'Allowed endpoint URL patterns' });
    expect(field).toHaveAccessibleDescription(explanation);
    expect(screen.getByRole('radiogroup', { name: 'User models' })).toHaveAccessibleDescription(explanation);
    expect(screen.getByText(explanation).closest('.MuiFormControl-root')).toBeNull();
    expect(field.compareDocumentPosition(screen.getByText(explanation)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'No restriction' }));
    expect(screen.queryByRole('textbox', { name: 'Allowed endpoint URL patterns' })).toBeNull();
});

it('cannot override a deployment restriction on user models', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: { ...snapshot,
        overrides: { disable_user_models: false }, user_models: { disabled: true, locked: true } } });
    render(<ConfigurationView />);
    const checkbox = await screen.findByRole('radio', { name: 'Disable user-created models' }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(checkbox.disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Add model' })).toBeEnabled();
});

it('opens model and connector setup in dialogs without saving on cancel', async () => {
    render(<ConfigurationView />);
    await screen.findByRole('button', { name: 'Edit Warehouse' });
    for (const name of ['Add model', 'Add data connection']) {
        fireEvent.click(screen.getByRole('button', { name }));
        expect(screen.getByRole('dialog', { name })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }
    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true);
});

it.each(['models', 'connectors', 'workflows'] as const)('keeps the %s add tile in both empty and populated grids', async section => {
    const label = section === 'models' ? 'Add model' : section === 'connectors' ? 'Add data connection' : 'Add workflow';
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: { ...snapshot, catalogs: { ...snapshot.catalogs, [section]: [] } } });
    const { unmount } = render(<ConfigurationView />);
    const emptyTile = await screen.findByRole('button', { name: label });
    expect(emptyTile.parentElement?.children).toHaveLength(1);
    unmount();
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: { ...snapshot, catalogs: { ...snapshot.catalogs,
        [section]: [section === 'models' ? { id: 'example', model: 'Example' } : { id: 'example', display_name: 'Example', name: 'Example' }],
    } } });
    render(<ConfigurationView />);
    const tile = await screen.findByRole('button', { name: label });
    const card = screen.getByRole('button', { name: 'Edit Example' }).closest('.MuiCard-root');
    expect(card?.parentElement).toBe(tile.parentElement);
    expect(tile.parentElement?.lastElementChild).toBe(tile);
    fireEvent.click(tile);
    expect(screen.getByRole('dialog', { name: label })).toBeTruthy();
});

it('creates an editable workflow draft and only persists it on Save', async () => {
    render(<ConfigurationView />);
    await screen.findByRole('button', { name: 'Edit Warehouse' });
    fireEvent.click(screen.getByRole('button', { name: 'Add workflow' }));
    fireEvent.change(screen.getByLabelText('New workflow filename'), { target: { value: 'review.yaml' } });
    const content = 'version: 1\nname: Review\noverview: Review data\ndeliverables: [Report]\nsteps:\n  - id: review\n    instructions: Review data\n';
    fireEvent.change(screen.getByLabelText('Workflow YAML'), { target: { value: content } });
    expect(screen.queryByRole('checkbox', { name: 'Published' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add to draft' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(apiRequest).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Edit server/review.yaml' }));
    expect((screen.getByLabelText('Workflow YAML') as HTMLTextAreaElement).value).toBe(content);
    fireEvent.change(screen.getByLabelText('Workflow YAML'), { target: { value: content + '\n' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Add workflow' }));
    fireEvent.change(screen.getByLabelText('New workflow filename'), { target: { value: 'review.yaml' } });
    expect((screen.getByRole('button', { name: 'Add to draft' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/configurations', expect.objectContaining({ method: 'PUT',
        body: JSON.stringify({ revision: 2, overrides: { workflows: { 'server/review.yaml': { enabled: true, content } } } }) })));
});

it('edits file-backed workflows from resolved content while JSON keeps only references', async () => {
    const content = 'version: 1\nname: Team review\n';
    const options = { enabled: false, file: 'workflows/team.yaml' };
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: { ...snapshot,
        overrides: { workflows: { 'server/team.yaml': options } },
        catalogs: { ...snapshot.catalogs, workflows: [{ id: 'server/team.yaml', name: 'Team review', content }] },
    } });
    render(<ConfigurationView />);
    fireEvent.click(await screen.findByRole('tab', { name: 'JSON' }));
    const document = JSON.parse((screen.getByLabelText('Configuration JSON') as HTMLTextAreaElement).value);
    expect(document.overrides.workflows['server/team.yaml']).toEqual(options);
    expect(document.catalogs).toBeUndefined();
    fireEvent.click(screen.getByRole('tab', { name: 'Form' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Team review' }));
    expect(screen.getByLabelText('Workflow YAML')).toHaveValue(content);
    fireEvent.change(screen.getByLabelText('Workflow YAML'), { target: { value: content + '\n' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply to draft' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/configurations', expect.objectContaining({ method: 'PUT',
        body: JSON.stringify({ revision: 2, overrides: { workflows: { 'server/team.yaml': { ...options, content: content + '\n' } } } }) })));
});

it('toggles demos together, enables their example datasets, and leaves custom workflows unchanged', async () => {
    const workflows = {
        'demo/first.yaml': { enabled: false, file: 'builtin:first.yaml' },
        'demo/second.yaml': { enabled: false },
        'server/team.yaml': { enabled: true, file: 'workflows/team.yaml' },
    };
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: { ...snapshot,
        overrides: { workflows, connectors: { sample_datasets: { enabled: false } } },
        catalogs: { ...snapshot.catalogs,
            connectors: [{ id: 'sample_datasets', display_name: 'Example Datasets' }],
            workflows: [{ id: 'demo/first.yaml', name: 'First demo' }, { id: 'demo/second.yaml', name: 'Second demo' },
                { id: 'server/team.yaml', name: 'Team review' }],
        },
    } });
    render(<ConfigurationView />);
    const toggle = await screen.findByRole('switch', { name: 'Show demo workflows' });
    expect(toggle).not.toBeChecked();
    expect(toggle.closest('.MuiCard-root')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit First demo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit Second demo' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit Team review' })).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.getByRole('switch', { name: 'Show built-in example datasets' })).toBeChecked();
    fireEvent.click(toggle);
    expect(screen.getByRole('switch', { name: 'Show built-in example datasets' })).toBeChecked();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/configurations', expect.objectContaining({ method: 'PUT',
        body: JSON.stringify({ revision: 2, overrides: {
            workflows: { ...workflows, 'demo/first.yaml': { ...workflows['demo/first.yaml'], enabled: true },
                'demo/second.yaml': { enabled: true } },
            connectors: { sample_datasets: { enabled: true } },
        } }),
    })));
});

it('configures example datasets with only an on/off toggle', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: { ...snapshot, catalogs: { ...snapshot.catalogs,
        connectors: [{ id: 'sample_datasets', display_name: 'Example Datasets' }] } } });
    render(<ConfigurationView />);
    const toggle = await screen.findByRole('switch', { name: 'Show built-in example datasets' });
    expect(toggle.closest('.MuiCard-root')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reset sample_datasets' })).toBeNull();
    expect(screen.queryByLabelText('Display name')).toBeNull();
    expect(screen.queryByLabelText('Description')).toBeNull();
    fireEvent.click(toggle);
    expect(apiRequest).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/configurations', expect.objectContaining({
        method: 'PUT', body: JSON.stringify({ revision: 2, overrides: { connectors: { sample_datasets: { enabled: false } } } }),
    })));
});

it.each(['models', 'connectors'] as const)('edits a saved %s connection through its form without duplicating the card', async section => {
    const id = 'installation-example';
    const item = section === 'models'
        ? { id, model: 'Warehouse', endpoint: 'openai', definition: { endpoint: 'openai', model: 'Warehouse' } }
        : { id, display_name: 'Warehouse', type: 'mysql', params: { host: 'old-host', port: '3306' } };
    const settings = section === 'models' ? item.definition : { type: item.type, display_name: item.display_name, params: item.params };
    const saved = { ...snapshot, catalogs: { models: [], connectors: [], workflows: [], [section]: [item] },
        overrides: { connections: { [section]: { [id]: { ...settings, credential_ref: 'old-reference' } } } },
        loader_types: [{ type: 'mysql', name: 'MySQL', params: [], auth_mode: 'credentials' }] };
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: saved });
    render(<ConfigurationView />);
    await screen.findByRole('button', { name: 'Edit Warehouse' });
    fireEvent.click(screen.getByRole('radio', { name: 'Disable user-created models' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Warehouse' }));
    expect(screen.getByRole('dialog', { name: section === 'models' ? 'Edit model' : 'Edit data connection' })).toBeTruthy();
    const updated = { ...saved, revision: 3, overrides: {
        ...(section === 'models' ? { default_model: id } : {}),
        connections: { [section]: { [id]: { ...settings, credential_ref: 'saved-reference' } } },
        [section]: { [id]: { display_name: 'Warehouse', ...(section === 'connectors' ? { description: '' } : {}) } },
    } };
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: { ...item, reference: 'new-reference' } })
        .mockResolvedValueOnce({ data: updated });
    fireEvent.click(screen.getByRole('button', { name: section === 'models' ? 'Test model connection' : 'Test data connection' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const request = JSON.parse(vi.mocked(apiRequest).mock.calls[1][1]!.body as string);
    expect(request).toMatchObject({ section, id, reference: 'old-reference' });
    expect(request.definition).toMatchObject(section === 'models'
        ? { endpoint: 'openai', model: 'updated-model' }
        : { type: 'mysql', params: { host: 'updated-host', port: '3306' } });
    expect(screen.getAllByRole('button', { name: 'Edit Warehouse' })).toHaveLength(1);
    expect(apiRequest).toHaveBeenCalledTimes(3);
    expect(screen.getByText('Connection saved')).toBeTruthy();
    const submitted = JSON.parse(vi.mocked(apiRequest).mock.calls[2][1]!.body as string);
    expect(submitted.revision).toBe(2);
    expect(submitted.overrides.connections[section]).toEqual({ [id]: { ...settings, credential_ref: 'new-reference' } });
    expect(submitted.overrides.disable_user_models).toBeUndefined();
    expect(screen.getByRole('radio', { name: 'Disable user-created models' })).toBeChecked();
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: updated });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(5));
    expect(JSON.parse(vi.mocked(apiRequest).mock.calls[3][1]!.body as string)).toEqual({
        revision: 3, overrides: { disable_user_models: true, ...updated.overrides },
    });
});

it('shows inline connection settings in JSON without exposing keys', async () => {
    const connections = {
        models: { 'installation-model': { endpoint: 'openai', model: 'team-model', api_base: 'https://gateway.example/v1', credential_ref: 'model-credentials' } },
        connectors: { 'installation-warehouse': { type: 'mysql', display_name: 'Warehouse', params: { host: 'db.example', port: '3306' }, credential_ref: 'warehouse-credentials' } },
    };
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: { ...snapshot, overrides: { connections } } });
    render(<ConfigurationView />);
    fireEvent.click(await screen.findByRole('tab', { name: 'JSON' }));
    const document = JSON.parse((screen.getByLabelText('Configuration JSON') as HTMLTextAreaElement).value);
    expect(document.overrides.connections).toEqual(connections);
    expect(document.overrides.connections.models['installation-model'].api_key).toBeUndefined();
    expect(document.overrides.connections.connectors['installation-warehouse'].params.password).toBeUndefined();
    expect(screen.getByText(/This JSON contains model and connector settings, but not secrets/)).toBeTruthy();
});

it.each(['test', 'save'])('keeps the model form open after a failed %s and permits retry', async failure => {
    render(<ConfigurationView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add model' }));
    const item = { id: 'installation-new', model: 'updated-model', endpoint: 'openai', reference: 'new-reference' };
    if (failure === 'save') vi.mocked(apiRequest).mockResolvedValueOnce({ data: item });
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error('Connection could not be saved'));
    fireEvent.click(screen.getByRole('button', { name: 'Test model connection' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('Connection could not be saved'));
    expect(apiRequest).toHaveBeenCalledTimes(failure === 'save' ? 3 : 2);
    const updated = { ...snapshot, revision: 3, overrides: { connections: { models: { [item.id]: item.reference } } },
        catalogs: { ...snapshot.catalogs, models: [item] } };
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: item }).mockResolvedValueOnce({ data: updated });
    fireEvent.click(screen.getByRole('button', { name: 'Test model connection' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Connection saved')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
});

it('selects the first configured model by default and saves an administrator choice', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: { ...snapshot, catalogs: { ...snapshot.catalogs,
        models: [{ id: 'first', model: 'First model' }, { id: 'second', model: 'Second model' }] } } });
    render(<ConfigurationView />);
    const selector = await screen.findByRole('combobox', { name: 'Default model' });
    expect(selector).toHaveTextContent('First model');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    fireEvent.mouseDown(selector);
    expect(screen.queryByRole('option', { name: 'Environment default' })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: 'Second model' }));
    expect(selector).toHaveTextContent('Second model');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/configurations', expect.objectContaining({
        method: 'PUT', body: JSON.stringify({ revision: 2, overrides: { default_model: 'second' } }),
    })));
});

it('falls back to the first enabled model when the selected default is disabled', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: { ...snapshot, overrides: { default_model: 'second' },
        catalogs: { ...snapshot.catalogs, models: [{ id: 'first', model: 'First model' }, { id: 'second', model: 'Second model' }] } } });
    render(<ConfigurationView />);
    const selector = await screen.findByRole('combobox', { name: 'Default model' });
    expect(selector).toHaveTextContent('Second model');
    fireEvent.click(screen.getByRole('switch', { name: 'Visible: Second model' }));
    expect(selector).toHaveTextContent('First model');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/api/configurations', expect.objectContaining({
        method: 'PUT', body: JSON.stringify({ revision: 2, overrides: { default_model: 'first', models: { second: { enabled: false } } } }),
    })));
});

it('disables default selection when there are no configured models', async () => {
    render(<ConfigurationView />);
    expect(await screen.findByRole('combobox', { name: 'Default model' })).toHaveAttribute('aria-disabled', 'true');
});

it('shows access denial without rendering configuration controls', async () => {
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error('Administrator access required'));
    render(<ConfigurationView />);
    await screen.findByText('Administrator access required');
    expect(screen.queryByRole('button', { name: 'Add model' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true);
});