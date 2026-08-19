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
    list_data: 'dataLoading.toolLabels.browsingCatalog',
    find_data: 'dataLoading.toolLabels.searchingData',
    describe_data: 'dataLoading.toolLabels.describingData',
    probe_data: 'dataLoading.toolLabels.probingData',
    list_connectors: 'dataThread.listingConnectors',
    describe_connector: 'dataThread.readingConnector',
};

export const formatAnalystToolProgress = (
    tool: string,
    args: Record<string, any> | undefined,
    t: Translate,
): string => {
    const values = args && typeof args === 'object' ? args : {};
    let detail = '';
    switch (tool) {
        case 'list_data': {
            const path = Array.isArray(values.path) ? values.path.join('/') : values.path;
            detail = [shortSourceId(values.source_id), path].filter(Boolean).join('/');
            if (values.filter) detail = `${detail} “${values.filter}”`.trim();
            break;
        }
        case 'find_data': {
            const scope = values.scope && values.scope !== 'all'
                ? ` in ${shortSourceId(values.scope)}`
                : '';
            detail = values.query ? `“${values.query}”${scope}` : '';
            break;
        }
        case 'describe_data':
            detail = [shortSourceId(values.source_id), values.table_key].filter(Boolean).join('/');
            break;
        case 'probe_data':
            detail = [values.table_key, summarizeProbeQuery(values.query)]
                .filter(Boolean).join(' · ');
            break;
        case 'describe_connector':
            detail = values.source_type || '';
            break;
    }

    const labelKey = toolLabelKeys[tool];
    const label = labelKey
        ? t(labelKey)
        : t('dataThread.usingTool', { tool: tool.replaceAll('_', ' ') });
    return detail ? `${label}: ${truncateDetail(String(detail))}` : label;
};
