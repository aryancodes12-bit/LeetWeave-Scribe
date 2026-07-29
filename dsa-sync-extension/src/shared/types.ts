export type Difficulty = 'Easy' | 'Medium' | 'Hard';
export type OrganizationMode = 'topic' | 'difficulty' | 'custom';

export interface ProblemMetadata {
  id: number;
  slug: string;
  title: string;
  difficulty: Difficulty;
  topics: string[];
  url: string;
  language: string;
  code: string;
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
  /** Optional — user-entered in the popup, stored the same way as githubToken.
   *  Falls back to the build-time GROQ_API_KEY (.env) constant if left empty. */
  groqApiKey?: string;
}

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
