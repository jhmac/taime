import { useState } from "react";
import { TrendingUp, TrendingDown, Users, AlertTriangle, Sparkles, ChevronRight, LayoutDashboard, Calendar, MessageCircle, Settings, Clock, CheckCircle2, Bell, MoreHorizontal } from "lucide-react";

const S = {
  bg: "#FFFFFF", surface: "#F8FAFF", card: "#FFFFFF",
  border: "#E8EDF8", borderLight: "#F0F4FF",
  primary: "#5B6CF0", primarySoft: "#EEF0FF",
  dark: "#0D1F3C", mid: "#445578", light: "#8898AA",
  green: "#00C48C", greenSoft: "#E6FAF4",
  orange: "#FF7A45", orangeSoft: "#FFF3EE",
  red: "#F43F5E", redSoft: "#FFF0F3",
  shadow: "0 1px 3px rgba(0,18,60,0.06), 0 4px 16px rgba(0,18,60,0.04)",
};

const MetricCard = ({ label, value, change, positive, icon: Icon, color, soft }: any) => (
  <div style={{ borderRadius: 16, background: S.card, padding: "14px", boxShadow: S.shadow, border: `1px solid ${S.border}` }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
      <div style={{ width: 32, height: 32, borderRadius: 10, background: soft, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon size={16} color={color} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 700, color: positive ? S.green : S.red }}>
        {positive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
        {change}
      </div>
    </div>
    <p style={{ fontSize: 10, fontWeight: 600, color: S.light, margin: 0, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</p>
    <p style={{ fontSize: 20, fontWeight: 800, color: S.dark, margin: "4px 0 0" }}>{value}</p>
  </div>
);

export default function ManagerDashboard() {
  const [tab, setTab] = useState<"today"|"week">("today");

  const team = [
    { name: "Taylor S.", role: "Lead", status: "clocked-in", since: "9:02 AM", avatar: "TS", score: 98 },
    { name: "Libby R.", role: "Sales", status: "clocked-in", since: "10:05 AM", avatar: "LR", score: 94 },
    { name: "Jordan M.", role: "Stock", status: "late", since: "10m late", avatar: "JM", score: 72 },
    { name: "Sela P.", role: "Sales", status: "off", since: "Day off", avatar: "SP", score: 89 },
  ];

  return (
    <div style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif", background: S.surface, height: "100vh", overflow: "hidden", position: "relative" }}>
      {/* Header */}
      <div style={{ background: S.card, borderBottom: `1px solid ${S.border}`, padding: "44px 20px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <p style={{ fontSize: 12, fontWeight: 600, color: S.light, letterSpacing: "0.06em", textTransform: "uppercase", margin: 0 }}>MANAGER VIEW</p>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: S.dark, margin: "4px 0 0" }}>Boutique Dashboard</h1>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 12, background: S.surface, border: `1px solid ${S.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Bell size={18} color={S.mid} />
            </div>
            <div style={{ width: 38, height: 38, borderRadius: "50%", background: `linear-gradient(135deg, ${S.primary}, #8B5CF6)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ color: "#fff", fontSize: 13, fontWeight: 700 }}>AH</span>
            </div>
          </div>
        </div>
        {/* Tab switcher */}
        <div style={{ display: "flex", gap: 6, marginTop: 14, background: S.surface, borderRadius: 12, padding: 4 }}>
          {(["today","week"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: "8px 0", borderRadius: 9, background: tab === t ? S.card : "transparent", border: tab === t ? `1px solid ${S.border}` : "1px solid transparent", fontSize: 13, fontWeight: 700, color: tab === t ? S.dark : S.light, cursor: "pointer", boxShadow: tab === t ? S.shadow : "none", transition: "all 0.2s" }}>
              {t === "today" ? "Today" : "This Week"}
            </button>
          ))}
        </div>
      </div>

      {/* Scroll */}
      <div style={{ height: "calc(100vh - 180px - 74px)", overflowY: "auto", padding: "16px 16px 0" }}>
        {/* Alert */}
        <div style={{ borderRadius: 14, background: S.redSoft, border: `1px solid ${S.red}30`, borderLeft: `3px solid ${S.red}`, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <AlertTriangle size={16} color={S.red} style={{ flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: S.dark, margin: 0 }}>Jordan is 10 min late</p>
            <p style={{ fontSize: 12, color: S.light, margin: "2px 0 0" }}>Shift started at 10:00 AM · Tap to message</p>
          </div>
          <ChevronRight size={16} color={S.light} />
        </div>

        {/* KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
          <MetricCard label="Today's Sales" value="$3,820" change="+14%" positive icon={TrendingUp} color={S.green} soft={S.greenSoft} />
          <MetricCard label="Team On Shift" value="3 / 5" change="+1" positive icon={Users} color={S.primary} soft={S.primarySoft} />
          <MetricCard label="Tasks Done" value="8 / 12" change="-2" positive={false} icon={CheckCircle2} color={S.orange} soft={S.orangeSoft} />
          <MetricCard label="Avg Score" value="88 pts" change="+5" positive icon={TrendingUp} color="#8B5CF6" soft="#F3EEFF" />
        </div>

        {/* Team Status */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: S.light, letterSpacing: "0.08em", textTransform: "uppercase", margin: 0 }}>TEAM STATUS</p>
            <span style={{ fontSize: 12, fontWeight: 600, color: S.primary }}>Manage →</span>
          </div>
          {team.map((m, i) => (
            <div key={i} style={{ borderRadius: 14, background: S.card, padding: "12px 14px", marginBottom: 8, boxShadow: S.shadow, border: `1px solid ${S.border}`, display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 38, height: 38, borderRadius: "50%", background: m.status === "late" ? `linear-gradient(135deg, ${S.red}, ${S.orange})` : `linear-gradient(135deg, ${S.primary}, #8B5CF6)`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ color: "#fff", fontSize: 13, fontWeight: 700 }}>{m.avatar}</span>
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 14, fontWeight: 700, color: S.dark, margin: 0 }}>{m.name}</p>
                <p style={{ fontSize: 12, color: S.light, margin: "2px 0 0" }}>{m.role} · {m.since}</p>
              </div>
              <div style={{ textAlign: "right" }}>
                <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: m.status === "clocked-in" ? S.greenSoft : m.status === "late" ? S.redSoft : S.surface, color: m.status === "clocked-in" ? S.green : m.status === "late" ? S.red : S.light }}>
                  {m.status === "clocked-in" ? "On shift" : m.status === "late" ? "Late" : "Off"}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* AI Insight */}
        <div style={{ borderRadius: 16, background: S.primarySoft, border: `1px solid ${S.primary}30`, padding: "14px 16px", display: "flex", gap: 10, marginBottom: 20 }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: S.primary, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Sparkles size={15} color="#fff" />
          </div>
          <div>
            <p style={{ fontSize: 12, fontWeight: 700, color: S.primary, margin: 0 }}>Ara · Suggested Action</p>
            <p style={{ fontSize: 13, color: S.mid, margin: "4px 0 0", lineHeight: 1.45 }}>Sales are up 14% — consider messaging the team to highlight today's momentum before the afternoon rush.</p>
          </div>
        </div>
      </div>

      {/* Bottom Nav */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: S.card, borderTop: `1px solid ${S.border}`, paddingBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-around", paddingTop: 10 }}>
          {[{ icon: LayoutDashboard, label: "Dashboard", active: true }, { icon: Calendar, label: "Schedule", active: false }, { icon: MessageCircle, label: "Messages", active: false }, { icon: Settings, label: "Settings", active: false }].map(i => (
            <div key={i.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
              <i.icon size={22} color={i.active ? S.primary : S.light} strokeWidth={i.active ? 2.5 : 1.8} />
              <span style={{ fontSize: 10, fontWeight: i.active ? 700 : 500, color: i.active ? S.primary : S.light }}>{i.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
