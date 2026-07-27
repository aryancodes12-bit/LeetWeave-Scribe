const LANGUAGE_EXTENSIONS: Record<string, string> = {
  java: 'java',
  python: 'py',
  python3: 'py',
  cpp: 'cpp',
  c: 'c',
  csharp: 'cs',
  javascript: 'js',
  typescript: 'ts',
  golang: 'go',
  kotlin: 'kt',
  swift: 'swift',
  rust: 'rs',
  ruby: 'rb',
  scala: 'scala',
  php: 'php',
  dart: 'dart',
  elixir: 'ex',
  erlang: 'erl',
  racket: 'rkt',
  mysql: 'sql',
  mssql: 'sql',
  oraclesql: 'sql',
  postgresql: 'sql',
};

/** Falls back to the raw LeetCode lang code if it's not in the known map, rather
 *  than throwing — an unrecognized language shouldn't block the sync. */
export function languageToExtension(leetCodeLang: string): string {
  return LANGUAGE_EXTENSIONS[leetCodeLang] ?? leetCodeLang;
}
