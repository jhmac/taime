import React, { useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Clock, Users, Calendar } from "lucide-react";

const S = {
  bg: "#FFFFFF", surface: "#F8FAFF", card: "#FFFFFF",
  border: "#E8EDF8", primary: "#5B6CF0", primarySoft: "#EEF0FF",
  dark: "#0D1F3C", mid: "#445578", light: "#8898AA",
  green: "#00C48C", greenSoft: "#E6FAF4",
  orange: "#FF7A45", orangeSoft: "#FFF3EE",
  purple: "#8B5CF6", purpleSoft: "#F3EEFF",
  teal: "#06B6D4", tealSoft: "#ECFEFF",
  shadow: "0 1px 3px rgba(0,18,60,0.06), 0 4px 16px rgba(0,18,60,0.04)",
};

const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dates = [4, 5, 6, 7, 8, 9, 10];

const shifts = [
  { name: "Taylor S.", start: 9, end: 17, color: S.primary, soft: S.primarySoft, avatar: "TS" },
  { name: "Libby R.", start: 10, end: 18, color: S.green, soft: S.greenSoft, avatar: "LR" },
  { name: "Jordan M.", start: 12, end: 20, color: S.orange, soft: S.orangeSoft, avatar: "JM" },
  { name: "Sela P.", start: 9, end: 14, color: S.purple, soft: S.purpleSoft, avatar: "SP" },
  { name: "Chris T.", start: 14, end: 22, color: S.teal, soft: S.tealSoft, avatar: "CT" },
];

const hours = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const totalHours = 14; // 8am to 10pm
const HOUR_PX = 52;

export default function Schedule() {
  const [selectedDay, setSelectedDay] = useState(2); // Tuesday
  const [view, setView] = useState<"day"|"week">("day");

  return (
    <div style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif", background: S.surface, height: "100vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ background: S.card, borderBottom: `1px solid ${S.border}`, padding: "44px 20px 0", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: S.dark, margin: 0 }}>Schedule</h1>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ display: "flex", background: S.surface, borderRadius: 10, padding: 3, gap: 2 }}>
              {(["day","week"] as const).map(v => (
                <button key={v} onClick={() => setView(v)} style={{ padding: "6px 12px", borderRadius: 8, background: view === v ? S.card : "transparent", border: view === v ? `1px solid ${S.border}` : "1px solid transparent", fontSize: 12, fontWeight: 700, color: view === v ? S.dark : S.light, cursor: "pointer", boxShadow: view === v ? S.shadow : "none" }}>
                  {v === "day" ? "Day" : "Week"}
                </button>
              ))}
            </div>
            <button style={{ width: 36, height: 36, borderRadius: 11, background: S.primary, border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <Plus size={18} color="#fff" />
            </button>
          </div>
        </div>

        {/* Week strip */}
        <div style={{ display: "flex", gap: 4, paddingBottom: 12 }}>
          {days.map((d, i) => (
            <button key={i} onClick={() => setSelectedDay(i)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "8px 0", borderRadius: 12, background: selectedDay === i ? S.primary : "transparent", border: "none", cursor: "pointer" }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: selectedDay === i ? "rgba(255,255,255,0.7)" : S.light }}>{d}</span>
              <span style={{ fontSize: 16, fontWeight: 800, color: selectedDay === i ? "#fff" : S.dark }}>{dates[i]}</span>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: i === 2 ? (selectedDay === i ? "#fff" : S.primary) : "transparent" }} />
            </button>
          ))}
        </div>
      </div>

      {/* Stats bar */}
      <div style={{ background: S.card, padding: "10px 16px", borderBottom: `1px solid ${S.border}`, display: "flex", gap: 16, flexShrink: 0 }}>
        {[{ icon: Users, label: "5 on shift", color: S.primary }, { icon: Clock, label: "52 hrs total", color: S.green }, { icon: Calendar, label: "2 open shifts", color: S.orange }].map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <s.icon size={14} color={s.color} />
            <span style={{ fontSize: 12, fontWeight: 600, color: S.mid }}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* Timeline */}
      <div style={{ flex: 1, overflowY: "auto", background: S.surface }}>
        <div style={{ display: "flex", minHeight: hours.length * HOUR_PX }}>
          {/* Time labels */}
          <div style={{ width: 44, flexShrink: 0, paddingTop: 0 }}>
            {hours.map(h => (
              <div key={h} style={{ height: HOUR_PX, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: S.light }}>{h > 12 ? `${h-12}PM` : h === 12 ? "12PM" : `${h}AM`}</span>
              </div>
            ))}
          </div>

          {/* Grid + Shifts */}
          <div style={{ flex: 1, position: "relative", paddingRight: 12 }}>
            {/* Hour lines */}
            {hours.map((h, i) => (
              <div key={h} style={{ position: "absolute", top: i * HOUR_PX, left: 0, right: 0, borderTop: `1px solid ${S.border}`, height: HOUR_PX }} />
            ))}

            {/* Shift bars */}
            {shifts.map((shift, i) => {
              const top = (shift.start - hours[0]) * HOUR_PX;
              const height = (shift.end - shift.start) * HOUR_PX - 6;
              const col = i % 3;
              const colW = "31%";
              const left = `${col * 33}%`;
              return (
                <div key={i} style={{ position: "absolute", top: top + 3, left, width: colW, height, borderRadius: 12, background: shift.color, boxShadow: `0 4px 12px ${shift.color}40`, padding: "8px 10px", overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <div style={{ width: 22, height: 22, borderRadius: "50%", background: "rgba(255,255,255,0.3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span style={{ fontSize: 9, fontWeight: 800, color: "#fff" }}>{shift.avatar}</span>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shift.name.split(" ")[0]}</span>
                  </div>
                  <p style={{ fontSize: 10, color: "rgba(255,255,255,0.75)", margin: 0 }}>{shift.start > 12 ? shift.start - 12 : shift.start}–{shift.end > 12 ? shift.end - 12 : shift.end}{shift.end >= 12 ? "PM" : "AM"}</p>
                </div>
              );
            })}

            {/* Current time line */}
            <div style={{ position: "absolute", top: (10.45 - hours[0]) * HOUR_PX, left: 0, right: 0, height: 2, background: S.orange, zIndex: 10 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: S.orange, position: "absolute", left: -5, top: -4 }} />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Nav */}
      <div style={{ background: S.card, borderTop: `1px solid ${S.border}`, paddingBottom: 20, flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-around", paddingTop: 10 }}>
          {[{ label: "Home", active: false }, { label: "Schedule", active: true }, { label: "Messages", active: false }, { label: "Team", active: false }].map(i => (
            <div key={i.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
              <div style={{ width: 22, height: 22, borderRadius: 6, background: i.active ? S.primarySoft : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ width: 4, height: 4, borderRadius: "50%", background: i.active ? S.primary : S.light }} />
              </div>
              <span style={{ fontSize: 10, fontWeight: i.active ? 700 : 500, color: i.active ? S.primary : S.light }}>{i.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
