/** Dictation labels omit the final sentence stop; meaningful internal punctuation stays. */
export function boardSpeechText(value: string): string {
  return value.trim().replace(/[。．]+$/u, '').replace(/(?<!\.)\.$/u, '').trimEnd();
}
