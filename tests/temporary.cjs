const { mkdtemp, realpath } = require('node:fs/promises');

// Windows runners can expose TEMP through an 8.3 alias (e.g. RUNNER~1).
// Native folder selection supplies canonical paths; fixtures must do the same.
exports.mkdtemp = async prefix => realpath(await mkdtemp(prefix));
