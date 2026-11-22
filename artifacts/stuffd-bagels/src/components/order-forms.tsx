// Shared pieces for the order form (Home.tsx) and the event booking form: one field style,
// the hidden honeypot, and the call to the Worker. Everything posts to our own /api (CSP stays 'self').
import { useId, type ReactNode } from "react";

export type Status = "idle" | "sending" | "sent";

export interface PostResult {
  ok: boolean;
  status: number;
  data: { ok?: boolean; ref?: string; error?: string; redirectUrl?: string; total?: number } | null;
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

/** A row that only states a fact (there is just one pickup point or Saturday, so there is nothing to choose). */
export function FixedRow({ label, value, hint, testId }: { label: string; value: string; hint?: string; testId?: string }) {
  return (
    <div className="flex flex-col" data-testid={testId}>
      <p className="eyebrow px-5 pt-4 pb-1 m-0 text-ink/75">{label}</p>
      <p className={`px-5 m-0 font-semibold text-base leading-snug [overflow-wrap:anywhere] ${hint ? "pb-1" : "pb-4"}`}>{value}</p>
      {hint && <p className="px-5 pb-3 m-0 text-[13px] leading-snug text-ink/75">{hint}</p>}
    </div>
  );
}

/**
 * One-tap time chips: a native radio group (arrow keys move and pick, Tab goes in and out as one stop, screen readers
 * read "1 of 6"). "Any time" is the empty choice, so a pick can always be undone.
 */
export function TimeChips({ legend, slots, value, onChange, hint }: { legend: string; slots: string[]; value: string; onChange: (v: string) => void; hint?: string }) {
  const id = useId();
  const options: [string, string][] = [["", "Any time"], ...slots.map((t): [string, string] => [t, t])];
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0" data-testid="time-chips">
      <legend className="eyebrow px-5 pt-4 pb-2 text-ink/75">{legend}</legend>
      <div className="flex flex-wrap gap-2 px-5 pb-4">
        {options.map(([v, label]) => (
          <label key={label} className="relative">
            <input
              type="radio"
              name={`${id}-time`}
              value={v}
              checked={value === v}
              onChange={() => onChange(v)}
              data-testid={v ? "time-chip" : "time-chip-any"}
              className="peer sr-only"
            />
            <span className="inline-flex min-h-[44px] cursor-pointer select-none items-center whitespace-nowrap rounded-full border-2 border-ink bg-paper px-4 text-sm font-bold text-ink peer-checked:bg-blue peer-checked:text-white peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink">
              {label}
            </span>
          </label>
        ))}
      </div>
      {hint && <p className="-mt-2 px-5 pb-3 m-0 text-[13px] leading-snug text-ink/75">{hint}</p>}
    </fieldset>
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


/** sessionStorage key for the cart and details saved just before the customer goes to Yoco ("Back to my order" restores it). */
export const DRAFT_KEY = "sb-order-draft";

export interface OrderDraft {
  ref: string;
  quantities: Record<string, number>;
  toppingQty: Record<string, number>;
  name: string;
  phone: string;
  email: string;
  pickup: string;
  /** The collection day: a Saturday, or the market day for a market pre-order. */
  saturday: string;
  /** SB-20: the market id when the order was a market pre-order, else "". */
  market: string;
  pickupTime: string;
  notes: string;
}

/** The saved cart, if it is under 2 hours old and well formed. Anything else is ignored (and the key is cleared). */
export function readDraft(): OrderDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<OrderDraft> & { v?: number; savedAt?: number };
    const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
    if (d.v !== 1 || typeof d.savedAt !== "number" || Date.now() - d.savedAt > 2 * 60 * 60 * 1000 || typeof d.quantities !== "object" || d.quantities === null) {
      sessionStorage.removeItem(DRAFT_KEY);
      return null;
    }
    return {
      ref: str(d.ref, 20), quantities: d.quantities as Record<string, number>, toppingQty: (typeof d.toppingQty === "object" && d.toppingQty ? d.toppingQty : {}) as Record<string, number>,
      name: str(d.name, 60), phone: str(d.phone, 20), email: str(d.email, 254), pickup: str(d.pickup, 64), saturday: str(d.saturday, 10), market: /^[A-Za-z0-9_-]{0,64}$/.test(str(d.market, 64)) ? str(d.market, 64) : "", pickupTime: str(d.pickupTime, 40), notes: str(d.notes, 300),
    };
  } catch {
    return null;
  }
}

/** A UUID v4 for one press of the Pay button (the Worker sends it to Yoco as the Idempotency-Key). */
export function newAttemptId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
