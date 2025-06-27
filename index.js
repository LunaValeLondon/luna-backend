// This is the main file for Luna Chat 2.0 to handle messages from Wix
const fs = require('fs');
const dotenv = require('dotenv');
const { logMessage } = require('./logging');
const OpenAI = require('openai');

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Load the chatbot key from .env
const apiKey = process.env.OPENAI_API_KEY;

// Load the chatbot instructions
const promptData = JSON.parse(fs.readFileSync('./system-prompt.json', 'utf8'));
const instructions = promptData.instructions;

// This handles messages from Wix
const messageHandler = async function (message, sessionId = null) {
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
    } else {
      // For Greeting or Heavy, use OpenAI API for dynamic response
      try {
        const completion = await openai.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: instructions },
            { role: 'user', content: message }
          ],
          temperature: 0.7,
          max_tokens: 150,
        });
        response = completion.choices[0].message.content.trim();
      } catch (error) {
        console.error('OpenAI API error:', error);
        // fallback response
        response = '[PERSONALITY_RESPONSE]';
      }
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
