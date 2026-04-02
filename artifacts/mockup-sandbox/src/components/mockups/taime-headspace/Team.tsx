import React from "react";
import { Search, Plus, Home, Users, Calendar, Settings, Star } from "lucide-react";

export function Team() {
  const teamMembers = [
    {
      id: 1,
      name: "Summer Furrh",
      role: "Shift Lead",
      status: "in",
      statusText: "Clocked In 🟢",
      score: 94,
      avatarColor: "bg-[#F47D31]",
      progress: 75,
      hours: "30/40 hrs",
    },
    {
      id: 2,
      name: "Taylor Holman",
      role: "Barista",
      status: "off",
      statusText: "Off Today ⚪",
      score: 87,
      avatarColor: "bg-[#4ECDC4]",
      progress: 0,
      hours: "0/20 hrs",
    },
    {
      id: 3,
      name: "Sela Waller",
      role: "Cashier",
      status: "late",
      statusText: "Late 🔴",
      score: 72,
      avatarColor: "bg-[#FF6B6B]",
      progress: 45,
      hours: "18/40 hrs",
    },
    {
      id: 4,
      name: "Sophia Davis",
      role: "Barista",
      status: "in",
      statusText: "Clocked In 🟢",
      score: 91,
      avatarColor: "bg-[#6BCB77]",
      progress: 60,
      hours: "15/25 hrs",
    },
    {
      id: 5,
      name: "Sydney Wall",
      role: "Barista",
      status: "in",
      statusText: "Clocked In 🟢",
      score: 88,
      avatarColor: "bg-[#F9C846]",
      progress: 85,
      hours: "34/40 hrs",
    },
  ];

  return (
    <div className="w-[390px] min-h-[844px] bg-[#FFF8F0] text-[#1A1A2E] font-['Nunito'] relative pb-24 overflow-y-auto">
      {/* Header */}
      <div className="px-6 pt-12 pb-4 sticky top-0 bg-[#FFF8F0]/90 backdrop-blur-md z-10">
        <h1 className="text-3xl font-extrabold mb-4 tracking-tight">Your Team</h1>
        
        {/* Search */}
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-gray-400" />
          </div>
          <input
            type="text"
            className="block w-full pl-11 pr-4 py-3 bg-[#EFEBE4]/50 border-none rounded-2xl text-[15px] focus:ring-2 focus:ring-[#F47D31] focus:bg-white transition-all shadow-sm outline-none placeholder:text-gray-500"
            placeholder="Find a team member..."
          />
        </div>
      </div>

      <div className="px-6 space-y-5">
        {/* AI Nudge */}
        <div className="bg-[#FFF1E5] border border-[#F47D31]/20 rounded-[20px] p-4 flex gap-3 shadow-[0_4px_12px_rgba(244,125,49,0.05)] relative overflow-hidden">
          <div className="absolute -right-4 -top-4 w-16 h-16 bg-[#F47D31]/10 rounded-full blur-xl"></div>
          <div className="absolute -left-4 -bottom-4 w-12 h-12 bg-[#F9C846]/10 rounded-full blur-lg"></div>
          <div className="text-xl">💛</div>
          <p className="text-[15px] leading-snug font-medium text-[#1A1A2E]/80 relative z-10">
            <strong className="text-[#F47D31]">Sela</strong> has been late 3x — a quick check-in can help
          </p>
        </div>

        {/* Team List */}
        <div className="space-y-4">
          {teamMembers.map((member) => (
            <div
              key={member.id}
              className="bg-white rounded-[24px] p-4 shadow-[0_8px_24px_rgba(26,26,46,0.04)] transition-transform active:scale-[0.98] border border-gray-100/50 flex flex-col gap-3"
            >
              <div className="flex items-center gap-4">
                {/* Avatar */}
                <div className={`w-14 h-14 rounded-full ${member.avatarColor} text-white flex items-center justify-center text-xl font-bold shadow-sm flex-shrink-0`}>
                  {member.name.charAt(0)}
                </div>
                
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start mb-0.5">
                    <h3 className="text-lg font-bold truncate text-[#1A1A2E]">
                      {member.name}
                    </h3>
                    {/* Points Pill */}
                    <div className="bg-[#F9C846]/20 text-[#B0861C] px-2 py-0.5 rounded-full flex items-center gap-1 text-xs font-bold whitespace-nowrap">
                      <Star className="w-3 h-3 fill-current" />
                      {member.score}
                    </div>
                  </div>
                  <p className="text-[#1A1A2E]/50 text-sm font-medium">{member.role}</p>
                </div>
              </div>

              <div className="flex items-center justify-between mt-1">
                {/* Status Pill */}
                <div className={`px-3 py-1.5 rounded-xl text-xs font-bold inline-flex items-center
                  ${member.status === 'in' ? 'bg-[#6BCB77]/10 text-[#2C7A36]' : 
                    member.status === 'off' ? 'bg-gray-100 text-gray-500' : 
                    'bg-[#FF6B6B]/10 text-[#C92A2A]'}`}
                >
                  {member.statusText}
                </div>

                {/* Progress */}
                <div className="flex flex-col items-end gap-1.5 w-[120px]">
                  <span className="text-[10px] font-bold text-[#1A1A2E]/40 uppercase tracking-wider">{member.hours}</span>
                  <div className="h-1.5 w-full bg-[#EFEBE4] rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full ${member.status === 'late' ? 'bg-[#FF6B6B]' : 'bg-[#F47D31]'}`}
                      style={{ width: `${member.progress}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* FAB */}
      <button className="fixed bottom-[100px] right-6 bg-[#F47D31] text-white px-5 py-3.5 rounded-full shadow-[0_8px_24px_rgba(244,125,49,0.3)] flex items-center gap-2 font-bold hover:bg-[#E3691A] transition-colors active:scale-95 z-20">
        <Plus className="w-5 h-5" />
        Invite
      </button>

      {/* Bottom Nav */}
      <div className="fixed bottom-0 w-[390px] h-[84px] bg-white border-t border-gray-100 flex justify-around items-center pb-6 pt-2 px-2 z-30 shadow-[0_-4px_24px_rgba(26,26,46,0.02)]">
        <button className="flex flex-col items-center gap-1 p-2 text-[#1A1A2E]/40 hover:text-[#1A1A2E]/70 transition-colors">
          <Home className="w-6 h-6" />
          <span className="text-[10px] font-bold">Home</span>
        </button>
        <button className="flex flex-col items-center gap-1 p-2 text-[#1A1A2E]/40 hover:text-[#1A1A2E]/70 transition-colors">
          <Calendar className="w-6 h-6" />
          <span className="text-[10px] font-bold">Schedule</span>
        </button>
        <button className="flex flex-col items-center gap-1 p-2 text-[#F47D31]">
          <Users className="w-6 h-6" />
          <span className="text-[10px] font-bold">Team</span>
        </button>
        <button className="flex flex-col items-center gap-1 p-2 text-[#1A1A2E]/40 hover:text-[#1A1A2E]/70 transition-colors">
          <Settings className="w-6 h-6" />
          <span className="text-[10px] font-bold">Settings</span>
        </button>
      </div>
    </div>
  );
}
