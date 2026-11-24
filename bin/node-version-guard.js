// Checked by bin/run before anything else is loaded. This file must keep parsing on the old Node versions it
// exists to refuse, so it uses no recent syntax and imports nothing.

function parseVersion(text) {
    var match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(text));
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

// `range` is package.json's engines.node. Only the ">=x.y.z" form is understood. With any other form, or a version
// that cannot be read, this returns undefined and the CLI runs: a guard that guesses wrong would lock everyone out.
export function unsupportedNodeMessage(running, range) {
    var minimumMatch = /^\s*>=\s*(\d+\.\d+\.\d+)\s*$/.exec(String(range));
    var minimum = minimumMatch ? parseVersion(minimumMatch[1]) : undefined;
    var current = parseVersion(running);
    if (!minimum || !current) return undefined;
    for (var index = 0; index < 3; index++) {
        if (current[index] > minimum[index]) return undefined;
        if (current[index] < minimum[index])
            return (
                "bitsocial requires Node.js " + minimumMatch[1] + " or later, but is running on Node.js " + String(running).replace(/^v/, "") + " (" + process.execPath + ").\n" +
                "Install a supported Node.js version from https://nodejs.org/ or with your version manager, then run the command again."
            );
    }
    return undefined;
}
