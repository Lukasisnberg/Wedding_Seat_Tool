"use client";

import { useCallback, useEffect, useRef } from "react";

// Ein unabhängiger Debounce-Timer pro Key — Tisch A wird verschoben, ohne
// den ausstehenden Schreibvorgang für Tisch B zu stören oder zurückzusetzen.
export function useDebouncedKeyedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delayMs: number
) {
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const timerMap = timers.current;
    return () => {
      timerMap.forEach((timer) => clearTimeout(timer));
      timerMap.clear();
    };
  }, []);

  return useCallback(
    (key: string, ...args: Args) => {
      const existing = timers.current.get(key);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        timers.current.delete(key);
        callbackRef.current(...args);
      }, delayMs);
      timers.current.set(key, timer);
    },
    [delayMs]
  );
}
