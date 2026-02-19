import { FeedbackResult, Script } from '@/types';

// During development with iOS Simulator, localhost works directly.
// For a physical device, use a tunnel (e.g. `npx localtunnel --port 3000`)
// and replace the DEV URL with the tunnel URL.
const BACKEND_URL = __DEV__
  ? 'http://localhost:3000'
  : 'https://off-book-backend-production.up.railway.app';

export interface ParseResult {
  script: Omit<Script, 'id' | 'createdAt' | 'selectedCharacter'>;
  scriptToken: string;
}

export interface TierInfo {
  tier: 'short' | 'medium' | 'long';
  productId: string;
  price: string;
  label: string;
}

export function getTierForLength(charCount: number): TierInfo {
  if (charCount < 20_000) {
    return {
      tier: 'short',
      productId: 'com.cueline.app.script.short',
      price: '$0.99',
      label: 'Short script',
    };
  } else if (charCount < 60_000) {
    return {
      tier: 'medium',
      productId: 'com.cueline.app.script.medium',
      price: '$1.99',
      label: 'Medium script',
    };
  } else {
    return {
      tier: 'long',
      productId: 'com.cueline.app.script.long',
      price: '$2.99',
      label: 'Long script',
    };
  }
}

async function backendPost<T>(
  path: string,
  body: object,
  scriptToken?: string
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (scriptToken) {
    headers['Authorization'] = `Bearer ${scriptToken}`;
  }

  const resp = await fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error((err as any).error ?? `Backend error ${resp.status}`);
  }

  return resp.json();
}

export async function parseScriptViaBackend(
  rcAppUserId: string,
  productId: string,
  scriptText: string,
  title: string
): Promise<ParseResult> {
  return backendPost<ParseResult>('/api/parse', {
    rcAppUserId,
    productId,
    scriptText,
    title,
  });
}

export async function evaluateLineViaBackend(
  scriptToken: string,
  spokenText: string,
  correctText: string,
  character: string,
  context: string
): Promise<FeedbackResult> {
  return backendPost<FeedbackResult>(
    '/api/evaluate',
    { spokenText, correctText, character, context },
    scriptToken
  );
}

export async function getHintViaBackend(
  scriptToken: string,
  correctText: string,
  attemptText: string,
  hintLevel: 1 | 2 | 3
): Promise<string> {
  const result = await backendPost<{ hint: string }>(
    '/api/hint',
    { correctText, attemptText, hintLevel },
    scriptToken
  );
  return result.hint;
}

export async function getCoachingViaBackend(
  scriptToken: string,
  character: string,
  lineText: string,
  sceneContext: string
): Promise<string> {
  const result = await backendPost<{ question: string }>(
    '/api/coaching',
    { character, lineText, sceneContext },
    scriptToken
  );
  return result.question;
}
