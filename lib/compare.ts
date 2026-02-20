import { FeedbackResult } from '@/types';

type AlignOp =
  | { type: 'match';  spoken: string; correct: string }
  | { type: 'sub';    spoken: string; correct: string }
  | { type: 'ins';    spoken: string }
  | { type: 'del';    correct: string };

// Expand common contractions before tokenizing (handles can't/cannot mismatch)
const CONTRACTIONS: [RegExp, string][] = [
  [/\bcan't\b/g, 'cannot'], [/\bwon't\b/g, 'will not'],
  [/\bi'm\b/g, 'i am'],     [/\bi'll\b/g, 'i will'],
  [/\bi'd\b/g, 'i would'],  [/\bi've\b/g, 'i have'],
  [/\byou're\b/g, 'you are'], [/\byou'll\b/g, 'you will'],
  [/\byou've\b/g, 'you have'], [/\bit's\b/g, 'it is'],
  [/\bthat's\b/g, 'that is'], [/\bdon't\b/g, 'do not'],
  [/\bdidn't\b/g, 'did not'], [/\bwasn't\b/g, 'was not'],
  [/\bweren't\b/g, 'were not'], [/\bcouldn't\b/g, 'could not'],
  [/\bwouldn't\b/g, 'would not'], [/\bshouldn't\b/g, 'should not'],
  [/\bhe's\b/g, 'he is'],   [/\bshe's\b/g, 'she is'],
  [/\bthey're\b/g, 'they are'], [/\bwe're\b/g, 'we are'],
];

function expandContractions(text: string): string {
  let result = text.toLowerCase();
  for (const [pattern, expansion] of CONTRACTIONS) {
    result = result.replace(pattern, expansion);
  }
  return result;
}

function tokenize(text: string): string[] {
  return expandContractions(text)
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(Boolean);
}

// Wagner-Fischer word-level alignment — O(m*n), trivial for lines under 50 words
function align(a: string[], b: string[]): AlignOp[] {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j-1], dp[i-1][j], dp[i][j-1]);
    }
  }
  const ops: AlignOp[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i-1] === b[j-1]) {
      ops.unshift({ type: 'match', spoken: a[i-1], correct: b[j-1] }); i--; j--;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i-1][j-1] + 1) {
      ops.unshift({ type: 'sub', spoken: a[i-1], correct: b[j-1] }); i--; j--;
    } else if (i > 0 && dp[i][j] === dp[i-1][j] + 1) {
      ops.unshift({ type: 'ins', spoken: a[i-1] }); i--;
    } else {
      ops.unshift({ type: 'del', correct: b[j-1] }); j--;
    }
  }
  return ops;
}

export function evaluateLineLocally(spoken: string, correct: string): FeedbackResult {
  const spokenWords  = tokenize(spoken);
  const correctWords = tokenize(correct);

  if (correctWords.length === 0) return { accurate: true, score: 100, feedback: 'Nothing to check.' };
  if (spokenWords.length === 0) return { accurate: false, score: 0, feedback: 'No speech detected.' };

  const ops = align(spokenWords, correctWords);
  const matchCount = ops.filter(o => o.type === 'match').length;
  const score = Math.min(100, Math.round((matchCount / correctWords.length) * 100));
  const accurate = score >= 80;

  const feedback =
    score >= 95 ? 'Nailed it!' :
    score >= 80 ? 'Good — just a few words off.' :
    score >= 60 ? 'Getting there — you have the idea, but check the exact wording.' :
    score >= 40 ? 'Partial — you got part of it. Take another look at the full line.' :
                  'Not quite — try reading the line again before your next attempt.';

  let corrections: string | undefined;
  if (score < 90) {
    const items: string[] = [];
    for (const op of ops) {
      if (items.length >= 5) { items.push('...'); break; }
      if (op.type === 'sub') items.push(`said "${op.spoken}" → correct: "${op.correct}"`);
      if (op.type === 'del') items.push(`missing: "${op.correct}"`);
      if (op.type === 'ins') items.push(`extra: "${op.spoken}"`);
    }
    if (items.length > 0) corrections = items.join('; ');
  }

  return { accurate, score, feedback, corrections };
}

// Hermes-safe: uses capture groups instead of lookbehind assertions
export function splitIntoChunks(text: string): string[] {
  const raw = text.split(/([.!?]+)\s+(?=[A-Z"'])/);
  const pieces: string[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    const piece = ((raw[i] ?? '') + (raw[i + 1] ?? '')).trim();
    if (piece) pieces.push(piece);
  }
  if (pieces.length >= 2) return pieces;

  // Fallback: split long single-sentence lines at commas/semicolons
  if (text.trim().split(/\s+/).length >= 15) {
    const fallback = text.split(/[,;]\s*/).map(s => s.trim()).filter(Boolean);
    if (fallback.length >= 2) return fallback;
  }

  return [text];
}

export function isChunkable(text: string): boolean {
  return splitIntoChunks(text).length >= 2;
}

// Check if a line is long but lacks punctuation (suggesting actor didn't break it up)
export function needsPunctuationTip(text: string): boolean {
  // Only show tip if line is long (15+ words) and doesn't have sentence-ending punctuation
  const wordCount = text.trim().split(/\s+/).length;
  const hasSentenceBreaks = /[.!?]/.test(text);
  return wordCount >= 15 && !hasSentenceBreaks;
}
