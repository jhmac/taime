import React, { useState, useEffect } from "react";
import { MapPin, Clock, Zap, CheckCircle2, AlertTriangle, ChevronDown } from "lucide-react";

const S = {
  bg: "#FFFFFF", surface: "#F8FAFF", card: "#FFFFFF",
  border: "#E8EDF8", primary: "#5B6CF0", primarySoft: "#EEF0FF",
  dark: "#0D1F3C", mid: "#445578", light: "#8898AA",
  green: "#00C48C", greenSoft: "#E6FAF4",
  orange: "#FF7A45", orangeSoft: "#FFF3EE",
  shadow: "0 1px 3px rgba(0,18,60,0.06), 0 4px 16px rgba(0,18,60,0.04)",
  shadowLg: "0 8px 32px rgba(91,108,240,0.25)",
};

export default function ClockIn() {
  const [state, setState] = useState<"idle"|"clocking"|"clocked">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [time, setTime] = useState("10:27 AM");

  useEffect(() => {
    const t = setInterval(() => {
      const now = new Date();
      setTime(now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (state !== "clocked") return;
    const t = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(t);
  }, [state]);

  const fmt = (s: number) => `${String(Math.floor(s/3600)).padStart(2,"0")}:${String(Math.floor((s%3600)/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

  return (
    <div style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif", background: S.card, height: "100vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* Top gradient decoration */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 280, background: `linear-gradient(160deg, ${S.primarySoft} 0%, ${S.surface} 100%)`, zIndex: 0 }} />

      <div style={{ position: "relative", zIndex: 1, flex: 1, display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div style={{ padding: "52px 24px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <p style={{ fontSize: 12, fontWeight: 600, color: S.light, letterSpacing: "0.06em", textTransform: "uppercase", margin: 0 }}>Taime</p>
            <p style={{ fontSize: 18, fontWeight: 800, color: S.dark, margin: "4px 0 0" }}>Good morning, Libby</p>
          </div>
          <div style={{ width: 42, height: 42, borderRadius: "50%", background: `linear-gradient(135deg, ${S.primary}, #8B5CF6)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ color: "#fff", fontSize: 15, fontWeight: 700 }}>LB</span>
          </div>
        </div>

        {/* Shift Info */}
        <div style={{ margin: "0 20px 24px", borderRadius: 18, background: S.card, border: `1px solid ${S.border}`, padding: "16px 20px", boxShadow: S.shadow }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: S.light, textTransform: "uppercase", letterSpacing: "0.08em", margin: 0 }}>TODAY'S SHIFT</p>
          <p style={{ fontSize: 26, fontWeight: 800, color: S.dark, margin: "6px 0 2px" }}>10:00 AM – 6:00 PM</p>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <MapPin size={13} color={S.green} />
              <span style={{ fontSize: 13, fontWeight: 600, color: S.green }}>Within range</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <Clock size={13} color={S.primary} />
              <span style={{ fontSize: 13, fontWeight: 600, color: S.mid }}>Starts in 15 min</span>
            </div>
          </div>
        </div>

        {/* Clock hero */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 24px" }}>
          {state === "clocked" ? (
            <>
              <div style={{ width: 160, height: 160, borderRadius: "50%", background: `linear-gradient(135deg, ${S.green}, #00A878)`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", boxShadow: `0 16px 48px rgba(0,196,140,0.35)`, marginBottom: 24 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.7)", textTransform: "uppercase", letterSpacing: "0.1em", margin: 0 }}>ON CLOCK</p>
                <p style={{ fontSize: 26, fontWeight: 800, color: "#fff", margin: "6px 0 0", fontVariantNumeric: "tabular-nums" }}>{fmt(elapsed)}</p>
              </div>
              <p style={{ fontSize: 16, fontWeight: 700, color: S.dark, margin: "0 0 8px" }}>You're clocked in ✓</p>
              <p style={{ fontSize: 14, color: S.light, margin: "0 0 32px" }}>Clocked in at 10:15 AM</p>
              <button onClick={() => { setState("idle"); setElapsed(0); }} style={{ padding: "14px 48px", borderRadius: 16, background: S.card, border: `2px solid ${S.border}`, fontSize: 15, fontWeight: 700, color: S.mid, cursor: "pointer" }}>Clock Out</button>
            </>
          ) : (
            <>
              {/* Big time display */}
              <div style={{ width: 160, height: 160, borderRadius: "50%", background: `linear-gradient(135deg, ${S.primary} 0%, #8B5CF6 100%)`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", boxShadow: S.shadowLg, marginBottom: 24, cursor: "pointer" }} onClick={() => setState("clocked")}>
                <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.65)", textTransform: "uppercase", letterSpacing: "0.1em", margin: 0 }}>TAP TO</p>
                <p style={{ fontSize: 24, fontWeight: 800, color: "#fff", margin: "6px 0 0" }}>Clock In</p>
                <Zap size={18} color="rgba(255,255,255,0.8)" style={{ marginTop: 4 }} />
              </div>
              <p style={{ fontSize: 20, fontWeight: 800, color: S.dark, margin: "0 0 4px", fontVariantNumeric: "tabular-nums" }}>{time}</p>
              <p style={{ fontSize: 14, color: S.light, margin: 0 }}>Monday, May 5 · {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}</p>

              {/* Or take a break */}
              <div style={{ marginTop: 32, borderRadius: 14, border: `1px solid ${S.border}`, padding: "12px 20px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                <div style={{ width: 32, height: 32, borderRadius: 10, background: S.orangeSoft, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Clock size={16} color={S.orange} />
                </div>
                <span style={{ fontSize: 14, fontWeight: 600, color: S.mid }}>Start a break instead</span>
                <ChevronDown size={16} color={S.light} style={{ marginLeft: "auto" }} />
              </div>
            </>
          )}
        </div>

        {/* Location status */}
        <div style={{ margin: "16px 20px", borderRadius: 14, background: S.greenSoft, border: `1px solid ${S.green}30`, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 }}>
          <CheckCircle2 size={18} color={S.green} style={{ flexShrink: 0 }} />
          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: S.dark, margin: 0 }}>Location verified</p>
            <p style={{ fontSize: 12, color: S.light, margin: "2px 0 0" }}>Inside geofence · Taime Boutique, Downtown</p>
          </div>
        </div>

        <div style={{ height: 20 }} />
      </div>
    </div>
  );
}
