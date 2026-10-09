import type { GeminiNotesData, GeminiResult, ProblemMetadata } from './types.js';

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

export const GEMINI_NOTES_SCHEMA = {
  "type": "OBJECT",
  "properties": {
    "patternTag": {
      "type": "STRING"
    },
    "problemSummary": {
      "type": "STRING"
    },
    "example": {
      "type": "OBJECT",
      "properties": {
        "input": {
          "type": "STRING"
        },
        "output": {
          "type": "STRING"
        }
      }
    },
    "keyInsights": {
      "type": "ARRAY",
      "items": {
        "type": "STRING"
      }
    },
    "approaches": {
      "type": "ARRAY",
      "items": {
        "type": "OBJECT",
        "properties": {
          "name": {
            "type": "STRING"
          },
          "idea": {
            "type": "STRING"
          },
          "time": {
            "type": "STRING"
          },
          "space": {
            "type": "STRING"
          }
        }
      }
    },
    "edgeCases": {
      "type": "ARRAY",
      "items": {
        "type": "STRING"
      }
    },
    "similarProblems": {
      "type": "ARRAY",
      "items": {
        "type": "STRING"
      }
    }
  }
};
