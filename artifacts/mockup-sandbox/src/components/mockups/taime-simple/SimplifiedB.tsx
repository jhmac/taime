import React, { useState, useEffect } from "react";
import {
  Home, Calendar, Users, MessageCircle, Settings,
  Clock, AlertTriangle, ChevronRight,
  Play, Circle, CheckCircle2, Sparkles,
} from "lucide-react";

const C = {
  bg: "#FFFBF5", card: "#FFFFFF", border: "#F0EBE3",
  orange: "#F47D31", teal: "#4ECDC4", green: "#6BCB77",
  red: "#FF6B6B", yellow: "#F9C846", dark: "#1A1A2E",
  purple: "#9B59B6",
};

const tasks = [
  { id: 1, label: "Approve Summer's shift swap", context: "Requested 2 hours ago", color: C.orange, due: "Now", done: false },
  { id: 2, label: "Restock Summer Collection display", context: "Due by 12:00 PM · Sela assigned", color: C.teal, due: "12 PM", done: false },
  { id: 3, label: "Send weekly team shoutout", context: "Due by end of day", color: C.purple, due: "EOD", done: false },
  { id: 4, label: "Morning register count", context: "Done by Taylor at 8:55 AM", color: C.green, due: "", done: true },
];

export function SimplifiedB() {
  const [mounted, setMounted] = useState(false);
  const [checked, setChecked] = useState<number[]>([4]);
  useEffect(() => { setMounted(true); }, []);

  const fade = (delay = 0): React.CSSProperties => ({
    opacity: mounted ? 1 : 0,
    transform: mounted ? "translateY(0)" : "translateY(18px)",
    transition: `all 0.55s cubic-bezier(0.16,1,0.3,1) ${delay}s`,
  });

  const pending = tasks.filter(t => !checked.includes(t.id));
  const done = tasks.filter(t => checked.includes(t.id));

  return (
    <div className="flex justify-center items-center min-h-screen" style={{ backgroundColor: "#F0EBE3", fontFamily: "'Nunito', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap'); .noscroll::-webkit-scrollbar{display:none;} .noscroll{-ms-overflow-style:none;scrollbar-width:none;}`}</style>

      <div className="relative w-[390px] h-[844px] overflow-hidden flex flex-col"
        style={{ backgroundColor: C.bg, borderRadius: 52, border: "8px solid #DDD8D0", boxShadow: "0 40px 80px rgba(0,0,0,0.14)" }}>

        {/* Status Bar */}
        <div className="h-14 w-full flex justify-between items-center px-7 pt-2 absolute top-0 z-50">
          <span className="text-[15px] font-bold" style={{ color: C.dark }}>9:41</span>
          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-[120px] h-[32px] bg-black rounded-full" />
          <div className="w-7 h-7 rounded-full flex items-center justify-center font-extrabold text-white text-[11px]" style={{ background: `linear-gradient(135deg, ${C.orange}, ${C.yellow})` }}>L</div>
        </div>

        {/* Scrollable */}
        <div className="noscroll flex-1 overflow-y-auto pt-16 px-5 pb-36 space-y-4">

          {/* Greeting — compact */}
          <div style={fade()}>
            <p className="text-[12px] font-bold mb-0.5" style={{ color: `${C.dark}45` }}>Thursday, April 2</p>
            <h1 className="text-[24px] font-extrabold leading-tight" style={{ color: C.dark }}>
              Good morning, Libby 👋
            </h1>
          </div>

          {/* ── TASKS — HERO ── */}
          <div style={fade(0.05)}>
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <h2 className="text-[19px] font-extrabold" style={{ color: C.dark }}>Your tasks today</h2>
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[11px] font-extrabold"
                  style={{ backgroundColor: C.orange }}>
                  {pending.length}
                </div>
              </div>
              <button className="text-[12px] font-bold flex items-center gap-0.5" style={{ color: C.orange }}>
                See all <ChevronRight size={13} />
              </button>
            </div>

            {/* Pending task cards */}
            <div className="space-y-2.5">
              {pending.map((task, i) => (
                <button
                  key={task.id}
                  onClick={() => setChecked(c => [...c, task.id])}
                  className="w-full rounded-3xl px-4 py-4 flex items-center gap-4 text-left active:scale-[0.98] transition-transform"
                  style={{ backgroundColor: C.card, border: `1.5px solid ${task.color}22`, boxShadow: `0 2px 12px ${task.color}10` }}
                >
                  {/* Number badge */}
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center font-extrabold text-white text-[15px] flex-shrink-0"
                    style={{ backgroundColor: task.color }}>
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-extrabold leading-snug" style={{ color: C.dark }}>{task.label}</p>
                    <p className="text-[11px] font-semibold mt-0.5" style={{ color: `${C.dark}55` }}>{task.context}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    {task.due && (
                      <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-lg"
                        style={{ backgroundColor: `${task.color}15`, color: task.color }}>
                        {task.due}
                      </span>
                    )}
                    <Circle size={20} style={{ color: `${C.dark}25` }} />
                  </div>
                </button>
              ))}
            </div>

            {/* Completed tasks — subtle */}
            {done.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {done.map(task => (
                  <div key={task.id} className="flex items-center gap-3 px-4 py-3 rounded-2xl"
                    style={{ backgroundColor: `${C.green}08`, border: `1px solid ${C.green}20` }}>
                    <CheckCircle2 size={18} style={{ color: C.green }} className="flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-bold line-through truncate" style={{ color: `${C.dark}45` }}>{task.label}</p>
                      <p className="text-[10px] font-semibold" style={{ color: `${C.dark}35` }}>{task.context}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── ALERT — slim banner ── */}
          <div style={fade(0.12)}>
            <div className="rounded-2xl px-4 py-3.5 flex items-center gap-3"
              style={{ backgroundColor: `${C.red}0D`, border: `1px solid ${C.red}30`, borderLeft: `3px solid ${C.red}` }}>
              <AlertTriangle size={15} style={{ color: C.red }} className="flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-extrabold" style={{ color: "#C0392B" }}>Summer hasn't clocked in</p>
                <p className="text-[11px] font-semibold" style={{ color: `${C.red}80` }}>8 min late · Tap to message</p>
              </div>
              <ChevronRight size={16} style={{ color: C.red }} className="flex-shrink-0" />
            </div>
          </div>

          {/* ── CLOCK IN — secondary ── */}
          <div style={fade(0.18)}>
            <div className="rounded-3xl overflow-hidden" style={{ backgroundColor: C.orange }}>
              <div className="px-5 py-4 flex items-center gap-4">
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-widest text-white/60 mb-1">Time Clock</p>
                  <p className="text-[26px] font-extrabold text-white leading-none">10:27 AM</p>
                </div>
                <div className="flex-1" />
                <button className="px-5 py-3 rounded-2xl font-extrabold text-[14px] flex items-center gap-2 flex-shrink-0"
                  style={{ backgroundColor: "rgba(255,255,255,0.95)", color: C.orange }}>
                  <Play size={14} fill={C.orange} strokeWidth={0} />
                  Clock In
                </button>
              </div>
            </div>
          </div>

          {/* ── STATS — bottom context ── */}
          <div style={fade(0.22)}>
            <div className="rounded-2xl px-5 py-4 flex items-center justify-between"
              style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
              <div className="text-center">
                <p className="text-[17px] font-extrabold" style={{ color: C.dark }}>$2,450</p>
                <p className="text-[9px] font-bold uppercase tracking-wide mt-0.5" style={{ color: `${C.dark}45` }}>Sales today</p>
                <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-full mt-1 inline-block" style={{ backgroundColor: `${C.green}18`, color: C.green }}>+12%</span>
              </div>
              <div className="w-px h-10" style={{ backgroundColor: C.border }} />
              <div className="text-center">
                <p className="text-[17px] font-extrabold" style={{ color: C.dark }}>2 / 3</p>
                <p className="text-[9px] font-bold uppercase tracking-wide mt-0.5" style={{ color: `${C.dark}45` }}>On floor</p>
                <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-full mt-1 inline-block" style={{ backgroundColor: `${C.red}18`, color: C.red }}>1 out</span>
              </div>
              <div className="w-px h-10" style={{ backgroundColor: C.border }} />
              <div className="text-center">
                <p className="text-[17px] font-extrabold" style={{ color: C.dark }}>92</p>
                <p className="text-[9px] font-bold uppercase tracking-wide mt-0.5" style={{ color: `${C.dark}45` }}>Team score</p>
                <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-full mt-1 inline-block" style={{ backgroundColor: `${C.orange}18`, color: C.orange }}>Top 5%</span>
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
