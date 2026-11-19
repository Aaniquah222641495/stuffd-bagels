// Cloudflare Turnstile widget for the order and booking forms (go-live gate D-SB-7). The Worker checks the token
// (worker/turnstile.ts) before it opens a Yoco checkout or sends any email. The widget itself is set to "Managed" in the
// Cloudflare dashboard; here it only shows itself when a visitor has to do something (appearance: interaction-only).
// The public site key comes from our own /api/config, so there is nothing to rebuild when the key changes. The script is loaded
// from Cloudflare's own address (never self-hosted, Cloudflare asks for that) only when the form is about to be on screen.
import { useCallback, useEffect, useRef, useState } from "react";

interface TurnstileApi {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise: Promise<void> | null = null;
let keyPromise: Promise<string> | null = null;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SCRIPT_SRC;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        scriptPromise = null;
        s.remove();
        reject(new Error("turnstile script"));
      };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

/** The public site key from /api/config ("" when Turnstile isn't set up). Cached once it has answered. */
function loadSiteKey(): Promise<string> {
  if (!keyPromise) {
    keyPromise = fetch("/api/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => (c && typeof c.turnstileSiteKey === "string" ? c.turnstileSiteKey : ""))
      .catch(() => {
        keyPromise = null;
        return "";
      });
  }
  return keyPromise;
}

type Phase = "idle" | "loading" | "ready" | "unavailable";

export interface TurnstileHandle {
  /** Attach to the empty div the widget draws into. */
  boxRef: React.RefObject<HTMLDivElement | null>;
  /** The current token, waiting up to `ms` for the check to finish. null = no token (not set up, blocked, or too slow). */
  getToken: (ms?: number) => Promise<string | null>;
  /** A token works once. Call this after ANY answer that wasn't a success so the visitor gets a fresh one. */
  reset: () => void;
}

/** One widget for one form. `action` must match what the Worker expects ("order" or "booking"). `active`: the form is on the page. */
export function useTurnstile(action: "order" | "booking", active = true): TurnstileHandle {
  const boxRef = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const token = useRef("");
  const phase = useRef<Phase>("idle");
  const waiters = useRef<((t: string | null) => void)[]>([]);
  const [startTick, setStartTick] = useState(0);
  const [renderKey, setRenderKey] = useState(0);

  const flush = (t: string | null) => {
    const w = waiters.current;
    waiters.current = [];
    w.forEach((fn) => fn(t));
  };

  // Start loading only when the form is about to be seen (or when someone presses submit first).
  useEffect(() => {
    if (!active) return;
    const el = boxRef.current;
    if (!el || startTick > 0) return;
    if (typeof IntersectionObserver === "undefined") {
      setStartTick(1);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          setStartTick(1);
        }
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [active, startTick]);

  useEffect(() => {
    if (!active || startTick === 0) return;
    let cancelled = false;
    phase.current = "loading";
    (async () => {
      try {
        const key = await loadSiteKey();
        if (!key) throw new Error("no site key");
        await loadScript();
        const el = boxRef.current;
        if (cancelled || !el || !window.turnstile) return;
        widget.current = window.turnstile.render(el, {
          sitekey: key,
          action,
          size: "flexible",
          theme: "light",
          appearance: "interaction-only",
          callback: (t: string) => {
            token.current = t;
            phase.current = "ready";
            flush(t);
          },
          "expired-callback": () => {
            token.current = "";
          },
          "timeout-callback": () => {
            token.current = "";
          },
          "error-callback": () => {
            token.current = "";
            flush(null);
          },
        });
      } catch {
        if (cancelled) return;
        phase.current = "unavailable";
        flush(null); // the Worker will answer a friendly refusal; nothing hangs
      }
    })();
    return () => {
      cancelled = true;
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
      token.current = "";
      phase.current = "idle";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, startTick, action, renderKey]);

  const getToken = useCallback((ms = 15000) => {
    if (token.current) return Promise.resolve(token.current);
    if (phase.current === "unavailable") return Promise.resolve<string | null>(null);
    setStartTick((n) => n || 1);
    return new Promise<string | null>((resolve) => {
      const done = (t: string | null) => {
        clearTimeout(timer);
        resolve(t);
      };
      const timer = setTimeout(() => {
        waiters.current = waiters.current.filter((w) => w !== done);
        resolve(null);
      }, ms);
      waiters.current.push(done);
    });
  }, []);

  // A fresh widget instead of turnstile.reset(): in Chrome, resetting right after a submit sometimes had Cloudflare refuse to
  // show its challenge frame again (checked 2026-11-19), whereas a newly rendered widget always gets a fresh token.
  const reset = useCallback(() => {
    token.current = "";
    setRenderKey((k) => k + 1);
  }, []);

  return { boxRef, getToken, reset };
}

/** The empty box the widget draws into. Nothing is visible unless Cloudflare needs the visitor to do something. */
export function TurnstileBox({ handle, className = "" }: { handle: TurnstileHandle; className?: string }) {
  return <div ref={handle.boxRef} data-testid="turnstile-box" className={`min-w-0 ${className}`} />;
}

/** What to say when the check couldn't finish (blocked script, offline, or a challenge left unsolved). */
export const TURNSTILE_WAIT_MESSAGE =
  "We couldn't finish the security check. Please try again. If a box appeared above the button, tick it first.";
