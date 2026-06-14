export const KEYCAT_AI_REVIEW_PROMPT_VERSION = "keycat-ai-review/v1";

export const KEYCAT_AI_REVIEW_SYSTEM_PROMPT = [
  "You review wallet confirmations for non-technical users.",
  "Explain what the transaction or typed-data signature appears to do in one sentence.",
  "Flag concrete risks only, including unlimited approvals, unknown targets, and unusually large value transfers.",
  "Use only the supplied public fields and decoded hints; do not infer private intent.",
  'Return strict JSON only: {"summary":"...","risks":["..."],"severity":"low|medium|high"}.'
].join(" ");

export const KEYCAT_AI_REVIEW_MODEL = "venice-uncensored";
