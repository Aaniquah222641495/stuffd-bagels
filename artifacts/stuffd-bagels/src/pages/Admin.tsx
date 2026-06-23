import { useState, useEffect, useCallback } from "react";

const ACCENT = "#C8900F";
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Availability {
  ordersEnabled: boolean;
  closedDates: string[];
  closedMessage: string;
  closedToday: boolean;
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
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [newDate, setNewDate] = useState("");

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
    if (!res.ok) {
      setError("Server error — check that the API is running.");
      return;
    }
    const json: Availability = await res.json();
    setData(json);
    setAuthed(true);
    sessionStorage.setItem("admin_pw", pw);
  }, []);

  useEffect(() => {
    if (password) load(password);
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    await load(draft || password);
    if (draft) setPassword(draft);
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
      }),
    });
    setSaving(false);
    if (res.ok) {
      setSaveMsg("Saved ✓");
      setTimeout(() => setSaveMsg(""), 3000);
    } else if (res.status === 401) {
      setAuthed(false);
      setError("Session expired — please log in again.");
    } else {
      setSaveMsg("Save failed — try again.");
    }
  }

  function addDate() {
    if (!newDate || !data) return;
    if (data.closedDates.includes(newDate)) return;
    setData({ ...data, closedDates: [...data.closedDates, newDate].sort() });
    setNewDate("");
  }

  function removeDate(d: string) {
    if (!data) return;
    setData({ ...data, closedDates: data.closedDates.filter((x) => x !== d) });
  }

  const inputCls =
    "w-full border-2 border-[#1A1A1A] px-3 py-2 text-sm font-medium bg-[#FBFBF9] focus:outline-none focus:border-[#C8900F]";
  const btnCls =
    "border-2 border-[#1A1A1A] px-4 py-2 font-black text-xs tracking-widest uppercase transition-colors";

  if (!authed) {
    return (
      <div className="min-h-screen bg-[#FBFBF9] flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <img src="/logo.png" alt="logo" className="h-16 w-16 mx-auto mb-4 object-contain" />
            <div
              className="font-black tracking-widest uppercase text-xl"
              style={{ fontFamily: "'Bebas Neue', sans-serif" }}
            >
              Admin
            </div>
            <div className="text-xs tracking-widest uppercase text-[#1A1A1A]/40 mt-1">
              Stuff'd Bagels
            </div>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <input
              type="password"
              placeholder="Password"
              autoFocus
              className={inputCls}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            {error && (
              <p className="text-red-600 text-xs font-medium">{error}</p>
            )}
            <button
              type="submit"
              className={`${btnCls} w-full text-white`}
              style={{ background: ACCENT, borderColor: ACCENT }}
            >
              Sign In
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-[#FBFBF9] flex items-center justify-center">
        <p className="text-sm tracking-widest uppercase text-[#1A1A1A]/40">
          Loading…
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FBFBF9]">
      {/* Header */}
      <div
        className="border-b-2 border-[#1A1A1A] px-6 py-4 flex items-center justify-between"
        style={{ background: "#1A1A1A" }}
      >
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="logo" className="h-8 w-8 object-contain invert" />
          <span
            className="font-black tracking-widest text-white uppercase"
            style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.1rem" }}
          >
            Admin — Stuff'd Bagels
          </span>
        </div>
        <button
          className="text-white/40 hover:text-white text-xs tracking-widest uppercase font-bold transition-colors"
          onClick={() => {
            sessionStorage.removeItem("admin_pw");
            setAuthed(false);
            setDraft("");
          }}
        >
          Sign Out
        </button>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-10 space-y-10">

        {/* Orders toggle */}
        <section>
          <div className="flex items-center gap-3 mb-6">
            <span className="font-black tracking-widest text-xs uppercase" style={{ color: ACCENT }}>01</span>
            <h2 className="font-black tracking-widest uppercase text-sm">Order Status</h2>
            <div className="flex-1 h-[2px] bg-[#1A1A1A]" />
          </div>
          <button
            onClick={() => setData({ ...data, ordersEnabled: !data.ordersEnabled })}
            className={`${btnCls} flex items-center gap-3 ${
              data.ordersEnabled
                ? "bg-[#1A1A1A] text-white border-[#1A1A1A]"
                : "bg-red-600 text-white border-red-600"
            }`}
          >
            <span
              className={`inline-block w-3 h-3 rounded-full ${
                data.ordersEnabled ? "bg-green-400" : "bg-white/60"
              }`}
            />
            {data.ordersEnabled ? "Orders Open — click to close" : "Orders Closed — click to open"}
          </button>
          <p className="text-xs text-[#1A1A1A]/40 mt-2 tracking-wide">
            When closed, the order form is replaced with your closed message.
          </p>
        </section>

        {/* Closed message */}
        <section>
          <div className="flex items-center gap-3 mb-6">
            <span className="font-black tracking-widest text-xs uppercase" style={{ color: ACCENT }}>02</span>
            <h2 className="font-black tracking-widest uppercase text-sm">Closed Message</h2>
            <div className="flex-1 h-[2px] bg-[#1A1A1A]" />
          </div>
          <textarea
            rows={3}
            className={inputCls}
            value={data.closedMessage}
            onChange={(e) => setData({ ...data, closedMessage: e.target.value })}
            placeholder="We're closed today — check back soon!"
          />
          <p className="text-xs text-[#1A1A1A]/40 mt-2 tracking-wide">
            Shown on the home page when orders are off or on a closed date.
          </p>
        </section>

        {/* Closed dates */}
        <section>
          <div className="flex items-center gap-3 mb-6">
            <span className="font-black tracking-widest text-xs uppercase" style={{ color: ACCENT }}>03</span>
            <h2 className="font-black tracking-widest uppercase text-sm">Closed Dates</h2>
            <div className="flex-1 h-[2px] bg-[#1A1A1A]" />
          </div>

          <div className="flex gap-2 mb-4">
            <input
              type="date"
              className={`${inputCls} flex-1`}
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
            />
            <button
              onClick={addDate}
              className={`${btnCls} bg-[#1A1A1A] text-white`}
            >
              Add
            </button>
          </div>

          {data.closedDates.length === 0 ? (
            <p className="text-xs text-[#1A1A1A]/40 tracking-wide italic">
              No closed dates set.
            </p>
          ) : (
            <div className="space-y-2">
              {data.closedDates.map((d) => (
                <div
                  key={d}
                  className="flex items-center justify-between border-2 border-[#1A1A1A] px-4 py-2"
                >
                  <span className="font-bold text-sm">{d}</span>
                  <button
                    onClick={() => removeDate(d)}
                    className="text-xs tracking-widest uppercase font-black text-red-600 hover:text-red-800 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-[#1A1A1A]/40 mt-3 tracking-wide">
            Orders are automatically blocked on these dates (SAST timezone).
          </p>
        </section>

        {/* Save */}
        <div className="flex items-center gap-4 pt-2 border-t-2 border-[#1A1A1A]">
          <button
            onClick={save}
            disabled={saving}
            className={`${btnCls} text-white`}
            style={{ background: ACCENT, borderColor: ACCENT }}
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
          {saveMsg && (
            <span className={`text-sm font-bold ${saveMsg.startsWith("Saved") ? "text-green-700" : "text-red-600"}`}>
              {saveMsg}
            </span>
          )}
        </div>

      </div>
    </div>
  );
}
