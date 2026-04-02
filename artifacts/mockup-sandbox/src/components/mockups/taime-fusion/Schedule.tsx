import React, { useState, useEffect } from "react";
import {
  Home,
  Users,
  Calendar,
  CheckSquare,
  Menu,
  ChevronLeft,
  ChevronRight,
  Plus,
  Clock,
  Activity,
  MoreHorizontal
} from "lucide-react";

const Avatar = ({ name, colorClass }: { name: string, colorClass: string }) => (
  <div className={`w-10 h-10 rounded-full ${colorClass} border border-white/10 flex items-center justify-center text-white/90 font-extrabold shadow-inner overflow-hidden backdrop-blur-sm flex-shrink-0`}>
    {name.split(' ').map(n => n[0]).join('')}
  </div>
);

type Shift = {
  id: string;
  name: string;
  role: string;
  time: string;
  colorClass: string;
  bgClass: string;
  borderClass: string;
  days: number[]; // 0 = Sun, 1 = Mon, etc.
};

const shifts: Shift[] = [
  {
    id: "1",
    name: "Summer Furrh",
    role: "Manager",
    time: "10:00 AM - 6:00 PM",
    colorClass: "bg-gradient-to-br from-[#FF6B6B]/80 to-[#FF6B6B]/40",
    bgClass: "bg-[#FF6B6B]/10",
    borderClass: "border-[#FF6B6B]/20",
    days: [1, 2, 3] // Mon-Wed
  },
  {
    id: "2",
    name: "Taylor Holman",
    role: "Stylist",
    time: "12:00 PM - 8:00 PM",
    colorClass: "bg-gradient-to-br from-[#4ECDC4]/80 to-[#4ECDC4]/40",
    bgClass: "bg-[#4ECDC4]/10",
    borderClass: "border-[#4ECDC4]/20",
    days: [2, 3, 4, 5, 6] // Tue-Sat
  },
  {
    id: "3",
    name: "Sela Waller",
    role: "Stylist",
    time: "9:00 AM - 5:00 PM",
    colorClass: "bg-gradient-to-br from-[#F9C846]/80 to-[#F9C846]/40",
    bgClass: "bg-[#F9C846]/10",
    borderClass: "border-[#F9C846]/20",
    days: [3, 4, 5] // Wed-Fri
  },
  {
    id: "4",
    name: "Sophia Davis",
    role: "Stylist",
    time: "11:00 AM - 7:00 PM",
    colorClass: "bg-gradient-to-br from-[#6BCB77]/80 to-[#6BCB77]/40",
    bgClass: "bg-[#6BCB77]/10",
    borderClass: "border-[#6BCB77]/20",
    days: [1, 4, 5] // Mon, Thu, Fri
  },
  {
    id: "5",
    name: "Sydney Wall",
    role: "Stylist",
    time: "10:00 AM - 4:00 PM",
    colorClass: "bg-gradient-to-br from-[#F47D31]/80 to-[#F47D31]/40",
    bgClass: "bg-[#F47D31]/10",
    borderClass: "border-[#F47D31]/20",
    days: [0, 6] // Sun, Sat
  }
];

const daysOfWeek = [
  { name: 'Sun', date: '12' },
  { name: 'Mon', date: '13' },
  { name: 'Tue', date: '14' },
  { name: 'Wed', date: '15' },
  { name: 'Thu', date: '16' },
  { name: 'Fri', date: '17' },
  { name: 'Sat', date: '18' },
];

export function Schedule() {
  const [mounted, setMounted] = useState(false);
  const [selectedDay, setSelectedDay] = useState(0); // Sunday

  useEffect(() => {
    setMounted(true);
  }, []);

  const dayShifts = shifts.filter(s => s.days.includes(selectedDay));

  return (
    <div className="flex justify-center items-center min-h-screen bg-[#050505] p-4 sm:p-8 font-['Nunito',sans-serif] selection:bg-[#F47D31]/30">
      {/* Mobile Device Container */}
      <div className="relative w-[390px] h-[844px] bg-[#0B0F19] rounded-[56px] overflow-hidden shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_40px_80px_rgba(0,0,0,0.8),0_0_120px_rgba(244,125,49,0.15)] ring-[8px] ring-[#1A1C23] flex flex-col text-slate-50">
        
        {/* Background Ambience */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[390px] h-[300px] bg-[#F47D31]/10 blur-[100px] rounded-full pointer-events-none" />
        <div className="absolute top-1/2 -right-32 w-[300px] h-[300px] bg-[#F9C846]/10 blur-[100px] rounded-full pointer-events-none" />

        {/* Dynamic Island / Status Bar area (Simulated) */}
        <div className="h-14 w-full flex justify-between items-center px-7 pt-2 z-50 absolute top-0">
          <span className="text-white text-[15px] font-bold tracking-tight">9:41</span>
          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-[120px] h-[32px] bg-black rounded-full z-50 shadow-[inset_0_-2px_4px_rgba(255,255,255,0.1)]" />
          <div className="flex gap-1.5 items-center">
            <Activity size={14} className="text-white/80" />
            <div className="w-5 h-[11px] rounded-[3px] border border-white/40 flex items-center p-[1px]">
              <div className="w-[80%] h-full bg-white rounded-[1.5px]" />
            </div>
          </div>
        </div>

        {/* Header */}
        <header className="px-6 pt-16 pb-2 z-10">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-white text-[28px] font-extrabold tracking-tight leading-none bg-clip-text text-transparent bg-gradient-to-br from-white to-white/80">
              Schedule
            </h1>
            <div className="flex gap-2">
              <button className="w-9 h-9 rounded-full bg-white/5 border border-white/[0.08] flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-all backdrop-blur-md">
                <Plus size={18} strokeWidth={3} />
              </button>
            </div>
          </div>
          
          <div className="flex items-center justify-between bg-white/5 border border-white/10 rounded-2xl p-1 mb-4 backdrop-blur-sm">
            <button className="w-10 h-10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/5 rounded-xl transition-all">
              <ChevronLeft size={20} strokeWidth={2.5} />
            </button>
            <div className="flex flex-col items-center">
              <span className="text-white/90 text-[15px] font-bold tracking-wide">Nov 12 - Nov 18</span>
              <span className="text-[#F47D31] text-[11px] font-extrabold uppercase tracking-wider">This Week</span>
            </div>
            <button className="w-10 h-10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/5 rounded-xl transition-all">
              <ChevronRight size={20} strokeWidth={2.5} />
            </button>
          </div>

          {/* 7-day strip */}
          <div className="flex justify-between mt-2">
            {daysOfWeek.map((day, i) => {
              const isSelected = selectedDay === i;
              const isToday = i === 0; // Sunday in this mock
              
              return (
                <button 
                  key={day.name}
                  onClick={() => setSelectedDay(i)}
                  className={`flex flex-col items-center justify-center w-11 h-14 rounded-2xl transition-all duration-300 relative group ${
                    isSelected 
                      ? 'bg-[#F47D31] shadow-[0_0_20px_rgba(244,125,49,0.4)] border border-[#F47D31]/50' 
                      : 'hover:bg-white/5 border border-transparent'
                  }`}
                >
                  {isToday && !isSelected && (
                    <div className="absolute top-1 w-1 h-1 rounded-full bg-[#F47D31]" />
                  )}
                  <span className={`text-[11px] font-extrabold uppercase tracking-wider mb-0.5 ${
                    isSelected ? 'text-white/90' : isToday ? 'text-[#F47D31]' : 'text-white/40'
                  }`}>
                    {day.name}
                  </span>
                  <span className={`text-[16px] font-extrabold ${
                    isSelected ? 'text-white' : isToday ? 'text-white/90' : 'text-white/60'
                  }`}>
                    {day.date}
                  </span>
                  
                  {/* Subtle indicator for days with shifts */}
                  {!isSelected && shifts.some(s => s.days.includes(i)) && (
                    <div className="absolute bottom-1 w-1 h-1 rounded-full bg-white/30" />
                  )}
                </button>
              )
            })}
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto pb-32 scrollbar-hide px-6 pt-4 z-10" style={{ transform: mounted ? 'translateY(0)' : 'translateY(20px)', opacity: mounted ? 1 : 0, transition: 'all 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.1s' }}>
          
          <div className="flex justify-between items-end mb-4 px-1">
            <h2 className="text-white/90 font-bold tracking-wide">
              {daysOfWeek[selectedDay].name}, Nov {daysOfWeek[selectedDay].date}
            </h2>
            <span className="text-white/40 text-[13px] font-bold">{dayShifts.length} shifts</span>
          </div>

          <div className="space-y-3">
            {dayShifts.length > 0 ? (
              dayShifts.map((shift, idx) => (
                <div 
                  key={shift.id} 
                  className={`p-4 rounded-3xl border backdrop-blur-2xl bg-[#12141D]/80 ${shift.borderClass} relative overflow-hidden group cursor-pointer hover:brightness-110 transition-all`}
                  style={{ transform: mounted ? 'translateY(0)' : 'translateY(20px)', opacity: mounted ? 1 : 0, transition: `all 0.5s cubic-bezier(0.16, 1, 0.3, 1) ${0.1 + (idx * 0.05)}s` }}
                >
                  <div className={`absolute -top-12 -right-12 w-32 h-32 ${shift.bgClass} rounded-full blur-[30px] pointer-events-none mix-blend-screen opacity-70`} />
                  
                  {/* Subtle gradient overlay */}
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.04] to-transparent -translate-x-full group-hover:translate-x-full duration-1000 transition-transform" />
                  
                  <div className="flex items-center gap-4 relative z-10">
                    <Avatar name={shift.name} colorClass={shift.colorClass} />
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start mb-0.5">
                        <h3 className="text-white/90 text-[16px] font-bold truncate">{shift.name}</h3>
                        <span className="text-white/50 text-[11px] uppercase tracking-widest font-extrabold">{shift.role}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-white/60">
                        <Clock size={14} strokeWidth={2.5} />
                        <span className="text-[14px] font-semibold">{shift.time}</span>
                      </div>
                    </div>
                    <button className="w-8 h-8 rounded-full flex items-center justify-center text-white/30 hover:bg-white/10 hover:text-white transition-colors">
                      <MoreHorizontal size={18} strokeWidth={2.5} />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="py-10 flex flex-col items-center justify-center text-white/30 text-[15px] font-bold">
                <Calendar size={36} className="mb-3 opacity-20" strokeWidth={1.5} />
                <p>No scheduled shifts for this day.</p>
              </div>
            )}

            {/* Open Shift Slot (Visible on Sunday) */}
            {selectedDay === 0 && (
              <div 
                className="p-4 rounded-3xl border-[2px] border-dashed border-white/10 bg-[#12141D]/40 hover:bg-[#12141D]/80 hover:border-white/20 transition-all cursor-pointer flex flex-col items-center justify-center gap-2 group mt-4 backdrop-blur-sm"
                style={{ transform: mounted ? 'translateY(0)' : 'translateY(20px)', opacity: mounted ? 1 : 0, transition: `all 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.3s` }}
              >
                <div className="w-10 h-10 rounded-full border-[2px] border-dashed border-white/20 flex items-center justify-center text-white/40 group-hover:text-[#F47D31] group-hover:border-[#F47D31]/30 group-hover:bg-[#F47D31]/10 transition-all">
                  <Plus size={20} strokeWidth={3} />
                </div>
                <div className="text-center">
                  <h3 className="text-white/70 text-[15px] font-bold group-hover:text-white transition-colors">Add Open Shift</h3>
                  <p className="text-white/40 text-[13px] font-semibold mt-0.5">Assign coverage or leave open</p>
                </div>
              </div>
            )}
          </div>
          
        </div>

        {/* Floating Bottom Navigation */}
        <div className="absolute bottom-0 w-full z-50 px-4 pb-6 pt-10 bg-gradient-to-t from-[#0B0F19] via-[#0B0F19]/95 to-transparent pointer-events-none">
          <div className="h-[72px] bg-[#12141D]/90 backdrop-blur-2xl border border-white/[0.08] rounded-[24px] px-6 flex justify-between items-center shadow-[0_-8px_32px_rgba(0,0,0,0.4)] pointer-events-auto">
            <button className="flex flex-col items-center gap-1.5 text-white/40 hover:text-white/80 transition-colors">
              <Home size={22} strokeWidth={2.5} />
            </button>
            <button className="flex flex-col items-center gap-1.5 text-white/40 hover:text-white/80 transition-colors">
              <Users size={22} strokeWidth={2.5} />
            </button>
            <button className="flex flex-col items-center gap-1.5 text-[#F47D31] group">
              <div className="relative">
                <Calendar size={22} strokeWidth={2.5} />
                <div className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-[#F47D31]" />
              </div>
            </button>
            <button className="flex flex-col items-center gap-1.5 text-white/40 hover:text-white/80 transition-colors relative">
              <CheckSquare size={22} strokeWidth={2.5} />
              <div className="absolute -top-1 -right-1.5 w-4 h-4 rounded-full bg-[#FF6B6B] border-2 border-[#12141D] flex items-center justify-center">
                <span className="text-[9px] font-extrabold text-white leading-none mt-px">3</span>
              </div>
            </button>
            <button className="flex flex-col items-center gap-1.5 text-white/40 hover:text-white/80 transition-colors">
              <Menu size={22} strokeWidth={2.5} />
            </button>
          </div>
          
          {/* Home indicator (iOS) */}
          <div className="w-[120px] h-1.5 bg-white/20 rounded-full mx-auto mt-5" />
        </div>
        
      </div>
    </div>
  );
}
