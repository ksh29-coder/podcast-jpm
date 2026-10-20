import { useCallback, useEffect, useRef, useState } from 'react';

// Minimal loader for one API call: data, error, and a reload for pull-to-refresh.
// `deps` are plain values (ids); the call reruns when they change.
export function useFetch<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  // Always call the latest `load` without making it a dependency.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  const key = JSON.stringify(deps);
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setLoading(true);
  }

  useEffect(() => {
    let current = true;
    loadRef.current().then(
      (result) => {
        if (!current) return;
        setData(result);
        setError(null);
        setLoading(false);
      },
      (e) => {
        if (!current) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    );
    return () => {
      current = false;
    };
  }, [key, attempt]);

  const reload = useCallback(() => {
    setLoading(true);
    setAttempt((n) => n + 1);
  }, []);

  return { data, error, loading, reload };
}
