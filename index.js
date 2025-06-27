const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { logMessage } = require('./logging');

// Load environment variables from .env
dotenv.config();
const apiKey = process.env.OPENAI_API_KEY;

// Load the chatbot instructions using absolute path
const promptPath = path.join(process.cwd(), 'system-prompt.json');
const promptData = JSON.parse(fs.readFileSync(promptPath, 'utf8'));
const instructions = promptData.instructions;

// This handles messages from Wix
const messageHandler = function (message, sessionId = null) {
    // Simple rule to decide the message type
    let category = 'Greeting';
    if (message.toLowerCase().includes('sad') || message.toLowerCase().includes('upset')) {
        category = 'Heavy';
    } else if (message.toLowerCase().includes('stupid') || message.toLowerCase().includes('shut up')) {
        category = 'Abusive';
    }

    // Create a response based on the type
    let response = '[PERSONALITY_RESPONSE]';
    if (category === 'Abusive') {
        response = 'Please keep it respectful';
    }

    // Save the message to the log
    logMessage({ message, sessionId, category, response });

    // Return the response for Wix
    return {
        response: response
    };
};

// Export the message handler for use by other modules
module.exports = { messageHandler };
