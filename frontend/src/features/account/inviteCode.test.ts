import { displayInviteCode, normalizeInviteCode } from './inviteCode';

describe('invite code normalisation', () => {
  it('upper-cases while typing and keeps spaces/dashes in the display', () => {
    expect(displayInviteCode('abcd-2345')).toBe('ABCD-2345');
    expect(displayInviteCode('ab cd')).toBe('AB CD');
  });

  it('removes spaces and dashes for the request', () => {
    expect(normalizeInviteCode(' abcd-2345 ')).toBe('ABCD2345');
    expect(normalizeInviteCode('AB CD 23-45')).toBe('ABCD2345');
  });
});
