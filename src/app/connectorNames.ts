const CONNECTION_IDENTITY_KEYS = [
    'host',
    'server',
    'server_hostname',
    'endpoint',
    'url',
    'account_name',
    'bucket',
    'project_id',
    'kusto_cluster',
    'database',
    'root_dir',
] as const;

const conciseIdentity = (value: string): string => {
    const trimmed = value.trim().replace(/\/$/, '');
    if (!trimmed) return '';

    try {
        const parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
        return parsed.host || trimmed;
    } catch {
        return trimmed;
    }
};

export const deriveConnectorDisplayName = (
    loaderName: string,
    params: Record<string, unknown>,
): string => {
    const cluster = params.kusto_cluster;
    if (typeof cluster === 'string' && cluster.trim()) {
        const identity = conciseIdentity(cluster);
        try {
            const hostname = new URL(`https://${identity}`).hostname;
            const clusterName = hostname.includes('.kusto.') ? hostname.split('.')[0] : identity;
            return `${loaderName} · ${clusterName}`;
        } catch {
            return `${loaderName} · ${identity}`;
        }
    }
    for (const key of CONNECTION_IDENTITY_KEYS) {
        const value = params[key];
        if (typeof value !== 'string') continue;
        const identity = conciseIdentity(value);
        if (identity) return `${loaderName} · ${identity}`;
    }
    return loaderName;
};
