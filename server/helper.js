const fs = require('fs');
const path = require('path');

const logFilePath = path.join(__dirname, 'error.log');

// Function to log error messages to a file
function logError(errorMessage) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ERROR: ${errorMessage}\n`;

    // Append the error message to the log file
    fs.appendFile(logFilePath, logMessage, (err) => {
        if (err) {
            console.error('Error writing to log file:', err);
        } else {
            console.log('Error logged successfully!');
        }
    });
}
module.exports = { logError };