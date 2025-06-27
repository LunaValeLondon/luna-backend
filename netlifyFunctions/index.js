const fs = require('fs');
const { logMessage } = require('./logging');

const promptData = JSON.parse(fs.readFileSync('./system-prompt.json', 'utf8'));

function messageHandler(message) {
  logMessage(message);
  const lowerMessage = message.toLowerCase();
  if (lowerMessage.includes('stupid') || lowerMessage.includes('shut up')) {
    return { response: 'Please keep it respectful' };
  }
  return { response: '[PERSONALITY_RESPONSE]' };
}

module.exports = { messageHandler };