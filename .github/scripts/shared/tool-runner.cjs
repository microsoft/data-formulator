// @ts-check
'use strict';

const { execFileSync } = require('node:child_process');

function envKeyForTool(tool) {
    return `ACT_TOOL_${String(tool).replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}`;
}

function runTool(tool, args, options = {}) {
    const overrideScript = process.env[envKeyForTool(tool)];
    if (overrideScript) {
        return execFileSync(process.execPath, [overrideScript, ...args], options);
    }
    return execFileSync(tool, args, options);
}

module.exports = { runTool, envKeyForTool };
