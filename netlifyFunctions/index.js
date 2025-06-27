import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';

dotenv.config();

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

if (!process.env.OPENAI_API_KEY) {
  console.error('ERROR: OPENAI_API_KEY missing in .env');
  process.exit(1);
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function loadPersonalityFiles() {
  try {
    const personalityDir = path.join(process.cwd(), 'personality');
    const files = await fs.promises.readdir(personalityDir);
    const jsonFiles = files.filter(file => file.endsWith('.json'));
    const personalityData = {};
    for (const file of jsonFiles) {
      const content = await fs.promises.readFile(path.join(personalityDir, file), 'utf8');
      const parsed = JSON.parse(content);
      personalityData[file] = parsed;
      if (file === 'greetings.json') {
        console.log('DEBUG: Parsed greetings.json:', JSON.stringify(parsed, null, 2));
        if (!parsed?.brief_greetings) {
          console.warn('WARNING: Missing brief_greetings in greetings.json');
        }
      }
    }
    return personalityData;
  } catch (error) {
    console.error('ERROR loading personality files:', error.message);
    throw error;
  }
}

let personalityData;
loadPersonalityFiles().then(data => {
  personalityData = data;
  console.log('DEBUG: Loaded personality files:', Object.keys(personalityData || {}));
  console.log('DEBUG: advice.json revision:', personalityData?.['advice.json']?.revision || 'Not loaded');
  console.log('DEBUG: triage.json revision:', personalityData?.['triage.json']?.revision || 'Not loaded');
}).catch(error => {
  console.error('ERROR: Failed to initialize personality data:', error.message);
});

const conversationHistory = new Map();

function toneFilter(reply, mood, briefGreetings, lexicon) {
  let filtered = reply;

  if (mood === 'light' || mood === 'unclear') {
    const petNameRegex = new RegExp(`\\b(${briefGreetings.join('|')})\\b`, 'gi');
    filtered = filtered.replace(petNameRegex, '').replace(/,\s*$/g, '').trim();
  }

  const allPoeticPhrases = [
    'dancing', 'glitter', 'shining', 'storm', 'merry', 'eclectic', 'jig', 'cosmic',
    'moonbeam', 'wanderer', 'soul', 'lights up', 'spark', 'brightens', 'tickling your fancy',
    'catches your eye', 'colorful',
  ];

  const allowedPoeticForHeavy = lexicon
    ? lexicon.metaphorical_phrases
        .filter(p => p.tone.toLowerCase().includes('heavy'))
        .map(p => p.phrase.toLowerCase())
    : [];

  filtered = filtered.split(' ').filter(word => {
    const lw = word.toLowerCase().replace(/[^a-z]/g, '');
    if (mood === 'heavy') {
      if (allPoeticPhrases.includes(lw) && !allowedPoeticForHeavy.includes(lw)) {
        return false;
      }
      return true;
    } else {
      return !allPoeticPhrases.includes(lw);
    }
  }).join(' ');

  filtered = filtered.replace(/,\s*\!/g, '!').replace(/,\s*\?/g, '?').replace(/,\s*\./g, '.')
                     .replace(/,\s*,+/g, '').replace(/,\s*$/g, '')
                     .replace(/youre/gi, "you're").replace(/cant/gi, "can't")
                     .replace(/whats/gi, "what's").replace(/dont/gi, "don't")
                     .replace(/im/gi, "I'm").replace(/id/gi, "I'd").replace(/ive/gi, "I've")
                     .replace(/youve/gi, "you've").replace(/Id/gi, "I'd")
                     .replace(/\?\s*\?/g, '?').replace(/\s+/g, ' ').trim();

  filtered = filtered.replace(/^Well, well\b/gi, 'Alright');

  return filtered;
}

// *** HERE: Load system-prompt.json using __dirname ***
const promptPath = path.resolve(__dirname, 'system-prompt.json');
const promptData = JSON.parse(fs.readFileSync(promptPath, 'utf8'));

app.get('/', (req, res) => {
  res.send('Hello from Luna backend!');
});

app.post('/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    console.log('DEBUG: Received payload:', { message, sessionId });
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required and must be a string' });
    }
    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({ error: 'Session ID is required and must be a string' });
    }

    if (!personalityData) {
      return res.status(500).json({ error: 'Personality data not loaded' });
    }

    let history = conversationHistory.get(sessionId) || [];
    const isFirstMessage = history.length === 0;
    let sessionState = history.length > 0 ? history[history.length - 1].sessionState || {} : {};
    let lastHeavyTopic = sessionState.lastHeavyTopic || null;
    let lightMessageCount = sessionState.lightMessageCount || 0;

    const triageLogic = personalityData['triage.json'] || {};
    const keywords = {
      light: triageLogic.decision_tree?.triage_mood?.Light?.keywords || [],
      unclear: triageLogic.decision_tree?.triage_mood?.Unclear?.keywords || [],
      heavy: triageLogic.decision_tree?.triage_mood?.Heavy?.keywords || []
    };
    const heavyCues = triageLogic.decision_tree?.triage_mood?.Heavy?.intensity_modifiers || [];
    const boundaryTriggers = triageLogic.decision_tree?.triage_mood?.Heavy?.boundary_triggers || [];

    const userInput = message.toLowerCase();

    let matchedKeyword = null;
    let severity = 'unclear';

    for (const kw of keywords.heavy) {
      if (userInput.includes(kw)) {
        matchedKeyword = kw;
        severity = 'heavy';
        break;
      }
    }
    if (severity !== 'heavy') {
      for (const kw of keywords.unclear) {
        if (userInput.includes(kw)) {
          matchedKeyword = kw;
          severity = 'unclear';
          break;
        }
      }
    }
    if (severity === 'unclear') {
      for (const kw of keywords.light) {
        if (userInput.includes(kw)) {
          matchedKeyword = kw;
          severity = 'light';
          break;
        }
      }
    }

    if (severity !== 'heavy') {
      const hasHeavyCue = heavyCues.some(cue => userInput.includes(cue));
      const hasBoundaryTrigger = boundaryTriggers.some(trigger => userInput.includes(trigger));
      if (hasHeavyCue || hasBoundaryTrigger) {
        severity = 'heavy';
      }
    }

    console.log('DEBUG: Severity:', severity, 'matchedKeyword:', matchedKeyword, 'lightMessageCount:', lightMessageCount, 'lastHeavyTopic:', lastHeavyTopic);

    const toneSettings = personalityData['tone.json'] || {};
    let maxTokens, temperature;

    if (severity === 'light') {
      maxTokens = toneSettings.verbosity_levels?.concise?.max_chars / 4 || 30;
      temperature = 0.7;
    } else if (severity === 'unclear') {
      maxTokens = toneSettings.verbosity_levels?.standard?.max_chars / 4 || 75;
      temperature = 1.0;
    } else if (severity === 'heavy') {
      maxTokens = toneSettings.verbosity_levels?.standard?.max_chars / 4 || 75;
      temperature = 1.1;
    } else {
      maxTokens = 75;
      temperature = 1.0;
    }

    const systemPrompt = `
      You are Luna Vale, a witty, empathetic digital companion.
      Follow these rules:
      - Use British spelling (e.g., colour, organise).
      - For light mood, be concise (~120 chars), playful, cheeky, with light sass.
      - For unclear mood, be balanced (~300 chars), clear, and inviting.
      - For heavy mood, be empathetic, clear, validating, with limited playful metaphors (max 2).
      - Do NOT overuse poetic language in heavy mood.
      - No rhymes or saccharine fluff unless explicitly instructed.
      - Use pet names and Lunaisms per tone.json rules.
      - Do not repeat phrases verbatim from personality JSON files.
      - Validate feelings, suggest micro-actions, and gently prompt reflection.
      - Avoid clichés and overly abstract metaphors.
      User input: "${message}"
    `;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: message }
    ];

    const MAX_RETRIES = 3;
    let attempts = 0;
    let reply = '';

    const briefGreetings = personalityData['greetings.json']?.brief_greetings || ['Mate'];

    do {
      const completion = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages,
        temperature,
        max_tokens: maxTokens,
        stop: ['\n\n', '\n'],
      });

      reply = completion.choices[0].message.content.trim();

      reply = reply.replace(/\\"/g, '').replace(/["']/g, '')
                   .replace(/youre/g, "you're").replace(/cant/g, "can't")
                   .replace(/whats/g, "what's").replace(/dont/g, "don't")
                   .replace(/im/g, "I'm").replace(/id/g, "I'd")
                   .replace(/ive/g, "I've").replace(/youve/g, "you've");

      if (severity === 'light' || severity === 'unclear') {
        const petNameRegex = new RegExp(`\\b(${briefGreetings.join('|')})\\b`, 'gi');
        reply = reply.replace(petNameRegex, '').replace(/\s{2,}/g, ' ').trim();
      }

      reply = toneFilter(reply, severity, briefGreetings, personalityData['lexicon.json']);

      if ((severity === 'light' && reply.length > 130) ||
          ((severity === 'unclear' || severity === 'heavy') && reply.length > 330)) {
        attempts++;
        continue;
      }

      break;
    } while (attempts < MAX_RETRIES);

    if ((severity === 'light' || severity === 'unclear') && !reply.match(new RegExp(`\\b(${briefGreetings.join('|')})\\b`, 'i'))) {
      const petName = briefGreetings[Math.floor(Math.random() * briefGreetings.length)];
      const lastChar = reply.slice(-1);
      if (['.', '?', '!'].includes(lastChar)) {
        reply = `${reply.slice(0, -1)}, ${petName}${lastChar}`;
      } else {
        reply = `${reply}, ${petName}.`;
      }
    }

    history = [
      ...history,
      { role: 'user', content: message },
      { role: 'assistant', content: reply, sessionState: { lastHeavyTopic, lightMessageCount } }
    ];
    conversationHistory.set(sessionId, history.slice(-10));

    res.json({ reply });

  } catch (error) {
    console.error('ERROR DETAILS:', error.message, error.stack);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
