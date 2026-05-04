import React, { useState } from "react";
import { Search, Plus, ChevronRight, Check, CheckCheck, Edit3 } from "lucide-react";

const S = {
  bg: "#FFFFFF", surface: "#F8FAFF", card: "#FFFFFF",
  border: "#E8EDF8", primary: "#5B6CF0", primarySoft: "#EEF0FF",
  dark: "#0D1F3C", mid: "#445578", light: "#8898AA",
  green: "#00C48C", greenSoft: "#E6FAF4",
  shadow: "0 1px 3px rgba(0,18,60,0.06), 0 4px 16px rgba(0,18,60,0.04)",
};

const threads = [
  { id: 1, name: "Taylor Singh", avatar: "TS", preview: "Can you cover the 2pm shift? I need to—", time: "2m ago", unread: 2, online: true, gradient: `linear-gradient(135deg, ${S.primary}, #8B5CF6)` },
  { id: 2, name: "Team · Boutique", avatar: "👥", preview: "Ara: Sales are up 14% today! Great job team 🎉", time: "12m ago", unread: 5, online: false, isGroup: true, gradient: `linear-gradient(135deg, #06B6D4, #0891B2)` },
  { id: 3, name: "Sela Park", avatar: "SP", preview: "Thanks, I'll have the display done by noon.", time: "1h ago", unread: 0, online: true, gradient: `linear-gradient(135deg, #8B5CF6, #7C3AED)` },
  { id: 4, name: "Jordan Mills", avatar: "JM", preview: "Running 5 mins late, so sorry!", time: "2h ago", unread: 0, online: false, gradient: `linear-gradient(135deg, #FF7A45, #FF5E2C)` },
  { id: 5, name: "Chris Torres", avatar: "CT", preview: "Got it, I'll clock in now 👍", time: "3h ago", unread: 0, online: true, gradient: `linear-gradient(135deg, #00C48C, #00A878)` },
  { id: 6, name: "Maya Patel", avatar: "MP", preview: "The quiz questions were really helpful today!", time: "Yesterday", unread: 0, online: false, gradient: `linear-gradient(135deg, #F59E0B, #D97706)` },
];

const messages = [
  { from: "them", text: "Can you cover the 2pm shift? I need to leave early today.", time: "2:04 PM" },
  { from: "me", text: "Sure! I'm scheduled until 6 anyway. What happened?", time: "2:06 PM" },
  { from: "them", text: "Doctor's appointment I forgot about 😅 Thank you so much!", time: "2:07 PM" },
  { from: "me", text: "No worries at all. Hope it goes well!", time: "2:08 PM" },
];

export default function Messages() {
  const [open, setOpen] = useState<number|null>(null);
  const [input, setInput] = useState("");

  if (open !== null) {
    const thread = threads.find(t => t.id === open)!;
    return (
      <div style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif", background: S.surface, height: "100vh", display: "flex", flexDirection: "column" }}>
        {/* Chat header */}
        <div style={{ background: S.card, borderBottom: `1px solid ${S.border}`, padding: "44px 16px 12px", display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => setOpen(null)} style={{ fontSize: 24, background: "none", border: "none", color: S.primary, cursor: "pointer", padding: 0 }}>‹</button>
          <div style={{ position: "relative" }}>
            <div style={{ width: 38, height: 38, borderRadius: "50%", background: thread.gradient, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ color: "#fff", fontSize: 13, fontWeight: 700 }}>{thread.avatar}</span>
            </div>
            <div style={{ position: "absolute", bottom: 0, right: 0, width: 11, height: 11, borderRadius: "50%", background: S.green, border: "2px solid #fff" }} />
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: S.dark, margin: 0 }}>{thread.name}</p>
            <p style={{ fontSize: 12, color: S.green, margin: "1px 0 0", fontWeight: 600 }}>Online</p>
          </div>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
          <div style={{ textAlign: "center", marginBottom: 16 }}>
            <span style={{ fontSize: 11, color: S.light, background: S.surface, padding: "4px 12px", borderRadius: 99, border: `1px solid ${S.border}` }}>Today, 2:04 PM</span>
          </div>
          {messages.map((m, i) => (
            <div key={i} style={{ display: "flex", justifyContent: m.from === "me" ? "flex-end" : "flex-start", marginBottom: 8 }}>
              <div style={{ maxWidth: "78%", borderRadius: m.from === "me" ? "18px 18px 4px 18px" : "18px 18px 18px 4px", background: m.from === "me" ? S.primary : S.card, border: m.from === "me" ? "none" : `1px solid ${S.border}`, padding: "10px 14px", boxShadow: m.from === "me" ? `0 4px 12px ${S.primary}40` : S.shadow }}>
                <p style={{ fontSize: 14, color: m.from === "me" ? "#fff" : S.dark, margin: 0, lineHeight: 1.45 }}>{m.text}</p>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4, marginTop: 4 }}>
                  <span style={{ fontSize: 11, color: m.from === "me" ? "rgba(255,255,255,0.6)" : S.light }}>{m.time}</span>
                  {m.from === "me" && <CheckCheck size={13} color="rgba(255,255,255,0.7)" />}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Input */}
        <div style={{ background: S.card, borderTop: `1px solid ${S.border}`, padding: "12px 16px 28px", display: "flex", gap: 10, alignItems: "flex-end" }}>
          <input value={input} onChange={e => setInput(e.target.value)} placeholder="Message Taylor…" style={{ flex: 1, padding: "11px 14px", borderRadius: 24, border: `1px solid ${S.border}`, background: S.surface, fontSize: 14, color: S.dark, outline: "none" }} />
          <button style={{ width: 42, height: 42, borderRadius: "50%", background: S.primary, border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: `0 4px 12px ${S.primary}40`, flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M12 5l7 7-7 7" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif", background: S.surface, height: "100vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ background: S.card, borderBottom: `1px solid ${S.border}`, padding: "44px 20px 0", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: S.dark, margin: 0 }}>Messages</h1>
          <button style={{ width: 36, height: 36, borderRadius: 11, background: S.primary, border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <Edit3 size={16} color="#fff" />
          </button>
        </div>
        <div style={{ position: "relative", marginBottom: 14 }}>
          <Search size={15} color={S.light} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
          <input placeholder="Search messages…" style={{ width: "100%", padding: "10px 12px 10px 34px", borderRadius: 12, border: `1px solid ${S.border}`, background: S.surface, fontSize: 14, color: S.dark, outline: "none", boxSizing: "border-box" }} />
        </div>
      </div>

      {/* Thread list */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {threads.map(t => (
          <div key={t.id} onClick={() => setOpen(t.id)} style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, borderBottom: `1px solid ${S.border}`, cursor: "pointer", background: t.unread ? S.card : "transparent" }}>
            <div style={{ position: "relative", flexShrink: 0 }}>
              <div style={{ width: 48, height: 48, borderRadius: "50%", background: t.gradient, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ color: "#fff", fontSize: t.isGroup ? 20 : 15, fontWeight: 700 }}>{t.avatar}</span>
              </div>
              {!t.isGroup && <div style={{ position: "absolute", bottom: 1, right: 1, width: 12, height: 12, borderRadius: "50%", background: t.online ? S.green : "#CBD5E1", border: "2px solid #fff" }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
                <p style={{ fontSize: 15, fontWeight: t.unread ? 800 : 600, color: S.dark, margin: 0 }}>{t.name}</p>
                <span style={{ fontSize: 11, color: t.unread ? S.primary : S.light, fontWeight: t.unread ? 700 : 400 }}>{t.time}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <p style={{ fontSize: 13, color: t.unread ? S.mid : S.light, fontWeight: t.unread ? 600 : 400, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "85%" }}>{t.preview}</p>
                {t.unread > 0 && <div style={{ width: 20, height: 20, borderRadius: "50%", background: S.primary, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><span style={{ fontSize: 11, fontWeight: 800, color: "#fff" }}>{t.unread}</span></div>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Bottom Nav */}
      <div style={{ background: S.card, borderTop: `1px solid ${S.border}`, paddingBottom: 20, flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-around", paddingTop: 10 }}>
          {["Home","Schedule","Messages","Team"].map(label => (
            <span key={label} style={{ fontSize: 10, fontWeight: label === "Messages" ? 700 : 500, color: label === "Messages" ? S.primary : S.light }}>{label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
