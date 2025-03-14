const fs = require('fs');
const path = require('path');

const logFilePath = path.join(__dirname, 'error.log');
let lastLoggedDate = new Date().toISOString().split('T')[0];  // YYYY-MM-DD format

// Function to log error messages to a file
function logError(errorMessage) {
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