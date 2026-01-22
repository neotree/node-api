const fs = require('fs');
const path = require('path');

const logFilePath = path.join(__dirname, 'error.log');
let lastLoggedDate = new Date().toISOString().split('T')[0];  // YYYY-MM-DD format

// Helper function to write to log file using synchronous operations
function writeToLog(level, message) {
    try {
        const currentDate = new Date().toISOString().split('T')[0]; // Get today's date in YYYY-MM-DD format

        // Check if the date has changed, meaning it's a new day
        if (currentDate !== lastLoggedDate) {
            // Delete the old log file and create a new one for the new day
            if (fs.existsSync(logFilePath)) {
                fs.unlinkSync(logFilePath);  // Delete the old log file
            }

            // Reset the lastLoggedDate to today's date
            lastLoggedDate = currentDate;
        }

        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ${level}: ${message}\n`;

        // Append the message to the log file synchronously to ensure it's written
        fs.appendFileSync(logFilePath, logMessage, 'utf8');
    } catch (err) {
        console.error('Error writing to log file:', err);
    }
}

// Function to log error messages to a file
function logError(errorMessage) {
    writeToLog('ERROR', errorMessage);
}

// Function to log info messages to a file
function logInfo(infoMessage) {
    writeToLog('INFO', infoMessage);
}

module.exports = { logError, logInfo };