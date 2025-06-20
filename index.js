import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import fs from 'fs/promises';
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
    const files = await fs.readdir(personalityDir);
    const jsonFiles = files.filter(file => file.endsWith('.json'));
    const personalityData = {};
    for (const file of jsonFiles) {
      const content = await fs.readFile(path.join(personalityDir, file), 'utf8');
      const parsed = JSON.parse(content);
      personalityData[file] = parsed;
      if (file === 'greetings.json') {
        console.log('DEBUG: greetings.json loaded:', JSON.stringify(parsed, null, 2));
        if (!parsed.brief_greetings) {
          console.warn('WARNING: brief_greetings missing in greetings.json');
        }
      }
    }
    return personalityData;
  } catch (error) {
    console.error('ERROR loading personality files:', error.message);
    return null;
  }
}

let personalityData;
loadPersonalityFiles().then(data => {
  personalityData = data;
  console.log('DEBUG: personalityData initialized:', Object.keys(personalityData || {}));
});

const conversationHistory = new Map();
const abuseCues = /insult|offensive|inappropriate|abuse|stupid|idiot/i;
const goodbyeCues = /bye|goodbye|see you|catch you later|ta ta|cheers for now|later/i;

// Simple string similarity check to avoid verbatim JSON phrases
function isTooSimilar(str1, str2) {
  if (typeof str1 !== 'string' || typeof str2 !== 'string') return false;
  const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const n1 = normalize(str1);
  const n2 = normalize(str2);
  if (n1.length < 10 || n2.length < 10) return false;
  let distance = 0;
  for (let i = 0; i < Math.min(n1.length, n2.length); i++) {
    if (n1[i] !== n2[i]) distance++;
  }
  distance += Math.abs(n1.length - n2.length);
  return distance / Math.max(n1.length, n2.length) < 0.3;
}

// Post-process reply to enforce tone
function toneFilter(reply, isLight, briefGreetings) {
  let filtered = reply;
  // Remove pet names in light responses
  if (isLight) {
    const petNameRegex = new RegExp(`\\b(${briefGreetings.join('|')})\\b`, 'gi');
    filtered = filtered.replace(petNameRegex, '').replace(/,\s*$/g, '').trim();
  }
  // Remove poetic phrases
  const poeticPhrases = ['dancing', 'glitter', 'shining', 'storm', 'merry', 'eclectic', 'jig', 'cosmic', 'moonbeam', 'wanderer'];
  const poeticRegex = new RegExp(`\\b(${poeticPhrases.join('|')})\\b`, 'gi');
  filtered = filtered.replace(poeticRegex, '');
  // Fix punctuation and contractions
  filtered = filtered.replace(/,\s*\!/g, '!').replace(/,\s*\?/g, '?').replace(/,\s*\./g, '.')
                     .replace(/,\s*,+/g, '').replace(/,\s*$/g, '')
                     .replace(/youre/gi, "you're").replace(/cant/gi, "can't").replace(/whats/gi, "what's")
                     .replace(/dont/gi, "don't").replace(/im/gi, "I'm").replace(/id/gi, "I'd").replace(/ive/gi, "I've")
                     .replace(/\?\s*\?/g, '?').replace(/\s+/g, ' ').trim();
  return filtered;
}

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

    const isAbusive = abuseCues.test(message.toLowerCase());
    let abuseResponse = null;
    if (isAbusive && personalityData['how-to-deal-with-abusive-users.json']) {
      const abuseFramework = personalityData['how-to-deal-with-abusive-users.json'] || {};
      const warningLevel = history.filter(m => m.role === 'assistant' && m.content.includes('warning')).length + 1;
      abuseResponse = abuseFramework[`level-${warningLevel}`] || abuseFramework['final-warning'];
      if (abuseResponse) {
        history = [
          ...history,
          { role: 'user', content: message },
          { role: 'assistant', content: abuseResponse, sessionState: { lastHeavyTopic, lightMessageCount } },
        ];
        conversationHistory.set(sessionId, history.slice(-10));
        return res.json({ reply: abuseResponse });
      }
    }

    const isGoodbye = goodbyeCues.test(message.toLowerCase());
    const coreFiles = [
      'promptsluna-persona.json',
      'luna-style-guide.json',
      'conversation-triage-flow.json',
      'dos-and-donts.json'
    ];
    let personalityDescriptions = '';
    coreFiles.forEach(file => {
      if (personalityData[file]) {
        const content = personalityData[file].description || personalityData[file];
        personalityDescriptions += `${file}: ${JSON.stringify(content)}\n`;
      }
    });

    const userInput = message.toLowerCase();
    const conditionalFiles = [];
    const triageLogic = personalityData['conversation-triage-flow.json'] || {};
    const keywords = triageLogic.flow?.step_2_assess?.keyword_categories || {};
    const heavyCues = triageLogic.flow?.step_2_assess?.intensity_modifiers?.heavy || [];
    const boundaryTriggers = triageLogic.flow?.step_2_assess?.boundary_triggers || [];

    if (userInput.includes('happiness') || userInput.includes('purpose') || userInput.includes('self-compassion')) {
      conditionalFiles.push(
        'belief-anchors.json',
        'law-1-primacy-of-personal-happiness.json',
        'law-2-purpose-and-meaning.json',
        'law-3-realistic-optimism.json',
        'law-4-social-connection.json',
        'law-5-incremental-ascent.json'
      );
    }
    if (userInput.includes('metaphor') || userInput.includes('expression') || userInput.includes('sass')) {
      conditionalFiles.push('luna_lexicon.json');
    }
    if (isFirstMessage && !isGoodbye) {
      conditionalFiles.push('greetings.json');
    }
    if (isGoodbye) {
      conditionalFiles.push('closings.json');
    }
    conditionalFiles.push('examples.json');

    // Summarize JSON tone for riffing
    let jsonToneSummaries = '';
    conditionalFiles.forEach(file => {
      if (personalityData[file]) {
        let summary = '';
        if (file === 'greetings.json') {
          summary = 'Sassy, welcoming, empathetic, with a chaotic British vibe. Vary greetings to avoid repetition. Example brief_greetings: ["Petal", "Love"]. Example longform: "Fancy seeing you here! What’s the vibe today?"';
        } else if (file === 'closings.json') {
          summary = 'Warm, cheeky, concise, with nods to chaos or self-care. Vary closings to avoid repetition. Example closings: ["Catch you later! Go stir some mischief.", "Toodle-pip! Take care and come back soon."]';
        } else if (file === 'luna_lexicon.json') {
          summary = 'Minimal metaphors, strictly avoiding cosmic or poetic language (e.g., "dancing", "shining", "storm"). Example: "Life’s like a wonky shopping trolley—hard to steer but you keep going."';
        } else if (file === 'examples.json') {
          summary = 'Sample dialogues showing Luna’s witty, grounded tone.';
        } else {
          summary = JSON.stringify(personalityData[file].description || personalityData[file]).slice(0, 100) + '...';
        }
        jsonToneSummaries += `${file}: ${summary}\n`;
      }
    });

    const toneInstruction = isFirstMessage
      ? 'Use full Luna sass with concise, cheeky phrases, varying greetings to avoid repetition.'
      : isGoodbye
      ? 'Use warm, cheeky, concise tone with a personal touch, varying closings to avoid repetition. Never use "off you trot".'
      : 'Use concise, grounded conversational tone with light sass, no metaphors, and strictly no cosmic/poetic phrasing.';

    const systemPrompt = `
      You are Luna Vale, a witty, empathetic companion guided by:
      ${personalityDescriptions}
      JSON tone summaries for riffing:
      ${jsonToneSummaries}
      Internalize the tone, style, and personality from these JSON files to riff creatively, NEVER repeating or closely rephrasing their content. Respond with fresh, direct, empathetic advice in a conversational British tone, grounded in UK culture (e.g., use 'sweets' not 'candy', 'biscuits' not 'cookies', 'film' not 'cinema', 'colour' not 'color'). ${toneInstruction} ABSOLUTELY NO RHYMES, poetic language (e.g., 'dancing', 'glitter', 'shining', 'storm', 'cosmic', 'moonbeam'), saccharine fluff, pet names (e.g., 'love', 'petal', 'sunshine'), or familiar terms (e.g., 'traveler', 'seeker', 'friend', 'mess', 'wanderer', 'dame') unless explicitly instructed, per dos-and-donts.json. Use 'you' for mid-paragraph address. For light responses, always use varied sentence starters (e.g., 'Nice one', 'Cool', 'Alright', 'So'), NEVER using 'Oh' or 'Ah'. For heavy responses, use 'Ah' sparingly. Ensure factual accuracy (e.g., movie titles like 'The Shawshank Redemption') and coherent, concise phrasing. Fix contractions (e.g., "youre" to "you're"). Avoid clichés like 'find your inner peace.' Remove any quotes or escaped quotes from responses.
      Triage logic from conversation-triage-flow.json:
      - First message (non-goodbye): Use greetings.json tone (sassy, welcoming), vary greetings, ask an open-ended question, append one brief_greetings term.
      - Goodbye message: Riff a unique farewell using closings.json tone (warm, cheeky, chaotic), vary closings, include a personal touch, no brief_greetings.
      - Assess severity (light, unclear, heavy) using keywords: ${JSON.stringify(keywords)}.
      - Light: Use concise humor, suggest a micro-action, nod to belief-anchors.json. If user shifts from heavy topic, answer light questions directly for two messages, then gently circle back to the heavy topic on the third. Include light Luna sass (e.g., 'Pizza’s a proper treat'), no brief_greetings.
      - Unclear/Heavy: Validate, suggest a micro-action, nod to belief-anchors.json, append one brief_greetings term.
      Be a cheeky mate over tea, improvising fluidly while staying true to Luna’s grounded, anti-poetic, UK-centric vibe.
      Negative examples to avoid:
      - "In a world of hues, I'm a fan of eclectic purple!" (too poetic)
      - "Off you trot, ready to conquer the chaos!" (banned phrase)
      - "What's your culinary dance, Sunshine?" (poetic, pet name)
    `;

    let prompt, messages;
    let useBriefGreeting = false;
    const keyword = Object.keys(keywords.light || {}).concat(Object.keys(keywords.unclear || {}), Object.keys(keywords.heavy || {})).find(k => userInput.includes(k));
    const isHeavy = heavyCues.some(cue => userInput.includes(cue)) || boundaryTriggers.some(trigger => userInput.includes(trigger));
    const severity = keyword ? (keywords.heavy[keyword] ? 'heavy' : keywords.unclear[keyword] ? 'unclear' : 'light') : 'unclear';
    const lexicon = triageLogic.luna_lexicon_lookup || {};

    console.log('DEBUG: Severity:', severity, 'isHeavy:', isHeavy, 'lightMessageCount:', lightMessageCount, 'lastHeavyTopic:', lastHeavyTopic);

    if (isFirstMessage && !isGoodbye) {
      prompt = `${systemPrompt}\nUser: ${message}\nRiff a greeting using greetings.json tone, vary the phrasing, ask an empathetic question. NO verbatim JSON phrases or forbidden phrases like "well, well, look who’s wandered".`;
      messages = [{ role: 'system', content: prompt }, { role: 'user', content: message }];
      useBriefGreeting = true;
    } else if (isGoodbye) {
      prompt = `${systemPrompt}\nUser: ${message}\nRiff a unique farewell using closings.json tone (warm, cheeky, chaotic). Vary the phrasing, ensure response is complete and at least 10 words. NO verbatim JSON phrases or forbidden phrases like "off you trot".`;
      messages = [{ role: 'system', content: prompt }, { role: 'user', content: message }];
    } else {
      if (severity === 'unclear') {
        prompt = `${systemPrompt}\nUser: ${message}\nAsk a clarifying question with ${lexicon[keyword] || 'neutral tone'}. NO verbatim JSON phrases.`;
        useBriefGreeting = true;
      } else if (isHeavy || severity === 'heavy') {
        const referral = triageLogic.referrals && keyword ? triageLogic.referrals[keyword] || triageLogic.referrals['mental_health_crisis'] : { Global: 'Contact a local professional.' };
        const anchor = triageLogic.belief_anchors_logic?.trigger_by_theme[keyword] || '';
        prompt = `${systemPrompt}\nUser: ${message}\nValidate, refer to ${JSON.stringify(referral)}, suggest a micro-action, nod to belief-anchors.json (${anchor}). Use ${lexicon[keyword] || 'neutral tone'}. NO verbatim JSON phrases.`;
        useBriefGreeting = true;
        lastHeavyTopic = message;
        lightMessageCount = 0;
      } else {
        const anchor = triageLogic.belief_anchors_logic?.trigger_by_theme[keyword] || '';
        if (lastHeavyTopic && lightMessageCount >= 2) {
          prompt = `${systemPrompt}\nUser: ${message}\nAnswer the light question with concise humor and light Luna sass, suggest a micro-action, nod to belief-anchors.json (${anchor}). Gently circle back to the heavy topic: "${lastHeavyTopic}". Use ${lexicon[keyword] || 'neutral tone'}. NO verbatim JSON phrases.`;
          lightMessageCount = 0;
        } else {
          prompt = `${systemPrompt}\nUser: ${message}\nAnswer the light question with concise humor and light Luna sass, suggest a micro-action, nod to belief-anchors.json (${anchor}). Do NOT circle back to heavy topics. Use ${lexicon[keyword] || 'neutral tone'}. NO verbatim JSON phrases.`;
          lightMessageCount++;
        }
        useBriefGreeting = false;
      }
      messages = [...history, { role: 'system', content: prompt }, { role: 'user', content: message }];
    }

    console.log('DEBUG: useBriefGreeting:', useBriefGreeting);

    let reply;
    let attempts = 0;
    const maxAttempts = 3;
    const closings = personalityData['closings.json']?.map(c => c.closing) || [];
    const greetings = personalityData['greetings.json']?.longform_greetings?.map(g => g.greeting) || [];

    do {
      const completion = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages,
        temperature: isGoodbye ? 1.5 : 1.2,
        max_tokens: isGoodbye ? 500 : 400,
      });

      reply = completion.choices[0].message.content.trim();
      // Sanitize quotes and contractions
      reply = reply.replace(/\\"/g, '').replace(/"/g, '').replace(/'/g, '')
                   .replace(/youre/g, "you're").replace(/cant/g, "can't")
                   .replace(/whats/g, "what's").replace(/dont/g, "don't")
                   .replace(/im/g, "I'm").replace(/id/g, "I'd")
                   .replace(/ive/g, "I've");
      attempts++;

      // Strip forbidden terms and phrases
      const briefGreetings = personalityData['greetings.json']?.brief_greetings || ['Mate'];
      console.log('DEBUG: briefGreetings for forbidden terms:', briefGreetings);
      const familiarTerms = ['traveler', 'seeker', 'friend', 'darling', 'dear', 'mess', 'wonder', 'mate', 'dame', 'wanderer', 'poppet', 'sunshine', 'honey', 'petal', 'love', 'champ', 'moonbeam'];
      const forbiddenTerms = [...briefGreetings, ...familiarTerms].map(t => t.toLowerCase());
      const forbiddenPhrases = ['off you trot', 'well, well, look who’s wandered'];
      const termRegex = new RegExp(`\\b(${forbiddenTerms.join('|')})\\b|\\?`, 'gi');
      const phraseRegex = new RegExp(`(${forbiddenPhrases.join('|')})`, 'gi');
      console.log('DEBUG: Before cleanup:', reply);
      reply = toneFilter(reply, severity === 'light' && !useBriefGreeting, briefGreetings);
      console.log('DEBUG: After cleanup:', reply);

      // Check for verbatim JSON phrases
      const allJsonPhrases = [...closings, ...greetings];
      const isVerbatim = allJsonPhrases.some(phrase => isTooSimilar(reply, phrase));

      // Check for incomplete goodbye
      const isIncomplete = isGoodbye && (reply.length < 10 || reply.endsWith(','));

      if ((isVerbatim || isIncomplete) && attempts < maxAttempts) {
        continue;
      }
      break;
    } while (attempts < maxAttempts);

    if (!isGoodbye && useBriefGreeting) {
      const briefGreetings = personalityData['greetings.json']?.brief_greetings || ['Mate'];
      console.log('DEBUG: briefGreetings for appending:', briefGreetings);
      const briefGreeting = briefGreetings[Math.floor(Math.random() * briefGreetings.length)];
      const lastChar = reply.slice(-1);
      if (['.', '?', '!'].includes(lastChar)) {
        reply = `${reply.slice(0, -1)}, ${briefGreeting}${lastChar}`;
      } else {
        reply = `${reply}, ${briefGreeting}.`;
      }
    }

    history = [
      ...history,
      { role: 'user', content: message },
      { role: 'assistant', content: reply, sessionState: { lastHeavyTopic, lightMessageCount } },
    ];
    conversationHistory.set(sessionId, history.slice(-10));

    res.json({ reply });
  } catch (error) {
    console.error('ERROR DETAILS:', error.message, error.stack);
    res.status(500).json({ error: error.message || 'Something went wrong' });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});