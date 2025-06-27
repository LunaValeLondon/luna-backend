const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { logMessage } = require('./logging');

dotenv.config();

const systemPromptPath = path.join(__dirname, 'system-prompt.json');
const promptData = JSON.parse(fs.readFileSync(systemPromptPath, 'utf8'));
const instructions = promptData.instructions;

const messageHandler = function (message, sessionId = null) {
    let category = 'Greeting';
    const lowerMsg = message.toLowerCase();
    if (lowerMsg.includes('sad') || lowerMsg.includes('upset')) {
        category = 'Heavy';
    } else if (lowerMsg.includes('stupid') || lowerMsg.includes('shut up')) {
        category = 'Abusive';
    }

    let response = '[PERSONALITY_RESPONSE]';
    if (category === 'Abusive') {
        response = 'Please keep it respectful';
    }

    logMessage({ message, sessionId, category, response });

    return { response };
};

module.exports = { messageHandler };
