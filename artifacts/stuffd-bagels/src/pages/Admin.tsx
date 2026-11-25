import { useState, useEffect, useCallback, useRef } from "react";
import { collectionSaturdays, isSaturday, marketClash, marketCutoffDay, niceDay, opensOnFor, sastDay, saturdayWarning, skippedSaturdays } from "@/collection";
import type { MarketPreorder } from "@/content";

const ACCENT = "var(--sb-blue)";
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Availability {
  ordersEnabled: boolean;
  closedDates: string[];
  closedMessage: string;
  closedToday: boolean;
  cutoffTime: string;
  addedSaturdays: string[];
  removedSaturdays: string[];
  keptSaturdays: string[];
  opensOn: Record<string, string>;
  /** Link to the prep sheet, from the Worker. Empty until it is set up. */
  prepSheetUrl?: string;
}

interface PickupPoint {
  id: string;
  name: string;
  area: string;
  days: string;
  /** Collection hours, "HH:MM". The order form makes one-hour time chips from them. Older points have none. */
  opens?: string;
  closes?: string;
  active: boolean;
}

const BLANK_PICKUP = { name: "", area: "", days: "", opens: "", closes: "", active: true };

interface ScheduleEvent {
  id: string;
  name: string;
  venue: string;
  start: string;
  end: string;
  preorder?: MarketPreorder;
}

const BLANK_EVENT = { name: "", venue: "", start: "", end: "" };
const TOO_MANY = "Too many tries. Wait 15 minutes and try again.";
const SOMETHING_WRONG = "Something went wrong. Try again in a minute.";

function niceDate(iso: string, opts: Intl.DateTimeFormatOptions) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-ZA", opts);
}

function apiUrl(path: string) {
  return `${BASE}/api${path}`;
}

const ATTENTION_LABEL: Record<AttentionItem["status"], string> = {
  mismatch: "amount paid didn't match",
  email_failed: "emails not sent",
  refund_failed: "cancelled, refund NOT CONFIRMED: check the Yoco app first, refund only if it shows none",
  refund_stuck: "cancelled, refund started but not confirmed: check the Yoco app first, refund only if it shows none",
  cancel_email_failed: "cancelled, cancellation emails not sent",
};

interface AttentionItem {
  ref: string;
  status: "email_failed" | "mismatch" | "refund_failed" | "refund_stuck" | "cancel_email_failed";
  amountCents: number;
  checkoutId: string | null;
  order: unknown;
}

export default function Admin() {
  const [password, setPassword] = useState(
    () => sessionStorage.getItem("admin_pw") ?? ""
  );
  const [draft, setDraft] = useState("");
  const [authed, setAuthed] = useState(false);
  const [data, setData] = useState<Availability | null>(null);
  const [scheduleEvents, setScheduleEvents] = useState<ScheduleEvent[]>([]);
  const [error, setError] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newSat, setNewSat] = useState("");
  const [satMsg, setSatMsg] = useState("");
  const [newEvent, setNewEvent] = useState(BLANK_EVENT);
  const [eventError, setEventError] = useState("");
  const [addingEvent, setAddingEvent] = useState(false);
  const [pickups, setPickups] = useState<PickupPoint[] | null>(null);
  const [pickupForm, setPickupForm] = useState(BLANK_PICKUP);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pickupError, setPickupError] = useState("");
  const [savingPickup, setSavingPickup] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [attention, setAttention] = useState<AttentionItem[]>([]);
  const [navOpen, setNavOpen] = useState(false);
  const navButtonRef = useRef<HTMLButtonElement>(null);
  const navPanelRef = useRef<HTMLDivElement>(null);

  const loadEvents = useCallback(async (pw: string) => {
    const res = await fetch(apiUrl("/admin/events"), {
      headers: { "x-admin-password": pw },
    });
    if (res.ok) setScheduleEvents(await res.json());
  }, []);

  const loadPickups = useCallback(async (pw: string) => {
    const res = await fetch(apiUrl("/admin/pickups"), {
      headers: { "x-admin-password": pw },
    });
    if (res.ok) setPickups(await res.json());
  }, []);

  // Paid orders whose emails could not be sent, and payments that didn't match their order (ADR-0041). Empty is the normal case.
  const loadAttention = useCallback(async (pw: string) => {
    try {
      const res = await fetch(apiUrl("/admin/orders/attention"), { headers: { "x-admin-password": pw } });
      if (res.ok) setAttention(((await res.json()) as { items?: AttentionItem[] }).items ?? []);
    } catch {
      /* the line just doesn't show */
    }
  }, []);

  const load = useCallback(async (pw: string) => {
    setError("");
    const res = await fetch(apiUrl("/admin/availability"), {
      headers: { "x-admin-password": pw },
    });
    if (res.status === 401) {
      setError("Wrong password.");
      sessionStorage.removeItem("admin_pw");
      return;
    }
    if (res.status === 429) {
      setError(TOO_MANY);
      sessionStorage.removeItem("admin_pw");
      return;
    }
    if (!res.ok) {
      setError(SOMETHING_WRONG);
      return;
    }
    const json: Availability = await res.json();
    setData(json);
    setAuthed(true);
    sessionStorage.setItem("admin_pw", pw);
    await loadEvents(pw);
    await loadPickups(pw);
    await loadAttention(pw);
  }, [loadEvents, loadPickups, loadAttention]);

  useEffect(() => {
    if (password) load(password);
  }, []);

  // Mobile menu: Escape and a tap outside close it (Escape returns focus to the button); opening moves focus to the first link;
  // growing to the desktop width shows the inline links instead, so the panel closes.
  useEffect(() => {
    if (!navOpen) return;
    navPanelRef.current?.querySelector("a")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setNavOpen(false);
        navButtonRef.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!navPanelRef.current?.contains(t) && !navButtonRef.current?.contains(t)) setNavOpen(false);
    };
    const mq = window.matchMedia("(min-width: 1024px)");
    const onMq = () => mq.matches && setNavOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    mq.addEventListener("change", onMq);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
      mq.removeEventListener("change", onMq);
    };
  }, [navOpen]);

  function signOut() {
    sessionStorage.removeItem("admin_pw");
    setAuthed(false);
    setDraft("");
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (signingIn) return; // every wrong try counts towards the lock-out, so one click is one try
    setSigningIn(true);
    try {
      const pw = draft || password;
      await load(pw);
      if (draft) setPassword(draft);
    } finally {
      setSigningIn(false);
    }
  }

  async function save() {
    if (!data) return;
    setSaving(true);
    setSaveMsg("");
    const res = await fetch(apiUrl("/admin/availability"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-password": password,
      },
      body: JSON.stringify({
        ordersEnabled: data.ordersEnabled,
        closedDates: data.closedDates,
        closedMessage: data.closedMessage,
        cutoffTime: data.cutoffTime,
        addedSaturdays: data.addedSaturdays,
        removedSaturdays: data.removedSaturdays,
        keptSaturdays: data.keptSaturdays,
        opensOn: data.opensOn,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setSaveMsg("Saved ✓");
      setTimeout(() => setSaveMsg(""), 3000);
    } else if (res.status === 401) {
      setAuthed(false);
      setError("Session expired — please log in again.");
    } else if (res.status === 429) {
      setSaveMsg(TOO_MANY);
    } else if (res.status === 400) {
      setSaveMsg("Check the cut-off time and the collection Saturdays (each one must open on or before its own date).");
    } else {
      setSaveMsg("Save failed — try again.");
    }
  }

  function addClosedDate() {
    if (!newDate || !data) return;
    if (data.closedDates.includes(newDate)) return;
    setData({ ...data, closedDates: [...data.closedDates, newDate].sort() });
    setNewDate("");
  }

  // True when the Saturday is on the built-in list (last Saturday of its month), before any owner changes. "Now" is the
  // Saturday itself, so its own month is always inside the generated window.
  const isDefaultSaturday = (d: string, rules: Availability) =>
    collectionSaturdays(Date.parse(`${d}T12:00:00Z`), { ...rules, addedSaturdays: [], removedSaturdays: [], events: [] }).includes(d);

  // The rules the page and Worker use: the saved lists plus the markets, so skipped Saturdays and warnings match.
  const rulesFor = (a: Availability) => ({ ...a, events: scheduleEvents.map((e) => ({ name: e.name, start: e.start, end: e.end })) });

  // Collection Saturdays: the list is the default (last Saturday of each month) plus what is added, minus what is removed.
  function addSaturday() {
    if (!data || !newSat) return;
    setSatMsg("");
    if (!isSaturday(newSat) || newSat < sastDay(Date.now())) return setSatMsg("Pick a Saturday that has not passed.");
    if (collectionSaturdays(Date.now(), rulesFor(data)).includes(newSat)) return setSatMsg("That Saturday is already on the list.");
    const isDefault = isDefaultSaturday(newSat, data);
    setData({
      ...data,
      removedSaturdays: data.removedSaturdays.filter((x) => x !== newSat),
      keptSaturdays: isDefault && marketClash(newSat, rulesFor(data).events) ? [...new Set([...data.keptSaturdays, newSat])].sort() : data.keptSaturdays,
      addedSaturdays: isDefault ? data.addedSaturdays : [...new Set([...data.addedSaturdays, newSat])].sort(),
    });
    setNewSat("");
  }

  function removeSaturday(d: string) {
    if (!data) return;
    const { [d]: _gone, ...opensOn } = data.opensOn;
    setData({
      ...data,
      opensOn,
      keptSaturdays: data.keptSaturdays.filter((x) => x !== d),
      addedSaturdays: data.addedSaturdays.filter((x) => x !== d),
      removedSaturdays: isDefaultSaturday(d, data) ? [...new Set([...data.removedSaturdays, d])].sort() : data.removedSaturdays,
    });
  }

  function putBackSaturday(d: string) {
    if (!data) return;
    setData({ ...data, removedSaturdays: data.removedSaturdays.filter((x) => x !== d) });
  }

  // A Saturday skipped for a market is put back by keeping it (the market is not removed).
  function keepSkippedSaturday(d: string) {
    if (!data) return;
    setData({ ...data, keptSaturdays: [...new Set([...data.keptSaturdays, d])].sort() });
  }

  function setOpens(d: string, v: string) {
    if (!data) return;
    const { [d]: _old, ...rest } = data.opensOn;
    setData({ ...data, opensOn: v && v !== opensOnFor(d, { opensOn: {} }) ? { ...rest, [d]: v } : rest });
  }

  function removeClosedDate(d: string) {
    if (!data) return;
    setData({ ...data, closedDates: data.closedDates.filter((x) => x !== d) });
  }

  async function addEvent() {
    setEventError("");
    if (!newEvent.name.trim() || !newEvent.venue.trim() || !newEvent.start || !newEvent.end) {
      setEventError("Fill in all fields.");
      return;
    }
    if (newEvent.end < newEvent.start) {
      setEventError("The last day can't be before the first day.");
      return;
    }
    setAddingEvent(true);
    const res = await fetch(apiUrl("/admin/events"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-password": password,
      },
      body: JSON.stringify(newEvent),
    });
    setAddingEvent(false);
    if (res.ok) {
      setNewEvent(BLANK_EVENT);
      // The Worker keeps any default Saturday that is already open for orders and that this market would skip.
      const added: { keptSaturdays?: string[] } = await res.json().catch(() => ({}));
      if (added.keptSaturdays?.length) {
        setData((d) => (d ? { ...d, keptSaturdays: [...new Set([...d.keptSaturdays, ...added.keptSaturdays!])].sort() } : d));
      }
      await loadEvents(password);
    } else if (res.status === 429) {
      setEventError(TOO_MANY);
    } else if (res.status === 400) {
      setEventError("Check the fields. Name up to 60 characters, venue up to 80.");
    } else {
      setEventError(SOMETHING_WRONG);
    }
  }

  async function deleteEvent(id: string) {
    const res = await fetch(apiUrl(`/admin/events/${id}`), {
      method: "DELETE",
      headers: { "x-admin-password": password },
    });
    if (res.ok) await loadEvents(password);
  }

  const adminHeaders = { "Content-Type": "application/json", "x-admin-password": password };

  function startEditPickup(pt: PickupPoint) {
    setEditingId(pt.id);
    setPickupForm({ name: pt.name, area: pt.area, days: pt.days, opens: pt.opens ?? "", closes: pt.closes ?? "", active: pt.active });
    setPickupError("");
    document.getElementById("pk-name")?.focus();
  }

  function cancelEditPickup() {
    setEditingId(null);
    setPickupForm(BLANK_PICKUP);
    setPickupError("");
  }

  async function savePickup() {
    setPickupError("");
    if (!pickupForm.name.trim() || !pickupForm.area.trim()) {
      setPickupError("Fill in the name and the area or address.");
      return;
    }
    if (!!pickupForm.opens !== !!pickupForm.closes || (pickupForm.opens && pickupForm.closes <= pickupForm.opens)) {
      setPickupError("Set both the opening and closing time, and closing must be after opening. Or leave both empty.");
      return;
    }
    setSavingPickup(true);
    const res = await fetch(apiUrl(editingId ? `/admin/pickups/${editingId}` : "/admin/pickups"), {
      method: editingId ? "PUT" : "POST",
      headers: adminHeaders,
      body: JSON.stringify(pickupForm),
    });
    setSavingPickup(false);
    if (res.ok) {
      cancelEditPickup();
      await loadPickups(password);
    } else if (res.status === 429) {
      setPickupError(TOO_MANY);
    } else if (res.status === 400) {
      setPickupError("Check the fields. Name up to 60 characters, area up to 120, times up to 120. You can have up to 30 points.");
    } else if (res.status === 404) {
      setPickupError("That pickup point was already removed.");
      cancelEditPickup();
      await loadPickups(password);
    } else {
      setPickupError(SOMETHING_WRONG);
    }
  }

  async function togglePickup(pt: PickupPoint) {
    const res = await fetch(apiUrl(`/admin/pickups/${pt.id}`), {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({ name: pt.name, area: pt.area, days: pt.days, opens: pt.opens ?? "", closes: pt.closes ?? "", active: !pt.active }),
    });
    if (res.ok) await loadPickups(password);
    else setPickupError(SOMETHING_WRONG);
  }

  async function removePickup(id: string) {
    const res = await fetch(apiUrl(`/admin/pickups/${id}`), {
      method: "DELETE",
      headers: { "x-admin-password": password },
    });
    setConfirmRemoveId(null);
    if (editingId === id) cancelEditPickup();
    if (res.ok) await loadPickups(password);
    else setPickupError(SOMETHING_WRONG);
  }

  // Only a Google Sheets link is ever shown (the Worker checks too).
  const prepUrl = data?.prepSheetUrl && /^https:\/\/docs\.google\.com\/spreadsheets\/d\//.test(data.prepSheetUrl) ? data.prepSheetUrl : "";

  const inputCls =
    "w-full border-2 border-ink px-3 py-2 text-sm font-medium bg-paper focus:outline-none focus:border-blue";
  const btnCls =
    "border-2 border-ink px-4 py-2 font-black text-xs tracking-widest uppercase transition-colors";

  if (!authed) {
    return (
      <main className="min-h-screen bg-paper flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <img src="/logo.png" alt="logo" className="h-16 w-16 mx-auto mb-4 object-contain" />
            <h1
              className="font-black tracking-widest uppercase text-xl"
              style={{ fontFamily: "'Bebas Neue', sans-serif" }}
            >
              Admin
            </h1>
            <div className="text-xs tracking-widest uppercase text-ink/75 mt-1">
              Stuff'd Bagels
            </div>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <input
              type="password"
              aria-label="Admin password"
              autoComplete="current-password"
              placeholder="Password"
              autoFocus
              className={inputCls}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            {error && (
              <p className="text-red-700 text-xs font-medium">{error}</p>
            )}
            <button
              type="submit"
              disabled={signingIn}
              className={`${btnCls} w-full text-white disabled:opacity-60`}
              style={{ background: ACCENT, borderColor: ACCENT }}
            >
              {signingIn ? "Signing in..." : "Sign In"}
            </button>
          </form>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="min-h-screen bg-paper flex items-center justify-center">
        <h1 className="text-sm tracking-widest uppercase text-ink/75">Loading…</h1>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-paper">
      {/* Header: sticky nav bar. Inline links from 1024px; below that a waffle button opens the same links in a panel. */}
      <header className="sticky top-0 z-40 border-b-2 border-ink" style={{ background: "var(--sb-ink)" }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 py-2">
          <a href="#top" className="flex min-h-11 items-center gap-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
            <img src="/logo.png" alt="" className="h-8 w-8 object-contain invert" />
            <h1
              className="font-black tracking-widest text-white uppercase"
              style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.1rem" }}
            >
              Admin<span className="hidden sm:inline"> — Stuff'd Bagels</span>
            </h1>
          </a>
          <nav aria-label="Admin sections" className="hidden lg:flex items-center gap-1">
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href} className={`${navLinkCls} px-3`}>{l.label}</a>
            ))}
            <button onClick={signOut} className={`${navLinkCls} ml-3 border-l border-white/30 pl-5 pr-2`}>Sign Out</button>
          </nav>
          <button
            ref={navButtonRef}
            type="button"
            aria-expanded={navOpen}
            aria-controls="admin-nav-panel"
            aria-label="Menu"
            onClick={() => setNavOpen((o) => !o)}
            className="lg:hidden flex h-11 w-11 items-center justify-center border-2 border-white/60 text-white hover:border-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <span aria-hidden="true" className="grid grid-cols-3 gap-[5px]">
              {Array.from({ length: 9 }, (_, n) => (
                <span key={n} className="block h-[5px] w-[5px] rounded-full bg-current" />
              ))}
            </span>
          </button>
        </div>
        {navOpen && (
          <div id="admin-nav-panel" ref={navPanelRef} className="lg:hidden border-t border-white/20" style={{ background: "var(--sb-ink)" }}>
            <nav aria-label="Admin sections" className="mx-auto flex max-w-6xl flex-col px-2 sm:px-4 py-2">
              {NAV_LINKS.map((l) => (
                <a key={l.href} href={l.href} onClick={() => setNavOpen(false)} className={`${navLinkCls} px-4`}>{l.label}</a>
              ))}
              <button onClick={signOut} className={`${navLinkCls} mt-1 border-t border-white/20 px-4 text-left`}>Sign Out</button>
            </nav>
          </div>
        )}
      </header>

      <main id="top" className="max-w-6xl mx-auto px-4 sm:px-6 py-8 lg:py-10 space-y-10">

        {attention.length > 0 && (
          <section aria-labelledby="attention-heading" data-testid="orders-attention" className="rounded-2xl border-2 border-red-700 bg-white p-5 max-w-3xl">
            <h2 id="attention-heading" className="m-0 text-base font-black text-red-700">
              {attention.length} paid {attention.length === 1 ? "order needs" : "orders need"} you
            </h2>
            <p className="text-sm mt-2 mb-0 text-ink">The customer has paid (check your Yoco app) but we could not send the order emails, or the amount paid did not match. Contact them and fulfil the order by hand. If it says the refund was not confirmed, the customer cancelled in time: open your Yoco app and check whether it already shows a refund for that payment. Only if it does not, refund it in full.</p>
            <ul className="list-none p-0 mt-3 mb-0 space-y-3">
              {attention.map((a) => {
                const o = (a.order ?? {}) as { name?: string; phone?: string; email?: string; pickupDate?: string; pickupPlace?: string; items?: { name: string; qty: number }[] };
                return (
                  <li key={a.ref} className="text-sm border-t border-ink/10 pt-3 [overflow-wrap:anywhere]">
                    <strong>{a.ref}</strong> · {ATTENTION_LABEL[a.status]} · R{(a.amountCents / 100).toFixed(2)}
                    {o.name && <><br />{o.name} · {o.phone} · {o.email}</>}
                    {o.items && <><br />{o.items.map((i) => `${i.qty} x ${i.name}`).join(", ")}</>}
                    {o.pickupPlace && <><br />{o.pickupPlace} on {o.pickupDate}</>}
                    {a.checkoutId && <><br />Yoco checkout id: {a.checkoutId}</>}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* ── Prep sheet ────────────────────────────────────── */}
        <section id="prep-sheet" aria-labelledby="prep-heading" data-testid="prep-sheet" className="scroll-mt-24 border-2 border-ink p-5 sm:p-6" style={{ borderLeftWidth: 8, borderLeftColor: ACCENT }}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 id="prep-heading" className="m-0 font-black tracking-widest uppercase text-sm">Prep sheet: what to make</h2>
              <p className="text-xs text-ink/75 mt-2 mb-0 tracking-wide max-w-xl">
                {prepUrl
                  ? "Every paid order, by collection month, with a To make totals table. It opens in Google Sheets."
                  : "Your prep sheet will appear here once it is set up."}
              </p>
            </div>
            {prepUrl && (
              <a
                href={prepUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`${btnCls} inline-flex min-h-11 shrink-0 items-center justify-center text-white`}
                style={{ background: ACCENT, borderColor: ACCENT }}
              >
                Open prep sheet
              </a>
            )}
          </div>
        </section>

        {/* Desktop: the three short settings on the left, collection rules on the right. Mobile: one column in the same order. */}
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-x-14 lg:items-start">
        <div className="space-y-10">
        {/* ── 01 Order Status ───────────────────────────────── */}
        <section id="order-status" className="scroll-mt-24">
          <SectionHead num="01" label="Order Status" />
          <button
            onClick={() => setData({ ...data, ordersEnabled: !data.ordersEnabled })}
            className={`${btnCls} flex items-center gap-3 ${
              data.ordersEnabled
                ? "bg-ink text-white border-ink"
                : "bg-red-600 text-white border-red-600"
            }`}
          >
            <span
              className={`inline-block w-3 h-3 rounded-full ${
                data.ordersEnabled ? "bg-green-400" : "bg-white/60"
              }`}
            />
            {data.ordersEnabled
              ? "Orders Open — click to close"
              : "Orders Closed — click to open"}
          </button>
          <p className="text-xs text-ink/75 mt-2 tracking-wide">
            When closed, the order form is replaced with your closed message.
          </p>
        </section>

        {/* ── 02 Closed Message ─────────────────────────────── */}
        <section id="closed-message" className="scroll-mt-24">
          <SectionHead num="02" label="Closed Message" />
          <textarea
            aria-label="Closed message"
            rows={3}
            className={inputCls}
            value={data.closedMessage}
            onChange={(e) => setData({ ...data, closedMessage: e.target.value })}
            placeholder="We're closed today — check back soon!"
          />
          <p className="text-xs text-ink/75 mt-2 tracking-wide">
            Shown on the home page when orders are off or on a closed date.
          </p>
        </section>

        {/* ── 03 Closed Dates ───────────────────────────────── */}
        <section id="closed-dates" className="scroll-mt-24">
          <SectionHead num="03" label="Closed Dates" />
          <div className="flex gap-2 mb-4">
            <input
              type="date"
              aria-label="Closed date"
              className={`${inputCls} flex-1`}
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
            />
            <button onClick={addClosedDate} className={`${btnCls} bg-ink text-white`}>
              Add
            </button>
          </div>
          {data.closedDates.length === 0 ? (
            <p className="text-xs text-ink/75 italic tracking-wide">No closed dates set.</p>
          ) : (
            <div className="space-y-2">
              {data.closedDates.map((d) => (
                <div key={d} className="flex items-center justify-between border-2 border-ink px-4 py-2">
                  <span className="font-bold text-sm">{d}</span>
                  <button
                    onClick={() => removeClosedDate(d)}
                    className="text-xs tracking-widest uppercase font-black text-red-700 hover:text-red-900 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-ink/75 mt-3 tracking-wide">
            Add a Saturday here to close it: customers can't choose it for collection. If today is listed, new orders are
            paused for the day (SAST timezone).
          </p>
        </section>
        </div>

        {/* ── 04 Collection rules ───────────────────────────── */}
        <section id="collection-rules" className="scroll-mt-24">
          <SectionHead num="04" label="Collection Rules" />
          <p className="text-xs text-ink/75 mb-4 tracking-wide">
            Customers collect on Saturdays only, at your pickup points. Orders for a Saturday close on the Wednesday before.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label htmlFor="cutoff-time" className="block text-[10px] font-black tracking-widest uppercase text-ink/75 mb-1">
                Wednesday cut-off time
              </label>
              <input
                id="cutoff-time"
                type="time"
                className={inputCls}
                value={data.cutoffTime}
                onChange={(e) => setData({ ...data, cutoffTime: e.target.value })}
              />
            </div>
          </div>
          <p className="text-xs text-ink/75 mt-3 tracking-wide">
            With {data.cutoffTime || "23:59"}, an order sent at {data.cutoffTime || "23:59"} on Wednesday still counts; from
            the next minute that Saturday is closed. Times are South African time.
          </p>

          <h3 className="mt-8 mb-1 text-sm font-black tracking-widest uppercase">Collection Saturdays</h3>
          <p className="text-xs text-ink/75 mb-4 tracking-wide">
            Customers can only order for the Saturdays listed here. The list starts as the last Saturday of each month.
            Orders for each one open on the day you set (the 15th unless you change it) and close on the Wednesday before.
          </p>
          <div className="space-y-2" data-testid="collection-saturdays">
            {collectionSaturdays(Date.now(), rulesFor(data)).map((d) => (
              <div key={d} className="flex flex-wrap items-center justify-between gap-3 border-2 border-ink px-4 py-2" data-testid={`sat-${d}`}>
                <span className="font-bold text-sm">
                  {niceDay(d)}
                  {saturdayWarning(d, rulesFor(data)) && (
                    <span className="block text-xs font-bold text-red-700 mt-1" data-testid={`warn-${d}`}>
                      Warning: {saturdayWarning(d, rulesFor(data))}. Orders for it are still open.
                    </span>
                  )}
                </span>
                <label className="flex items-center gap-2 whitespace-nowrap text-xs font-bold tracking-wide">
                  Orders open on
                  <input
                    type="date"
                    aria-label={`Orders open on, for ${niceDay(d)}`}
                    className={`${inputCls} w-auto`}
                    value={opensOnFor(d, data)}
                    max={d}
                    onChange={(e) => setOpens(d, e.target.value)}
                  />
                </label>
                <button
                  onClick={() => removeSaturday(d)}
                  aria-label={`Remove ${niceDay(d)} from collection Saturdays`}
                  className="text-xs tracking-widest uppercase font-black text-red-700 hover:text-red-900 transition-colors"
                >
                  Remove
                </button>
              </div>
            ))}
            {collectionSaturdays(Date.now(), rulesFor(data)).length === 0 && (
              <p className="text-xs text-ink/75 italic tracking-wide">No collection Saturdays listed, so ordering is hidden.</p>
            )}
          </div>
          <div className="flex gap-2 mt-4">
            <input
              type="date"
              aria-label="Saturday to add"
              className={`${inputCls} flex-1`}
              value={newSat}
              onChange={(e) => setNewSat(e.target.value)}
            />
            <button onClick={addSaturday} className={`${btnCls} bg-ink text-white`}>
              Add Saturday
            </button>
          </div>
          {skippedSaturdays(Date.now(), rulesFor(data)).length > 0 && (
            <div className="mt-4 space-y-2" data-testid="skipped-saturdays">
              {skippedSaturdays(Date.now(), rulesFor(data)).map((x) => (
                <div key={x.date} className="flex flex-wrap items-center justify-between gap-3 border-2 border-dashed border-ink px-4 py-2" data-testid={`skipped-${x.date}`}>
                  <span className="text-sm font-bold">
                    {niceDay(x.date)} <span className="font-medium text-ink/75">Skipped: {x.event} that weekend</span>
                  </span>
                  <button onClick={() => keepSkippedSaturday(x.date)} aria-label={`Put ${niceDay(x.date)} back on the list`} className="underline text-xs font-black tracking-widest uppercase">
                    Put back
                  </button>
                </div>
              ))}
            </div>
          )}
          {satMsg && <p role="alert" className="text-xs font-bold text-red-700 mt-2">{satMsg}</p>}
          {data.removedSaturdays.filter((d) => d >= sastDay(Date.now())).length > 0 && (
            <p className="text-xs text-ink/75 mt-3 tracking-wide">
              Taken off:{" "}
              {data.removedSaturdays.filter((d) => d >= sastDay(Date.now())).map((d) => (
                <button key={d} onClick={() => putBackSaturday(d)} className="underline font-bold mr-3" aria-label={`Put ${niceDay(d)} back on the list`}>
                  {niceDay(d)} (put back)
                </button>
              ))}
            </p>
          )}
        </section>
        </div>

        {/* ── Save availability ─────────────────────────────── */}
        <div className="flex items-center gap-4 border-t-2 border-ink pt-6">
          <button
            onClick={save}
            disabled={saving}
            className={`${btnCls} text-white`}
            style={{ background: ACCENT, borderColor: ACCENT }}
          >
            {saving ? "Saving…" : "Save Availability and Rules"}
          </button>
          {saveMsg && (
            <span className={`text-sm font-bold ${saveMsg.startsWith("Saved") ? "text-green-800" : "text-red-700"}`}>
              {saveMsg}
            </span>
          )}
        </div>

        {/* ── 05 Pickup points ─────────────────────────────── */}
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-x-14 lg:items-start lg:border-t-2 lg:border-ink lg:pt-10">
        <section id="pickups" className="scroll-mt-24 border-t-2 border-ink pt-10 lg:pt-0 lg:border-t-0" aria-labelledby="pickups-heading">
          <SectionHead num="05" label="Pickup Points" id="pickups-heading" />
          <p className="text-xs text-ink/75 mb-6 tracking-wide">
            Where customers collect their online orders, on Saturdays. They choose one when they order. Changes can take up
            to a minute to show.
          </p>

          {pickups !== null && !pickups.some((p) => p.active) && (
            <p
              role="status"
              data-testid="pickups-none-active"
              className="border-2 border-red-700 text-red-700 px-4 py-3 text-xs font-bold tracking-wide mb-6"
            >
              {pickups.length === 0
                ? "No pickup points yet. Online ordering is hidden on the site until you add one."
                : "No pickup point is switched on. Online ordering is hidden on the site until you switch one on."}
            </p>
          )}

          <div className="border-2 border-ink p-5 mb-6 space-y-3">
            <div className="font-black text-xs tracking-widest uppercase mb-4" style={{ color: ACCENT }}>
              {editingId ? "Edit Pickup Point" : "Add Pickup Point"}
            </div>
            <div>
              <label htmlFor="pk-name" className="block text-[10px] font-black tracking-widest uppercase text-ink/75 mb-1">
                Name
              </label>
              <input
                id="pk-name"
                type="text"
                maxLength={60}
                placeholder="Name of the pickup point"
                className={inputCls}
                value={pickupForm.name}
                onChange={(e) => setPickupForm({ ...pickupForm, name: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="pk-area" className="block text-[10px] font-black tracking-widest uppercase text-ink/75 mb-1">
                Area or address (shown to customers)
              </label>
              <input
                id="pk-area"
                type="text"
                maxLength={120}
                className={inputCls}
                value={pickupForm.area}
                onChange={(e) => setPickupForm({ ...pickupForm, area: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="pk-days" className="block text-[10px] font-black tracking-widest uppercase text-ink/75 mb-1">
                Collection times (optional)
              </label>
              <input
                id="pk-days"
                type="text"
                maxLength={120}
                placeholder="e.g. Saturdays, 10am to 1pm"
                className={inputCls}
                value={pickupForm.days}
                onChange={(e) => setPickupForm({ ...pickupForm, days: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="pk-opens" className="block text-[10px] font-black tracking-widest uppercase text-ink/75 mb-1">
                  Opens (optional)
                </label>
                <input
                  id="pk-opens"
                  type="time"
                  className={inputCls}
                  value={pickupForm.opens}
                  onChange={(e) => setPickupForm({ ...pickupForm, opens: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="pk-closes" className="block text-[10px] font-black tracking-widest uppercase text-ink/75 mb-1">
                  Closes (optional)
                </label>
                <input
                  id="pk-closes"
                  type="time"
                  className={inputCls}
                  value={pickupForm.closes}
                  onChange={(e) => setPickupForm({ ...pickupForm, closes: e.target.value })}
                />
              </div>
            </div>
            <p className="text-xs text-ink/75 -mt-1 m-0">
              With an opening and closing time, customers can tap a one-hour slot (for example 1pm to 2pm) as their preferred time.
            </p>
            <label className="flex items-center gap-2 text-xs font-bold tracking-wide cursor-pointer">
              <input
                id="pk-active"
                type="checkbox"
                className="w-4 h-4 accent-[var(--sb-blue)]"
                checked={pickupForm.active}
                onChange={(e) => setPickupForm({ ...pickupForm, active: e.target.checked })}
              />
              Active (customers can choose it)
            </label>
            {pickupError && (
              <p role="alert" className="text-red-700 text-xs font-medium">{pickupError}</p>
            )}
            <div className="flex gap-3 mt-2">
              <button
                onClick={savePickup}
                disabled={savingPickup}
                className={`${btnCls} text-white`}
                style={{ background: ACCENT, borderColor: ACCENT }}
              >
                {savingPickup ? "Saving…" : editingId ? "Save Changes" : "Add Pickup Point"}
              </button>
              {editingId && (
                <button onClick={cancelEditPickup} className={`${btnCls} bg-paper text-ink`}>
                  Cancel
                </button>
              )}
            </div>
          </div>

          {pickups !== null && pickups.length > 0 && (
            <ul className="space-y-3 list-none p-0 m-0" data-testid="pickup-list">
              {pickups.map((pt) => (
                <li key={pt.id} className="border-2 border-ink px-4 py-3" data-testid="pickup-item">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-black text-sm">
                        {pt.name}
                        <span
                          className={`ml-2 align-middle text-[10px] tracking-widest uppercase px-2 py-0.5 ${
                            pt.active ? "bg-ink text-white" : "border border-ink text-ink"
                          }`}
                        >
                          {pt.active ? "Active" : "Off"}
                        </span>
                      </div>
                      <div className="text-xs text-ink/75 font-medium mt-0.5">{pt.area}</div>
                      {pt.days && <div className="text-xs text-ink/75 mt-0.5">{pt.days}</div>}
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <button
                        onClick={() => togglePickup(pt)}
                        aria-label={`${pt.active ? "Switch off" : "Switch on"} ${pt.name}`}
                        className="text-xs tracking-widest uppercase font-black text-ink hover:text-blue transition-colors"
                      >
                        {pt.active ? "Switch off" : "Switch on"}
                      </button>
                      <button
                        onClick={() => startEditPickup(pt)}
                        aria-label={`Edit ${pt.name}`}
                        className="text-xs tracking-widest uppercase font-black text-ink hover:text-blue transition-colors"
                      >
                        Edit
                      </button>
                      {confirmRemoveId === pt.id ? (
                        <span className="text-xs font-black tracking-widest uppercase">
                          Sure?{" "}
                          <button
                            onClick={() => removePickup(pt.id)}
                            aria-label={`Yes, remove ${pt.name}`}
                            className="text-red-700 hover:text-red-900 underline"
                          >
                            Yes
                          </button>{" "}
                          <button onClick={() => setConfirmRemoveId(null)} aria-label="No, keep it" className="underline">
                            No
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmRemoveId(pt.id)}
                          aria-label={`Remove ${pt.name}`}
                          className="text-xs tracking-widest uppercase font-black text-red-700 hover:text-red-900 transition-colors"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── 06 Market dates ──────────────────────────────── */}
        <section id="markets" className="scroll-mt-24 border-t-2 border-ink pt-10 lg:pt-0 lg:border-t-0">
          <SectionHead num="06" label="Markets: Where We At" />
          <p className="text-xs text-ink/75 mb-6 tracking-wide">
            Market dates appear on the home page under "Where we at". By default people just buy at the cart. Switch on
            "Take pre-orders" for a market and customers can order and pay online, then collect at your stall on the day they
            pick. Changes can take up to a minute to show.
          </p>

          {/* Add new event form */}
          <div className="border-2 border-ink p-5 mb-6 space-y-3">
            <div className="font-black text-xs tracking-widest uppercase mb-4" style={{ color: ACCENT }}>
              Add New Event
            </div>
            <div>
              <label htmlFor="ev-name" className="block text-[10px] font-black tracking-widest uppercase text-ink/75 mb-1">
                Event name
              </label>
              <input
                id="ev-name"
                type="text"
                maxLength={60}
                placeholder="Luxe Cape Club"
                className={inputCls}
                value={newEvent.name}
                onChange={(e) => setNewEvent({ ...newEvent, name: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="ev-venue" className="block text-[10px] font-black tracking-widest uppercase text-ink/75 mb-1">
                Venue / Location
              </label>
              <input
                id="ev-venue"
                type="text"
                maxLength={80}
                placeholder="Sans Souci Grounds, Newlands"
                className={inputCls}
                value={newEvent.venue}
                onChange={(e) => setNewEvent({ ...newEvent, venue: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="ev-start" className="block text-[10px] font-black tracking-widest uppercase text-ink/75 mb-1">
                  First day
                </label>
                <input
                  id="ev-start"
                  type="date"
                  className={inputCls}
                  value={newEvent.start}
                  onChange={(e) =>
                    setNewEvent({ ...newEvent, start: e.target.value, end: newEvent.end || e.target.value })
                  }
                />
              </div>
              <div>
                <label htmlFor="ev-end" className="block text-[10px] font-black tracking-widest uppercase text-ink/75 mb-1">
                  Last day
                </label>
                <input
                  id="ev-end"
                  type="date"
                  className={inputCls}
                  value={newEvent.end}
                  min={newEvent.start || undefined}
                  onChange={(e) => setNewEvent({ ...newEvent, end: e.target.value })}
                />
              </div>
            </div>
            {eventError && (
              <p className="text-red-700 text-xs font-medium">{eventError}</p>
            )}
            <button
              onClick={addEvent}
              disabled={addingEvent}
              className={`${btnCls} text-white mt-2`}
              style={{ background: ACCENT, borderColor: ACCENT }}
            >
              {addingEvent ? "Adding…" : "Add Event"}
            </button>
          </div>

          {/* Existing events list */}
          {scheduleEvents.length === 0 ? (
            <p className="text-xs text-ink/75 italic tracking-wide">
              No events scheduled yet.
            </p>
          ) : (
            <div className="space-y-3">
              {scheduleEvents.map((ev) => {
                const when =
                  ev.start === ev.end
                    ? niceDate(ev.start, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
                    : `${niceDate(ev.start, { day: "numeric", month: "long" })} to ${niceDate(ev.end, { day: "numeric", month: "long", year: "numeric" })}`;
                return (
                  <div key={ev.id} className="border-2 border-ink px-4 py-3" data-testid={`event-${ev.id}`}>
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-black text-sm">{ev.name}</div>
                        <div className="text-xs text-ink/75 font-medium mt-0.5">{ev.venue}</div>
                        <div className="text-xs text-ink/75 mt-0.5">{when}</div>
                      </div>
                      <button
                        onClick={() => deleteEvent(ev.id)}
                        aria-label={`Remove ${ev.name}`}
                        className="text-xs tracking-widest uppercase font-black text-red-700 hover:text-red-900 transition-colors ml-4 shrink-0"
                      >
                        Remove
                      </button>
                    </div>
                    <PreorderEditor ev={ev} password={password} cutoffTime={data?.cutoffTime ?? "23:59"} inputCls={inputCls} btnCls={btnCls} onSaved={() => loadEvents(password)} />
                  </div>
                );
              })}
            </div>
          )}
        </section>
        </div>

      </main>
    </div>
  );
}

const NAV_LINKS = [
  { href: "#prep-sheet", label: "Prep sheet" },
  { href: "#order-status", label: "Orders" },
  { href: "#closed-message", label: "Message" },
  { href: "#closed-dates", label: "Closed dates" },
  { href: "#collection-rules", label: "Collection" },
  { href: "#pickups", label: "Pickups" },
  { href: "#markets", label: "Markets" },
];
const navLinkCls =
  "flex min-h-11 items-center text-xs tracking-widest uppercase font-bold text-white/80 hover:text-white transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white";

const LONGEST_PREORDER_MARKET_DAYS = 14;

/** Every date from first to last day, inclusive (YYYY-MM-DD). */
function daysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`) && out.length <= LONGEST_PREORDER_MARKET_DAYS; t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** SB-20: one market's pre-order settings: the toggle, the day orders open, which days, and the stall hours. */
function PreorderEditor({
  ev, password, cutoffTime, inputCls, btnCls, onSaved,
}: {
  ev: ScheduleEvent;
  password: string;
  cutoffTime: string;
  inputCls: string;
  btnCls: string;
  onSaved: () => void;
}) {
  const days = daysBetween(ev.start, ev.end);
  const tooLong = days.length > LONGEST_PREORDER_MARKET_DAYS;
  const saved = ev.preorder;
  const [enabled, setEnabled] = useState(saved?.enabled ?? false);
  const [opensOn, setOpensOn] = useState(saved?.opensOn ?? "");
  // Never set before: every day of the market is ticked, as the spec says.
  const [picked, setPicked] = useState<string[]>(saved && saved.days.length > 0 ? saved.days : days);
  const [opens, setOpens] = useState(saved && saved.opens !== "00:00" ? saved.opens : "");
  const [closes, setCloses] = useState(saved && saved.closes !== "00:01" ? saved.closes : "");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const id = `po-${ev.id}`;
  const label = "block text-[10px] font-black tracking-widest uppercase text-ink/75 mb-1";

  async function save() {
    setMsg("");
    setBusy(true);
    const res = await fetch(`${BASE}/api/admin/events/${encodeURIComponent(ev.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-admin-password": password },
      body: JSON.stringify({ preorder: { enabled, opensOn: opensOn || undefined, days: picked, opens, closes } }),
    });
    setBusy(false);
    if (res.ok) {
      setMsg(enabled ? "Saved. Pre-orders are on for this market." : "Saved. Pre-orders are off: people just buy at the cart.");
      onSaved();
      return;
    }
    const body: { error?: string } = await res.json().catch(() => ({}));
    setMsg(res.status === 400 && body.error ? body.error : res.status === 429 ? TOO_MANY : SOMETHING_WRONG);
  }

  return (
    <fieldset className="mt-4 border-t-2 border-ink/20 pt-3" data-testid={`preorder-${ev.id}`}>
      <legend className="sr-only">Pre-orders for {ev.name}</legend>
      {tooLong ? (
        <p className="text-xs text-ink/75">Pre-orders work for markets of up to {LONGEST_PREORDER_MARKET_DAYS} days. This one is longer.</p>
      ) : (
        <div className="space-y-3">
          <label className="flex items-center gap-3 text-sm font-black min-h-11">
            <input type="checkbox" data-testid={`${id}-toggle`} checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-5 w-5 accent-[var(--sb-blue)]" />
            Take pre-orders
          </label>
          {enabled && (
            <p className="text-xs text-ink/75">
              Customers can order until Wednesday {niceDay(marketCutoffDay(ev.start)).replace(/^\w+ /, "")} at {cutoffTime} (the Wednesday before the first day), then pre-orders close.
              Before that they can cancel for an automatic refund.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={`${id}-open`} className={label}>Stall opens</label>
              <input id={`${id}-open`} type="time" data-testid={`${id}-opens`} className={inputCls} value={opens} onChange={(e) => setOpens(e.target.value)} />
            </div>
            <div>
              <label htmlFor={`${id}-close`} className={label}>Stall closes</label>
              <input id={`${id}-close`} type="time" data-testid={`${id}-closes`} className={inputCls} value={closes} onChange={(e) => setCloses(e.target.value)} />
            </div>
          </div>
          <div>
            <label htmlFor={`${id}-from`} className={label}>Orders open on (optional)</label>
            <input id={`${id}-from`} type="date" data-testid={`${id}-opens-on`} className={inputCls} value={opensOn} max={marketCutoffDay(ev.start)} onChange={(e) => setOpensOn(e.target.value)} />
            <p className="text-xs text-ink/75 mt-1">Leave empty to open as soon as you switch it on.</p>
          </div>
          <div role="group" aria-label={`Pre-order days for ${ev.name}`}>
            <div className={label}>Pre-order days</div>
            <div className="flex flex-wrap gap-2">
              {days.map((d) => (
                <label key={d} className="inline-flex items-center gap-2 border-2 border-ink px-3 min-h-11 text-xs font-black">
                  <input
                    type="checkbox" data-testid={`${id}-day-${d}`} checked={picked.includes(d)} className="h-4 w-4 accent-[var(--sb-blue)]"
                    onChange={(e) => setPicked(e.target.checked ? [...picked, d].sort() : picked.filter((x) => x !== d))}
                  />
                  {niceDay(d)}
                </label>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={save} disabled={busy} data-testid={`${id}-save`} className={`${btnCls} text-white`} style={{ background: ACCENT, borderColor: ACCENT }}>
              {busy ? "Saving…" : "Save pre-order settings"}
            </button>
            {msg && <p role="status" className="text-xs font-medium">{msg}</p>}
          </div>
        </div>
      )}
    </fieldset>
  );
}

function SectionHead({ num, label, id }: { num: string; label: string; id?: string }) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <span className="font-black tracking-widest text-xs uppercase" style={{ color: ACCENT }}>
        {num}
      </span>
      <h2 id={id} className="font-black tracking-widest uppercase text-sm">{label}</h2>
      <div className="flex-1 h-[2px] bg-ink" />
    </div>
  );
}
