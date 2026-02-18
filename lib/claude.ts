import { Script, Scene, Line, FeedbackResult } from '@/types';

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

async function callClaude(
  apiKey: string,
  messages: object[],
  systemPrompt: string,
  maxTokens = 4096
): Promise<string> {
  const response = await fetch(ANTHROPIC_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error (${response.status}): ${err}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

// --- Script Parsing ---

export async function parseScript(
  apiKey: string,
  scriptText: string,
  title: string
): Promise<Omit<Script, 'id' | 'createdAt' | 'selectedCharacter'>> {
  const system = `You are a script analysis expert for theatre and musical theatre.
Your job is to parse a script and extract its structure precisely.

IMPORTANT RULES:
- In scripts, character names before their lines are usually in ALL CAPS or bold (e.g., "HAMLET:", "JULIE:")
- Sung lines in musical theatre are often in ALL CAPS or marked differently from spoken lines
- Stage directions are usually in parentheses or italics
- Identify scene breaks by looking for "SCENE", "ACT", "Scene", location headings, or clear breaks in the action
- Extract ONLY actual spoken/sung dialogue lines — not stage directions
- Preserve the EXACT text of each line, including punctuation

Return ONLY valid JSON, no markdown, no explanation.`;

  const prompt = `Parse this script titled "${title}" and return a JSON object with this exact structure:

{
  "title": "Script title",
  "characters": ["CHARACTER1", "CHARACTER2", ...],
  "scenes": [
    {
      "id": "scene_1",
      "number": 1,
      "title": "Act 1, Scene 1" or descriptive title,
      "lines": [
        {
          "id": "line_1_1",
          "character": "CHARACTER NAME",
          "text": "The exact line text",
          "type": "spoken" or "sung"
        },
        ...
      ]
    },
    ...
  ]
}

For "type": use "sung" if the line is in ALL CAPS or clearly marked as a song lyric, otherwise use "spoken".
Character names should be consistent — always use the same capitalization.
If there are no clear scene breaks, put everything in one scene.

Script text:
${scriptText.slice(0, 50000)}`; // limit to avoid token overflow

  const raw = await callClaude(apiKey, [{ role: 'user', content: prompt }], system, 8192);

  // Strip any markdown code blocks if Claude added them
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed = JSON.parse(cleaned);

  // Add cue lines to each line
  const scenesWithCues = parsed.scenes.map((scene: Scene) => {
    const linesWithCues = scene.lines.map((line: Line, idx: number) => {
      const cues = [];
      if (idx > 0) {
        const prev = scene.lines[idx - 1];
        cues.push({ character: prev.character, text: prev.text });
      }
      if (idx > 1) {
        const prevPrev = scene.lines[idx - 2];
        cues.unshift({ character: prevPrev.character, text: prevPrev.text });
      }
      return { ...line, cues };
    });
    return { ...scene, lines: linesWithCues };
  });

  return { ...parsed, scenes: scenesWithCues };
}

// --- Line Feedback ---

export async function evaluateLine(
  apiKey: string,
  spokenText: string,
  correctText: string,
  character: string,
  context: string
): Promise<FeedbackResult> {
  const system = `You are a supportive acting coach helping an actor memorize their lines.
Be encouraging but precise. Focus on what matters for performance memorization.`;

  const prompt = `An actor is memorizing lines for the character "${character}".

Correct line: "${correctText}"
What the actor said: "${spokenText}"
Scene context: ${context}

Evaluate their attempt and respond with ONLY valid JSON in this format:
{
  "accurate": true/false,
  "score": 0-100,
  "feedback": "Brief, warm feedback (1-2 sentences)",
  "corrections": "Only include if score < 90: specifically what was wrong",
  "hint": "Only include if score < 50: a helpful hint (first few words, or a clue about the line)"
}

Score guidelines:
- 95-100: Word-perfect or only trivial differences (articles, minor word order)
- 80-94: Got the gist, minor word substitutions that don't change meaning
- 60-79: Correct meaning but notable word differences
- 40-59: Partial recall, got part of the line
- 0-39: Significantly off or wrong line entirely`;

  const raw = await callClaude(apiKey, [{ role: 'user', content: prompt }], system, 512);
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(cleaned);
}

// --- Coaching Questions ---

export async function getCoachingQuestion(
  apiKey: string,
  character: string,
  lineText: string,
  sceneContext: string
): Promise<string> {
  const system = `You are a thoughtful acting teacher using the Stanislavski method.
You ask questions that help actors discover meaning, not answers that tell them what to feel.
Your questions are concise, Socratic, and open-ended.`;

  const prompt = `The actor is working on this line for the character ${character}:
"${lineText}"

Scene: ${sceneContext}

Ask ONE brief, Socratic question (1-2 sentences max) that would help them find the motivation or subtext for this line. Do NOT answer the question. Do NOT explain the line. Just ask the question.`;

  return callClaude(apiKey, [{ role: 'user', content: prompt }], system, 150);
}

// --- Hint Generation ---

export async function getHint(
  apiKey: string,
  correctText: string,
  attemptText: string,
  hintLevel: 1 | 2 | 3
): Promise<string> {
  const hints = {
    1: `Give the first 3-4 words of this line as a hint: "${correctText}"\nRespond with ONLY the hint words, nothing else.`,
    2: `Give the first half of this line as a hint: "${correctText}"\nRespond with ONLY the hint text, nothing else.`,
    3: `The full line is: "${correctText}"\nThe actor said: "${attemptText}"\nRespond with ONLY the full correct line, nothing else.`,
  };

  return callClaude(
    apiKey,
    [{ role: 'user', content: hints[hintLevel] }],
    'You provide memorization hints for actors. Be precise and brief.',
    100
  );
}
