import type { Role } from '@/lib/api';

export function homeForRole(role: Role | null | undefined): string {
  if (role === 'TEACHER') return '/teacher';
  if (role === 'STUDENT') return '/student';
  return '/login';
}

export function roleLabel(role: Role | null | undefined): string {
  if (role === 'TEACHER') return '교사';
  if (role === 'STUDENT') return '학생';
  return '';
}
