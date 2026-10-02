import { useEffect, useRef } from "react";

// Keep requests sequential and use the latest callback without restarting the timer.
export function useAutoRefresh(load: () => Promise<void>, enabled = true) {
  const latest = useRef(load);
  latest.current = load;
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      if (stopped || pending) return;
      clearTimeout(timer);
      pending = true;
      try {
        await latest.current();
      } finally {
        pending = false;
        if (!stopped) timer = setTimeout(() => void refresh(), 4000);
      }
    };
    const resume = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    void refresh();
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [enabled]);
}
