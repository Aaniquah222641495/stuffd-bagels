// Shared pieces for the order form (Home.tsx) and the event booking form: one field style,
// the hidden honeypot, and the call to the Worker. Everything posts to our own /api (CSP stays 'self').
import { useId, type ReactNode } from "react";

export type Status = "idle" | "sending" | "sent";

export interface PostResult {
  ok: boolean;
  status: number;
  data: { ok?: boolean; ref?: string; error?: string } | null;
}

export async function postForm(url: string, body: unknown): Promise<PostResult> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let data: PostResult["data"] = null;
    try {
      data = await res.json();
    } catch {
      /* not JSON */
    }
    return { ok: res.ok && data?.ok === true, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

/** What to tell the visitor when a send fails. Never a technical message. */
export function failureMessage(r: PostResult): string {
  if (r.data?.error && r.status !== 500) return r.data.error;
  return "Something went wrong and we couldn't send that. Please try again, or email stuffd.bagels@gmail.com.";
}

export const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
export const looksLikePhone = (v: string) => {
  const d = v.replace(/[\s\-().]/g, "");
  return /^(?:\+27|0027|27|0)[1-9]\d{8}$/.test(d) || /^(?:\+|00)[1-9]\d{7,14}$/.test(d);
};

/** One labelled row in the card. Shows its own error and links it to the input for screen readers. */
export function FieldRow({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: (p: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}) {
  const id = useId();
  const msgId = `${id}-msg`;
  return (
    <div
      className="flex flex-col"
      style={error ? { boxShadow: "inset 5px 0 0 var(--sb-error)" } : undefined}
    >
      <label htmlFor={id} className="eyebrow px-5 pt-4 pb-1 text-ink/75">
        {label}
      </label>
      {children({ id, describedBy: error || hint ? msgId : undefined, invalid: !!error })}
      {(error || hint) && (
        <p
          id={msgId}
          className={`px-5 pb-3 -mt-1 m-0 text-[13px] leading-snug ${error ? "font-bold text-error" : "text-ink/75"}`}
        >
          {error || hint}
        </p>
      )}
    </div>
  );
}

export const inputClass =
  "px-5 pb-4 bg-transparent font-semibold text-base outline-none placeholder:text-ink/45 focus-visible:bg-sky/30";

/** Bots fill every field they find; people never see this one. Anything in it is dropped silently. */
export function Honeypot({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
      <label>
        Leave this empty
        <input type="text" name="website" tabIndex={-1} autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}

export function PrivacyNote({ what, onDark = false }: { what: string; onDark?: boolean }) {
  return (
    <p className={`text-[13px] mt-4 leading-relaxed px-1 m-0 ${onDark ? "text-white/90" : "text-ink/75"}`}>
      {what} Only STUFF&apos;D Bagels sees it. <a className="font-bold underline underline-offset-2" href="/privacy">Privacy notice</a>.
    </p>
  );
}
