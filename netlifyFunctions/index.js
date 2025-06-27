const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { logMessage } = require('./logging');  // Ensure logging.js is in same folder

dotenv.config();

const apiKey = process.env.OPENAI_API_KEY;

// Use absolute path to system-prompt.json inside netlifyFunctions folder
const promptPath = path.join(__dirname, 'system-prompt.json');
const promptData = JSON.parse(fs.readFileSync(promptPath, 'utf8'));
const instructions = promptData.instructions;

const messageHandler = function (message, sessionId = null) {
    let category = 'Greeting';
    if (message.toLowerCase().includes('sad') || message.toLowerCase().includes('upset')) {
        category = 'Heavy';
    } else if (message.toLowerCase().includes('stupid') || message.toLowerCase().includes('shut up')) {
        category = 'Abusive';
    }

    let response = '[PERSONALITY_RESPONSE]';
    if (category === 'Abusive') {
        response = 'Please keep it respectful';
    }

    logMessage({ message, sessionId, category, response });

    return {
        response: response
    };
};

module.exports = { messageHandler };
