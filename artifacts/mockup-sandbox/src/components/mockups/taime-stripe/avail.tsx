import { useState } from "react";
import { ChevronLeft, ChevronRight, Save, Moon, Sun } from "lucide-react";

const S = {
  bg: "#FFFFFF", surface: "#F8FAFF", card: "#FFFFFF",
  border: "#E8EDF8", primary: "#5B6CF0", primarySoft: "#EEF0FF",
  dark: "#0D1F3C", mid: "#445578", light: "#8898AA",
  green: "#00C48C", greenSoft: "#E6FAF4",
  orange: "#FF7A45", orangeSoft: "#FFF3EE",
  red: "#F43F5E", redSoft: "#FFF0F3",
  shadow: "0 1px 3px rgba(0,18,60,0.06), 0 4px 16px rgba(0,18,60,0.04)",
};

const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Slot = "morning" | "afternoon" | "evening" | "unavailable";
const slotLabel: Record<Slot, string> = { morning: "Morning", afternoon: "Afternoon", evening: "Evening", unavailable: "Unavailable" };
const slotIcon: Record<Slot, React.ReactNode> = {
  morning: <Sun size={14} color="#F59E0B" />,
  afternoon: <Sun size={14} color={S.orange} />,
  evening: <Moon size={14} color="#8B5CF6" />,
  unavailable: <span style={{ fontSize: 12 }}>✕</span>,
};
const slotColor: Record<Slot, string> = { morning: "#FFFBEB", afternoon: S.orangeSoft, evening: "#F3EEFF", unavailable: S.surface };
const slotBorder: Record<Slot, string> = { morning: "#FEF08A", afternoon: "#FED7AA", evening: "#DDD6FE", unavailable: S.border };
const slotText: Record<Slot, string> = { morning: "#92400E", afternoon: "#C2410C", evening: "#5B21B6", unavailable: S.light };

const initialAvail: Record<string, Slot> = {
  Mon: "morning", Tue: "afternoon", Wed: "morning", Thu: "unavailable", Fri: "afternoon", Sat: "morning", Sun: "evening"
};

const slots: Slot[] = ["morning", "afternoon", "evening", "unavailable"];

export default function Avail() {
  const [avail, setAvail] = useState<Record<string, Slot>>(initialAvail);
  const [saved, setSaved] = useState(false);
  const [week, setWeek] = useState("May 5 – 11");

  const save = () => { setSaved(true); setTimeout(() => setSaved(false), 2000); };

  const availDays = days.filter(d => avail[d] !== "unavailable").length;
  const pctText = `${availDays}/7 days available`;

  return (
    <div style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif", background: S.surface, height: "100vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ background: S.card, borderBottom: `1px solid ${S.border}`, padding: "44px 20px 16px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: S.dark, margin: 0 }}>Availability</h1>
          <button onClick={save} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 12, background: saved ? S.green : S.primary, border: "none", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", transition: "background 0.3s" }}>
            {saved ? <><Save size={14} /> Saved!</> : <><Save size={14} /> Save</>}
          </button>
        </div>

        {/* Week nav */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginBottom: 14 }}>
          <button style={{ width: 32, height: 32, borderRadius: 10, background: S.surface, border: `1px solid ${S.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <ChevronLeft size={16} color={S.mid} />
          </button>
          <span style={{ fontSize: 15, fontWeight: 700, color: S.dark }}>{week}</span>
          <button style={{ width: 32, height: 32, borderRadius: 10, background: S.surface, border: `1px solid ${S.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <ChevronRight size={16} color={S.mid} />
          </button>
        </div>

        {/* Summary pill */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1, height: 6, borderRadius: 99, background: S.surface, overflow: "hidden", border: `1px solid ${S.border}` }}>
            <div style={{ height: "100%", width: `${(availDays/7)*100}%`, background: `linear-gradient(90deg, ${S.primary}, #8B5CF6)`, borderRadius: 99 }} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: S.mid, whiteSpace: "nowrap" }}>{pctText}</span>
        </div>
      </div>

      {/* Day cards */}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px" }}>
        {days.map(day => {
          const current = avail[day];
          return (
            <div key={day} style={{ borderRadius: 16, background: S.card, padding: "14px 16px", marginBottom: 10, boxShadow: S.shadow, border: `1px solid ${S.border}` }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <p style={{ fontSize: 15, fontWeight: 700, color: S.dark, margin: 0 }}>{day === "Mon" ? "Monday" : day === "Tue" ? "Tuesday" : day === "Wed" ? "Wednesday" : day === "Thu" ? "Thursday" : day === "Fri" ? "Friday" : day === "Sat" ? "Saturday" : "Sunday"}</p>
                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 8, background: slotColor[current], border: `1px solid ${slotBorder[current]}` }}>
                  {slotIcon[current]}
                  <span style={{ fontSize: 12, fontWeight: 700, color: slotText[current] }}>{slotLabel[current]}</span>
                </div>
              </div>

              {/* Slot picker */}
              <div style={{ display: "flex", gap: 6 }}>
                {slots.map(slot => (
                  <button key={slot} onClick={() => setAvail(a => ({ ...a, [day]: slot }))} style={{ flex: 1, padding: "8px 4px", borderRadius: 10, background: avail[day] === slot ? (slot === "unavailable" ? S.red : S.primary) : S.surface, border: avail[day] === slot ? "none" : `1px solid ${S.border}`, fontSize: 10, fontWeight: 700, color: avail[day] === slot ? "#fff" : S.light, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, transition: "all 0.2s" }}>
                    <span style={{ fontSize: 14 }}>{slot === "morning" ? "🌅" : slot === "afternoon" ? "☀️" : slot === "evening" ? "🌙" : "✕"}</span>
                    <span>{slot === "morning" ? "AM" : slot === "afternoon" ? "PM" : slot === "evening" ? "Eve" : "Off"}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        <div style={{ height: 12 }} />
      </div>

      {/* Bottom Nav */}
      <div style={{ background: S.card, borderTop: `1px solid ${S.border}`, paddingBottom: 20, flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-around", paddingTop: 10 }}>
          {["Home","Schedule","Messages","Team"].map(label => (
            <span key={label} style={{ fontSize: 10, fontWeight: 500, color: S.light }}>{label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
