import React, { useState, useEffect } from "react";
import {
  Home,
  Users,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Plus,
  Clock,
  Activity,
  MoreHorizontal,
  MessageCircle,
  Settings
} from "lucide-react";

type ShiftColor = {
  avatar: string;
  bg: string;
  border: string;
  text: string;
};

type Shift = {
  id: string;
  name: string;
  role: string;
  time: string;
  initials: string;
  color: ShiftColor;
  days: number[];
};

const COLORS: Record<string, ShiftColor> = {
  coral: { avatar: "linear-gradient(135deg, #FF6B6B, #F47D31)", bg: "#FF6B6B0C", border: "#FF6B6B20", text: "#C0392B" },
  teal:  { avatar: "linear-gradient(135deg, #4ECDC4, #6BCB77)", bg: "#4ECDC40C", border: "#4ECDC420", text: "#2E9E97" },
  yellow:{ avatar: "linear-gradient(135deg, #F9C846, #F47D31)", bg: "#F9C8460C", border: "#F9C84620", text: "#A8820A" },
  green: { avatar: "linear-gradient(135deg, #6BCB77, #4ECDC4)", bg: "#6BCB770C", border: "#6BCB7720", text: "#3D8B40" },
  orange:{ avatar: "linear-gradient(135deg, #F47D31, #F9C846)", bg: "#F47D310C", border: "#F47D3120", text: "#C05E1E" },
};

const shifts: Shift[] = [
  { id: "1", name: "Summer Furrh",  role: "Manager", time: "10:00 AM - 6:00 PM", initials: "SF", color: COLORS.coral,  days: [1,2,3] },
  { id: "2", name: "Taylor Holman", role: "Stylist",  time: "12:00 PM - 8:00 PM", initials: "TH", color: COLORS.teal,   days: [2,3,4,5,6] },
  { id: "3", name: "Sela Waller",   role: "Stylist",  time: "9:00 AM - 5:00 PM",  initials: "SW", color: COLORS.yellow, days: [3,4,5] },
  { id: "4", name: "Sophia Davis",  role: "Stylist",  time: "11:00 AM - 7:00 PM", initials: "SD", color: COLORS.green,  days: [1,4,5] },
  { id: "5", name: "Sydney Wall",   role: "Stylist",  time: "10:00 AM - 4:00 PM", initials: "SW", color: COLORS.orange, days: [0,6] },
];

const daysOfWeek = [
  { name: "Sun", date: "12" },
  { name: "Mon", date: "13" },
  { name: "Tue", date: "14" },
  { name: "Wed", date: "15" },
  { name: "Thu", date: "16" },
  { name: "Fri", date: "17" },
  { name: "Sat", date: "18" },
];

export function Schedule() {
  const [mounted, setMounted] = useState(false);
  const [selectedDay, setSelectedDay] = useState(0);
  useEffect(() => { setMounted(true); }, []);

  const dayShifts = shifts.filter(s => s.days.includes(selectedDay));

  return (
    <div className="flex justify-center items-center min-h-screen" style={{ backgroundColor: "#F0EBE3", fontFamily: "'Nunito', 'Nunito Sans', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800;900&display=swap'); .no-scroll::-webkit-scrollbar{display:none;} .no-scroll{-ms-overflow-style:none;scrollbar-width:none;}`}</style>

      <div className="relative w-[390px] h-[844px] overflow-hidden flex flex-col" style={{ backgroundColor: "#FFFBF5", borderRadius: "52px", border: "8px solid #DDD8D0", boxShadow: "0 40px 80px rgba(0,0,0,0.14)" }}>

        {/* Status Bar */}
        <div className="h-14 w-full flex justify-between items-center px-7 pt-2 z-50 absolute top-0">
          <span className="text-[15px] font-bold" style={{ color: "#1A1A2E" }}>9:41</span>
          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-[120px] h-[32px] bg-black rounded-full z-50" />
          <div className="flex gap-1.5 items-center">
            <Activity size={14} style={{ color: "#1A1A2E" }} />
            <div className="w-5 h-[11px] rounded-[3px] flex items-center p-[1px]" style={{ border: "1px solid #1A1A2E" }}>
              <div className="w-[80%] h-full rounded-[1.5px]" style={{ backgroundColor: "#1A1A2E" }} />
            </div>
          </div>
        </div>

        {/* Header */}
        <header className="px-6 pt-16 pb-2 z-10">
          <div className="flex justify-between items-center mb-5">
            <h1 className="text-[28px] font-extrabold tracking-tight" style={{ color: "#1A1A2E" }}>Schedule</h1>
            <button className="w-9 h-9 rounded-full flex items-center justify-center" style={{ backgroundColor: "#F47D31", boxShadow: "0 4px 12px rgba(244,125,49,0.35)" }}>
              <Plus size={18} strokeWidth={2.5} className="text-white" />
            </button>
          </div>

          {/* Week nav */}
          <div className="flex items-center justify-between rounded-2xl p-1 mb-4" style={{ backgroundColor: "#FFFFFF", border: "1px solid #F0EBE3", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
            <button className="w-10 h-10 flex items-center justify-center rounded-xl" style={{ color: "#1A1A2E80" }}>
              <ChevronLeft size={20} />
            </button>
            <div className="flex flex-col items-center">
              <span className="font-extrabold text-[15px]" style={{ color: "#1A1A2E" }}>Nov 12 - Nov 18</span>
              <span className="text-[11px] font-extrabold uppercase tracking-wider" style={{ color: "#F47D31" }}>This Week</span>
            </div>
            <button className="w-10 h-10 flex items-center justify-center rounded-xl" style={{ color: "#1A1A2E80" }}>
              <ChevronRight size={20} />
            </button>
          </div>

          {/* 7-day strip */}
          <div className="flex justify-between mt-2">
            {daysOfWeek.map((day, i) => {
              const isSelected = selectedDay === i;
              const isToday = i === 0;
              return (
                <button
                  key={day.name}
                  onClick={() => setSelectedDay(i)}
                  className="flex flex-col items-center justify-center w-11 h-14 rounded-2xl transition-all duration-300 relative"
                  style={{
                    backgroundColor: isSelected ? "#F47D31" : "transparent",
                    border: isSelected ? "none" : "1px solid transparent",
                    boxShadow: isSelected ? "0 4px 16px rgba(244,125,49,0.35)" : "none",
                  }}
                >
                  {isToday && !isSelected && (
                    <div className="absolute top-1 w-1 h-1 rounded-full" style={{ backgroundColor: "#F47D31" }} />
                  )}
                  <span className="text-[10px] font-extrabold uppercase tracking-wider mb-1" style={{ color: isSelected ? "rgba(255,255,255,0.9)" : isToday ? "#F47D31" : "#1A1A2E60" }}>
                    {day.name}
                  </span>
                  <span className="text-[16px] font-extrabold" style={{ color: isSelected ? "#FFFFFF" : isToday ? "#1A1A2E" : "#1A1A2E80" }}>
                    {day.date}
                  </span>
                  {!isSelected && shifts.some(s => s.days.includes(i)) && (
                    <div className="absolute bottom-1 w-1 h-1 rounded-full" style={{ backgroundColor: "#F47D3150" }} />
                  )}
                </button>
              );
            })}
          </div>
        </header>

        {/* Shift List */}
        <div
          className="no-scroll flex-1 overflow-y-auto pb-32 px-6 pt-4 z-10"
          style={{ transform: mounted ? "translateY(0)" : "translateY(20px)", opacity: mounted ? 1 : 0, transition: "all 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.1s" }}
        >
          <div className="flex justify-between items-end mb-4 px-1">
            <h2 className="font-extrabold" style={{ color: "#1A1A2E" }}>{daysOfWeek[selectedDay].name}, Nov {daysOfWeek[selectedDay].date}</h2>
            <span className="text-xs font-bold" style={{ color: "#1A1A2E50" }}>{dayShifts.length} shifts</span>
          </div>

          <div className="space-y-3">
            {dayShifts.length > 0 ? dayShifts.map((shift, idx) => (
              <div
                key={shift.id}
                className="p-4 rounded-3xl cursor-pointer"
                style={{
                  backgroundColor: shift.color.bg,
                  border: `1px solid ${shift.color.border}`,
                  transform: mounted ? "translateY(0)" : "translateY(20px)",
                  opacity: mounted ? 1 : 0,
                  transition: `all 0.5s cubic-bezier(0.16, 1, 0.3, 1) ${0.1 + idx * 0.05}s`,
                }}
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-extrabold text-sm flex-shrink-0" style={{ background: shift.color.avatar }}>
                    {shift.initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start mb-0.5">
                      <h3 className="font-extrabold text-[15px]" style={{ color: "#1A1A2E" }}>{shift.name}</h3>
                      <span className="text-[11px] uppercase tracking-wider font-extrabold" style={{ color: shift.color.text }}>{shift.role}</span>
                    </div>
                    <div className="flex items-center gap-1.5" style={{ color: "#1A1A2E70" }}>
                      <Clock size={12} />
                      <span className="text-sm font-semibold">{shift.time}</span>
                    </div>
                  </div>
                  <button className="w-8 h-8 rounded-full flex items-center justify-center" style={{ color: "#1A1A2E40" }}>
                    <MoreHorizontal size={16} />
                  </button>
                </div>
              </div>
            )) : (
              <div className="py-10 flex flex-col items-center justify-center text-sm" style={{ color: "#1A1A2E50" }}>
                <Calendar size={32} className="mb-3 opacity-30" />
                <p className="font-bold">No scheduled shifts for this day.</p>
              </div>
            )}

            {selectedDay === 0 && (
              <div
                className="p-4 rounded-3xl cursor-pointer flex flex-col items-center justify-center gap-2 mt-4"
                style={{ border: "1.5px dashed #D0C9C0", backgroundColor: "transparent" }}
              >
                <div className="w-10 h-10 rounded-full border-[1.5px] flex items-center justify-center" style={{ borderStyle: "dashed", borderColor: "#D0C9C0", color: "#1A1A2E50" }}>
                  <Plus size={20} />
                </div>
                <div className="text-center">
                  <h3 className="font-extrabold text-[15px]" style={{ color: "#1A1A2E70" }}>Add Open Shift</h3>
                  <p className="text-xs font-semibold mt-0.5" style={{ color: "#1A1A2E50" }}>Assign coverage or leave open</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Bottom Navigation */}
        <div className="absolute bottom-0 w-full z-50 pointer-events-none" style={{ background: "linear-gradient(to top, #FFFBF5 55%, transparent)", paddingTop: 32 }}>
          <div className="mx-4 mb-5 rounded-[28px] pointer-events-auto" style={{ backgroundColor: "#FFFFFF", boxShadow: "0 4px 24px rgba(0,0,0,0.10)", padding: "10px 24px 10px" }}>
            <div className="flex justify-between items-center">
              {/* Home */}
              <button className="flex flex-col items-center gap-1 pt-1">
                <Home size={22} strokeWidth={1.8} style={{ color: "#1A1A2E55" }} />
              </button>
              {/* Calendar — ACTIVE */}
              <button className="flex flex-col items-center gap-1">
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ backgroundColor: "#F47D31" }}>
                  <Calendar size={21} strokeWidth={2.5} className="text-white" />
                </div>
                <span className="text-[11px] font-extrabold" style={{ color: "#F47D31" }}>Schedule</span>
              </button>
              {/* Team */}
              <button className="flex flex-col items-center gap-1 pt-1">
                <Users size={22} strokeWidth={1.8} style={{ color: "#1A1A2E55" }} />
              </button>
              {/* Messages */}
              <button className="flex flex-col items-center gap-1 pt-1">
                <MessageCircle size={22} strokeWidth={1.8} style={{ color: "#1A1A2E55" }} />
              </button>
              {/* Settings */}
              <button className="flex flex-col items-center gap-1 pt-1">
                <Settings size={22} strokeWidth={1.8} style={{ color: "#1A1A2E55" }} />
              </button>
            </div>
          </div>
          <div className="w-[120px] h-1.5 rounded-full mx-auto" style={{ backgroundColor: "#1A1A2E20" }} />
        </div>

      </div>
    </div>
  );
}
