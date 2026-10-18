type Translate = (key: string, options?: Record<string, unknown>) => string;

const truncateDetail = (value: string, maxLength = 56): string =>
    value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;

/** Source ids read `type:name` (`mysql:mysql`, `local_folder:datasets`); the
 *  name alone identifies it well enough for a progress line. */
const shortSourceId = (sourceId: unknown): string => {
    const value = String(sourceId ?? '');
    const name = value.split(':').pop() || '';
    return name || value;
};

const summarizeProbeQuery = (query: unknown): string => {
    if (!query || typeof query !== 'object') return '';
    const value = query as Record<string, any>;
    const parts: string[] = [];
    if (Array.isArray(value.aggregates) && value.aggregates.length > 0) {
        parts.push(value.aggregates
            .map((aggregate: any) => aggregate.op === 'count' && !aggregate.column
                ? 'count'
                : `${aggregate.op}(${aggregate.column ?? ''})`)
            .join(', '));
    }
    if (Array.isArray(value.group_by) && value.group_by.length > 0) {
        parts.push(`by ${value.group_by.join(', ')}`);
    }
    const filterCount = Number(value.filter_count)
        || (Array.isArray(value.filters) ? value.filters.length : 0);
    if (filterCount > 0) {
        parts.push(`${filterCount} filter${filterCount === 1 ? '' : 's'}`);
    }
    if (value.limit) parts.push(`limit ${value.limit}`);
    return parts.join(' ');
};

const toolLabelKeys: Record<string, string> = {
    web_search: 'dataLoading.toolLabels.searchingWeb',
    web_fetch: 'dataLoading.toolLabels.readingWebPage',
    summarize_data_sources: 'dataLoading.toolLabels.summarizingSources',
    list_data: 'dataLoading.toolLabels.browsingCatalog',
    find_data: 'dataLoading.toolLabels.searchingData',
    describe_data: 'dataLoading.toolLabels.describingData',
    probe_data: 'dataLoading.toolLabels.probingData',
    load_data: 'dataLoading.toolLabels.loadingData',
    list_connectors: 'dataThread.listingConnectors',
    list_workflows: 'dataThread.listingWorkflows',
    list_sessions: 'dataThread.searchingSessions',
    delete_items: 'dataThread.deletingItems',
    list_files: 'dataThread.listingFiles',
    read_file: 'dataThread.readingFile',
    search: 'dataThread.searchingSession',
    // Older conversations name the earlier grep tool.
    search_files: 'dataThread.searchingFiles',
    move_file: 'dataThread.movingFile',
    wait_tasks: 'backgroundTasks.waiting',
    stop_task: 'backgroundTasks.stopping',
};

export const formatAnalystToolProgress = (
    tool: string,
    args: Record<string, any> | undefined,
    t: Translate,
): string => {
    const values = args && typeof args === 'object' ? args : {};
    let detail = '';
    switch (tool) {
        case 'web_search':
            detail = Array.isArray(values.search_queries)
                ? values.search_queries.map((query: unknown) => `“${String(query)}”`).join(', ') : '';
            break;
        case 'web_fetch':
            detail = Array.isArray(values.urls) ? values.urls.map(String).join(', ') : '';
            break;
        case 'list_data': {
            const path = Array.isArray(values.path) ? values.path.join('/') : values.path;
            detail = [shortSourceId(values.source_id), path].filter(Boolean).join('/');
            if (values.filter_by) detail = `${detail} (${values.filter_by})`.trim();
            break;
        }
        case 'find_data': {
            const path = Array.isArray(values.path) ? values.path.join('/') : values.path;
            const scope = [shortSourceId(values.source_id), path].filter(Boolean).join('/');
            detail = [values.query ? `“${values.query}”` : '', scope ? `in ${scope}` : '', values.filter_by ? `(${values.filter_by})` : '']
                .filter(Boolean).join(' ');
            break;
        }
        case 'describe_data':
            detail = [shortSourceId(values.source_id), values.table_key].filter(Boolean).join('/');
            break;
        case 'probe_data':
            detail = [String(values.table_key || '').split('/').pop(), summarizeProbeQuery(values.query)]
                .filter(Boolean).join(' · ');
            break;
        case 'load_data':
            detail = Array.isArray(values.tables) ? values.tables.map(String).join(', ') : '';
            break;
        case 'list_connectors':
            detail = values.source_type || '';
            break;
        case 'list_sessions':
            detail = values.query ? `“${values.query}”` : '';
            break;
        case 'list_files':
            detail = values.path || '';
            break;
        case 'read_file': {
            const items = Array.isArray(values.files) ? values.files : [];
            const described = items.map((item: any) => {
                if (typeof item === 'string') return item;
                if (!item || typeof item !== 'object' || !item.path) return '';
                const unit = item.rows ? `rows ${item.rows}` : item.pages ? `pages ${item.pages}` : item.sheet ? item.sheet : '';
                return unit ? `${item.path} (${unit})` : String(item.path);
            });
            detail = [values.path, ...(Array.isArray(values.paths) ? values.paths : []), ...described]
                .filter(Boolean).map(String).join(', ');
            break;
        }
        case 'search': {
            const scope = Array.isArray(values.path) ? values.path.join(', ') : values.path;
            detail = [values.query ? `“${values.query}”` : '', scope ? `in ${scope}` : ''].filter(Boolean).join(' ');
            break;
        }
        case 'search_files':
            detail = [values.pattern ? `“${values.pattern}”` : '', values.path ? `in ${values.path}` : ''].filter(Boolean).join(' ');
            break;
        case 'move_file':
            detail = [values.path, values.new_path].filter(Boolean).join(' → ');
            break;
        case 'delete_items':
            detail = Array.isArray(values.items) ? values.items.map(String).join(', ') : '';
            break;
        case 'load_skill':
            detail = values.name || '';
            break;
        case 'edit_file':
            detail = values.path || '';
            break;
        case 'create_file':
            detail = values.filename || '';
            break;
        case 'create_data':
        case 'update_data':
            detail = values.table_name || '';
            break;
    }

    // Naming a type reads that connector's setup.
    const labelKey = tool === 'list_connectors' && values.source_type ? 'dataThread.readingConnector' : toolLabelKeys[tool];
    const label = labelKey
        ? t(labelKey, tool === 'load_data' ? { defaultValue: 'Loading data' } : undefined)
        : tool.replaceAll('_', ' ');
    return detail ? `${label}: ${truncateDetail(String(detail))}` : label;
};
