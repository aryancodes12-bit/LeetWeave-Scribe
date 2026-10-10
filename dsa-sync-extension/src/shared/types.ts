export type Difficulty = 'Easy' | 'Medium' | 'Hard';
export type OrganizationMode = 'topic' | 'difficulty' | 'custom';

export interface ProblemApproaches {
  optimal: string;
  better?: string;
  brute?: string;
  aiGenerated?: {
    better?: boolean;
    brute?: boolean;
  };
}

export interface ProblemMetadata {
  id: number;
  slug: string;
  title: string;
  difficulty: Difficulty;
  topics: string[];
  url: string;
  language: string;
  code: string;
  approaches?: ProblemApproaches;
}

export interface CustomRule {
  topic: string;
  path: string;
}

export interface ExtensionConfig {
  repoOwner: string;
  repoName: string;
  branch: string;
  destinationRoot: string;
  organization: OrganizationMode;
  rules: CustomRule[];
  fallbackFolder: string;
  namingPattern: string;
  githubToken: string;
  /** User-entered Google Gemini API key stored in chrome.storage */
  geminiApiKey?: string;
  /** Configurable Gemini model, default 'gemini-3.5-flash' */
  geminiModel?: string;
  /** Auto-push countdown in seconds, default 8 */
  autoPushSeconds?: number;
  /** Enable synthesized WebAudio sound effects */
  soundEnabled?: boolean;
  /** WebAudio volume (0.0 to 1.0), default 0.5 */
  soundVolume?: number;
}

export interface GeminiNotesApproach {
  name: 'Brute' | 'Better' | 'Optimal';
  idea: string;
  time: string;
  space: string;
}

export interface GeminiNotesData {
  patternTag: string;
  problemSummary: string;
  example: {
    input: string;
    output: string;
  };
  keyInsights: string[];
  approaches: GeminiNotesApproach[];
  edgeCases: string[];
  similarProblems: string[];
}

export type GeminiResult =
  | { ok: true; data: GeminiNotesData; workingModel?: string }
  | { ok: false; reason: string };

export interface SyncedProblem {
  id: number;
  title: string;
  difficulty: Difficulty;
  language: string;
  date: string;
}

export interface SyncStats {
  total: number;
  easy: number;
  medium: number;
  hard: number;
  currentStreak: number;
  longestStreak: number;
  lastSyncedAt: string | null;
  recent: SyncedProblem[];
  timeSavedSeconds: number;
}

export function emptyStats(): SyncStats {
  return {
    total: 0,
    easy: 0,
    medium: 0,
    hard: 0,
    currentStreak: 0,
    longestStreak: 0,
    lastSyncedAt: null,
    recent: [],
    timeSavedSeconds: 0,
  };
}
