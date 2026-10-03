import { useCallback, useEffect, useRef, useState } from "react";

export type ConnectionState =
  "connecting" | "live" | "reconnecting" | "offline";

type Snapshot<T> = {
  key: string;
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  lastUpdated: number | undefined;
  connection: ConnectionState;
};

const empty = <T>(key: string, enabled: boolean): Snapshot<T> => ({
  key,
  data: undefined,
  error: undefined,
  loading: enabled,
  lastUpdated: undefined,
  connection: "connecting",
});

// All reads for a resource, including reads after mutations, use this coordinator.
export function useAutoRefresh<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
  enabled = true,
) {
  const latest = useRef(load);
  latest.current = load;
  const identity = useRef({ key, enabled });
  identity.current = { key, enabled };
  const [snapshot, setSnapshot] = useState(() => empty<T>(key, enabled));
  const request = useRef<() => Promise<void>>(async () => {});
  const refresh = useCallback(() => request.current(), []);

  useEffect(() => {
    setSnapshot(empty<T>(key, enabled));
    if (!enabled) {
      request.current = async () => {};
      return;
    }

    let stopped = false;
    let generation = 0;
    let repeat = false;
    let pending: Promise<void> | undefined;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const current = () =>
      !stopped && identity.current.key === key && identity.current.enabled;
    const visible = () => document.visibilityState !== "hidden";
    const online = () => navigator.onLine !== false;
    const update = (fn: (previous: Snapshot<T>) => Snapshot<T>) => {
      if (current())
        setSnapshot((previous) => (current() ? fn(previous) : previous));
    };

    const schedule = () => {
      clearTimeout(timer);
      if (current() && visible() && online())
        timer = setTimeout(() => void run(), 4000);
    };

    const cycle = async () => {
      try {
        do {
          repeat = false;
          const started = generation;
          const active = new AbortController();
          controller = active;
          const timeout = setTimeout(
            () =>
              active.abort(
                new Error(
                  "The manager did not respond within 15 seconds. Retrying automatically.",
                ),
              ),
            15000,
          );
          let abort: (() => void) | undefined;
          update((previous) => ({
            ...previous,
            loading: previous.data === undefined,
            connection: previous.error ? "reconnecting" : previous.connection,
          }));
          try {
            // Racing the signal also protects against loaders that ignore cancellation.
            const result = await Promise.race([
              Promise.resolve().then(() => latest.current(active.signal)),
              new Promise<never>((_resolve, reject) => {
                abort = () => reject(active.signal.reason);
                active.signal.addEventListener("abort", abort, { once: true });
              }),
            ]);
            if (started === generation && !active.signal.aborted)
              update(() => ({
                key,
                data: result,
                error: undefined,
                loading: false,
                lastUpdated: Date.now(),
                connection: "live",
              }));
          } catch (error) {
            if (started === generation)
              update((previous) => ({
                ...previous,
                error:
                  error instanceof Error ? error : new Error(String(error)),
                loading: false,
                connection: online() ? "reconnecting" : "offline",
              }));
          } finally {
            clearTimeout(timeout);
            if (abort) active.signal.removeEventListener("abort", abort);
            controller = undefined;
          }
        } while (repeat && current() && online());
      } finally {
        pending = undefined;
        schedule();
      }
    };

    const run = () => {
      if (!current() || !online()) return Promise.resolve();
      clearTimeout(timer);
      if (pending) {
        // Discard reads started before a mutation; callers share one fresh follow-up.
        generation++;
        repeat = true;
        controller?.abort();
        return pending;
      }
      pending = cycle();
      return pending;
    };
    request.current = run;

    const resume = () => {
      if (visible()) void run();
    };
    const visibility = () => {
      if (visible()) resume();
      else clearTimeout(timer);
    };
    const offline = () => {
      clearTimeout(timer);
      generation++;
      repeat = false;
      controller?.abort();
      update((previous) => ({
        ...previous,
        loading: false,
        connection: "offline",
        error: new Error(
          "You are offline. Updates will resume when the connection returns.",
        ),
      }));
    };

    if (!online()) offline();
    else if (visible()) void run();
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      stopped = true;
      generation++;
      clearTimeout(timer);
      controller?.abort();
      request.current = async () => {};
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [key, enabled]);

  // Identity changes must hide old data even before the effect has cleaned up.
  const value =
    snapshot.key === key && enabled ? snapshot : empty<T>(key, enabled);
  return {
    data: value.data,
    error: value.error,
    loading: value.loading,
    lastUpdated: value.lastUpdated,
    connection: value.connection,
    refresh,
  };
}
