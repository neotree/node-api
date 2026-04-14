const fs = require('fs');
const path = require('path');

const MAX_LOG_BYTES = 1024 * 1024; // 1 MB safeguard per file
const MAX_LOG_FILES = 10; // cap the number of log files kept

const LOG_LEVELS = {
    ERROR: 'error',
    INFO: 'info'
};

function ensureDirectoryWritable(dirPath) {
    try {
        fs.mkdirSync(dirPath, { recursive: true });
        fs.accessSync(dirPath, fs.constants.W_OK);
        return true;
    } catch (err) {
        console.error(`Unable to use log directory ${dirPath}: ${err.message}`);
        return false;
    }
}

// Prefer /logs, fall back to the current working directory when not writable.
function resolveLogDirectory() {
    const cwd = process.cwd();
    const candidates = ['/logs', path.join(cwd, 'logs'), cwd];
    for (const dir of candidates) {
        if (ensureDirectoryWritable(dir)) {
            console.log(`[logger] Writing logs to directory ${dir}`);
            return dir;
        }
    }

    // As a last resort, place the directory next to this helper.
    const fallback = path.join(__dirname, 'logs');
    ensureDirectoryWritable(fallback);
    console.log(`[logger] Fallback log directory in use: ${fallback}`);
    return fallback;
}

const logDirectory = resolveLogDirectory();

function currentDateString() {
    return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

function getLogFilePath(level, dateString = currentDateString()) {
    return path.join(logDirectory, `${level}-${dateString}.log`);
}

function enforceMaxSize(filePath, nextMessageSize) {
    try {
        if (!fs.existsSync(filePath)) return;
        const { size } = fs.statSync(filePath);

        // Clean up before the file grows beyond the 1 MB limit
        if (size + nextMessageSize >= MAX_LOG_BYTES) {
            fs.truncateSync(filePath, 0);
        }
    } catch (err) {
        console.error('Error enforcing log size limit:', err.message);
    }
}

function pruneOldLogFiles() {
    try {
        const logFiles = fs.readdirSync(logDirectory)
            .filter((file) => file.endsWith('.log'))
            .map((file) => path.join(logDirectory, file))
            .filter((filePath) => fs.existsSync(filePath));

        if (logFiles.length <= MAX_LOG_FILES) return;

        logFiles.sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs); // oldest first

        while (logFiles.length > MAX_LOG_FILES) {
            const oldest = logFiles.shift();
            fs.unlinkSync(oldest);
        }
    } catch (err) {
        console.error('Error pruning old log files:', err.message);
    }
}

function formatPayload(payload) {
    if (payload instanceof Error) {
        return `${payload.name || 'Error'}: ${payload.message}\n${payload.stack || ''}`.trim();
    }

    if (typeof payload === 'object') {
        try {
            return JSON.stringify(payload);
        } catch (err) {
            return `[Unserializable object] ${err.message}`;
        }
    }

    return String(payload);
}

function serializeError(err) {
    if (!err) return null;
    return {
        name: err.name,
        message: err.message,
        stack: err.stack,
        code: err.code,
        detail: err.detail,
        constraint: err.constraint,
        file: err.file,
        line: err.line
    };
}

// Helper function to write to log file using synchronous operations
function writeToLog(level, ...payloads) {
    try {
        const filePath = getLogFilePath(level.toLowerCase());

        const timestamp = new Date().toISOString();
        const combined = payloads.length ? payloads.map(formatPayload).join(' | ') : '';
        const logMessage = `[${timestamp}] ${level}: ${combined}\n`;

        enforceMaxSize(filePath, Buffer.byteLength(logMessage, 'utf8'));

        // Append the message to the log file synchronously to ensure it's written
        fs.appendFileSync(filePath, logMessage, 'utf8');

        pruneOldLogFiles();
    } catch (err) {
        console.error('Error writing to log file:', err);
    }
}

// Function to log error messages to a file
function logError(...errorPayloads) {
    writeToLog(LOG_LEVELS.ERROR.toUpperCase(), ...errorPayloads);
}

// Function to log info messages to a file
function logInfo(...infoPayloads) {
    writeToLog(LOG_LEVELS.INFO.toUpperCase(), ...infoPayloads);
}

module.exports = {
    logError,
    logInfo,
    serializeError,
    getLogFilePath,
    logDirectory,
    // Maintain legacy compatibility for callers that previously used logFilePath
    get logFilePath() {
        return getLogFilePath(LOG_LEVELS.ERROR);
    }
};
