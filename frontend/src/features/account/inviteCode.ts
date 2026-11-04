/** Invite-code input rules (docs/contracts/auth.md §5): upper-cased, spaces and `-` removed. */
export function normalizeInviteCode(input: string): string {
  return input.replace(/[\s-]+/g, '').toUpperCase();
}

/** While typing: upper-case the display but keep spaces/dashes so pasted codes stay readable. */
export function displayInviteCode(input: string): string {
  return input.toUpperCase();
}
