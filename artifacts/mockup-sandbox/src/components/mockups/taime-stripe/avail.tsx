import React, { useState } from "react";
import { ChevronLeft, ChevronRight, Save, Check, X } from "lucide-react";

const S = {
  bg: "#FFFFFF", surface: "#F8FAFF", card: "#FFFFFF",
  border: "#E8EDF8", primary: "#5B6CF0", primarySoft: "#EEF0FF",
  dark: "#0D1F3C", mid: "#445578", light: "#8898AA",
  green: "#00C48C", greenSoft: "#E6FAF4",
  red: "#F43F5E", redSoft: "#FFF0F3",
  shadow: "0 1px 3px rgba(0,18,60,0.06), 0 4px 16px rgba(0,18,60,0.04)",
};

const DAYS = [
  { key: "Mon", label: "Monday",    date: "May 5" },
  { key: "Tue", label: "Tuesday",   date: "May 6" },
  { key: "Wed", label: "Wednesday", date: "May 7" },
  { key: "Thu", label: "Thursday",  date: "May 8" },
  { key: "Fri", label: "Friday",    date: "May 9" },
  { key: "Sat", label: "Saturday",  date: "May 10" },
  { key: "Sun", label: "Sunday",    date: "May 11" },
];

type DayState = { start: string; end: string; off: boolean; recurring: boolean };

const initial: Record<string, DayState> = {
  Mon: { start: "09:00", end: "17:00", off: false, recurring: true },
  Tue: { start: "09:00", end: "17:00", off: false, recurring: false },
  Wed: { start: "12:00", end: "20:00", off: false, recurring: true },
  Thu: { start: "", end: "", off: true,  recurring: false },
  Fri: { start: "09:00", end: "15:00", off: false, recurring: false },
  Sat: { start: "10:00", end: "16:00", off: false, recurring: true },
  Sun: { start: "", end: "", off: true,  recurring: false },
};

function fmt12(t: string): string {
  if (!t) return "";
  const [hStr, mStr] = t.split(":");
  let h = parseInt(hStr, 10);
  const m = mStr;
  const ampm = h < 12 ? "AM" : "PM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m} ${ampm}`;
}

function duration(start: string, end: string): string {
  if (!start || !end) return "";
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins <= 0) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function TimeInput({ value, onChange, disabled, label }: {
  value: string; onChange: (v: string) => void; disabled: boolean; label: string;
}) {
  return (
    <div style={{ flex: 1 }}>
      <p style={{ fontSize: 10, fontWeight: 700, color: S.light, letterSpacing: "0.06em", textTransform: "uppercase", margin: "0 0 5px" }}>{label}</p>
      <div style={{ position: "relative" }}>
        <input
          type="time"
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          style={{
            width: "100%",
            padding: "9px 10px",
            borderRadius: 10,
            border: `1.5px solid ${disabled ? S.border : value ? S.primary : S.border}`,
            background: disabled ? S.surface : S.card,
            fontSize: 14,
            fontWeight: 700,
            color: disabled ? S.light : S.dark,
            outline: "none",
            cursor: disabled ? "not-allowed" : "pointer",
            boxSizing: "border-box",
            fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif",
            WebkitAppearance: "none",
          } as React.CSSProperties}
        />
      </div>
    </div>
  );
}

const orange = "#F59E0B";
const orangeSoft = "#FFFBEB";
const orangeBorder = "#FDE68A";

export default function Avail() {
  const [avail, setAvail] = useState<Record<string, DayState>>(initial);
  const [saved, setSaved] = useState(false);

  const update = (day: string, patch: Partial<DayState>) =>
    setAvail(a => ({ ...a, [day]: { ...a[day], ...patch } }));

  const toggleOff = (day: string) => {
    const wasOff = avail[day].off;
    update(day, {
      off: !wasOff,
      start: wasOff ? "09:00" : "",
      end: wasOff ? "17:00" : "",
    });
  };

  const save = () => { setSaved(true); setTimeout(() => setSaved(false), 2000); };

  const availCount = DAYS.filter(d => !avail[d.key].off).length;

  return (
    <div style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif", background: S.surface, height: "100vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>

      {/* Header */}
      <div style={{ background: S.card, borderBottom: `1px solid ${S.border}`, padding: "44px 20px 14px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: S.dark, margin: 0 }}>Availability</h1>
          <button
            onClick={save}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 12, background: saved ? S.green : S.primary, border: "none", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "background 0.3s" }}
          >
            {saved ? <><Check size={14} /> Saved</> : <><Save size={14} /> Save</>}
          </button>
        </div>

        {/* Week nav */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginBottom: 14 }}>
          <button style={{ width: 32, height: 32, borderRadius: 10, background: S.surface, border: `1px solid ${S.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <ChevronLeft size={16} color={S.mid} />
          </button>
          <span style={{ fontSize: 15, fontWeight: 700, color: S.dark }}>May 5 – 11</span>
          <button style={{ width: 32, height: 32, borderRadius: 10, background: S.surface, border: `1px solid ${S.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <ChevronRight size={16} color={S.mid} />
          </button>
        </div>

        {/* Progress bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, height: 5, borderRadius: 99, background: S.surface, overflow: "hidden", border: `1px solid ${S.border}` }}>
            <div style={{ height: "100%", width: `${(availCount / 7) * 100}%`, background: `linear-gradient(90deg, ${S.primary}, #8B5CF6)`, borderRadius: 99, transition: "width 0.4s" }} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: S.mid, whiteSpace: "nowrap" }}>{availCount}/7 days</span>
        </div>
      </div>

      {/* Day cards */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px 16px" }}>
        {DAYS.map(({ key, label, date }) => {
          const d = avail[key];
          const dur = duration(d.start, d.end);
          return (
            <div
              key={key}
              style={{ borderRadius: 16, background: d.off ? S.surface : S.card, padding: "14px 16px", marginBottom: 10, boxShadow: d.off ? "none" : S.shadow, border: `1.5px solid ${d.off ? S.border : d.start && d.end ? S.primarySoft : S.border}`, transition: "all 0.25s" }}
            >
              {/* Day header row */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: d.off ? 0 : 12 }}>
                <div>
                  <p style={{ fontSize: 15, fontWeight: 700, color: d.off ? S.light : S.dark, margin: 0, transition: "color 0.2s" }}>{label}</p>
                  {!d.off && dur && (
                    <p style={{ fontSize: 11, fontWeight: 600, color: S.primary, margin: "2px 0 0" }}>{dur} shift</p>
                  )}
                  {d.off && (
                    <p style={{ fontSize: 11, fontWeight: 600, color: S.light, margin: "2px 0 0" }}>Not available</p>
                  )}
                </div>

                {/* Off toggle */}
                <button
                  onClick={() => toggleOff(key)}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "5px 11px", borderRadius: 8,
                    background: d.off ? S.redSoft : S.surface,
                    border: `1px solid ${d.off ? "#FECDD3" : S.border}`,
                    color: d.off ? S.red : S.light,
                    fontSize: 12, fontWeight: 700, cursor: "pointer",
                    transition: "all 0.2s",
                  }}
                >
                  <X size={11} strokeWidth={2.5} />
                  Off
                </button>
              </div>

              {/* Time inputs — hidden when off */}
              {!d.off && (
                <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                  <TimeInput
                    label="Start"
                    value={d.start}
                    onChange={v => update(key, { start: v })}
                    disabled={false}
                  />
                  <div style={{ paddingBottom: 10, color: S.light, fontSize: 16, fontWeight: 300, flexShrink: 0 }}>→</div>
                  <TimeInput
                    label="End"
                    value={d.end}
                    onChange={v => update(key, { end: v })}
                    disabled={false}
                  />
                </div>
              )}

              {/* Apply to — shown when day is active */}
              {!d.off && (
                <div style={{ marginTop: 12 }}>
                  <p style={{ fontSize: 10, fontWeight: 700, color: S.light, letterSpacing: "0.06em", textTransform: "uppercase", margin: "0 0 7px" }}>Apply to</p>
                  <div style={{ display: "flex", gap: 8 }}>
                    {/* Date only */}
                    <button
                      onClick={() => update(key, { recurring: false })}
                      style={{
                        flex: 1, padding: "9px 10px", borderRadius: 10, cursor: "pointer",
                        background: !d.recurring ? orangeSoft : S.surface,
                        border: `1.5px solid ${!d.recurring ? orangeBorder : S.border}`,
                        textAlign: "left", transition: "all 0.2s",
                      }}
                    >
                      <p style={{ fontSize: 13, fontWeight: 700, color: !d.recurring ? "#92400E" : S.dark, margin: 0 }}>{date} only</p>
                      <p style={{ fontSize: 10, color: !d.recurring ? "#B45309" : S.light, margin: "2px 0 0", fontWeight: 500 }}>Just this one day</p>
                    </button>

                    {/* Every [weekday] */}
                    <button
                      onClick={() => update(key, { recurring: true })}
                      style={{
                        flex: 1, padding: "9px 10px", borderRadius: 10, cursor: "pointer",
                        background: d.recurring ? S.primarySoft : S.surface,
                        border: `1.5px solid ${d.recurring ? "#C7CBF9" : S.border}`,
                        textAlign: "left", transition: "all 0.2s",
                      }}
                    >
                      <p style={{ fontSize: 13, fontWeight: 700, color: d.recurring ? S.primary : S.dark, margin: 0 }}>Every {label}</p>
                      <p style={{ fontSize: 10, color: d.recurring ? "#7C85E8" : S.light, margin: "2px 0 0", fontWeight: 500 }}>Recurring weekly</p>
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <div style={{ height: 8 }} />
      </div>

      {/* Bottom nav */}
      <div style={{ background: S.card, borderTop: `1px solid ${S.border}`, paddingBottom: 20, flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-around", paddingTop: 10 }}>
          {["Home", "Schedule", "Messages", "Team"].map(label => (
            <span key={label} style={{ fontSize: 10, fontWeight: 500, color: S.light }}>{label}</span>
          ))}
        </div>
      </div>

    </div>
  );
}
