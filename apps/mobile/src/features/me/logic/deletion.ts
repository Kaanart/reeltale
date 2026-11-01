// Deleting the account asks twice: a page that says what goes and what stays, then the word typed out.

/** The typed word must match the one shown (case included; extra spaces around it don't count). */
export function isDeleteConfirmed(input: string, word: string): boolean {
  return word.length > 0 && input.trim() === word;
}
