require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const OpenAI = require('openai');

const app = express();
app.use(cors());
app.use(express.json());

// Your other code here (like loading JSON files, setting up OpenAI)

function buildLunaPrompt() {
  // Your prompt builder code
}

// <<< Paste the /chat endpoint handler here >>>
app.post('/chat', async (req, res) => {
  try {
    const userMessage = req.body.message;

    const prompt = buildLunaPrompt();

    const messages = [
      { role: 'system', content: prompt },
      { role: 'user', content: userMessage },
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages,
      temperature: 0.8,
      max_tokens: 400,
    });

    res.json({ reply: completion.choices[0].message.content });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Luna backend running on port ${PORT}`);
});
