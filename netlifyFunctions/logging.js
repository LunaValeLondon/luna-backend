const fs = require('fs');
const path = require('path');

const logFilePath = path.join(__dirname, 'chat-log.txt');

function logMessage({ message, sessionId, category, response }) {
    const logEntry = `[${new Date().toISOString()}] Session: ${sessionId || 'N/A'} Category: ${category} Message: "${message}" Response: "${response}"\n`;
    fs.appendFile(logFilePath, logEntry, (err) => {
        if (err) {
            console.error('Error writing log:', err);
        }
    });
}

module.exports = { logMessage };
