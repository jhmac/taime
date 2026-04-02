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
  MoreHorizontal,
  Activity,
  MessageSquare
} from "lucide-react";

const Card = ({ children, className = "", style = {} }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) => (
  <div className={`relative rounded-3xl overflow-hidden ${className}`} style={{ backgroundColor: "#FFFFFF", border: "1px solid #F0EBE3", boxShadow: "0 2px 12px rgba(0,0,0,0.06)", ...style }}>
    {children}
  </div>
);

const Avatar = ({ name, status }: { name: string; status?: "online" | "late" | "offline" }) => (
  <div className="relative inline-flex items-center justify-center flex-shrink-0">
    <div className="w-11 h-11 rounded-full flex items-center justify-center font-extrabold text-white" style={{ background: "linear-gradient(135deg, #F47D31 0%, #F9C846 100%)" }}>
      {name.charAt(0)}
    </div>
    {status === "online" && <div className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-[2.5px] border-white" style={{ backgroundColor: "#6BCB77" }} />}
    {status === "late" && <div className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-[2.5px] border-white" style={{ backgroundColor: "#FF6B6B" }} />}
    {status === "offline" && <div className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-[2.5px] border-white" style={{ backgroundColor: "#D0C9C0" }} />}
  </div>
);

export function Dashboard() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

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
        <header className="px-6 pt-16 pb-4 flex justify-between items-end z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full mb-3" style={{ backgroundColor: "#F47D3112", border: "1px solid #F47D3125" }}>
              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#F47D31" }} />
              <p className="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: "#F47D31" }}>Libby Story • Ridgeland, MS</p>
            </div>
            <h1 className="text-[28px] font-extrabold tracking-tight leading-none" style={{ color: "#1A1A2E" }}>Overview</h1>
          </div>
          <div className="flex gap-2.5">
            <button className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: "#FFFFFF", border: "1px solid #F0EBE3", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
              <Search size={18} strokeWidth={2.5} style={{ color: "#1A1A2E80" }} />
            </button>
            <button className="w-10 h-10 rounded-full flex items-center justify-center relative" style={{ backgroundColor: "#FFFFFF", border: "1px solid #F0EBE3", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
              <Bell size={18} strokeWidth={2.5} style={{ color: "#1A1A2E80" }} />
              <div className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full border-2 border-white" style={{ backgroundColor: "#FF6B6B" }} />
            </button>
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="no-scroll flex-1 overflow-y-auto pb-40 px-6 pt-2 z-10" style={{ gap: 0 }}>

          {/* AI Greeting Card */}
          <div className="mb-5" style={{ transform: mounted ? "translateY(0)" : "translateY(20px)", opacity: mounted ? 1 : 0, transition: "all 0.8s cubic-bezier(0.16, 1, 0.3, 1)" }}>
            <Card className="p-6" style={{ border: "1.5px solid #F47D3118" } as React.CSSProperties}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "linear-gradient(135deg, #F47D31, #F9C846)" }}>
                  <Sparkles size={14} className="text-white" />
                </div>
                <h2 className="text-sm font-extrabold" style={{ color: "#1A1A2E" }}>Good morning, Libby</h2>
              </div>
              <p className="text-[15px] leading-relaxed mb-5 font-semibold" style={{ color: "#1A1A2EAA" }}>
                Store opened exactly on time. Sales are trending{" "}
                <span className="font-extrabold" style={{ color: "#3D8B40" }}>12% above</span> yesterday. Here's what matters today.
              </p>

              {/* Alert */}
              <div className="rounded-2xl p-4 flex gap-4 items-start relative overflow-hidden" style={{ backgroundColor: "#FF6B6B0A", border: "1px solid #FF6B6B20" }}>
                <div className="absolute top-0 left-0 w-1 h-full rounded-l-2xl" style={{ background: "linear-gradient(to bottom, #FF6B6B, #F47D31)" }} />
                <div className="mt-0.5 p-2 rounded-full flex-shrink-0" style={{ backgroundColor: "#FF6B6B18", border: "1px solid #FF6B6B25" }}>
                  <AlertTriangle size={16} style={{ color: "#FF6B6B" }} />
                </div>
                <div className="flex-1">
                  <h3 className="font-extrabold text-sm mb-1.5 flex items-center justify-between" style={{ color: "#C0392B" }}>
                    Summer is late
                    <span className="text-[10px] uppercase font-extrabold tracking-wider" style={{ color: "#FF6B6B80" }}>Urgent</span>
                  </h3>
                  <p className="text-xs leading-relaxed mb-3 font-semibold" style={{ color: "#C0392B80" }}>She hasn't clocked in. Her shift started 8 min ago.</p>
                  <div className="flex gap-2">
                    <button className="flex-1 py-2 rounded-xl text-white text-xs font-extrabold flex items-center justify-center gap-1.5" style={{ background: "linear-gradient(135deg, #FF6B6B, #F47D31)", boxShadow: "0 4px 12px rgba(255,107,107,0.3)" }}>
                      <MessageSquare size={12} /> Message
                    </button>
                    <button className="px-4 py-2 rounded-xl text-xs font-bold" style={{ backgroundColor: "#F0EBE3", color: "#1A1A2E60" }}>
                      Ignore
                    </button>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {/* Key Metrics */}
          <div className="grid grid-cols-2 gap-4 mb-5" style={{ transform: mounted ? "translateY(0)" : "translateY(20px)", opacity: mounted ? 1 : 0, transition: "all 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.1s" }}>
            <Card className="p-5 cursor-pointer">
              <div className="flex justify-between items-start mb-5">
                <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ backgroundColor: "#6BCB7712", border: "1px solid #6BCB7728" }}>
                  <TrendingUp size={18} style={{ color: "#6BCB77" }} />
                </div>
                <div className="px-2 py-1 rounded-lg text-[10px] font-extrabold" style={{ backgroundColor: "#6BCB7712", color: "#3D8B40" }}>+12%</div>
              </div>
              <div>
                <p className="text-xs font-extrabold uppercase tracking-wider mb-1" style={{ color: "#1A1A2E50" }}>Sales Pulse</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-extrabold" style={{ color: "#1A1A2E" }}>$2,450</span>
                  <span className="text-sm font-semibold" style={{ color: "#1A1A2E40" }}>.00</span>
                </div>
              </div>
            </Card>

            <Card className="p-5 cursor-pointer">
              <div className="flex justify-between items-start mb-5">
                <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ backgroundColor: "#F47D3112", border: "1px solid #F47D3128" }}>
                  <Award size={18} style={{ color: "#F47D31" }} />
                </div>
                <div className="px-2 py-1 rounded-lg text-[10px] font-extrabold" style={{ backgroundColor: "#F47D3112", color: "#C05E1E" }}>TOP 5%</div>
              </div>
              <div>
                <p className="text-xs font-extrabold uppercase tracking-wider mb-1" style={{ color: "#1A1A2E50" }}>Team Score</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-extrabold" style={{ color: "#1A1A2E" }}>92</span>
                  <span className="text-sm font-semibold" style={{ color: "#1A1A2E40" }}>/100</span>
                </div>
              </div>
            </Card>
          </div>

          {/* On Floor Now */}
          <div className="mb-5" style={{ transform: mounted ? "translateY(0)" : "translateY(20px)", opacity: mounted ? 1 : 0, transition: "all 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.2s" }}>
            <div className="flex justify-between items-end px-1 mb-3">
              <h2 className="font-extrabold text-[15px]" style={{ color: "#1A1A2E" }}>On Floor Now</h2>
              <button className="text-xs font-extrabold flex items-center gap-0.5" style={{ color: "#F47D31" }}>
                Full roster <ChevronRight size={14} />
              </button>
            </div>

            <Card className="p-2">
              <div className="flex items-center justify-between p-3 rounded-2xl cursor-pointer">
                <div className="flex items-center gap-3.5">
                  <Avatar name="Taylor" status="online" />
                  <div>
                    <h4 className="text-sm font-extrabold" style={{ color: "#1A1A2E" }}>Taylor</h4>
                    <p className="text-[11px] mt-0.5 font-semibold" style={{ color: "#1A1A2E60" }}>Manager • In since 8:45 AM</p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <div className="px-2 py-1 rounded-lg flex items-center gap-1.5" style={{ backgroundColor: "#6BCB7712", border: "1px solid #6BCB7728" }}>
                    <CheckSquare size={10} style={{ color: "#6BCB77" }} />
                    <span className="text-[10px] font-extrabold" style={{ color: "#3D8B40" }}>4/5 tasks</span>
                  </div>
                  <MoreHorizontal size={14} style={{ color: "#1A1A2E30" }} />
                </div>
              </div>

              <div className="h-px w-[calc(100%-32px)] mx-auto" style={{ background: "linear-gradient(to right, transparent, #F0EBE3, transparent)" }} />

              <div className="flex items-center justify-between p-3 rounded-2xl cursor-pointer">
                <div className="flex items-center gap-3.5">
                  <Avatar name="Sela" status="online" />
                  <div>
                    <h4 className="text-sm font-extrabold" style={{ color: "#1A1A2E" }}>Sela</h4>
                    <p className="text-[11px] mt-0.5 font-semibold" style={{ color: "#1A1A2E60" }}>Stylist • In since 9:00 AM</p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <div className="px-2 py-1 rounded-lg flex items-center gap-1.5" style={{ backgroundColor: "#4ECDC412", border: "1px solid #4ECDC428" }}>
                    <Clock size={10} style={{ color: "#4ECDC4" }} />
                    <span className="text-[10px] font-extrabold" style={{ color: "#2E9E97" }}>Break in 2h</span>
                  </div>
                  <MoreHorizontal size={14} style={{ color: "#1A1A2E30" }} />
                </div>
              </div>

              <div className="h-px w-[calc(100%-32px)] mx-auto" style={{ background: "linear-gradient(to right, transparent, #F0EBE3, transparent)" }} />

              <div className="flex items-center justify-between p-3 rounded-2xl cursor-pointer">
                <div className="flex items-center gap-3.5">
                  <Avatar name="Sophia" status="offline" />
                  <div>
                    <h4 className="text-sm font-extrabold" style={{ color: "#1A1A2E60" }}>Sophia</h4>
                    <p className="text-[11px] mt-0.5 font-semibold" style={{ color: "#1A1A2E40" }}>Stylist • Next up 1:00 PM</p>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {/* Action Items */}
          <div className="pb-8" style={{ transform: mounted ? "translateY(0)" : "translateY(20px)", opacity: mounted ? 1 : 0, transition: "all 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.3s" }}>
            <div className="flex justify-between items-end px-1 mb-3">
              <h2 className="font-extrabold text-[15px]" style={{ color: "#1A1A2E" }}>Action Items</h2>
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-extrabold text-white" style={{ backgroundColor: "#F47D31" }}>3</span>
            </div>

            <Card className="p-4 flex items-center gap-4 cursor-pointer mb-3">
              <div className="w-6 h-6 rounded-lg flex-shrink-0" style={{ border: "1.5px solid #F47D3160" }} />
              <div className="flex-1">
                <h4 className="text-[15px] font-extrabold mb-1" style={{ color: "#1A1A2E" }}>Restock Summer Collection</h4>
                <p className="text-xs font-semibold" style={{ color: "#1A1A2E60" }}>Assigned to Sela • Due at 12:00 PM</p>
              </div>
            </Card>

            <div className="p-4 flex items-center gap-4 cursor-pointer rounded-3xl" style={{ opacity: 0.5, border: "1px dashed #D0C9C0", backgroundColor: "transparent" }}>
              <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "#6BCB7718", border: "1px solid #6BCB7740" }}>
                <CheckSquare size={12} style={{ color: "#6BCB77" }} />
              </div>
              <div className="flex-1">
                <h4 className="text-[15px] font-extrabold mb-1 line-through" style={{ color: "#1A1A2E60" }}>Morning Register Count</h4>
                <p className="text-xs font-semibold" style={{ color: "#1A1A2E40" }}>Completed by Taylor at 8:55 AM</p>
              </div>
            </div>
          </div>

        </div>

        {/* Floating AI Button */}
        <div className="absolute bottom-[104px] right-6 z-[60]">
          <button className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #F47D31, #F9C846)", boxShadow: "0 8px 32px rgba(244,125,49,0.40)", border: "1px solid rgba(255,255,255,0.3)" }}>
            <Sparkles size={24} className="text-white" strokeWidth={2} />
          </button>
        </div>

        {/* Bottom Navigation */}
        <div className="absolute bottom-0 w-full z-50 px-4 pb-6 pt-10 pointer-events-none" style={{ background: "linear-gradient(to top, #FFFBF5 60%, transparent)" }}>
          <div className="h-[72px] rounded-[24px] px-6 flex justify-between items-center pointer-events-auto" style={{ backgroundColor: "rgba(255,251,245,0.96)", backdropFilter: "blur(20px)", border: "1px solid #F0EBE3", boxShadow: "0 -4px 20px rgba(0,0,0,0.05)" }}>
            <button className="flex flex-col items-center gap-1.5 relative">
              <Home size={22} strokeWidth={2.5} style={{ color: "#F47D31" }} />
              <div className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full" style={{ backgroundColor: "#F47D31" }} />
            </button>
            <button className="flex flex-col items-center gap-1.5"><Users size={22} strokeWidth={2} style={{ color: "#1A1A2E40" }} /></button>
            <button className="flex flex-col items-center gap-1.5"><Calendar size={22} strokeWidth={2} style={{ color: "#1A1A2E40" }} /></button>
            <button className="flex flex-col items-center gap-1.5 relative">
              <CheckSquare size={22} strokeWidth={2} style={{ color: "#1A1A2E40" }} />
              <div className="absolute -top-1 -right-1.5 w-3.5 h-3.5 rounded-full border-2 border-white flex items-center justify-center" style={{ backgroundColor: "#FF6B6B" }}>
                <span className="text-[8px] font-extrabold text-white leading-none">3</span>
              </div>
            </button>
            <button className="flex flex-col items-center gap-1.5"><Menu size={22} strokeWidth={2} style={{ color: "#1A1A2E40" }} /></button>
          </div>
          <div className="w-[120px] h-1.5 rounded-full mx-auto mt-5" style={{ backgroundColor: "#1A1A2E20" }} />
        </div>

      </div>
    </div>
  );
}
