const fs = require('fs');
const path = require('path');

const MAX_LOG_BYTES = 1024 * 1024; // 1 MB safeguard

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
function resolveLogFilePath() {
    const candidates = ['/logs', process.cwd()];
    for (const dir of candidates) {
        if (ensureDirectoryWritable(dir)) {
            const filePath = path.join(dir, 'error.log');
            console.log(`[logger] Writing logs to ${filePath}`);
            return filePath;
        }
    }

    // As a last resort, place the file next to this helper.
    const fallback = path.join(__dirname, 'error.log');
    console.log(`[logger] Fallback log path in use: ${fallback}`);
    return fallback;
}

const logFilePath = resolveLogFilePath();
let lastLoggedDate = new Date().toISOString().split('T')[0];  // YYYY-MM-DD format

function enforceMaxSize(nextMessageSize) {
    try {
        if (!fs.existsSync(logFilePath)) return;
        const { size } = fs.statSync(logFilePath);

        // Clean up before the file grows beyond the 1 MB limit
        if (size + nextMessageSize >= MAX_LOG_BYTES) {
            fs.truncateSync(logFilePath, 0);
        }
    } catch (err) {
        console.error('Error enforcing log size limit:', err.message);
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
        const currentDate = new Date().toISOString().split('T')[0]; // Get today's date in YYYY-MM-DD format

        // Check if the date has changed, meaning it's a new day
        if (currentDate !== lastLoggedDate) {
            if (fs.existsSync(logFilePath)) {
                fs.truncateSync(logFilePath, 0); // Start fresh each day
            }

            lastLoggedDate = currentDate;
        }

        const timestamp = new Date().toISOString();
        const combined = payloads.length ? payloads.map(formatPayload).join(' | ') : '';
        const logMessage = `[${timestamp}] ${level}: ${combined}\n`;

        enforceMaxSize(Buffer.byteLength(logMessage, 'utf8'));

        // Append the message to the log file synchronously to ensure it's written
        fs.appendFileSync(logFilePath, logMessage, 'utf8');
    } catch (err) {
        console.error(`Error writing to log file (${logFilePath}):`, err);
    }
}

// Function to log error messages to a file
function logError(...errorPayloads) {
    writeToLog('ERROR', ...errorPayloads);
}

// Function to log info messages to a file
function logInfo(...infoPayloads) {
    writeToLog('INFO', ...infoPayloads);
}

module.exports = { logError, logInfo, serializeError, logFilePath };
