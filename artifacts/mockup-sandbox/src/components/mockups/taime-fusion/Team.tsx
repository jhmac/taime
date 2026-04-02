import React from 'react';
import {
  Search,
  Filter,
  Home,
  Users,
  Calendar,
  Plus,
  Sparkles,
  ChevronRight,
  MessageCircle,
  Settings
} from 'lucide-react';

const TEAM_MEMBERS = [
  { id: 1, name: 'Summer Furrh',  role: 'Sales Associate', status: 'Clocked In',  statusColor: "#3D8B40", statusBg: "#6BCB7712", statusBorder: "#6BCB7728", score: 94, hours: '28h this week', initials: 'SF', avatarGrad: 'linear-gradient(135deg, #FF6B6B, #F47D31)' },
  { id: 4, name: 'Sophia Davis',  role: 'Stylist',          status: 'Clocked In',  statusColor: "#3D8B40", statusBg: "#6BCB7712", statusBorder: "#6BCB7728", score: 91, hours: '32h this week', initials: 'SD', avatarGrad: 'linear-gradient(135deg, #6BCB77, #4ECDC4)' },
  { id: 5, name: 'Sydney Wall',   role: 'Keyholder',        status: 'Clocked In',  statusColor: "#3D8B40", statusBg: "#6BCB7712", statusBorder: "#6BCB7728", score: 88, hours: '15h this week', initials: 'SW', avatarGrad: 'linear-gradient(135deg, #F47D31, #F9C846)' },
  { id: 2, name: 'Taylor Holman', role: 'Manager',          status: 'Off Today',   statusColor: "#1A1A2E60", statusBg: "#1A1A2E08", statusBorder: "#1A1A2E15", score: 87, hours: '0h this week',  initials: 'TH', avatarGrad: 'linear-gradient(135deg, #4ECDC4, #6BCB77)' },
  { id: 3, name: 'Sela Waller',   role: 'Sales Associate',  status: 'Late',        statusColor: "#C0392B",  statusBg: "#FF6B6B0C", statusBorder: "#FF6B6B20", score: 72, hours: '12h this week', initials: 'SW', avatarGrad: 'linear-gradient(135deg, #F9C846, #F47D31)' },
];

export function Team() {
  return (
    <div className="flex justify-center items-center min-h-screen" style={{ backgroundColor: "#F0EBE3", fontFamily: "'Nunito', 'Nunito Sans', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800;900&display=swap'); .no-scroll::-webkit-scrollbar{display:none;} .no-scroll{-ms-overflow-style:none;scrollbar-width:none;}`}</style>

      <div className="relative w-[390px] h-[844px] overflow-hidden flex flex-col" style={{ backgroundColor: "#FFFBF5", borderRadius: "52px", border: "8px solid #DDD8D0", boxShadow: "0 40px 80px rgba(0,0,0,0.14)" }}>

        {/* Status bar placeholder */}
        <div className="h-14 w-full flex justify-between items-center px-7 pt-2 z-50 absolute top-0">
          <span className="text-[15px] font-bold" style={{ color: "#1A1A2E" }}>9:41</span>
          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-[120px] h-[32px] bg-black rounded-full z-50" />
        </div>

        {/* Header */}
        <div className="px-5 pt-16 pb-4 relative z-10">
          <h1 className="text-[24px] font-extrabold tracking-tight mb-4" style={{ color: "#1A1A2E" }}>Team</h1>

          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "#1A1A2E60" }} />
              <input
                type="text"
                placeholder="Search team..."
                className="w-full rounded-full py-2.5 pl-10 pr-4 text-sm focus:outline-none"
                style={{ backgroundColor: "#FFFFFF", border: "1px solid #F0EBE3", color: "#1A1A2E", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}
              />
            </div>
            <button className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "#FFFFFF", border: "1px solid #F0EBE3", boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
              <Filter className="w-4 h-4" style={{ color: "#1A1A2E70" }} />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="no-scroll px-5 pb-32 h-full overflow-y-auto relative z-10 space-y-4">

          {/* AI Insight Banner */}
          <div className="rounded-2xl p-4 cursor-pointer relative overflow-hidden" style={{ background: "linear-gradient(135deg, #F47D3110, #F9C84610)", border: "1px solid #F47D3120" }}>
            <div className="flex gap-3 relative z-10">
              <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg, #F47D31, #F9C846)" }}>
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-sm font-extrabold leading-snug" style={{ color: "#1A1A2E" }}>
                  Sela has been late 3 times this week — consider a check-in
                </p>
                <button className="text-xs font-extrabold mt-2 flex items-center gap-0.5" style={{ color: "#F47D31" }}>
                  Take action <ChevronRight size={13} />
                </button>
              </div>
            </div>
          </div>

          {/* Team List */}
          <div className="space-y-3 pt-2">
            {TEAM_MEMBERS.map((member) => (
              <div
                key={member.id}
                className="rounded-2xl p-4 flex items-center gap-4 cursor-pointer"
                style={{ backgroundColor: "#FFFFFF", border: "1px solid #F0EBE3", boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}
              >
                <div className="w-12 h-12 rounded-full flex items-center justify-center font-extrabold text-sm text-white flex-shrink-0" style={{ background: member.avatarGrad }}>
                  {member.initials}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-extrabold truncate" style={{ color: "#1A1A2E" }}>{member.name}</h3>
                    <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                      <span className="text-xs font-extrabold" style={{ color: "#1A1A2E60" }}>Score</span>
                      <span className="text-sm font-extrabold px-2 py-0.5 rounded-full" style={{ backgroundColor: "#F47D3112", color: "#C05E1E", border: "1px solid #F47D3120" }}>
                        {member.score}
                      </span>
                    </div>
                  </div>

                  <p className="text-xs font-semibold truncate mb-2" style={{ color: "#1A1A2E70" }}>{member.role}</p>

                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-extrabold px-2.5 py-1 rounded-full" style={{ backgroundColor: member.statusBg, color: member.statusColor, border: `1px solid ${member.statusBorder}` }}>
                      {member.status}
                    </span>
                    <span className="text-[11px] font-semibold" style={{ color: "#1A1A2E50" }}>{member.hours}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Floating Action Button */}
        <div className="absolute bottom-28 right-5 z-20">
          <button className="text-white rounded-full px-5 py-3.5 flex items-center gap-2 font-extrabold text-sm" style={{ background: "linear-gradient(135deg, #F47D31, #F9C846)", boxShadow: "0 8px 24px rgba(244,125,49,0.35)" }}>
            <Plus className="w-4 h-4" />
            Invite Member
          </button>
        </div>

        {/* Bottom Navigation */}
        <div className="absolute bottom-0 w-full z-50 pointer-events-none" style={{ background: "linear-gradient(to top, #FFFBF5 55%, transparent)", paddingTop: 32 }}>
          <div className="mx-4 mb-5 rounded-[28px] pointer-events-auto" style={{ backgroundColor: "#FFFFFF", boxShadow: "0 4px 24px rgba(0,0,0,0.10)", padding: "10px 24px 10px" }}>
            <div className="flex justify-between items-center">
              {/* Home */}
              <button className="flex flex-col items-center gap-1 pt-1">
                <Home size={22} strokeWidth={1.8} style={{ color: "#1A1A2E55" }} />
              </button>
              {/* Calendar */}
              <button className="flex flex-col items-center gap-1 pt-1">
                <Calendar size={22} strokeWidth={1.8} style={{ color: "#1A1A2E55" }} />
              </button>
              {/* Team — ACTIVE */}
              <button className="flex flex-col items-center gap-1">
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ backgroundColor: "#F47D31" }}>
                  <Users size={21} strokeWidth={2.5} className="text-white" />
                </div>
                <span className="text-[11px] font-extrabold" style={{ color: "#F47D31" }}>Team</span>
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
