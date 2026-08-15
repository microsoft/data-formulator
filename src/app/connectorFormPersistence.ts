// Connector-form prefills may contain credentials supplied in chat. Keep them
// in memory only, regardless of which persistence path serializes the state.
export const stripConnectorPrefillFromEntries = (entries: unknown) => {
    if (!Array.isArray(entries)) return entries;
    return entries.map((entry: any) => {
        if (entry?.form?.kind === 'connector' && entry.form.connector?.prefilled) {
            const { prefilled, ...connector } = entry.form.connector;
            return { ...entry, form: { ...entry.form, connector } };
        }
        if (entry?.connectorForm?.prefilled) {
            const { prefilled, ...connectorForm } = entry.connectorForm;
            return { ...entry, connectorForm };
        }
        return entry;
    });
};