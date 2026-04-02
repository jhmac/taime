import React, { useState } from "react";
import { 
  ChevronLeft, 
  ChevronRight, 
  Plus, 
  Home, 
  Users, 
  Calendar as CalendarIcon, 
  MessageCircle, 
  Settings,
  AlertCircle
} from "lucide-react";

export function Schedule() {
  const [activeTab, setActiveTab] = useState("Team");
  const days = [
    { name: "M", date: "1" },
    { name: "T", date: "2" },
    { name: "W", date: "3", active: true },
    { name: "T", date: "4" },
    { name: "F", date: "5" },
    { name: "S", date: "6" },
    { name: "S", date: "7" },
  ];

  const employees = [
    {
      name: "Summer Furrh",
      color: "#FF6B6B",
      bg: "#FFF0F0",
      shifts: [
        { day: 1, start: "10am", end: "6pm" },
        { day: 2, start: "10am", end: "6pm" },
        { day: 3, start: "10am", end: "6pm" },
      ]
    },
    {
      name: "Taylor Holman",
      color: "#4ECDC4",
      bg: "#E8FAF9",
      shifts: [
        { day: 2, start: "12pm", end: "8pm" },
        { day: 3, start: "12pm", end: "8pm" },
        { day: 4, start: "12pm", end: "8pm" },
        { day: 5, start: "12pm", end: "8pm" },
        { day: 6, start: "12pm", end: "8pm" },
      ]
    },
    {
      name: "Sela Waller",
      color: "#F9C846",
      bg: "#FEF9E8",
      shifts: [
        { day: 3, start: "9am", end: "5pm" },
        { day: 4, start: "9am", end: "5pm" },
        { day: 5, start: "9am", end: "5pm" },
      ]
    },
    {
      name: "Sophia Davis",
      color: "#6BCB77",
      bg: "#F0FAF1",
      shifts: [
        { day: 1, start: "11am", end: "7pm" },
        { day: 4, start: "11am", end: "7pm" },
        { day: 5, start: "11am", end: "7pm" },
      ]
    },
    {
      name: "Sydney Wall",
      color: "#F47D31",
      bg: "#FEF2EB",
      shifts: [
        { day: 6, start: "10am", end: "4pm" },
        { day: 7, start: "10am", end: "4pm" },
      ]
    }
  ];

  return (
    <div className="w-[390px] h-[844px] bg-[#FFFBF5] relative overflow-hidden font-['Nunito',sans-serif] text-[#2D2D2D] flex flex-col shadow-2xl rounded-[40px] border-[8px] border-white ring-1 ring-gray-100">
      
      {/* Header */}
      <div className="pt-14 pb-4 px-6 bg-white/50 backdrop-blur-xl z-10 sticky top-0">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-extrabold tracking-tight">Schedule</h1>
          <div className="w-10 h-10 bg-[#FEF2EB] rounded-full flex items-center justify-center cursor-pointer">
            <span className="text-[#F47D31] font-bold">SM</span>
          </div>
        </div>
        
        <div className="flex items-center justify-between bg-white rounded-full p-1 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] mb-6">
          <button className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-50 text-gray-400">
            <ChevronLeft size={20} />
          </button>
          <span className="font-bold text-[15px]">Apr 1 – 7</span>
          <button className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-50 text-gray-400">
            <ChevronRight size={20} />
          </button>
        </div>

        {/* Days Pill Strip */}
        <div className="flex justify-between items-center px-1">
          {days.map((day, i) => (
            <div 
              key={i} 
              className={`flex flex-col items-center justify-center w-10 h-14 rounded-full ${
                day.active 
                  ? 'bg-[#F47D31] text-white shadow-[0_4px_12px_rgba(244,125,49,0.3)]' 
                  : 'text-gray-500 hover:bg-white/80'
              }`}
            >
              <span className={`text-[11px] font-bold mb-1 ${day.active ? 'text-white/80' : 'text-gray-400'}`}>{day.name}</span>
              <span className="text-[15px] font-extrabold">{day.date}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto pb-28 px-4 pt-2 no-scrollbar">
        
        {/* Coverage Warning */}
        <div className="mb-6 bg-[#FFF0F0] rounded-[20px] p-4 flex items-start gap-3 border border-[#FF6B6B]/20">
          <div className="bg-[#FF6B6B] rounded-full p-1 mt-0.5">
            <AlertCircle size={14} className="text-white" />
          </div>
          <div>
            <h3 className="text-[#FF6B6B] font-bold text-[15px] mb-0.5">Coverage Warning</h3>
            <p className="text-[#FF6B6B]/80 text-[13px] font-medium">Sunday has no coverage during morning peak hours.</p>
          </div>
        </div>

        {/* Timeline View */}
        <div className="space-y-4 relative">
          {/* subtle background grid lines could go here */}
          
          {employees.map((emp, i) => {
            // Find shifts for today (day 3 = wednesday)
            const todayShift = emp.shifts.find(s => s.day === 3);
            
            return (
              <div key={i} className="flex gap-3">
                {/* Employee Info */}
                <div className="w-[85px] shrink-0 pt-3">
                  <div className="flex items-center gap-2">
                    <div 
                      className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shadow-sm"
                      style={{ backgroundColor: emp.color }}
                    >
                      {emp.name.split(' ').map(n => n[0]).join('')}
                    </div>
                  </div>
                </div>

                {/* Shifts Container */}
                <div className="flex-1 bg-white rounded-[24px] p-2 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] border border-gray-50">
                  {todayShift ? (
                    <div 
                      className="rounded-[16px] p-3 shadow-sm transition-transform active:scale-[0.98]"
                      style={{ backgroundColor: emp.color }}
                    >
                      <div className="flex justify-between items-center mb-1 text-white">
                        <span className="font-bold text-[14px]">{emp.name.split(' ')[0]}</span>
                        <span className="font-extrabold text-[12px] bg-white/20 px-2 py-0.5 rounded-full">{todayShift.start} - {todayShift.end}</span>
                      </div>
                      <div className="text-white/80 text-[11px] font-bold">
                        Front Desk • 8h
                      </div>
                    </div>
                  ) : (
                    <div className="h-[60px] rounded-[16px] border-2 border-dashed border-gray-100 flex items-center justify-center text-gray-300 text-[12px] font-bold bg-gray-50/50">
                      Off today
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Add Shift Button */}
        <button className="w-full mt-6 h-14 rounded-[20px] border-2 border-dashed border-[#F47D31]/40 bg-[#FEF2EB]/50 text-[#F47D31] font-bold text-[15px] flex items-center justify-center gap-2 hover:bg-[#FEF2EB] transition-colors">
          <div className="bg-[#F47D31] text-white rounded-full p-1">
            <Plus size={16} strokeWidth={3} />
          </div>
          Add New Shift
        </button>
        
        {/* Decorative elements */}
        <div className="absolute top-1/2 -left-8 w-16 h-16 bg-[#F9C846]/20 rounded-full blur-xl pointer-events-none"></div>
        <div className="absolute bottom-32 -right-8 w-24 h-24 bg-[#4ECDC4]/20 rounded-full blur-xl pointer-events-none"></div>
        
      </div>

      {/* Bottom Nav */}
      <div className="absolute bottom-0 w-full bg-white rounded-b-[32px] pt-4 pb-8 px-6 shadow-[0_-10px_40px_rgba(0,0,0,0.05)] border-t border-gray-50 z-20">
        <div className="flex justify-between items-center">
          {[
            { id: "Home", icon: Home },
            { id: "Schedule", icon: CalendarIcon },
            { id: "Team", icon: Users },
            { id: "Chat", icon: MessageCircle },
            { id: "More", icon: Settings },
          ].map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            // The task requested Team item as active
            const isReallyActive = item.id === "Team";
            return (
              <button 
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex flex-col items-center gap-1.5 transition-all ${isReallyActive ? '-mt-2' : ''}`}
              >
                <div className={`p-2.5 rounded-2xl transition-all duration-300 ${
                  isReallyActive 
                    ? 'bg-[#F47D31] text-white shadow-[0_8px_16px_rgba(244,125,49,0.3)]' 
                    : 'text-gray-400 hover:bg-gray-50'
                }`}>
                  <Icon size={isReallyActive ? 22 : 20} strokeWidth={isReallyActive ? 2.5 : 2} />
                </div>
                {isReallyActive && (
                  <span className="text-[10px] font-bold text-[#F47D31]">{item.id}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

    </div>
  );
}
