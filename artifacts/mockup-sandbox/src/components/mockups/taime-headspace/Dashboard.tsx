import React from "react";
import { 
  Bell, 
  Search, 
  Home, 
  Calendar, 
  MessageCircle, 
  User,
  Sparkles,
  ChevronRight,
  TrendingUp,
  Award,
  CheckCircle2,
  Clock,
  Zap
} from "lucide-react";

export function Dashboard() {
  return (
    <div 
      className="w-[390px] h-[844px] overflow-hidden relative font-['Nunito'] flex flex-col"
      style={{ backgroundColor: "#FFFBF5", color: "#1A1A2E" }}
    >
      {/* Header */}
      <div className="px-6 pt-12 pb-4 flex justify-between items-center">
        <div className="w-10 h-10 rounded-full bg-[#F47D31]/10 flex items-center justify-center">
          <span className="font-bold text-[#F47D31] text-lg">L</span>
        </div>
        <div className="flex gap-3">
          <button className="w-10 h-10 rounded-full bg-white shadow-sm flex items-center justify-center relative">
            <Search size={20} className="text-[#1A1A2E]/60" />
          </button>
          <button className="w-10 h-10 rounded-full bg-white shadow-sm flex items-center justify-center relative">
            <Bell size={20} className="text-[#1A1A2E]/60" />
            <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[#FF6B6B]"></span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-32 px-6 no-scrollbar">
        {/* Greeting */}
        <div className="mb-8 mt-2">
          <h1 className="text-3xl font-extrabold mb-2 tracking-tight">Good morning,<br/>Libby! ☀️</h1>
          <div 
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-white font-bold text-sm shadow-md"
            style={{ background: "linear-gradient(135deg, #F47D31 0%, #F9C846 100%)" }}
          >
            <Sparkles size={16} />
            <span>It's a beautiful day to sell</span>
          </div>
        </div>

        {/* Today's Vibe */}
        <div className="bg-white rounded-[24px] p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] mb-6">
          <h2 className="text-lg font-bold mb-4">Today's Vibe</h2>
          <div className="flex justify-between items-center">
            <div className="flex flex-col items-center">
              <div className="w-12 h-12 rounded-full bg-[#6BCB77]/15 flex items-center justify-center mb-2">
                <span className="text-[#6BCB77] font-bold text-xl">3</span>
              </div>
              <span className="text-xs font-bold text-[#1A1A2E]/60">Clocked in</span>
            </div>
            <div className="flex flex-col items-center">
              <div className="w-12 h-12 rounded-full bg-[#FF6B6B]/15 flex items-center justify-center mb-2">
                <span className="text-[#FF6B6B] font-bold text-xl">1</span>
              </div>
              <span className="text-xs font-bold text-[#1A1A2E]/60">Late</span>
            </div>
            <div className="flex flex-col items-center">
              <div className="w-12 h-12 rounded-full bg-[#F9C846]/15 flex items-center justify-center mb-2">
                <span className="text-[#F9C846] font-bold text-xl">2</span>
              </div>
              <span className="text-xs font-bold text-[#1A1A2E]/60">Needs Attn</span>
            </div>
          </div>
        </div>

        {/* AI Insight Card */}
        <div className="bg-white rounded-[24px] p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] mb-6 border-2 border-[#F47D31]/20 relative overflow-hidden">
          <div className="absolute -right-6 -top-6 w-24 h-24 bg-[#F47D31]/10 rounded-full blur-xl"></div>
          <div className="flex items-start gap-4 relative">
            <div className="w-10 h-10 rounded-full overflow-hidden shrink-0 border-2 border-[#F47D31]">
              <img src="https://i.pravatar.cc/150?u=summer" alt="Summer" className="w-full h-full object-cover" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Zap size={16} className="text-[#F47D31]" />
                <span className="text-sm font-bold text-[#F47D31]">Action Needed</span>
              </div>
              <p className="text-[#1A1A2E] font-medium leading-snug mb-3">
                Summer still needs to clock in — her shift started 8 min ago.
              </p>
              <button className="bg-[#F47D31] text-white px-4 py-2 rounded-full font-bold text-sm shadow-md shadow-[#F47D31]/30 hover:bg-[#E06A20] transition-colors">
                Ping Summer
              </button>
            </div>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          <div className="bg-white rounded-[24px] p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex flex-col items-center text-center">
            <div className="w-10 h-10 rounded-full bg-[#FF6B6B]/10 flex items-center justify-center mb-3">
              <TrendingUp size={20} className="text-[#FF6B6B]" />
            </div>
            <span className="text-xs font-bold text-[#1A1A2E]/60 uppercase tracking-wider mb-1">Sales</span>
            <span className="text-2xl font-black">$4.2k</span>
          </div>
          
          <div className="bg-white rounded-[24px] p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex flex-col items-center text-center">
            <div className="w-10 h-10 rounded-full bg-[#4ECDC4]/10 flex items-center justify-center mb-3">
              <Award size={20} className="text-[#4ECDC4]" />
            </div>
            <span className="text-xs font-bold text-[#1A1A2E]/60 uppercase tracking-wider mb-1">Team Score</span>
            <span className="text-2xl font-black text-[#4ECDC4]">98</span>
          </div>
          
          <div className="bg-white rounded-[24px] p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex flex-col items-center text-center">
            <div className="w-10 h-10 rounded-full bg-[#6BCB77]/10 flex items-center justify-center mb-3">
              <CheckCircle2 size={20} className="text-[#6BCB77]" />
            </div>
            <span className="text-xs font-bold text-[#1A1A2E]/60 uppercase tracking-wider mb-1">Tasks Done</span>
            <span className="text-2xl font-black">12/15</span>
          </div>
          
          <div className="bg-white rounded-[24px] p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex flex-col items-center text-center">
            <div className="w-10 h-10 rounded-full bg-[#F9C846]/10 flex items-center justify-center mb-3">
              <Clock size={20} className="text-[#F9C846]" />
            </div>
            <span className="text-xs font-bold text-[#1A1A2E]/60 uppercase tracking-wider mb-1">Labor Hrs</span>
            <span className="text-2xl font-black">24.5</span>
          </div>
        </div>

        {/* Team Quick Glance */}
        <div className="mb-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-bold">Team Today</h2>
            <button className="text-[#F47D31] font-bold text-sm flex items-center">
              View all <ChevronRight size={16} />
            </button>
          </div>
          <div className="flex gap-4 overflow-x-auto pb-4 no-scrollbar -mx-6 px-6">
            {[
              { name: "Alex", color: "#4ECDC4", status: "#6BCB77" },
              { name: "Sam", color: "#F9C846", status: "#6BCB77" },
              { name: "Jordan", color: "#FF6B6B", status: "#F9C846" },
              { name: "Taylor", color: "#9D4EDD", status: "#1A1A2E20" },
              { name: "Casey", color: "#F47D31", status: "#1A1A2E20" }
            ].map((member, i) => (
              <div key={i} className="flex flex-col items-center gap-2 shrink-0">
                <div className="relative">
                  <div 
                    className="w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-lg"
                    style={{ backgroundColor: member.color }}
                  >
                    {member.name[0]}
                  </div>
                  <div 
                    className="absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-[#FFFBF5]"
                    style={{ backgroundColor: member.status }}
                  ></div>
                </div>
                <span className="text-xs font-bold">{member.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Floating Ask AI Button */}
      <div className="absolute bottom-24 left-0 right-0 flex justify-center pointer-events-none z-10">
        <button className="pointer-events-auto bg-[#F47D31] text-white px-6 py-4 rounded-full font-bold shadow-[0_10px_25px_rgba(244,125,49,0.4)] flex items-center gap-2 hover:scale-105 transition-transform">
          <Sparkles size={20} />
          <span>Ask AI</span>
        </button>
      </div>

      {/* Bottom Nav */}
      <div className="absolute bottom-0 left-0 right-0 bg-[#FFFBF5]/90 backdrop-blur-md border-t border-[#1A1A2E]/5 pb-8 pt-4 px-8 flex justify-between items-center z-20">
        <button className="flex flex-col items-center gap-1 text-[#F47D31]">
          <div className="bg-[#F47D31]/10 p-2 rounded-2xl">
            <Home size={24} />
          </div>
          <span className="text-[10px] font-bold">Home</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-[#1A1A2E]/40 hover:text-[#1A1A2E]/70 transition-colors">
          <div className="p-2">
            <Calendar size={24} />
          </div>
          <span className="text-[10px] font-bold">Schedule</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-[#1A1A2E]/40 hover:text-[#1A1A2E]/70 transition-colors relative">
          <div className="p-2">
            <MessageCircle size={24} />
          </div>
          <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[#FF6B6B]"></span>
          <span className="text-[10px] font-bold">Messages</span>
        </button>
        <button className="flex flex-col items-center gap-1 text-[#1A1A2E]/40 hover:text-[#1A1A2E]/70 transition-colors">
          <div className="p-2">
            <User size={24} />
          </div>
          <span className="text-[10px] font-bold">Profile</span>
        </button>
      </div>
    </div>
  );
}
