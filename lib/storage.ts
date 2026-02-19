import AsyncStorage from '@react-native-async-storage/async-storage';
import { Script, ScriptProgress, AppSettings } from '@/types';

const KEYS = {
  SCRIPTS: 'cueline_scripts',
  PROGRESS: (scriptId: string) => `cueline_progress_${scriptId}`,
  SETTINGS: 'cueline_settings',
};

// --- Scripts ---

export async function getScripts(): Promise<Script[]> {
  const raw = await AsyncStorage.getItem(KEYS.SCRIPTS);
  return raw ? JSON.parse(raw) : [];
}

export async function getScript(id: string): Promise<Script | null> {
  const scripts = await getScripts();
  return scripts.find((s) => s.id === id) ?? null;
}

export async function saveScript(script: Script): Promise<void> {
  const scripts = await getScripts();
  const idx = scripts.findIndex((s) => s.id === script.id);
  if (idx >= 0) {
    scripts[idx] = script;
  } else {
    scripts.unshift(script);
  }
  await AsyncStorage.setItem(KEYS.SCRIPTS, JSON.stringify(scripts));
}

export async function deleteScript(id: string): Promise<void> {
  const scripts = await getScripts();
  const filtered = scripts.filter((s) => s.id !== id);
  await AsyncStorage.setItem(KEYS.SCRIPTS, JSON.stringify(filtered));
  await AsyncStorage.removeItem(KEYS.PROGRESS(id));
}

// --- Progress ---

export async function getProgress(scriptId: string): Promise<ScriptProgress | null> {
  const raw = await AsyncStorage.getItem(KEYS.PROGRESS(scriptId));
  return raw ? JSON.parse(raw) : null;
}

export async function saveProgress(progress: ScriptProgress): Promise<void> {
  await AsyncStorage.setItem(KEYS.PROGRESS(progress.scriptId), JSON.stringify(progress));
}

export function initProgress(scriptId: string, character: string): ScriptProgress {
  return {
    scriptId,
    character,
    sceneProgress: {},
    lastPracticed: new Date().toISOString(),
  };
}

// --- Settings ---

export async function getSettings(): Promise<AppSettings> {
  const raw = await AsyncStorage.getItem(KEYS.SETTINGS);
  const defaults: AppSettings = {
    anthropicApiKey: '',
    speechLanguage: 'en-US',
    cueContext: 1,
    autoAdvance: false,
    hasAcceptedTerms: false,
    audioCueMode: 'text',
    audioStorageSubscribed: false,
  };
  return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
}

export async function saveSettings(settings: Partial<AppSettings>): Promise<void> {
  const current = await getSettings();
  await AsyncStorage.setItem(KEYS.SETTINGS, JSON.stringify({ ...current, ...settings }));
}
