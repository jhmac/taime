import React, { useState, useEffect } from "react";
import { Clock, CheckCircle2, Sparkles, Bell, Home, Calendar, MessageCircle, MoreHorizontal, Zap, TrendingUp, Star, AlertTriangle, X } from "lucide-react";

const S = {
  bg: "#FFFFFF", surface: "#F8FAFF", card: "#FFFFFF",
  border: "#E8EDF8", borderLight: "#F0F4FF",
  primary: "#5B6CF0", primarySoft: "#EEF0FF",
  dark: "#0D1F3C", mid: "#445578", light: "#8898AA",
  green: "#00C48C", greenSoft: "#E6FAF4",
  orange: "#FF7A45", orangeSoft: "#FFF3EE",
  red: "#F43F5E", redSoft: "#FFF0F3",
  purple: "#8B5CF6", purpleSoft: "#F3EEFF",
  shadow: "0 1px 3px rgba(0,18,60,0.06), 0 4px 16px rgba(0,18,60,0.04)",
  shadowMd: "0 2px 8px rgba(0,18,60,0.08), 0 16px 40px rgba(0,18,60,0.06)",
};

const Nav = ({ active = "home" }) => {
  const items = [
    { icon: Home, label: "Home", key: "home" },
    { icon: Calendar, label: "Schedule", key: "schedule" },
    { icon: MessageCircle, label: "Messages", key: "messages" },
    { icon: MoreHorizontal, label: "More", key: "more" },
  ];
  return (
    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: S.card, borderTop: `1px solid ${S.border}`, paddingBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-around", paddingTop: 10 }}>
        {items.map(i => (
          <div key={i.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, cursor: "pointer" }}>
            <i.icon size={22} color={i.key === active ? S.primary : S.light} strokeWidth={i.key === active ? 2.5 : 1.8} />
            <span style={{ fontSize: 10, fontWeight: i.key === active ? 700 : 500, color: i.key === active ? S.primary : S.light }}>{i.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

function IssuesPanel({ onClose }: { onClose: () => void }) {
  const issues = [
    { title: "Display window not restocked", priority: "high", time: "2h ago" },
    { title: "Break room fridge needs cleaning", priority: "medium", time: "Yesterday" },
    { title: "POS terminal #2 slow response", priority: "low", time: "3h ago" },
  ];
  const colors: Record<string, string> = { high: S.red, medium: S.orange, low: S.primary };
  const bgs: Record<string, string> = { high: S.redSoft, medium: S.orangeSoft, low: S.primarySoft };
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(13,31,60,0.4)", zIndex: 50, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div style={{ background: S.card, borderRadius: "20px 20px 0 0", padding: "0 0 32px" }}>
        <div style={{ width: 36, height: 4, borderRadius: 99, background: S.border, margin: "12px auto 0" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px 12px" }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: S.dark, margin: 0 }}>Store Issues</h2>
            <p style={{ fontSize: 12, color: S.light, margin: "2px 0 0", fontWeight: 500 }}>3 open · tap to report a new one</p>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 10, background: S.surface, border: `1px solid ${S.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <X size={15} color={S.mid} />
          </button>
        </div>
        {issues.map((iss, idx) => (
          <div key={idx} style={{ margin: "0 16px 8px", padding: "13px 14px", borderRadius: 14, background: S.surface, border: `1px solid ${S.border}`, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: bgs[iss.priority], display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <AlertTriangle size={16} color={colors[iss.priority]} />
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: S.dark, margin: 0 }}>{iss.title}</p>
              <p style={{ fontSize: 11, color: S.light, margin: "2px 0 0" }}>{iss.time}</p>
            </div>
            <span style={{ fontSize: 10, fontWeight: 700, color: colors[iss.priority], background: bgs[iss.priority], padding: "3px 8px", borderRadius: 6, textTransform: "capitalize" }}>{iss.priority}</span>
          </div>
        ))}
        <div style={{ margin: "12px 16px 0" }}>
          <button style={{ width: "100%", padding: "13px 0", borderRadius: 14, background: S.primary, color: "#fff", fontWeight: 700, fontSize: 14, border: "none", cursor: "pointer" }}>
            + Report New Issue
          </button>
        </div>
      </div>
    </div>
  );
}

function AraPanel({ onClose }: { onClose: () => void }) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([
    { role: "ara", text: "Hi Libby! I'm Ara, your AI assistant. Ask me anything about your shift, tasks, store policies, or performance." },
  ]);
  const send = () => {
    if (!input.trim()) return;
    const q = input.trim();
    setInput("");
    setMessages(m => [...m, { role: "user", text: q }]);
    setTimeout(() => {
      setMessages(m => [...m, { role: "ara", text: "Great question! Based on your current shift data and store history, here's what I found: your tasks are 60% complete and your score is trending up this week. Anything else?" }]);
    }, 800);
  };
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(13,31,60,0.4)", zIndex: 50, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div style={{ background: S.card, borderRadius: "20px 20px 0 0", height: "72%", display: "flex", flexDirection: "column" }}>
        <div style={{ width: 36, height: 4, borderRadius: 99, background: S.border, margin: "12px auto 0", flexShrink: 0 }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px 12px", flexShrink: 0, borderBottom: `1px solid ${S.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: `linear-gradient(135deg, ${S.primary}, ${S.purple})`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Sparkles size={16} color="#fff" />
            </div>
            <div>
              <p style={{ fontSize: 15, fontWeight: 800, color: S.dark, margin: 0 }}>Ask Ara</p>
              <p style={{ fontSize: 11, color: S.green, margin: 0, fontWeight: 600 }}>● Online</p>
            </div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 10, background: S.surface, border: `1px solid ${S.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <X size={15} color={S.mid} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 8px", display: "flex", flexDirection: "column", gap: 10 }}>
          {messages.map((m, i) => (
            <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
              {m.role === "ara" && (
                <div style={{ width: 28, height: 28, borderRadius: 8, background: `linear-gradient(135deg, ${S.primary}, ${S.purple})`, display: "flex", alignItems: "center", justifyContent: "center", marginRight: 8, flexShrink: 0, alignSelf: "flex-end" }}>
                  <Sparkles size={13} color="#fff" />
                </div>
              )}
              <div style={{ maxWidth: "75%", padding: "10px 13px", borderRadius: m.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px", background: m.role === "user" ? S.primary : S.surface, border: m.role === "user" ? "none" : `1px solid ${S.border}` }}>
                <p style={{ fontSize: 13, color: m.role === "user" ? "#fff" : S.dark, margin: 0, lineHeight: 1.4 }}>{m.text}</p>
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: "8px 16px 20px", flexShrink: 0, borderTop: `1px solid ${S.border}` }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && send()}
              placeholder="Ask anything…"
              style={{ flex: 1, padding: "11px 14px", borderRadius: 12, border: `1.5px solid ${S.border}`, background: S.surface, fontSize: 14, color: S.dark, outline: "none", fontFamily: "inherit" }}
            />
            <button onClick={send} style={{ padding: "11px 16px", borderRadius: 12, background: S.primary, color: "#fff", fontWeight: 700, fontSize: 13, border: "none", cursor: "pointer" }}>Send</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [clocked, setClocked] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [visible, setVisible] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [showAra, setShowAra] = useState(false);
  useEffect(() => { setTimeout(() => setVisible(true), 60); }, []);
  useEffect(() => {
    if (!clocked) return;
    const t = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(t);
  }, [clocked]);
  const fmt = (s: number) => `${String(Math.floor(s/3600)).padStart(2,"0")}:${String(Math.floor((s%3600)/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

  const anim = (d = 0): React.CSSProperties => ({
    opacity: visible ? 1 : 0,
    transform: visible ? "translateY(0)" : "translateY(12px)",
    transition: `all 0.5s cubic-bezier(0.16,1,0.3,1) ${d}s`,
  });

  return (
    <div style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif", background: S.surface, height: "100vh", overflow: "hidden", position: "relative" }}>

      {/* Overlays */}
      {showIssues && <IssuesPanel onClose={() => setShowIssues(false)} />}
      {showAra && <AraPanel onClose={() => setShowAra(false)} />}

      {/* Status bar */}
      <div style={{ height: 44, background: S.card, display: "flex", alignItems: "center", justifyContent: "space-between", paddingInline: 16, borderBottom: `1px solid ${S.border}` }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: S.dark }}>9:41</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Issues button */}
          <button
            onClick={() => { setShowAra(false); setShowIssues(true); }}
            style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 9, background: S.redSoft, border: `1px solid #FECDD3`, cursor: "pointer" }}
          >
            <AlertTriangle size={12} color={S.red} strokeWidth={2.5} />
            <span style={{ fontSize: 11, fontWeight: 700, color: S.red }}>3 Issues</span>
          </button>
          {/* Ask Ara button */}
          <button
            onClick={() => { setShowIssues(false); setShowAra(true); }}
            style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 9, background: S.primarySoft, border: `1px solid #C7CBF9`, cursor: "pointer" }}
          >
            <Sparkles size={12} color={S.primary} />
            <span style={{ fontSize: 11, fontWeight: 700, color: S.primary }}>Ask Ara</span>
          </button>
          {/* Bell */}
          <Bell size={16} color={S.mid} style={{ cursor: "pointer" }} />
          {/* Avatar */}
          <div style={{ width: 30, height: 30, borderRadius: "50%", background: `linear-gradient(135deg, ${S.primary}, #8B5CF6)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ color: "#fff", fontSize: 11, fontWeight: 700 }}>LB</span>
          </div>
        </div>
      </div>

      {/* Scroll area */}
      <div style={{ height: "calc(100vh - 44px - 74px)", overflowY: "auto", padding: "20px 16px 0" }}>

        {/* Greeting */}
        <div style={anim()}>
          <p style={{ fontSize: 12, fontWeight: 600, color: S.light, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 2 }}>MONDAY, MAY 5</p>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: S.dark, lineHeight: 1.2, margin: 0 }}>Good morning, Libby ✦</h1>
        </div>

        {/* Clock-in Hero Card */}
        <div style={{ marginTop: 16, ...anim(0.06) }}>
          {!clocked ? (
            <div style={{ borderRadius: 20, overflow: "hidden", background: `linear-gradient(135deg, ${S.primary} 0%, #8B5CF6 100%)`, boxShadow: "0 8px 32px rgba(91,108,240,0.35)" }}>
              <div style={{ padding: "20px 20px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: "rgba(255,255,255,0.6)", textTransform: "uppercase", margin: 0 }}>TIME CLOCK</p>
                  <p style={{ fontSize: 36, fontWeight: 800, color: "#fff", margin: "4px 0 0", lineHeight: 1 }}>10:27 AM</p>
                </div>
                <div style={{ width: 52, height: 52, borderRadius: 16, background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Clock size={26} color="#fff" />
                </div>
              </div>
              <div style={{ padding: "0 16px 16px" }}>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", margin: "0 0 12px" }}>Your shift starts in <strong style={{ color: "#fff" }}>15 min</strong></p>
                <button onClick={() => setClocked(true)} style={{ width: "100%", padding: "14px 0", borderRadius: 14, background: "rgba(255,255,255,0.96)", color: S.primary, fontWeight: 800, fontSize: 15, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <Zap size={16} fill={S.primary} strokeWidth={0} />
                  Clock In Now
                </button>
              </div>
            </div>
          ) : (
            <div style={{ borderRadius: 20, background: `linear-gradient(135deg, ${S.green} 0%, #00A878 100%)`, boxShadow: "0 8px 32px rgba(0,196,140,0.3)", padding: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: "rgba(255,255,255,0.65)", textTransform: "uppercase", margin: 0 }}>ON THE CLOCK</p>
                  <p style={{ fontSize: 36, fontWeight: 800, color: "#fff", margin: "4px 0 0", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{fmt(elapsed)}</p>
                </div>
                <button onClick={() => { setClocked(false); setElapsed(0); }} style={{ padding: "10px 16px", borderRadius: 12, background: "rgba(255,255,255,0.2)", color: "#fff", fontWeight: 700, fontSize: 13, border: "none", cursor: "pointer" }}>Clock Out</button>
              </div>
            </div>
          )}
        </div>

        {/* Today's Snapshot */}
        <div style={{ marginTop: 20, ...anim(0.1) }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: S.light, letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 10px" }}>TODAY</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[
              { label: "Shift", value: "10:00 AM–6:00 PM", icon: Clock, color: S.primary, soft: S.primarySoft },
              { label: "Tasks Done", value: "3 of 5", icon: CheckCircle2, color: S.green, soft: S.greenSoft },
              { label: "Score", value: "94 pts", icon: Star, color: "#F59E0B", soft: "#FFFBEB" },
              { label: "Breaks", value: "1 remaining", icon: TrendingUp, color: S.orange, soft: S.orangeSoft },
            ].map(c => (
              <div key={c.label} style={{ borderRadius: 16, background: S.card, padding: "14px", boxShadow: S.shadow, border: `1px solid ${S.border}` }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: c.soft, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                  <c.icon size={17} color={c.color} />
                </div>
                <p style={{ fontSize: 10, fontWeight: 600, color: S.light, margin: 0 }}>{c.label}</p>
                <p style={{ fontSize: 14, fontWeight: 800, color: S.dark, margin: "3px 0 0" }}>{c.value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Tasks */}
        <div style={{ marginTop: 20, ...anim(0.14) }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: S.light, letterSpacing: "0.08em", textTransform: "uppercase", margin: 0 }}>MY TASKS</p>
            <span style={{ fontSize: 12, fontWeight: 600, color: S.primary, cursor: "pointer" }}>See all</span>
          </div>
          {[
            { label: "Restock display window", tag: "12 PM", done: true },
            { label: "Morning team huddle notes", tag: "Now", done: false, urgent: true },
            { label: "Send end-of-day report", tag: "6 PM", done: false },
          ].map((t, i) => (
            <div key={i} style={{ borderRadius: 14, background: S.card, padding: "14px 16px", marginBottom: 8, boxShadow: S.shadow, border: `1px solid ${S.border}`, display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${t.done ? S.green : S.border}`, background: t.done ? S.green : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {t.done && <CheckCircle2 size={12} color="#fff" strokeWidth={3} />}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: t.done ? S.light : S.dark, textDecoration: t.done ? "line-through" : "none", margin: 0 }}>{t.label}</p>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: t.urgent ? S.orange : S.light, background: t.urgent ? S.orangeSoft : "transparent", padding: t.urgent ? "2px 8px" : "0", borderRadius: 6 }}>{t.tag}</span>
            </div>
          ))}
        </div>

        {/* AI Insight */}
        <div style={{ marginTop: 16, marginBottom: 20, ...anim(0.18) }}>
          <div style={{ borderRadius: 16, background: S.primarySoft, border: `1px solid ${S.primary}30`, padding: "14px 16px", display: "flex", alignItems: "flex-start", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: S.primary, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Sparkles size={15} color="#fff" />
            </div>
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: S.primary, margin: 0 }}>Ara · AI Insight</p>
              <p style={{ fontSize: 13, color: S.mid, margin: "4px 0 0", lineHeight: 1.4 }}>Your punctuality score is in the top 10% this week. Keep it up!</p>
            </div>
          </div>
        </div>
      </div>

      <Nav active="home" />
    </div>
  );
}
