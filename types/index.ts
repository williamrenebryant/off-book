export type LineType = 'spoken' | 'sung' | 'stage_direction';

export interface CueLine {
  character: string;
  text: string;
}

export interface Line {
  id: string;
  character: string;
  text: string;
  type: LineType;
  cues: CueLine[]; // lines immediately before this one
}

export interface Scene {
  id: string;
  number: number;
  title: string;
  lines: Line[];
}

export interface Script {
  id: string;
  title: string;
  characters: string[];
  selectedCharacter: string | null;
  scenes: Scene[];
  createdAt: string;
  rawText?: string;
  pdfUri?: string;
}

export interface LineProgress {
  lineId: string;
  attempts: number;
  correctAttempts: number;
  lastPracticed: string;
  mastered: boolean;
  readyForTest?: boolean;
  practiceDuration?: number;
}

export interface SceneProgress {
  sceneId: string;
  lineProgress: Record<string, LineProgress>;
  completedAt?: string;
}

export interface ScriptProgress {
  scriptId: string;
  character: string;
  sceneProgress: Record<string, SceneProgress>;
  lastPracticed: string;
}

export interface FeedbackResult {
  accurate: boolean;
  score: number; // 0-100
  feedback: string;
  corrections?: string;
  hint?: string;
}

export interface AppSettings {
  anthropicApiKey: string;
  speechLanguage: string;
  cueContext: number; // how many cue lines to show (1-3)
  autoAdvance: boolean;
}
