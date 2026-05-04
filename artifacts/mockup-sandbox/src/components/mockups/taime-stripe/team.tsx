import React, { useState } from "react";
import { Search, Plus, ChevronRight, Star, Clock, Shield } from "lucide-react";

const S = {
  bg: "#FFFFFF", surface: "#F8FAFF", card: "#FFFFFF",
  border: "#E8EDF8", primary: "#5B6CF0", primarySoft: "#EEF0FF",
  dark: "#0D1F3C", mid: "#445578", light: "#8898AA",
  green: "#00C48C", greenSoft: "#E6FAF4",
  orange: "#FF7A45", orangeSoft: "#FFF3EE",
  red: "#F43F5E", redSoft: "#FFF0F3",
  purple: "#8B5CF6", purpleSoft: "#F3EEFF",
  shadow: "0 1px 3px rgba(0,18,60,0.06), 0 4px 16px rgba(0,18,60,0.04)",
};

const members = [
  { name: "Taylor Singh", role: "Store Lead", avatar: "TS", status: "on-shift", score: 98, hours: "32h this week", gradient: `linear-gradient(135deg, ${S.primary}, #8B5CF6)` },
  { name: "Libby Rodriguez", role: "Sales Associate", avatar: "LR", status: "on-shift", score: 94, hours: "28h this week", gradient: `linear-gradient(135deg, ${S.green}, #00A878)` },
  { name: "Jordan Mills", role: "Stock Lead", avatar: "JM", status: "late", score: 72, hours: "24h this week", gradient: `linear-gradient(135deg, ${S.orange}, #FF5E2C)` },
  { name: "Sela Park", role: "Sales Associate", avatar: "SP", status: "off", score: 89, hours: "20h this week", gradient: `linear-gradient(135deg, #8B5CF6, #7C3AED)` },
  { name: "Chris Torres", role: "Sales Associate", avatar: "CT", status: "on-shift", score: 86, hours: "30h this week", gradient: `linear-gradient(135deg, #06B6D4, #0891B2)` },
  { name: "Maya Patel", role: "Sales Associate", avatar: "MP", status: "off", score: 91, hours: "18h this week", gradient: `linear-gradient(135deg, #F59E0B, #D97706)` },
];

const statusLabel = (s: string) => s === "on-shift" ? "On Shift" : s === "late" ? "Late" : "Off Today";
const statusColor = (s: string) => s === "on-shift" ? S.green : s === "late" ? S.red : S.light;
const statusBg = (s: string) => s === "on-shift" ? S.greenSoft : s === "late" ? S.redSoft : S.surface;

export default function Team() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all"|"on-shift"|"off">("all");

  const filtered = members.filter(m =>
    (filter === "all" || (filter === "on-shift" ? m.status !== "off" : m.status === "off")) &&
    m.name.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif", background: S.surface, height: "100vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ background: S.card, borderBottom: `1px solid ${S.border}`, padding: "44px 20px 0", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: S.dark, margin: 0 }}>Team</h1>
          <button style={{ width: 36, height: 36, borderRadius: 11, background: S.primary, border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <Plus size={18} color="#fff" />
          </button>
        </div>

        {/* Search */}
        <div style={{ position: "relative", marginBottom: 12 }}>
          <Search size={15} color={S.light} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search team members…" style={{ width: "100%", padding: "10px 12px 10px 34px", borderRadius: 12, border: `1px solid ${S.border}`, background: S.surface, fontSize: 14, color: S.dark, outline: "none", boxSizing: "border-box" }} />
        </div>

        {/* Filter chips */}
        <div style={{ display: "flex", gap: 6, paddingBottom: 14 }}>
          {(["all","on-shift","off"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{ padding: "6px 14px", borderRadius: 20, border: filter === f ? "none" : `1px solid ${S.border}`, background: filter === f ? S.primary : S.card, color: filter === f ? "#fff" : S.mid, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
              {f === "all" ? "All" : f === "on-shift" ? "On Shift" : "Off Today"}
            </button>
          ))}
          <div style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: S.light, display: "flex", alignItems: "center" }}>{filtered.length} members</div>
        </div>
      </div>

      {/* Team list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
        {filtered.map((m, i) => (
          <div key={i} style={{ borderRadius: 16, background: S.card, padding: "14px", marginBottom: 10, boxShadow: S.shadow, border: `1px solid ${S.border}`, display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
            {/* Avatar */}
            <div style={{ position: "relative", flexShrink: 0 }}>
              <div style={{ width: 46, height: 46, borderRadius: "50%", background: m.gradient, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ color: "#fff", fontSize: 15, fontWeight: 800 }}>{m.avatar}</span>
              </div>
              <div style={{ position: "absolute", bottom: 0, right: 0, width: 13, height: 13, borderRadius: "50%", background: statusColor(m.status), border: "2px solid #fff" }} />
            </div>

            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                <p style={{ fontSize: 15, fontWeight: 700, color: S.dark, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</p>
                {m.role.includes("Lead") && <Shield size={12} color={S.primary} />}
              </div>
              <p style={{ fontSize: 12, color: S.light, margin: 0 }}>{m.role}</p>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: statusBg(m.status), color: statusColor(m.status) }}>{statusLabel(m.status)}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <Star size={11} color="#F59E0B" fill="#F59E0B" />
                  <span style={{ fontSize: 11, fontWeight: 700, color: S.mid }}>{m.score}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <Clock size={11} color={S.light} />
                  <span style={{ fontSize: 11, color: S.light }}>{m.hours}</span>
                </div>
              </div>
            </div>

            <ChevronRight size={16} color={S.light} style={{ flexShrink: 0 }} />
          </div>
        ))}
      </div>

      {/* Bottom Nav */}
      <div style={{ background: S.card, borderTop: `1px solid ${S.border}`, paddingBottom: 20, flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-around", paddingTop: 10 }}>
          {["Home","Schedule","Messages","Team"].map((label, i) => (
            <div key={label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: label === "Team" ? S.primary : "transparent" }} />
              <span style={{ fontSize: 10, fontWeight: label === "Team" ? 700 : 500, color: label === "Team" ? S.primary : S.light }}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
