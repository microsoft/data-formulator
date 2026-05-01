// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export const formatRuleDescriptionYamlValue = (description: string): string => (
    JSON.stringify(description)
);

export function patchRuleFrontMatterContent(raw: string, description: string, alwaysApply: boolean): string {
    const descriptionValue = formatRuleDescriptionYamlValue(description);
    const fmMatch = raw.match(/^---[ \t]*\r?\n([\s\S]*?\r?\n)---[ \t]*\r?\n?/);
    if (fmMatch) {
        let fm = fmMatch[1];
        fm = fm.replace(/^description:.*$/m, '').replace(/^alwaysApply:.*$/m, '');
        fm = fm.replace(/\n{2,}/g, '\n').trim();
        fm += `\ndescription: ${descriptionValue}\nalwaysApply: ${alwaysApply}\n`;
        return `---\n${fm}---\n` + raw.slice(fmMatch[0].length);
    }
    const header = `---\ndescription: ${descriptionValue}\nalwaysApply: ${alwaysApply}\n---\n\n`;
    return header + raw;
}
