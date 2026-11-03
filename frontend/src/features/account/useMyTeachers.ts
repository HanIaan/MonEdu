'use client';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, type TeacherLink } from '@/lib/api';

function asApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  return new ApiError(0, 'UNKNOWN', err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
}

export interface MyTeachersState {
  teachers: TeacherLink[] | null;
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
  /** Merge a freshly created link without a refetch (idempotent by teacher id). */
  addLink: (link: TeacherLink) => void;
}

/** Teachers linked to the signed-in student (docs/contracts/auth.md §5, oldest first). */
export function useMyTeachers(): MyTeachersState {
  const [teachers, setTeachers] = useState<TeacherLink[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    void (async () => {
      try {
        const list = await api.listMyTeachers({ signal: controller.signal });
        if (cancelled) return;
        setTeachers(list);
        setError(null);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(asApiError(err));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [reloadKey]);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  const addLink = useCallback((link: TeacherLink) => {
    setTeachers((prev) => {
      if (!prev) return [link];
      if (prev.some((item) => item.teacher.id === link.teacher.id)) return prev;
      return [...prev, link];
    });
  }, []);

  return { teachers, loading, error, reload, addLink };
}
