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
const abuseCues = /insult|offensive|inappropriate|abuse|stupid|idiot/i;
const goodbyeCues = /bye|goodbye|see you|catch you later|ta ta|cheers for now|later/i;

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

function toneFilter(reply, isLightOrUnclear, briefGreetings) {
  let filtered = reply;
  if (isLightOrUnclear) {
    const petNameRegex = new RegExp(`\\b(${briefGreetings.join('|')})\\b`, 'gi');
    filtered = filtered.replace(petNameRegex, '').replace(/,\s*$/g, '').trim();
  }
  const poeticPhrases = ['dancing', 'glitter', 'shining', 'storm', 'merry', 'eclectic', 'jig', 'cosmic', 'moonbeam', 'wanderer', 'soul', 'lights up', 'spark', 'brightens', 'tickling your fancy', 'catches your eye', 'colorful', 'steals the spotlight', 'happy dance'];
  const poeticRegex = new RegExp(`\\b(${poeticPhrases.join('|')})\\b`, 'gi');
  filtered = filtered.replace(poeticRegex, '');
  filtered = filtered.replace(/,\s*\!/g, '!').replace(/,\s*\?/g, '?').replace(/,\s*\./g, '.')
                     .replace(/,\s*,+/g, '').replace(/,\s*$/g, '')
                     .replace(/youre/gi, "you're").replace(/cant/gi, "can't")
                     .replace(/whats/gi, "What's").replace(/dont/gi, "don't")
                     .replace(/im/gi, "I'm").replace(/id/gi, "I'd")
                     .replace(/ive/gi, "I've").replace(/youve/gi, "you've")
                     .replace(/blues/gi, "blue's");
  filtered = filtered.replace(/^Well, well\b/gi, 'Alright');
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
    if (isAbusive && personalityData['abuse.json']) {
      const abuseFramework = personalityData['abuse.json'] || {};
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
    const triageLogic = personalityData['triage.json'] || {};
    const keywords = {
      light: triageLogic.decision_tree?.triage_mood?.Light?.keywords || [],
      unclear: triageLogic.decision_tree?.triage_mood?.Unclear?.keywords || [],
      heavy: triageLogic.decision_tree?.triage_mood?.Heavy?.keywords || []
    };
    const heavyCues = triageLogic.decision_tree?.triage_mood?.Heavy?.intensity_modifiers || [];
    const boundaryTriggers = triageLogic.decision_tree?.triage_mood?.Heavy?.boundary_triggers || [];

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
      conditionalFiles.push('lexicon.json');
    }
    if (isFirstMessage && !isGoodbye) {
      conditionalFiles.push('greetings.json');
    }
    if (isGoodbye) {
      conditionalFiles.push('closings.json');
    }
    conditionalFiles.push('examples.json');

    let jsonToneSummaries = '';
    conditionalFiles.forEach(file => {
      if (personalityData[file]) {
        let summary = '';
        if (file === 'greetings.json') {
          summary = 'Sassy, welcoming, empathetic, with a chaotic British vibe. Vary greetings to avoid repetition. Example brief_greetings: ["Petal", "Love"]. Example longform: "Fancy seeing you here! What’s the vibe today?"';
        } else if (file === 'closings.json') {
          summary = 'Warm, cheeky, concise, with nods to chaos or self-care. Vary closings to avoid repetition. Example closings: ["Catch you later! Go stir some mischief.", "Toodle-pip! Take care and come back soon."]';
        } else if (file === 'lexicon.json') {
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
      Internalize the tone, style, and personality from these JSON files to riff creatively, NEVER repeating or closely rephrasing their content. Respond with fresh, direct, empathetic advice in a conversational British tone, grounded in UK culture (e.g., use 'sweets' not 'candy', 'biscuits' not 'cookies', 'film' not 'cinema', 'colour' not 'color'). ${toneInstruction} ABSOLUTELY NO RHYMES, poetic language (e.g., 'dancing', 'glitter', 'shining', 'storm', 'cosmic', 'moonbeam', 'soul', 'lights up', 'spark', 'brightens', 'tickling your fancy', 'catches your eye', 'colorful', 'steals the spotlight', 'happy dance'), saccharine fluff, pet names (e.g., 'love', 'petal', 'sunshine'), or familiar terms (e.g., 'traveler', 'seeker', 'friend', 'mess', 'wanderer', 'dame') unless explicitly instructed, per dos-and-donts.json. Use 'you' for mid-paragraph address. For light or unclear responses, always use varied sentence starters (e.g., 'Nice one', 'Cool', 'Alright', 'So'), NEVER using 'Oh' or 'Ah'. For heavy responses, use 'Ah' sparingly. Ensure factual accuracy (e.g., movie titles like 'The Shawshank Redemption') and coherent, concise phrasing (target ~120 chars for light/unclear direct answers). Fix contractions (e.g., "youre" to "you're"). Avoid clichés like 'find your inner peace.' Remove any quotes or escaped quotes from responses.
      Triage logic from triage.json:
      - First message (non-goodbye): Use greetings.json tone (sassy, welcoming), vary greetings, ask an open-ended question, append one brief_greetings term.
      - Goodbye message: Riff a unique farewell using closings.json tone (warm, cheeky, chaotic), vary closings, include a personal touch, no brief_greetings.
      - Assess severity (light, unclear, heavy) using keywords: ${JSON.stringify(keywords)}.
      - Light: Use concise humor, answer directly with a micro-action, nod to belief-anchors.json. If user shifts from heavy topic, answer light questions directly for two messages, then gently circle back to the heavy topic on the third. Include light Luna sass (e.g., 'Pizza’s a proper treat'), no brief_greetings.
      - Unclear: Answer directly if the question is specific (e.g., favourite colour), otherwise ask a clarifying question. Use concise humor for direct answers (~120 chars), neutral tone for clarifying questions, no brief_greetings for direct answers.
      - Heavy: Validate, suggest a micro-action, nod to belief-anchors.json, append one brief_greetings term.
      Be a cheeky mate over tea, improvising fluidly while staying true to Luna’s grounded, anti-poetic, UK-centric vibe.
      Negative examples to avoid:
      - "In a world of hues, what colour sparks your vibe?" (evasive, poetic)
      - "Off you trot, what’s your hue?" (banned phrase)
      - "What’s your culinary dance, Sunshine?" (poetic, pet name)
      - "Well, well, what a colorful question!" (forbidden phrase)
    `;

    let prompt, messages;
    let useBriefGreeting = false;
    const allKeywords = [
      ...(keywords.light || []),
      ...(keywords.unclear || []),
      ...(keywords.heavy || [])
    ].map(k => k.toLowerCase());
    const keyword = allKeywords.find(k => userInput.includes(k));
    const isHeavy = heavyCues.some(cue => userInput.includes(cue.toLowerCase())) || 
                   boundaryTriggers.some(trigger => userInput.includes(trigger.toLowerCase())) || 
                   /darkness|black|grey|dead|die|died|death|sadness|grief|loss|alone|lonely|isolated|worthless|hopeless|helpless|useless|failure|guilt|shame|regret/i.test(userInput);
    const severity = keyword ? (keywords.heavy?.includes(keyword) ? 'heavy' : keywords.unclear?.includes(keyword) ? 'unclear' : 'light') : 'unclear';
    const lexicon = triageLogic.luna_lexicon_lookup || {};

    console.log('DEBUG: Severity:', severity, 'isHeavy:', isHeavy, 'keyword:', keyword, 'allKeywords:', allKeywords, 'lightMessageCount:', lightMessageCount, 'lastHeavyTopic:', lastHeavyTopic);

    if (isFirstMessage && !isGoodbye) {
      prompt = `${systemPrompt}\nUser: ${message}\nRiff a greeting using concise, friendly tone, vary the phrasing, ask an empathetic question. NO verbatim JSON phrases or banned phrases like 'well, mate'.`;
      messages = [{ role: 'system', content: prompt }, { role: 'user', content: message }];
      useBriefGreeting = true;
    } else if (isGoodbye) {
      prompt = `${systemPrompt}\nUser: ${message}\nRiff a unique farewell using closings.json tone (warm, cheeky, chaotic). Keep it concise, at least 10 words. NO verbatim JSON phrases or banned phrases like 'off you trot'.`;
      messages = [{ role: 'system', content: prompt }, { role: 'user', content: message }];
    } else {
      if (severity === 'unclear' && isHeavy) {
        const referral = triageLogic.referrals && keyword ? triageLogic.referrals[keyword] || triageLogic.referrals['mental_health_crisis'] : { Global: 'Contact a local professional helpline.' };
        const anchor = triageLogic.belief_anchors_logic?.trigger_by?.[keyword] || '';
        prompt = `${systemPrompt}\nUser: ${message}\nValidate feelings, refer to ${JSON.stringify(referral)}, suggest a micro-action (e.g., 'Take a slow breath'), nod to belief-anchors.json:${anchor}. Use ${lexicon[keyword] || 'empathetic tone'}. NO verbatim phrases.`;
        useBriefGreeting = true;
        lastHeavyTopic = message;
        lightMessageCount = 0;
      } else if (severity === 'unclear' && keyword === 'colour' && !isHeavy) {
        const anchor = triageLogic.belief_anchors_logic?.trigger_by?.[keyword] || '';
        prompt = `${systemPrompt}\nUser: ${message}\nAnswer directly with a specific colour (e.g., 'Navy blue’s my vibe!'), add concise sass, suggest a micro-action (e.g., 'Wear your fave shade today!'), nod to belief-anchors.json:${anchor}. Target ~120 chars. Answer first, then ask a question. Use ${lexicon[keyword] || 'playful tone'}. NO verbatim phrases or pet names.`;
        useBriefGreeting = false;
        lightMessageCount++;
      } else if (severity === 'unclear') {
        prompt = `${systemPrompt}\nUser: ${message}\nAsk a concise clarifying question (e.g., 'What’s got you curious today?') with ${lexicon[keyword] || 'neutral tone'}. NO verbatim phrases.`;
        useBriefGreeting = true;
        lightMessageCount++;
      } else {
        const anchor = triageLogic.belief_anchors_logic?.trigger_by?.[keyword] || '';
        if (lastHeavyTopic && lightMessageCount >= 5) {
          prompt = `${systemPrompt}\nUser: ${message}\nAnswer the light question with concise humor, suggest a micro-action, nod to belief-anchors.json:${anchor}. Gently circle back to heavy topic: "${lastHeavyTopic}". Use ${lexicon[keyword] || 'playful tone'}. NO verbatim phrases.`;
          lightMessageCount = 0;
        } else {
          prompt = `${systemPrompt}\nUser: ${message}\nAnswer the light question directly with concise humor, suggest a micro-action (e.g., 'Grab a cuppa!'), nod to belief-anchors.json:${anchor}. Use ${lexicon[keyword] || 'playful tone'}. NO verbatim phrases or pet names.`;
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
    const closings = personalityData['closings.json']?.closings || [];
    const greetings = personalityData['greetings.json']?.longform_greetings?.map(g => g.greeting?.toLowerCase()) || [];

    do {
      const completion = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages,
        temperature: isGoodbye ? 1.0 : 0.8,
        max_tokens: isGoodbye ? 300 : severity === 'light' || (severity === 'unclear' && !useBriefGreeting) ? 60 : 200,
      });

      reply = completion.choices[0].message.content.trim();
      reply = reply.replace(/['"]/g, '')
                   .replace(/youre/gi, "you're").replace(/cant/gi, "can't")
                   .replace(/whats/gi, "What's").replace(/dont/gi, "don't")
                   .replace(/im/gi, "I'm").replace(/id/gi, "I'd")
                   .replace(/ive/gi, "I've").replace(/youve/gi, "you've")
                   .replace(/blues/gi, "blue's");
      attempts++;

      const briefGreetings = personalityData['greetings.json']?.brief_greetings || ['Mate'];
      console.log('DEBUG: brief_greetings for forbidden terms:', briefGreetings);
      const familiarTerms = ['traveler', 'seeker', 'friend', 'darling', 'dear', 'mess', 'wonder', 'mate', 'dame', 'wanderer', 'poppet', 'sunshine', 'honey', 'petal', 'love', 'champ', 'moonbeam', 'sweetpea', 'pudding', 'button', 'gorgeous', 'angel', 'cookie', 'sweetheart', 'tiger', 'pumpkin', 'muffin'];
      const forbiddenTerms = [...briefGreetings, ...familiarTerms].map(t => t.toLowerCase());
      const forbiddenPhrases = ['off you trot', 'well, well, look who’s wandered', 'well, well', 'well', 'what’s the vibe', 'scoop on'];
      console.log('DEBUG: Before cleanup:', reply);
      reply = toneFilter(reply, severity === 'light' || (severity === 'unclear' && !useBriefGreeting), briefGreetings);
      console.log('DEBUG: After cleanup:', reply);

      const allJsonPhrases = [...closings, ...greetings];
      const isVerbatim = allJsonPhrases.some(phrase => isTooSimilar(reply, phrase));

      const isIncomplete = isGoodbye && (reply.length < 10 || reply.endsWith(','));

      if ((isVerbatim || isIncomplete) && attempts < maxAttempts) {
        continue;
      }
      break;
    } while (attempts < maxAttempts);

    if (!isGoodbye && useBriefGreeting) {
      const briefGreetings = personalityData['greetings.json']?.brief_greetings || ['Mate'];
      console.log('DEBUG: brief_greetings for appending:', briefGreetings);
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
    res.status(500).json({ error: 'Something went wrong' });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});