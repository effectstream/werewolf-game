import { useEffect, useRef, useState } from "react";

const MAX_BACKOFF_MULTIPLIER = 4;

/**
 * Generic polling hook that fetches data at a regular interval.
 * Backs off (up to 4× the base interval) when the response is unchanged,
 * and resets to the base interval immediately on any change.
 * Returns { data, error, loading }.
 */
export function usePolling<T>(
  url: string | null,
  intervalMs: number = 3000,
): { data: T | null; error: string | null; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);
  const lastJsonRef = useRef<string | null>(null);
  const currentIntervalRef = useRef(intervalMs);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!url) {
      setData(null);
      lastJsonRef.current = null;
      currentIntervalRef.current = intervalMs;
      return;
    }

    // Clear stale data and reset backoff when url or base interval changes
    setData(null);
    currentIntervalRef.current = intervalMs;
    lastJsonRef.current = null;

    const scheduleNext = () => {
      timerRef.current = setTimeout(fetchData, currentIntervalRef.current);
    };

    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (mountedRef.current) {
          const serialized = JSON.stringify(json);
          if (serialized === lastJsonRef.current) {
            // Data unchanged — back off, up to the cap
            currentIntervalRef.current = Math.min(
              currentIntervalRef.current * 2,
              intervalMs * MAX_BACKOFF_MULTIPLIER,
            );
          } else {
            // Data changed — reset to base interval
            currentIntervalRef.current = intervalMs;
            lastJsonRef.current = serialized;
            setData(json);
          }
          setError(null);
        }
      } catch (err: any) {
        if (mountedRef.current) {
          setError(err.message);
          // Reset interval on error so we retry at normal speed
          currentIntervalRef.current = intervalMs;
        }
      } finally {
        if (mountedRef.current) {
          setLoading(false);
          scheduleNext();
        }
      }
    };

    fetchData();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [url, intervalMs]);

  return { data, error, loading };
}
