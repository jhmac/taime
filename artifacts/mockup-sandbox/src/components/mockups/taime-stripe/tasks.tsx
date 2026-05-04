import React, { useState } from "react";
import { CheckCircle2, Circle, Plus, ChevronRight, Clock, Sparkles, ClipboardList, Package, Repeat } from "lucide-react";

const S = {
  bg: "#FFFFFF", surface: "#F8FAFF", card: "#FFFFFF",
  border: "#E8EDF8", primary: "#5B6CF0", primarySoft: "#EEF0FF",
  dark: "#0D1F3C", mid: "#445578", light: "#8898AA",
  green: "#00C48C", greenSoft: "#E6FAF4",
  orange: "#FF7A45", orangeSoft: "#FFF3EE",
  red: "#F43F5E", redSoft: "#FFF0F3",
  purple: "#8B5CF6", purpleSoft: "#F3EEFF",
  teal: "#06B6D4", tealSoft: "#ECFEFF",
  shadow: "0 1px 3px rgba(0,18,60,0.06), 0 4px 16px rgba(0,18,60,0.04)",
};

const categories = [
  { key: "all", label: "All", count: 9 },
  { key: "task", label: "Tasks", count: 4 },
  { key: "chore", label: "Chores", count: 3 },
  { key: "supply", label: "Supply", count: 2 },
];

const tasks = [
  { id: 1, title: "Morning register count", category: "chore", assignee: "Taylor S.", due: "9:00 AM", done: true, priority: "high" },
  { id: 2, title: "Restock Summer Collection display", category: "task", assignee: "Libby R.", due: "12:00 PM", done: false, priority: "high" },
  { id: 3, title: "Send team shoutout message", category: "task", assignee: "You", due: "EOD", done: false, priority: "medium" },
  { id: 4, title: "Clean fitting rooms", category: "chore", assignee: "Jordan M.", due: "2:00 PM", done: false, priority: "medium" },
  { id: 5, title: "Check wrapping supplies", category: "supply", assignee: "Sela P.", due: "11:00 AM", done: true, priority: "low" },
  { id: 6, title: "End-of-day cash count", category: "chore", assignee: "Taylor S.", due: "6:00 PM", done: false, priority: "high" },
  { id: 7, title: "Update window display", category: "task", assignee: "You", due: "3:00 PM", done: false, priority: "low" },
  { id: 8, title: "Office supply inventory", category: "supply", assignee: "You", due: "EOD", done: false, priority: "low" },
  { id: 9, title: "Product knowledge quiz", category: "task", assignee: "Team", due: "EOD", done: false, priority: "medium" },
];

const catIcon = (c: string) => c === "chore" ? Repeat : c === "supply" ? Package : ClipboardList;
const catColor = (c: string) => c === "chore" ? S.orange : c === "supply" ? S.teal : S.primary;
const catSoft = (c: string) => c === "chore" ? S.orangeSoft : c === "supply" ? S.tealSoft : S.primarySoft;
const priColor = (p: string) => p === "high" ? S.red : p === "medium" ? S.orange : S.light;

export default function Tasks() {
  const [activeTab, setActiveTab] = useState("all");
  const [done, setDone] = useState<number[]>([1, 5]);

  const filtered = tasks.filter(t => activeTab === "all" || t.category === activeTab);
  const completedCount = filtered.filter(t => done.includes(t.id)).length;
  const pct = Math.round((completedCount / filtered.length) * 100);

  return (
    <div style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif", background: S.surface, height: "100vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ background: S.card, borderBottom: `1px solid ${S.border}`, padding: "44px 20px 0", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: S.dark, margin: 0 }}>Tasks & Chores</h1>
          <button style={{ width: 36, height: 36, borderRadius: 11, background: S.primary, border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <Plus size={18} color="#fff" />
          </button>
        </div>

        {/* Progress bar */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: S.mid }}>Today's progress</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: S.dark }}>{completedCount}/{filtered.length} done</span>
          </div>
          <div style={{ height: 6, background: S.surface, borderRadius: 99, overflow: "hidden", border: `1px solid ${S.border}` }}>
            <div style={{ height: "100%", width: `${pct}%`, background: `linear-gradient(90deg, ${S.primary}, #8B5CF6)`, borderRadius: 99, transition: "width 0.4s ease" }} />
          </div>
        </div>

        {/* Category tabs */}
        <div style={{ display: "flex", gap: 6, paddingBottom: 14, overflowX: "auto" }}>
          {categories.map(c => (
            <button key={c.key} onClick={() => setActiveTab(c.key)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 20, background: activeTab === c.key ? S.primary : S.card, border: activeTab === c.key ? "none" : `1px solid ${S.border}`, color: activeTab === c.key ? "#fff" : S.mid, fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>
              {c.label}
              <span style={{ fontSize: 11, fontWeight: 800, padding: "1px 6px", borderRadius: 99, background: activeTab === c.key ? "rgba(255,255,255,0.25)" : S.surface, color: activeTab === c.key ? "#fff" : S.light }}>{c.count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Task list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
        {filtered.map(t => {
          const isDone = done.includes(t.id);
          const Icon = catIcon(t.category);
          return (
            <div key={t.id} style={{ borderRadius: 16, background: S.card, padding: "14px", marginBottom: 8, boxShadow: S.shadow, border: `1px solid ${isDone ? S.greenSoft : S.border}`, display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer", opacity: isDone ? 0.65 : 1, transition: "opacity 0.2s" }}
              onClick={() => setDone(d => d.includes(t.id) ? d.filter(x => x !== t.id) : [...d, t.id])}>

              {/* Check */}
              <div style={{ width: 24, height: 24, borderRadius: "50%", border: `2px solid ${isDone ? S.green : S.border}`, background: isDone ? S.green : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 }}>
                {isDone && <CheckCircle2 size={14} color="#fff" strokeWidth={3} />}
              </div>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: isDone ? S.light : S.dark, textDecoration: isDone ? "line-through" : "none", margin: 0, lineHeight: 1.4 }}>{t.title}</p>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 6, background: catSoft(t.category) }}>
                    <Icon size={11} color={catColor(t.category)} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: catColor(t.category) }}>{t.category}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                    <Clock size={11} color={S.light} />
                    <span style={{ fontSize: 11, color: S.light }}>{t.due}</span>
                  </div>
                  <div style={{ width: 5, height: 5, borderRadius: "50%", background: priColor(t.priority), flexShrink: 0 }} />
                </div>
                <p style={{ fontSize: 12, color: S.light, margin: "4px 0 0" }}>→ {t.assignee}</p>
              </div>
            </div>
          );
        })}

        {/* AI suggestion */}
        <div style={{ borderRadius: 14, background: S.primarySoft, border: `1px solid ${S.primary}20`, padding: "12px 14px", display: "flex", alignItems: "flex-start", gap: 10, marginTop: 4, marginBottom: 16 }}>
          <Sparkles size={16} color={S.primary} style={{ flexShrink: 0, marginTop: 1 }} />
          <p style={{ fontSize: 13, color: S.mid, margin: 0, lineHeight: 1.45 }}>Ara: <strong style={{ color: S.primary }}>3 tasks</strong> are at risk of being missed today. Broadcast to the team?</p>
        </div>
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
