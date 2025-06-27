// index.js (full file)
const fs = require('fs');
const dotenv = require('dotenv');
const { logMessage } = require('./logging');
const OpenAI = require('openai');

dotenv.config();

const apiKey = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey });

const promptData = JSON.parse(fs.readFileSync('./system-prompt.json', 'utf8'));
const instructions = promptData.instructions;

async function messageHandler(message, sessionId = null) {
  const lowerMsg = message.toLowerCase();
  if (lowerMsg.includes('stupid') || lowerMsg.includes('shut up')) {
    const response = 'Please keep it respectful';
    logMessage({ message, sessionId, category: 'Abusive', response });
    return { response };
  }

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: message },
      ],
      temperature: 0.8,
      max_tokens: 150,
    });

    const response = completion.choices[0].message.content.trim();
    logMessage({ message, sessionId, category: 'Processed', response });
    return { response };

  } catch (error) {
    console.error('OpenAI API error:', error);
    const response = 'Sorry, I’m having trouble thinking right now. Please try again later.';
    logMessage({ message, sessionId, category: 'Error', response });
    return { response };
  }
}

module.exports = { messageHandler };
