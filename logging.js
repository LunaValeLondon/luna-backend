// This file keeps track of messages for Luna Chat 2.0
const logMessage = function ({ message, sessionId = null, category, response }) {
    // Store a message with a timestamp
    const logEntry = {
        time: new Date().toISOString(),
        message,
        sessionId,
        category,
        response
    };
    // This will save to a file later
    console.log(JSON.stringify(logEntry));
};

// Make this available for the backend to use
module.exports = { logMessage };