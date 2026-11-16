import { useState, useEffect, useCallback } from "react";

const ACCENT = "var(--sb-blue)";
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Availability {
  ordersEnabled: boolean;
  closedDates: string[];
  closedMessage: string;
  closedToday: boolean;
  cutoffTime: string;
  maxWeeksAhead: number;
}

interface PickupPoint {
  id: string;
  name: string;
  area: string;
  days: string;
  active: boolean;
}

const BLANK_PICKUP = { name: "", area: "", days: "", active: true };

interface ScheduleEvent {
  id: string;
  name: string;
  venue: string;
  start: string;
  end: string;
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
  const [newEvent, setNewEvent] = useState(BLANK_EVENT);
  const [eventError, setEventError] = useState("");
  const [addingEvent, setAddingEvent] = useState(false);
  const [pickups, setPickups] = useState<PickupPoint[] | null>(null);
  const [pickupForm, setPickupForm] = useState(BLANK_PICKUP);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pickupError, setPickupError] = useState("");
  const [savingPickup, setSavingPickup] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

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
  }, [loadEvents, loadPickups]);

  useEffect(() => {
    if (password) load(password);
  }, []);

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
        maxWeeksAhead: data.maxWeeksAhead,
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
      setSaveMsg("Check the cut-off time and the weeks ahead (1 to 12).");
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
    setPickupForm({ name: pt.name, area: pt.area, days: pt.days, active: pt.active });
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
      body: JSON.stringify({ name: pt.name, area: pt.area, days: pt.days, active: !pt.active }),
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
      {/* Header */}
      <header
        className="border-b-2 border-ink px-6 py-4 flex items-center justify-between"
        style={{ background: "var(--sb-ink)" }}
      >
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="logo" className="h-8 w-8 object-contain invert" />
          <h1
            className="font-black tracking-widest text-white uppercase"
            style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.1rem" }}
          >
            Admin — Stuff'd Bagels
          </h1>
        </div>
        <button
          className="text-white/80 hover:text-white text-xs tracking-widest uppercase font-bold transition-colors"
          onClick={() => {
            sessionStorage.removeItem("admin_pw");
            setAuthed(false);
            setDraft("");
          }}
        >
          Sign Out
        </button>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-10 space-y-10">

        {/* ── 01 Order Status ───────────────────────────────── */}
        <section>
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
        <section>
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
        <section>
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

        {/* ── 04 Collection rules ───────────────────────────── */}
        <section>
          <SectionHead num="04" label="Collection Rules" />
          <p className="text-xs text-ink/75 mb-4 tracking-wide">
            Customers collect on Saturdays only, at your pickup points. Orders for a Saturday close on the Wednesday before.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
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
            <div>
              <label htmlFor="weeks-ahead" className="block text-[10px] font-black tracking-widest uppercase text-ink/75 mb-1">
                Weeks ahead (1 to 12)
              </label>
              <input
                id="weeks-ahead"
                type="number"
                min={1}
                max={12}
                className={inputCls}
                value={data.maxWeeksAhead}
                onChange={(e) => setData({ ...data, maxWeeksAhead: Number(e.target.value) })}
              />
            </div>
          </div>
          <p className="text-xs text-ink/75 mt-3 tracking-wide">
            With {data.cutoffTime || "23:59"}, an order sent at {data.cutoffTime || "23:59"} on Wednesday still counts; from
            the next minute the form offers the following Saturday. Times are South African time.
          </p>
        </section>

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
        <section className="border-t-2 border-ink pt-10" aria-labelledby="pickups-heading">
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
        <section className="border-t-2 border-ink pt-10">
          <SectionHead num="06" label="Markets: Where We At" />
          <p className="text-xs text-ink/75 mb-6 tracking-wide">
            Market dates appear on the home page under "Where we at". They are for information only: no online orders are taken
            for markets, people just buy at the cart. Changes can take up to a minute to show.
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
                  <div key={ev.id} className="flex items-start justify-between border-2 border-ink px-4 py-3">
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
                );
              })}
            </div>
          )}
        </section>

      </main>
    </div>
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
