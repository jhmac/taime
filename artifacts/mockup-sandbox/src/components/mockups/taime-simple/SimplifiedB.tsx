import React, { useState, useEffect } from "react";
import {
  Home, Calendar, Users, MessageCircle, Settings,
  Clock, AlertTriangle, CheckSquare, ChevronRight,
  Play, MessageSquare, Star, DollarSign,
} from "lucide-react";

const C = {
  bg: "#FFFBF5", card: "#FFFFFF", border: "#F0EBE3",
  orange: "#F47D31", teal: "#4ECDC4", green: "#6BCB77",
  red: "#FF6B6B", yellow: "#F9C846", dark: "#1A1A2E",
};

interface BigTileProps {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  subtitle: string;
  bg: string;
  action?: string;
  urgent?: boolean;
}
function BigTile({ icon: Icon, title, subtitle, bg, action, urgent }: BigTileProps) {
  return (
    <div className="rounded-3xl px-5 py-4 flex items-center gap-4 active:scale-[0.98] transition-transform cursor-pointer"
      style={{ backgroundColor: bg }}>
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: "rgba(255,255,255,0.25)" }}>
        <Icon size={24} className="text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[15px] font-extrabold text-white leading-tight">{title}</p>
        <p className="text-[12px] font-semibold text-white/70 mt-0.5 truncate">{subtitle}</p>
      </div>
      {action && (
        <div className="flex-shrink-0 px-3.5 py-2 rounded-xl font-extrabold text-[12px]"
          style={{ backgroundColor: "rgba(255,255,255,0.22)", color: "white" }}>
          {action}
        </div>
      )}
      {!action && <ChevronRight size={18} className="text-white/50 flex-shrink-0" />}
    </div>
  );
}

export function SimplifiedB() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const fade = (delay = 0): React.CSSProperties => ({
    opacity: mounted ? 1 : 0,
    transform: mounted ? "translateY(0)" : "translateY(20px)",
    transition: `all 0.55s cubic-bezier(0.16,1,0.3,1) ${delay}s`,
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
        </div>

        {/* Scrollable */}
        <div className="noscroll flex-1 overflow-y-auto pt-16 px-5 pb-40 space-y-3">

          {/* Greeting */}
          <div className="pb-1" style={fade()}>
            <p className="text-[13px] font-bold mb-1" style={{ color: `${C.dark}55` }}>Thursday, April 2</p>
            <h1 className="text-[28px] font-extrabold leading-tight" style={{ color: C.dark }}>
              Good morning,<br />Libby 👋
            </h1>
            <p className="text-[13px] font-semibold mt-1.5" style={{ color: `${C.dark}60` }}>
              Here's what needs your attention today.
            </p>
          </div>

          {/* Urgent — stands out first */}
          <div style={fade(0.05)}>
            <BigTile
              icon={AlertTriangle}
              title="Summer hasn't clocked in"
              subtitle="8 minutes late — tap to message her"
              bg={C.red}
              action="Message"
              urgent
            />
          </div>

          {/* Clock In */}
          <div style={fade(0.1)}>
            <div className="rounded-3xl overflow-hidden" style={{ backgroundColor: C.orange }}>
              <div className="px-5 pt-5 pb-2 flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-extrabold uppercase tracking-widest text-white/60 mb-1">Your Time Clock</p>
                  <p className="text-[30px] font-extrabold text-white leading-none">10:27 AM</p>
                </div>
                <Clock size={36} className="text-white/30" />
              </div>
              <div className="px-5 pb-5 pt-3">
                <button className="w-full py-4 rounded-2xl font-extrabold text-[16px] flex items-center justify-center gap-2.5"
                  style={{ backgroundColor: "rgba(255,255,255,0.95)", color: C.orange }}>
                  <Play size={18} fill={C.orange} strokeWidth={0} />
                  Clock In
                </button>
              </div>
            </div>
          </div>

          {/* 3 Priorities */}
          <div style={fade(0.15)}>
            <p className="text-[11px] font-extrabold uppercase tracking-widest px-1 mb-2.5" style={{ color: `${C.dark}45` }}>
              Top priorities
            </p>
            <div className="space-y-2.5">
              <BigTile
                icon={CheckSquare}
                title="Approve schedule change"
                subtitle="Summer requested a swap · 2h ago"
                bg={C.teal}
              />
              <BigTile
                icon={CheckSquare}
                title="Restock Summer Collection"
                subtitle="Assigned to Sela · Due 12:00 PM"
                bg="#9B59B6"
              />
            </div>
          </div>

          {/* Stats — just a simple pill row */}
          <div style={fade(0.2)}>
            <div className="rounded-2xl px-4 py-3.5 flex items-center justify-between"
              style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
              <div className="text-center">
                <p className="text-[18px] font-extrabold" style={{ color: C.dark }}>$2,450</p>
                <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: `${C.dark}45` }}>Today's Sales</p>
                <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-full mt-0.5 inline-block" style={{ backgroundColor: `${C.green}18`, color: C.green }}>+12%</span>
              </div>
              <div className="w-px h-10" style={{ backgroundColor: C.border }} />
              <div className="text-center">
                <p className="text-[18px] font-extrabold" style={{ color: C.dark }}>2 of 3</p>
                <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: `${C.dark}45` }}>On Floor</p>
                <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-full mt-0.5 inline-block" style={{ backgroundColor: `${C.red}18`, color: C.red }}>1 missing</span>
              </div>
              <div className="w-px h-10" style={{ backgroundColor: C.border }} />
              <div className="text-center">
                <p className="text-[18px] font-extrabold" style={{ color: C.dark }}>92</p>
                <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: `${C.dark}45` }}>Team Score</p>
                <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-full mt-0.5 inline-block" style={{ backgroundColor: `${C.orange}18`, color: C.orange }}>Top 5%</span>
              </div>
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
