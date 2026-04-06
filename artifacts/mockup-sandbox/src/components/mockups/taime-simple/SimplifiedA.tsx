import React, { useState, useEffect } from "react";
import {
  Bell, Home, Calendar, Users, MessageCircle, Settings,
  Clock, AlertTriangle, CheckSquare, ChevronRight,
  TrendingUp, Sparkles, Circle, Play, MessageSquare,
} from "lucide-react";

const C = {
  bg: "#FFFBF5", card: "#FFFFFF", border: "#F0EBE3",
  orange: "#F47D31", teal: "#4ECDC4", green: "#6BCB77",
  red: "#FF6B6B", yellow: "#F9C846", dark: "#1A1A2E",
};

const today = new Date();
const dayStr = today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

interface TaskProps { done?: boolean; label: string; sub: string; color?: string; }
function Task({ done, label, sub, color = C.orange }: TaskProps) {
  return (
    <div className="flex items-center gap-3.5 py-3.5" style={{ borderBottom: `1px solid ${C.border}` }}>
      <div
        className="w-6 h-6 rounded-lg flex-shrink-0 flex items-center justify-center"
        style={done
          ? { backgroundColor: `${C.green}18`, border: `1.5px solid ${C.green}50` }
          : { border: `1.5px solid ${color}60` }
        }
      >
        {done && <CheckSquare size={12} style={{ color: C.green }} />}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-[14px] font-bold leading-tight ${done ? "line-through" : ""}`}
          style={{ color: done ? `${C.dark}50` : C.dark }}>
          {label}
        </p>
        <p className="text-[11px] mt-0.5 font-semibold" style={{ color: `${C.dark}55` }}>{sub}</p>
      </div>
      {!done && <ChevronRight size={14} style={{ color: `${C.dark}30` }} />}
    </div>
  );
}

export function SimplifiedA() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const fade = (delay = 0): React.CSSProperties => ({
    opacity: mounted ? 1 : 0,
    transform: mounted ? "translateY(0)" : "translateY(16px)",
    transition: `all 0.6s cubic-bezier(0.16,1,0.3,1) ${delay}s`,
  });

  return (
    <div className="flex justify-center items-center min-h-screen" style={{ backgroundColor: "#F0EBE3", fontFamily: "'Nunito', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap'); .noscroll::-webkit-scrollbar{display:none;} .noscroll{-ms-overflow-style:none;scrollbar-width:none;}`}</style>

      <div className="relative w-[390px] h-[844px] overflow-hidden flex flex-col"
        style={{ backgroundColor: C.bg, borderRadius: 52, border: "8px solid #DDD8D0", boxShadow: "0 40px 80px rgba(0,0,0,0.14)" }}>

        {/* Status Bar */}
        <div className="h-14 w-full flex justify-between items-center px-7 pt-2 absolute top-0 z-50">
          <span className="text-[15px] font-bold" style={{ color: C.dark }}>9:41</span>
          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-[120px] h-[32px] bg-black rounded-full" />
          <Bell size={17} style={{ color: C.dark }} />
        </div>

        {/* Header */}
        <div className="px-6 pt-16 pb-4 flex justify-between items-center" style={fade()}>
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-widest mb-1" style={{ color: `${C.dark}45` }}>{dayStr}</p>
            <h1 className="text-[26px] font-extrabold tracking-tight leading-tight" style={{ color: C.dark }}>
              Good morning,<br />Libby 👋
            </h1>
          </div>
          <div className="w-12 h-12 rounded-full flex items-center justify-center font-extrabold text-white text-lg" style={{ background: `linear-gradient(135deg, ${C.orange}, ${C.yellow})` }}>
            L
          </div>
        </div>

        {/* Scrollable */}
        <div className="noscroll flex-1 overflow-y-auto px-6 pb-40 space-y-4" style={fade(0.05)}>

          {/* Clock In Hero */}
          <div className="rounded-3xl overflow-hidden" style={{ backgroundColor: C.orange }}>
            <div className="px-5 pt-5 pb-4">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-[11px] font-extrabold uppercase tracking-widest text-white/70 mb-1">Time Clock</p>
                  <p className="text-[32px] font-extrabold text-white leading-none">10:27 AM</p>
                </div>
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: "rgba(255,255,255,0.2)" }}>
                  <Clock size={24} className="text-white" />
                </div>
              </div>
              <button className="w-full py-3.5 rounded-2xl font-extrabold text-[15px] flex items-center justify-center gap-2"
                style={{ backgroundColor: "rgba(255,255,255,0.95)", color: C.orange }}>
                <Play size={16} fill={C.orange} />
                Clock In
              </button>
            </div>
            <div className="grid grid-cols-2 border-t" style={{ borderColor: "rgba(255,255,255,0.15)" }}>
              <div className="py-3 px-5 text-center" style={{ borderRight: "1px solid rgba(255,255,255,0.15)" }}>
                <p className="text-[10px] uppercase tracking-wider font-bold text-white/60 mb-0.5">Today's Hours</p>
                <p className="text-lg font-extrabold text-white">0h 0m</p>
              </div>
              <div className="py-3 px-5 text-center">
                <p className="text-[10px] uppercase tracking-wider font-bold text-white/60 mb-0.5">Break Time</p>
                <p className="text-lg font-extrabold text-white">0m</p>
              </div>
            </div>
          </div>

          {/* Urgent Alert */}
          <div className="rounded-2xl px-4 py-3.5 flex gap-3.5 items-start"
            style={{ backgroundColor: `${C.red}0A`, border: `1px solid ${C.red}25`, borderLeft: `3px solid ${C.red}` }}>
            <AlertTriangle size={16} style={{ color: C.red, marginTop: 2 }} className="flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-extrabold mb-0.5" style={{ color: "#C0392B" }}>Summer hasn't clocked in</p>
              <p className="text-[11px] font-semibold" style={{ color: `${C.red}80` }}>Shift started 8 min ago • Needs your attention</p>
            </div>
            <button className="flex-shrink-0 px-3 py-1.5 rounded-xl text-white text-[11px] font-extrabold flex items-center gap-1"
              style={{ background: `linear-gradient(135deg, ${C.red}, ${C.orange})` }}>
              <MessageSquare size={10} /> Message
            </button>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: TrendingUp, label: "Sales", value: "$2,450", tag: "+12%", color: C.green },
              { icon: Users, label: "On Floor", value: "2 of 3", tag: "Live", color: C.teal },
              { icon: Sparkles, label: "Team Score", value: "92", tag: "Top 5%", color: C.orange },
            ].map(({ icon: Icon, label, value, tag, color }) => (
              <div key={label} className="rounded-2xl p-3.5 text-center" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
                <div className="w-8 h-8 rounded-xl flex items-center justify-center mx-auto mb-2" style={{ backgroundColor: `${color}12` }}>
                  <Icon size={15} style={{ color }} />
                </div>
                <p className="text-[13px] font-extrabold" style={{ color: C.dark }}>{value}</p>
                <p className="text-[9px] font-bold uppercase tracking-wide mt-0.5" style={{ color: `${C.dark}45` }}>{label}</p>
                <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-full mt-1 inline-block" style={{ backgroundColor: `${color}15`, color }}>
                  {tag}
                </span>
              </div>
            ))}
          </div>

          {/* To-Do List */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[15px] font-extrabold" style={{ color: C.dark }}>Today's To-Do</h2>
              <span className="w-5 h-5 rounded-full text-white text-[10px] font-extrabold flex items-center justify-center" style={{ backgroundColor: C.orange }}>2</span>
            </div>
            <div className="rounded-3xl overflow-hidden px-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
              <Task label="Approve Summer's schedule change" sub="Requested 2h ago • Tap to review" color={C.orange} />
              <Task label="Restock Summer Collection display" sub="Assigned to Sela • Due 12:00 PM" color={C.teal} />
              <Task done label="Morning register count" sub="Completed by Taylor at 8:55 AM" />
            </div>
          </div>

        </div>

        {/* Bottom Nav */}
        <div className="absolute bottom-0 w-full z-50 pointer-events-none" style={{ background: `linear-gradient(to top, ${C.bg} 55%, transparent)`, paddingTop: 28 }}>
          <div className="mx-4 mb-5 rounded-[28px] pointer-events-auto"
            style={{ backgroundColor: C.card, boxShadow: "0 4px 24px rgba(0,0,0,0.10)", padding: "10px 24px 10px" }}>
            <div className="flex justify-between items-center">
              <button className="flex flex-col items-center gap-0.5">
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ backgroundColor: C.orange }}>
                  <Home size={20} strokeWidth={2.5} className="text-white" />
                </div>
                <span className="text-[11px] font-extrabold" style={{ color: C.orange }}>Home</span>
              </button>
              {[Calendar, Users, MessageCircle, Settings].map((Icon, i) => (
                <button key={i} className="flex flex-col items-center pt-2">
                  <Icon size={22} strokeWidth={1.8} style={{ color: `${C.dark}45` }} />
                </button>
              ))}
            </div>
          </div>
          <div className="w-[120px] h-1.5 rounded-full mx-auto" style={{ backgroundColor: `${C.dark}20` }} />
        </div>
      </div>
    </div>
  );
}
