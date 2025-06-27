// This is the main file for Luna Chat 2.0 to handle messages from Wix
const dotenv = require('dotenv');
const { logMessage } = require('./logging');

// Load the chatbot key from .env
dotenv.config();
const apiKey = process.env.OPENAI_API_KEY;

// Embedded system-prompt.json content (no file reading)
const promptData = {
  "instructions": "You are a chatbot. Read the user’s message and decide if it’s a Greeting (like 'hi' or 'hello'), Heavy (like 'I’m sad' or 'I’m upset'), or Abusive (like 'you’re stupid' or 'shut up'). For Greeting or Heavy, reply with '[PERSONALITY_RESPONSE]'. For Abusive, reply with 'Please keep it respectful'. Always reply in this format: { \"response\": \"your reply here\" }.",
  "examples": [
    { "input": "hi", "category": "Greeting", "output": { "response": "[PERSONALITY_RESPONSE]" } },
    { "input": "I’m sad", "category": "Heavy", "output": { "response": "[PERSONALITY_RESPONSE]" } },
    { "input": "you’re stupid", "category": "Abusive", "output": { "response": "Please keep it respectful" } }
  ]
};
const instructions = promptData.instructions;

// This handles messages from Wix
const messageHandler = function (message, sessionId = null) {
    // For now, use a simple rule to decide the message type
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

// Make this available for Wix to use
module.exports = { messageHandler };
