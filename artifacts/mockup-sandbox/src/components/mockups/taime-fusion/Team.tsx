import React from 'react';
import { 
  Search, 
  Filter, 
  Home, 
  Users, 
  Calendar, 
  CheckSquare, 
  Menu,
  Plus,
  Sparkles,
  ChevronRight
} from 'lucide-react';

const TEAM_MEMBERS = [
  {
    id: 1,
    name: 'Summer Furrh',
    role: 'Sales Associate',
    status: 'Clocked In 🟢',
    statusColor: 'text-[#6BCB77]', // healthy metric
    score: 94,
    hours: '28h this week',
    initials: 'SF',
    avatarBg: 'bg-[#FF6B6B]/20 text-[#FF6B6B] border-[#FF6B6B]/30 shadow-[0_0_15px_rgba(255,107,107,0.2)]'
  },
  {
    id: 4,
    name: 'Sophia Davis',
    role: 'Stylist',
    status: 'Clocked In 🟢',
    statusColor: 'text-[#6BCB77]',
    score: 91,
    hours: '32h this week',
    initials: 'SD',
    avatarBg: 'bg-[#6BCB77]/20 text-[#6BCB77] border-[#6BCB77]/30 shadow-[0_0_15px_rgba(107,203,119,0.2)]'
  },
  {
    id: 5,
    name: 'Sydney Wall',
    role: 'Keyholder',
    status: 'Clocked In 🟢',
    statusColor: 'text-[#6BCB77]',
    score: 88,
    hours: '15h this week',
    initials: 'SW',
    avatarBg: 'bg-[#F47D31]/20 text-[#F47D31] border-[#F47D31]/30 shadow-[0_0_15px_rgba(244,125,49,0.2)]'
  },
  {
    id: 2,
    name: 'Taylor Holman',
    role: 'Manager',
    status: 'Off Today ⚪',
    statusColor: 'text-neutral-400',
    score: 87,
    hours: '0h this week',
    initials: 'TH',
    avatarBg: 'bg-[#4ECDC4]/20 text-[#4ECDC4] border-[#4ECDC4]/30 shadow-[0_0_15px_rgba(78,205,196,0.2)]'
  },
  {
    id: 3,
    name: 'Sela Waller',
    role: 'Sales Associate',
    status: 'Late 🔴',
    statusColor: 'text-[#FF6B6B]',
    score: 72,
    hours: '12h this week',
    initials: 'SW',
    avatarBg: 'bg-[#F9C846]/20 text-[#F9C846] border-[#F9C846]/30 shadow-[0_0_15px_rgba(249,200,70,0.2)]'
  }
];

export default function Team() {
  return (
    <div className="w-[390px] h-[844px] bg-[#0B0F19] text-white relative overflow-hidden font-['Nunito'] border-8 border-[#000000] rounded-[3rem]">
      {/* Ambient background glows */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-[#F47D31]/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-40 left-0 w-80 h-80 bg-[#F9C846]/10 rounded-full blur-[80px] pointer-events-none" />

      {/* Header */}
      <div className="px-5 pt-12 pb-4 relative z-10">
        <h1 className="text-2xl font-bold tracking-tight text-white mb-4">Team</h1>
        
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
            <input 
              type="text" 
              placeholder="Search team..." 
              className="w-full bg-[#12141D]/80 border border-white/[0.08] rounded-full py-2.5 pl-10 pr-4 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-[#F47D31]/50 backdrop-blur-2xl transition-all"
            />
          </div>
          <button className="w-10 h-10 rounded-full bg-[#12141D]/80 border border-white/[0.08] flex items-center justify-center text-neutral-300 hover:bg-white/10 transition-colors backdrop-blur-2xl shrink-0">
            <Filter className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="px-5 pb-32 h-full overflow-y-auto hide-scrollbar relative z-10 space-y-4">
        
        {/* AI Insight Banner */}
        <div className="bg-gradient-to-r from-[#F47D31]/10 to-[#F9C846]/10 border border-[#F47D31]/20 rounded-3xl p-4 backdrop-blur-2xl relative overflow-hidden group cursor-pointer bg-[#12141D]/80">
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#F47D31]/10 rounded-full blur-[30px] -mr-10 -mt-10 transition-transform group-hover:scale-110" />
          <div className="flex gap-3 relative z-10">
            <div className="w-8 h-8 rounded-full bg-[#F47D31]/20 flex items-center justify-center shrink-0 border border-[#F47D31]/30">
              <Sparkles className="w-4 h-4 text-[#F47D31]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[#FFF8F0] leading-snug">
                Sela has been late 3 times this week — consider a check-in
              </p>
              <button className="text-xs text-[#F47D31] font-bold mt-2 hover:text-[#E3691A] transition-colors">
                Take action →
              </button>
            </div>
          </div>
        </div>

        {/* Team List */}
        <div className="space-y-3 pt-2">
          {TEAM_MEMBERS.map((member) => (
            <div 
              key={member.id}
              className="bg-[#12141D]/80 border border-white/[0.08] rounded-3xl p-4 flex items-center gap-4 hover:bg-white/[0.05] transition-colors cursor-pointer backdrop-blur-2xl group"
            >
              <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-base border ${member.avatarBg} shrink-0`}>
                {member.initials}
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-bold text-neutral-100 truncate">{member.name}</h3>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-neutral-400">Score</span>
                    <span className="text-sm font-bold text-[#F9C846] bg-[#F9C846]/10 px-2 py-0.5 rounded-full border border-[#F9C846]/20">
                      {member.score}
                    </span>
                  </div>
                </div>
                
                <p className="text-xs font-medium text-neutral-400 truncate mb-2">
                  {member.role}
                </p>
                
                <div className="flex items-center justify-between">
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full bg-white/5 border border-white/5 ${member.statusColor}`}>
                    {member.status}
                  </span>
                  <span className="text-[11px] font-medium text-neutral-500">
                    {member.hours}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Floating Action Button */}
      <div className="absolute bottom-28 right-5 z-20">
        <button className="bg-[#F47D31] hover:bg-[#E3691A] text-white rounded-full px-5 py-3.5 flex items-center gap-2 shadow-[0_0_20px_rgba(244,125,49,0.3)] border border-[#F47D31]/50 transition-transform active:scale-95 font-bold text-sm">
          <Plus className="w-4 h-4" />
          Invite Member
        </button>
      </div>

      {/* Bottom Nav */}
      <div className="absolute bottom-0 left-0 right-0 h-24 bg-[#0B0F19]/90 backdrop-blur-xl border-t border-white/10 z-30 px-6 pb-6">
        <div className="h-full flex items-center justify-between">
          <button className="flex flex-col items-center gap-1.5 text-neutral-500 hover:text-white transition-colors">
            <Home className="w-5 h-5" />
            <span className="text-[10px] font-bold">Home</span>
          </button>
          <button className="flex flex-col items-center gap-1.5 text-white transition-colors relative">
            <Users className="w-5 h-5 text-[#F47D31]" />
            <span className="text-[10px] font-bold text-[#F47D31]">Team</span>
            <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-1 h-1 bg-[#F47D31] rounded-full shadow-[0_0_8px_rgba(244,125,49,0.8)]" />
          </button>
          <button className="flex flex-col items-center gap-1.5 text-neutral-500 hover:text-white transition-colors">
            <Calendar className="w-5 h-5" />
            <span className="text-[10px] font-bold">Schedule</span>
          </button>
          <button className="flex flex-col items-center gap-1.5 text-neutral-500 hover:text-white transition-colors">
            <CheckSquare className="w-5 h-5" />
            <span className="text-[10px] font-bold">Tasks</span>
          </button>
          <button className="flex flex-col items-center gap-1.5 text-neutral-500 hover:text-white transition-colors">
            <Menu className="w-5 h-5" />
            <span className="text-[10px] font-bold">More</span>
          </button>
        </div>
      </div>
      
      {/* CSS for hide-scrollbar */}
      <style dangerouslySetInnerHTML={{__html: `
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .hide-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}} />
    </div>
  );
}
