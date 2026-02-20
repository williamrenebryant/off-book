// Development/Production configuration
// Set DEV_MODE to true during development to use cheaper Haiku model
export const DEV_MODE = true;

// Model selection based on environment
export const MODELS = {
  // For parsing scripts and complex analysis
  ANALYSIS: DEV_MODE ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-6',
  // For line evaluation, hints, coaching
  EVAL: DEV_MODE ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-6',
};

// Development settings
export const DEV_SETTINGS = {
  // Skip expensive coaching questions during dev
  skipCoachingQuestions: DEV_MODE,
  // Log API calls for debugging
  logApiCalls: DEV_MODE,
  // Use mock data for testing (when available)
  useMocks: false,
};

export function getModel(type: 'analysis' | 'eval'): string {
  return MODELS[type === 'analysis' ? 'ANALYSIS' : 'EVAL'];
}
