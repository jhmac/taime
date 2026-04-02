import React, { useState, useEffect } from "react";
import {
  Bell,
  Search,
  Home,
  Users,
  Calendar,
  CheckSquare,
  Menu,
  Sparkles,
  ChevronRight,
  Clock,
  AlertTriangle,
  TrendingUp,
  Award,
  Zap,
  MoreHorizontal,
  Activity,
  MessageSquare
} from "lucide-react";

const GlassCard = ({ children, className = "", glow = false, glowColor = "orange" }: { children: React.ReactNode, className?: string, glow?: boolean, glowColor?: "orange" | "coral" | "green" }) => {
  const glowClasses = {
    orange: "bg-[#F47D31]/20",
    coral: "bg-[#FF6B6B]/20",
    green: "bg-[#6BCB77]/20",
  };

  return (
    <div className={`relative rounded-3xl border border-white/[0.08] bg-[#12141D]/80 backdrop-blur-2xl overflow-hidden shadow-xl ${className}`}>
      {glow && (
        <div className={`absolute -top-12 -right-12 w-32 h-32 ${glowClasses[glowColor]} rounded-full blur-[40px] pointer-events-none mix-blend-screen`} />
      )}
      <div className="relative z-10">{children}</div>
    </div>
  );
};

const Avatar = ({ src, name, status, role }: { src?: string, name: string, status?: 'online' | 'late' | 'offline', role?: string }) => (
  <div className="relative inline-flex items-center justify-center">
    <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[#F47D31]/40 to-[#F9C846]/40 border border-white/10 flex items-center justify-center text-white/90 font-medium shadow-inner overflow-hidden backdrop-blur-sm">
      {src ? <img src={src} alt={name} className="w-full h-full rounded-full object-cover" /> : name.charAt(0)}
    </div>
    {status === 'online' && <div className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-emerald-400 border-[2.5px] border-[#0B0F19] shadow-[0_0_8px_rgba(52,211,153,0.6)]" />}
    {status === 'late' && <div className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-[#FF6B6B] border-[2.5px] border-[#0B0F19] shadow-[0_0_8px_rgba(255,107,107,0.6)]" />}
    {status === 'offline' && <div className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-white/20 border-[2.5px] border-[#0B0F19]" />}
  </div>
);

export function Dashboard() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="flex justify-center items-center min-h-screen bg-[#050505] p-4 sm:p-8 font-['Nunito'] selection:bg-[#F47D31]/30">
      {/* Mobile Device Container */}
      <div className="relative w-[390px] h-[844px] bg-[#0A0C10] rounded-[56px] overflow-hidden shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_40px_80px_rgba(0,0,0,0.8),0_0_120px_rgba(244,125,49,0.15)] ring-[8px] ring-[#1A1C23] flex flex-col text-slate-50">
        
        {/* Background Ambience */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[390px] h-[300px] bg-[#F47D31]/10 blur-[100px] rounded-full pointer-events-none" />
        <div className="absolute -top-32 -right-32 w-[300px] h-[300px] bg-[#F9C846]/10 blur-[100px] rounded-full pointer-events-none" />

        {/* Dynamic Island / Status Bar area (Simulated) */}
        <div className="h-14 w-full flex justify-between items-center px-7 pt-2 z-50 absolute top-0">
          <span className="text-white text-[15px] font-semibold tracking-tight">9:41</span>
          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-[120px] h-[32px] bg-black rounded-full z-50 shadow-[inset_0_-2px_4px_rgba(255,255,255,0.1)]" />
          <div className="flex gap-1.5 items-center">
            <Activity size={14} className="text-white/80" />
            <div className="w-5 h-[11px] rounded-[3px] border border-white/40 flex items-center p-[1px]">
              <div className="w-[80%] h-full bg-white rounded-[1.5px]" />
            </div>
          </div>
        </div>

        {/* Header */}
        <header className="px-6 pt-16 pb-4 flex justify-between items-end z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-white/5 border border-white/5 mb-3 backdrop-blur-md">
              <div className="w-1.5 h-1.5 rounded-full bg-[#F47D31] animate-pulse" />
              <p className="text-white/60 text-[10px] font-bold uppercase tracking-widest">Libby Story • Ridgeland, MS</p>
            </div>
            <h1 className="text-white text-[28px] font-extrabold tracking-tight leading-none bg-clip-text text-transparent bg-gradient-to-br from-white to-white/60">
              Overview
            </h1>
          </div>
          <div className="flex gap-2.5">
            <button className="w-10 h-10 rounded-full bg-white/5 border border-white/[0.08] flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-all backdrop-blur-md">
              <Search size={18} strokeWidth={2.5} />
            </button>
            <button className="w-10 h-10 rounded-full bg-white/5 border border-white/[0.08] flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-all backdrop-blur-md relative">
              <Bell size={18} strokeWidth={2.5} />
              <div className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-[#F47D31] shadow-[0_0_8px_rgba(244,125,49,0.8)] border-2 border-[#12141D]" />
            </button>
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto pb-40 scrollbar-hide px-6 pt-2 space-y-6 z-10">
          
          {/* AI Greeting Card */}
          <div className="relative group cursor-pointer" style={{ transform: mounted ? 'translateY(0)' : 'translateY(20px)', opacity: mounted ? 1 : 0, transition: 'all 0.8s cubic-bezier(0.16, 1, 0.3, 1)' }}>
            <div className="absolute inset-0 bg-gradient-to-b from-[#F47D31]/20 to-[#F9C846]/5 rounded-3xl blur-xl group-hover:blur-2xl transition-all duration-500 opacity-50" />
            <GlassCard glow glowColor="orange" className="p-6 border-[#F47D31]/20 bg-gradient-to-br from-[#12141D]/90 to-[#1A1C2A]/90">
              <div className="flex items-center gap-3 mb-4">
                <div className="relative flex items-center justify-center">
                  <div className="w-8 h-8 rounded-full bg-[#F47D31]/20 flex items-center justify-center border border-[#F47D31]/30">
                    <Sparkles size={14} className="text-[#F47D31]" />
                  </div>
                  <div className="absolute inset-0 rounded-full border border-[#F47D31]/50 animate-ping opacity-20" />
                </div>
                <h2 className="text-white/90 text-sm font-bold tracking-wide">Good morning, Libby</h2>
              </div>
              <p className="text-white/80 text-[15px] leading-relaxed mb-6 font-medium">
                Store opened exactly on time. Sales are trending <span className="text-[#6BCB77] font-bold">12% above</span> yesterday. Here's what matters today.
              </p>
              
              {/* Action Item */}
              <div className="bg-gradient-to-br from-[#FF6B6B]/[0.08] to-[#FF6B6B]/[0.02] border border-[#FF6B6B]/20 rounded-2xl p-4 flex gap-4 items-start relative overflow-hidden backdrop-blur-sm">
                <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-[#FF6B6B] to-[#FF6B6B]" />
                <div className="mt-0.5 bg-[#FF6B6B]/20 p-2 rounded-full border border-[#FF6B6B]/30">
                  <AlertTriangle size={16} className="text-[#FF6B6B]" />
                </div>
                <div className="flex-1">
                  <h3 className="text-white font-bold text-sm mb-1.5 flex items-center justify-between">
                    Summer is late
                    <span className="text-[#FF6B6B]/80 text-[10px] uppercase font-bold tracking-wider">Urgent</span>
                  </h3>
                  <p className="text-white/60 text-xs leading-relaxed mb-3">She hasn't clocked in. Her shift started 8 min ago.</p>
                  <div className="flex gap-2">
                    <button className="flex-1 py-2 rounded-xl bg-[#FF6B6B]/20 text-[#FF6B6B] text-xs font-bold hover:bg-[#FF6B6B]/30 transition-all border border-[#FF6B6B]/20 flex items-center justify-center gap-1.5 shadow-[0_0_15px_rgba(255,107,107,0.1)]">
                      <MessageSquare size={12} /> Message
                    </button>
                    <button className="px-4 py-2 rounded-xl bg-white/5 text-white/50 text-xs font-bold hover:bg-white/10 transition-all border border-white/5">
                      Ignore
                    </button>
                  </div>
                </div>
              </div>
            </GlassCard>
          </div>

          {/* Key Metrics */}
          <div className="grid grid-cols-2 gap-4" style={{ transform: mounted ? 'translateY(0)' : 'translateY(20px)', opacity: mounted ? 1 : 0, transition: 'all 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.1s' }}>
            <GlassCard className="p-5 hover:bg-white/[0.08] transition-colors cursor-pointer group">
              <div className="flex justify-between items-start mb-6">
                <div className="w-10 h-10 rounded-2xl bg-[#FF6B6B]/10 border border-[#FF6B6B]/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <TrendingUp size={18} className="text-[#FF6B6B]" />
                </div>
                <div className="px-2 py-1 rounded-lg bg-[#FF6B6B]/10 text-[#FF6B6B] text-[10px] font-bold tracking-wide">
                  +12%
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-white/40 text-xs font-bold uppercase tracking-wider">Sales Pulse</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-white text-2xl font-extrabold tracking-tight">$2,450</span>
                  <span className="text-white/30 text-sm font-bold">.00</span>
                </div>
              </div>
            </GlassCard>
            
            <GlassCard className="p-5 hover:bg-white/[0.08] transition-colors cursor-pointer group">
              <div className="flex justify-between items-start mb-6">
                <div className="w-10 h-10 rounded-2xl bg-[#4ECDC4]/10 border border-[#4ECDC4]/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Award size={18} className="text-[#4ECDC4]" />
                </div>
                <div className="px-2 py-1 rounded-lg bg-[#4ECDC4]/10 text-[#4ECDC4] text-[10px] font-bold tracking-wide">
                  TOP 5%
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-white/40 text-xs font-bold uppercase tracking-wider">Team Score</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-white text-2xl font-extrabold tracking-tight">92</span>
                  <span className="text-white/30 text-sm font-bold">/100</span>
                </div>
              </div>
            </GlassCard>
          </div>

          {/* Team Status */}
          <div className="space-y-4" style={{ transform: mounted ? 'translateY(0)' : 'translateY(20px)', opacity: mounted ? 1 : 0, transition: 'all 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.2s' }}>
            <div className="flex justify-between items-end px-1">
              <h2 className="text-white/90 font-bold tracking-wide">On Floor Now</h2>
              <button className="text-[#F47D31] text-xs font-bold hover:text-[#F47D31]/80 flex items-center gap-0.5 group">
                Full roster <ChevronRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
              </button>
            </div>
            
            <GlassCard className="p-2">
              <div className="flex items-center justify-between p-3 rounded-2xl hover:bg-white/5 transition-colors cursor-pointer">
                <div className="flex items-center gap-3.5">
                  <Avatar name="Taylor" status="online" />
                  <div>
                    <h4 className="text-white/90 text-sm font-bold tracking-wide">Taylor</h4>
                    <p className="text-white/40 text-[11px] mt-0.5 font-medium">Manager • In since 8:45 AM</p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <div className="px-2 py-1 rounded-md bg-white/5 border border-white/5 flex items-center gap-1.5">
                    <CheckSquare size={10} className="text-[#6BCB77]" />
                    <span className="text-white/70 text-[10px] font-bold">4/5 tasks</span>
                  </div>
                  <MoreHorizontal size={14} className="text-white/20 mt-1" />
                </div>
              </div>
              
              <div className="h-px w-[calc(100%-32px)] mx-auto bg-gradient-to-r from-transparent via-white/10 to-transparent" />
              
              <div className="flex items-center justify-between p-3 rounded-2xl hover:bg-white/5 transition-colors cursor-pointer">
                <div className="flex items-center gap-3.5">
                  <Avatar name="Sela" status="online" />
                  <div>
                    <h4 className="text-white/90 text-sm font-bold tracking-wide">Sela</h4>
                    <p className="text-white/40 text-[11px] mt-0.5 font-medium">Stylist • In since 9:00 AM</p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <div className="px-2 py-1 rounded-md bg-white/5 border border-white/5 flex items-center gap-1.5">
                    <Clock size={10} className="text-white/50" />
                    <span className="text-white/50 text-[10px] font-bold">Break in 2h</span>
                  </div>
                  <MoreHorizontal size={14} className="text-white/20 mt-1" />
                </div>
              </div>
              
              <div className="h-px w-[calc(100%-32px)] mx-auto bg-gradient-to-r from-transparent via-white/10 to-transparent" />
              
              <div className="flex items-center justify-between p-3 rounded-2xl hover:bg-white/5 transition-colors cursor-pointer">
                <div className="flex items-center gap-3.5">
                  <Avatar name="Sophia" status="offline" />
                  <div>
                    <h4 className="text-white/60 text-sm font-bold tracking-wide">Sophia</h4>
                    <p className="text-white/30 text-[11px] mt-0.5 font-medium">Stylist • Next up 1:00 PM</p>
                  </div>
                </div>
              </div>
            </GlassCard>
          </div>

          {/* Tasks Overview */}
          <div className="space-y-4 pb-8" style={{ transform: mounted ? 'translateY(0)' : 'translateY(20px)', opacity: mounted ? 1 : 0, transition: 'all 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.3s' }}>
            <div className="flex justify-between items-end px-1">
              <h2 className="text-white/90 font-bold tracking-wide">Action Items</h2>
              <span className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-bold text-white/60">3</span>
            </div>
            <GlassCard className="p-4 flex items-center gap-4 hover:bg-white/[0.08] transition-colors cursor-pointer group">
              <div className="w-6 h-6 rounded-lg border-[1.5px] border-white/20 group-hover:border-[#F47D31]/50 flex-shrink-0 transition-colors" />
              <div className="flex-1">
                <h4 className="text-white/90 text-[15px] font-bold mb-1">Restock Summer Collection</h4>
                <p className="text-white/40 text-xs font-medium">Assigned to Sela • Due at 12:00 PM</p>
              </div>
            </GlassCard>
            <GlassCard className="p-4 flex items-center gap-4 opacity-50 bg-transparent border-dashed">
              <div className="w-6 h-6 rounded-lg border-[1.5px] border-[#6BCB77]/50 bg-[#6BCB77]/10 flex items-center justify-center flex-shrink-0">
                <CheckSquare size={12} className="text-[#6BCB77]" />
              </div>
              <div className="flex-1">
                <h4 className="text-white/60 line-through text-[15px] font-bold mb-1">Morning Register Count</h4>
                <p className="text-white/30 text-xs font-medium">Completed by Taylor at 8:55 AM</p>
              </div>
            </GlassCard>
          </div>
          
        </div>

        {/* Floating Ask MAinager Button - The "Cockpit" feel */}
        <div className="absolute bottom-[104px] right-6 z-[60]">
          <button className="relative group w-14 h-14 rounded-2xl bg-[#F47D31] flex items-center justify-center shadow-[0_8px_32px_rgba(244,125,49,0.4),inset_0_2px_4px_rgba(255,255,255,0.3)] border border-[#F47D31]/50 transition-all hover:scale-105 active:scale-95 duration-300">
            {/* Outer rings pulse */}
            <div className="absolute inset-0 rounded-2xl border-[1.5px] border-[#F47D31]/30 scale-110 opacity-0 group-hover:opacity-100 group-hover:scale-125 transition-all duration-500" />
            <div className="absolute inset-0 rounded-2xl border border-[#F47D31]/10 scale-125 opacity-0 group-hover:opacity-100 group-hover:scale-[1.4] transition-all duration-700 delay-75" />
            
            {/* Inner glow */}
            <div className="absolute inset-0 rounded-2xl bg-[#F47D31] opacity-0 group-hover:opacity-50 blur-lg transition-opacity duration-300" />
            
            <Sparkles size={24} className="text-white relative z-10 drop-shadow-md" strokeWidth={2} />
          </button>
        </div>

        {/* Floating Bottom Navigation */}
        <div className="absolute bottom-0 w-full z-50 px-4 pb-6 pt-10 bg-gradient-to-t from-[#0A0C10] via-[#0A0C10]/95 to-transparent pointer-events-none">
          <div className="h-[72px] bg-[#12141D]/90 backdrop-blur-2xl border border-white/[0.08] rounded-[24px] px-6 flex justify-between items-center shadow-[0_-8px_32px_rgba(0,0,0,0.4)] pointer-events-auto">
            <button className="flex flex-col items-center gap-1.5 text-[#F47D31] group">
              <div className="relative">
                <Home size={22} strokeWidth={2.5} />
                <div className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[#F47D31]" />
              </div>
            </button>
            <button className="flex flex-col items-center gap-1.5 text-white/40 hover:text-white/80 transition-colors">
              <Users size={22} strokeWidth={2} />
            </button>
            <button className="flex flex-col items-center gap-1.5 text-white/40 hover:text-white/80 transition-colors">
              <Calendar size={22} strokeWidth={2} />
            </button>
            <button className="flex flex-col items-center gap-1.5 text-white/40 hover:text-white/80 transition-colors relative">
              <CheckSquare size={22} strokeWidth={2} />
              <div className="absolute -top-1 -right-1.5 w-3.5 h-3.5 rounded-full bg-[#FF6B6B] border-2 border-[#12141D] flex items-center justify-center">
                <span className="text-[8px] font-bold text-white leading-none">3</span>
              </div>
            </button>
            <button className="flex flex-col items-center gap-1.5 text-white/40 hover:text-white/80 transition-colors">
              <Menu size={22} strokeWidth={2} />
            </button>
          </div>
          
          {/* Home indicator (iOS) */}
          <div className="w-[120px] h-1.5 bg-white/20 rounded-full mx-auto mt-5" />
        </div>
        
      </div>
    </div>
  );
}
