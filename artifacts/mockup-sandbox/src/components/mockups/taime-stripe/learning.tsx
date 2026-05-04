import { useState } from "react";
import { BookOpen, Sparkles, ChevronRight, Star, Trophy, CheckCircle2, Play, Zap } from "lucide-react";

const S = {
  bg: "#FFFFFF", surface: "#F8FAFF", card: "#FFFFFF",
  border: "#E8EDF8", primary: "#5B6CF0", primarySoft: "#EEF0FF",
  dark: "#0D1F3C", mid: "#445578", light: "#8898AA",
  green: "#00C48C", greenSoft: "#E6FAF4",
  orange: "#FF7A45", orangeSoft: "#FFF3EE",
  purple: "#8B5CF6", purpleSoft: "#F3EEFF",
  yellow: "#F59E0B",
  shadow: "0 1px 3px rgba(0,18,60,0.06), 0 4px 16px rgba(0,18,60,0.04)",
};

const quiz = {
  q: "What is Taime Boutique's policy for gift wrapping during peak season?",
  options: ["Complimentary on all purchases over $50", "Available for an additional $5 fee", "Only available on weekends", "Complimentary on all purchases"],
  correct: 0,
};

const articles = [
  { title: "Summer Collection Highlights", category: "Product", emoji: "👗", read: true, score: 10 },
  { title: "Handling Returns & Exchanges", category: "SOP", emoji: "📋", read: true, score: 10 },
  { title: "Upselling Techniques That Work", category: "Training", emoji: "📈", read: false, score: 10 },
  { title: "Visual Merchandising Guide", category: "Training", emoji: "🏪", read: false, score: 10 },
  { title: "Morning Opening Checklist", category: "SOP", emoji: "✅", read: true, score: 10 },
];

export default function Learning() {
  const [selected, setSelected] = useState<number|null>(null);
  const [answered, setAnswered] = useState(false);
  const [tab, setTab] = useState<"daily"|"library">("daily");

  const choose = (i: number) => { setSelected(i); setAnswered(true); };

  return (
    <div style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif", background: S.surface, height: "100vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ background: S.card, borderBottom: `1px solid ${S.border}`, padding: "44px 20px 0", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: S.dark, margin: 0 }}>Learning</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 20, background: "#FFFBEB", border: "1px solid #FEF08A" }}>
            <Star size={14} color={S.yellow} fill={S.yellow} />
            <span style={{ fontSize: 13, fontWeight: 800, color: "#92400E" }}>30 pts today</span>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", background: S.surface, borderRadius: 12, padding: 4, gap: 2, marginBottom: 0 }}>
          {(["daily","library"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: "9px 0", borderRadius: 9, background: tab === t ? S.card : "transparent", border: tab === t ? `1px solid ${S.border}` : "1px solid transparent", fontSize: 13, fontWeight: 700, color: tab === t ? S.dark : S.light, cursor: "pointer", boxShadow: tab === t ? S.shadow : "none" }}>
              {t === "daily" ? "Daily Quiz" : "Knowledge Base"}
            </button>
          ))}
        </div>
        <div style={{ height: 14 }} />
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
        {tab === "daily" ? (
          <>
            {/* Streak */}
            <div style={{ borderRadius: 16, background: `linear-gradient(135deg, ${S.primary}, #8B5CF6)`, padding: "14px 18px", display: "flex", alignItems: "center", gap: 12, marginBottom: 16, boxShadow: `0 8px 24px rgba(91,108,240,0.3)` }}>
              <div style={{ width: 44, height: 44, borderRadius: 14, background: "rgba(255,255,255,0.2)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <Zap size={20} color="#FCD34D" fill="#FCD34D" />
              </div>
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.65)", textTransform: "uppercase", letterSpacing: "0.08em", margin: 0 }}>STREAK</p>
                <p style={{ fontSize: 22, fontWeight: 800, color: "#fff", margin: "2px 0 0" }}>7 Days 🔥</p>
              </div>
              <div style={{ marginLeft: "auto", textAlign: "right" }}>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", margin: 0 }}>Rank</p>
                <p style={{ fontSize: 18, fontWeight: 800, color: "#fff", margin: "2px 0 0" }}>#2</p>
              </div>
            </div>

            {/* Quiz card */}
            <div style={{ borderRadius: 20, background: S.card, border: `1px solid ${S.border}`, padding: "20px", boxShadow: S.shadow, marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <div style={{ width: 30, height: 30, borderRadius: 9, background: S.primarySoft, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Sparkles size={15} color={S.primary} />
                </div>
                <p style={{ fontSize: 12, fontWeight: 700, color: S.primary, margin: 0 }}>TODAY'S QUESTION</p>
              </div>
              <p style={{ fontSize: 15, fontWeight: 700, color: S.dark, lineHeight: 1.45, margin: "0 0 18px" }}>{quiz.q}</p>
              {quiz.options.map((opt, i) => {
                const isSelected = selected === i;
                const isCorrect = i === quiz.correct;
                const bg = !answered ? S.surface : isCorrect ? S.greenSoft : (isSelected && !isCorrect) ? "#FFF0F3" : S.surface;
                const border = !answered ? S.border : isCorrect ? S.green : (isSelected && !isCorrect) ? "#F43F5E" : S.border;
                const color = !answered ? S.dark : isCorrect ? S.green : (isSelected && !isCorrect) ? "#F43F5E" : S.light;
                return (
                  <button key={i} onClick={() => !answered && choose(i)} style={{ width: "100%", textAlign: "left", padding: "12px 14px", borderRadius: 12, background: bg, border: `1.5px solid ${border}`, color, fontSize: 14, fontWeight: 600, cursor: answered ? "default" : "pointer", marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between", transition: "all 0.2s" }}>
                    {opt}
                    {answered && isCorrect && <CheckCircle2 size={18} color={S.green} />}
                  </button>
                );
              })}
              {answered && <div style={{ marginTop: 12, padding: "12px 14px", borderRadius: 12, background: selected === quiz.correct ? S.greenSoft : "#FFF0F3", border: `1px solid ${selected === quiz.correct ? S.green : "#F43F5E"}30` }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: selected === quiz.correct ? S.green : "#F43F5E", margin: "0 0 4px" }}>{selected === quiz.correct ? "Correct! +10 pts ✓" : "Not quite — correct answer highlighted"}</p>
                <p style={{ fontSize: 13, color: S.mid, margin: 0 }}>Complimentary gift wrapping is offered on all purchases over $50 to enhance customer experience.</p>
              </div>}
            </div>
          </>
        ) : (
          <>
            <p style={{ fontSize: 11, fontWeight: 700, color: S.light, letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 10px" }}>FROM YOUR STORE'S KNOWLEDGE BASE</p>
            {articles.map((a, i) => (
              <div key={i} style={{ borderRadius: 14, background: S.card, padding: "14px 16px", marginBottom: 8, boxShadow: S.shadow, border: `1px solid ${S.border}`, display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: S.primarySoft, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>{a.emoji}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 700, color: S.dark, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</p>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: S.primarySoft, color: S.primary }}>{a.category}</span>
                    {a.read && <span style={{ fontSize: 11, fontWeight: 600, color: S.green }}>✓ Read · +{a.score}pts</span>}
                  </div>
                </div>
                {!a.read && <div style={{ width: 34, height: 34, borderRadius: 10, background: S.primary, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Play size={14} color="#fff" fill="#fff" />
                </div>}
                {a.read && <ChevronRight size={16} color={S.light} />}
              </div>
            ))}
          </>
        )}
        <div style={{ height: 12 }} />
      </div>

      {/* Bottom Nav */}
      <div style={{ background: S.card, borderTop: `1px solid ${S.border}`, paddingBottom: 20, flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-around", paddingTop: 10 }}>
          {["Home","Schedule","Messages","Team"].map(label => (
            <span key={label} style={{ fontSize: 10, fontWeight: 500, color: S.light }}>{label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
