/**
 * Client-side mirror of the password policy in docs/contracts/auth.md §1.
 * The server is authoritative; these hints only help the user before submitting.
 */
export interface PasswordRule {
  id: 'length' | 'alnum' | 'email';
  label: string;
  ok: boolean;
}

const BYTE_LIMIT = 72;

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function emailLocalPart(email: string): string {
  const at = email.indexOf('@');
  return (at === -1 ? email : email.slice(0, at)).trim();
}

export function passwordRules(password: string, email: string): PasswordRule[] {
  const localPart = emailLocalPart(email);
  const lowerPassword = password.toLowerCase();
  const containsLocalPart = localPart.length >= 3 && lowerPassword.includes(localPart.toLowerCase());

  return [
    {
      id: 'length',
      label: '8–64자 (최대 72바이트)',
      ok: password.length >= 8 && password.length <= 64 && byteLength(password) <= BYTE_LIMIT,
    },
    {
      id: 'alnum',
      label: '영문과 숫자를 각각 1자 이상 포함',
      ok: /[A-Za-z]/.test(password) && /\d/.test(password),
    },
    {
      id: 'email',
      label:
        localPart.length >= 3
          ? `이메일 아이디(${localPart})를 포함하지 않음`
          : '이메일 아이디를 포함하지 않음',
      ok: !containsLocalPart,
    },
  ];
}

export function passwordPolicySatisfied(password: string, email: string): boolean {
  return passwordRules(password, email).every((rule) => rule.ok);
}
