const fs = require('fs');
const path = require('path');
const { logMessage } = require('./logging');  // Make sure logging.js is in same folder

// Load the chatbot instructions using absolute path
const promptPath = path.join(__dirname, 'system-prompt.json');
const promptData = JSON.parse(fs.readFileSync(promptPath, 'utf8'));
const instructions = promptData.instructions;

// This handles messages from Wix
const messageHandler = function (message, sessionId = null) {
    // Simple categorization logic
    let category = 'Greeting';
    const msgLower = message.toLowerCase();

    if (msgLower.includes('sad') || msgLower.includes('upset')) {
        category = 'Heavy';
    } else if (msgLower.includes('stupid') || msgLower.includes('shut up')) {
        category = 'Abusive';
    }

    // Prepare response based on category
    let response = '[PERSONALITY_RESPONSE]';
    if (category === 'Abusive') {
        response = 'Please keep it respectful';
    }

    // Log the message and response
    logMessage({ message, sessionId, category, response });

    // Return response object
    return { response };
};

// Export the handler for use
module.exports = { messageHandler };
