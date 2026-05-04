import React, { useState } from "react";
import { TrendingUp, TrendingDown, DollarSign, ShoppingBag, AlertTriangle, CheckCircle2, ChevronRight, Camera, Sparkles } from "lucide-react";

const S = {
  bg: "#FFFFFF", surface: "#F8FAFF", card: "#FFFFFF",
  border: "#E8EDF8", primary: "#5B6CF0", primarySoft: "#EEF0FF",
  dark: "#0D1F3C", mid: "#445578", light: "#8898AA",
  green: "#00C48C", greenSoft: "#E6FAF4",
  orange: "#FF7A45", orangeSoft: "#FFF3EE",
  red: "#F43F5E", redSoft: "#FFF0F3",
  shadow: "0 1px 3px rgba(0,18,60,0.06), 0 4px 16px rgba(0,18,60,0.04)",
};

const lineItems = [
  { label: "Hundreds ($100)", qty: 5, value: 500 },
  { label: "Fifties ($50)", qty: 8, value: 400 },
  { label: "Twenties ($20)", qty: 12, value: 240 },
  { label: "Tens ($10)", qty: 7, value: 70 },
  { label: "Fives ($5)", qty: 10, value: 50 },
  { label: "Ones ($1)", qty: 23, value: 23 },
];
const totalCash = lineItems.reduce((s, l) => s + l.value, 0);
const shopifyExpected = 1295;
const variance = totalCash - shopifyExpected;

export default function Cash() {
  const [step, setStep] = useState<"overview"|"count"|"deposit">("overview");

  if (step === "count") {
    return (
      <div style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif", background: S.surface, height: "100vh", display: "flex", flexDirection: "column" }}>
        <div style={{ background: S.card, borderBottom: `1px solid ${S.border}`, padding: "44px 20px 16px", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 4 }}>
            <button onClick={() => setStep("overview")} style={{ fontSize: 22, background: "none", border: "none", color: S.primary, cursor: "pointer", padding: 0 }}>‹</button>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: S.dark, margin: 0 }}>Cash Count</h1>
          </div>
          <p style={{ fontSize: 13, color: S.light, margin: "0 0 0 36px" }}>May 5, 2026 · End of Day</p>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
          {lineItems.map((item, i) => (
            <div key={i} style={{ borderRadius: 14, background: S.card, padding: "14px 16px", marginBottom: 8, boxShadow: S.shadow, border: `1px solid ${S.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: S.dark }}>{item.label}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 13, color: S.light }}>×{item.qty}</span>
                <span style={{ fontSize: 15, fontWeight: 800, color: S.dark, minWidth: 56, textAlign: "right" }}>${item.value}</span>
              </div>
            </div>
          ))}
          <div style={{ borderRadius: 16, background: variance === 0 ? S.greenSoft : Math.abs(variance) < 20 ? S.orangeSoft : S.redSoft, border: `2px solid ${variance === 0 ? S.green : Math.abs(variance) < 20 ? S.orange : S.red}`, padding: "16px 18px", marginTop: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: S.dark }}>Total Counted</span>
              <span style={{ fontSize: 22, fontWeight: 800, color: S.dark }}>${totalCash.toLocaleString()}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
              <span style={{ fontSize: 13, color: S.light }}>Shopify Expected</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: S.light }}>${shopifyExpected.toLocaleString()}</span>
            </div>
            <div style={{ height: 1, background: `${variance === 0 ? S.green : S.orange}30`, margin: "10px 0" }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: variance === 0 ? S.green : S.orange }}>Variance</span>
              <span style={{ fontSize: 16, fontWeight: 800, color: variance === 0 ? S.green : S.orange }}>{variance >= 0 ? "+" : ""}${variance}</span>
            </div>
          </div>
          <button onClick={() => setStep("deposit")} style={{ width: "100%", marginTop: 16, marginBottom: 20, padding: "16px", borderRadius: 16, background: `linear-gradient(135deg, ${S.primary}, #8B5CF6)`, border: "none", color: "#fff", fontSize: 15, fontWeight: 800, cursor: "pointer", boxShadow: `0 8px 24px rgba(91,108,240,0.3)` }}>
            Continue to Deposit →
          </button>
        </div>
      </div>
    );
  }

  if (step === "deposit") {
    return (
      <div style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif", background: S.surface, height: "100vh", display: "flex", flexDirection: "column" }}>
        <div style={{ background: S.card, borderBottom: `1px solid ${S.border}`, padding: "44px 20px 16px", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button onClick={() => setStep("count")} style={{ fontSize: 22, background: "none", border: "none", color: S.primary, cursor: "pointer", padding: 0 }}>‹</button>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: S.dark, margin: 0 }}>Deposit Slip</h1>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
          <div style={{ borderRadius: 20, border: `2px dashed ${S.primary}50`, background: S.primarySoft, padding: "32px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 12, marginBottom: 16, cursor: "pointer" }}>
            <div style={{ width: 56, height: 56, borderRadius: 18, background: S.card, boxShadow: S.shadow, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Camera size={26} color={S.primary} />
            </div>
            <p style={{ fontSize: 15, fontWeight: 700, color: S.dark, margin: 0 }}>Upload deposit slip</p>
            <p style={{ fontSize: 13, color: S.light, margin: 0, textAlign: "center" }}>AI will verify the amount matches your count</p>
          </div>
          <div style={{ borderRadius: 16, background: S.card, border: `1px solid ${S.border}`, padding: "16px", boxShadow: S.shadow, marginBottom: 16 }}>
            {[{ label: "Cash counted", value: `$${totalCash.toLocaleString()}` }, { label: "Deposit amount", value: `$${totalCash.toLocaleString()}` }, { label: "Date", value: "May 5, 2026" }, { label: "Bank", value: "Main Branch" }].map((r, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: i < 3 ? `1px solid ${S.border}` : "none" }}>
                <span style={{ fontSize: 14, color: S.light }}>{r.label}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: S.dark }}>{r.value}</span>
              </div>
            ))}
          </div>
          <div style={{ borderRadius: 14, background: S.primarySoft, border: `1px solid ${S.primary}20`, padding: "12px 14px", display: "flex", gap: 10, marginBottom: 16 }}>
            <Sparkles size={16} color={S.primary} style={{ flexShrink: 0, marginTop: 1 }} />
            <p style={{ fontSize: 13, color: S.mid, margin: 0 }}>Ara will verify this against your Shopify expected amount and alert the owner if there's a discrepancy.</p>
          </div>
          <button style={{ width: "100%", padding: "16px", borderRadius: 16, background: `linear-gradient(135deg, ${S.green}, #00A878)`, border: "none", color: "#fff", fontSize: 15, fontWeight: 800, cursor: "pointer", boxShadow: `0 8px 24px rgba(0,196,140,0.3)`, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 20 }}>
            <CheckCircle2 size={18} color="#fff" />
            Submit Deposit
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif", background: S.surface, height: "100vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* Header gradient */}
      <div style={{ background: `linear-gradient(135deg, ${S.primary} 0%, #8B5CF6 100%)`, padding: "44px 20px 24px", flexShrink: 0 }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.65)", textTransform: "uppercase", letterSpacing: "0.08em", margin: 0 }}>CASH MANAGEMENT</p>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: "#fff", margin: "6px 0 0" }}>$3,820.00</h1>
        <p style={{ fontSize: 14, color: "rgba(255,255,255,0.7)", margin: "4px 0 0" }}>Today's total sales · Shopify synced</p>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 12px", borderRadius: 99, background: "rgba(255,255,255,0.2)" }}>
            <TrendingUp size={13} color="#fff" />
            <span style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>+14% vs last week</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 12px", borderRadius: 99, background: "rgba(255,255,255,0.2)" }}>
            <ShoppingBag size={13} color="#fff" />
            <span style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>47 transactions</span>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
        {/* Quick actions */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
          <button onClick={() => setStep("count")} style={{ padding: "16px", borderRadius: 16, background: S.card, border: `1px solid ${S.border}`, boxShadow: S.shadow, cursor: "pointer", textAlign: "left" }}>
            <div style={{ width: 36, height: 36, borderRadius: 11, background: S.primarySoft, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
              <DollarSign size={18} color={S.primary} />
            </div>
            <p style={{ fontSize: 14, fontWeight: 700, color: S.dark, margin: 0 }}>Cash Count</p>
            <p style={{ fontSize: 12, color: S.light, margin: "3px 0 0" }}>Count register</p>
          </button>
          <button onClick={() => setStep("deposit")} style={{ padding: "16px", borderRadius: 16, background: S.card, border: `1px solid ${S.border}`, boxShadow: S.shadow, cursor: "pointer", textAlign: "left" }}>
            <div style={{ width: 36, height: 36, borderRadius: 11, background: S.greenSoft, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
              <CheckCircle2 size={18} color={S.green} />
            </div>
            <p style={{ fontSize: 14, fontWeight: 700, color: S.dark, margin: 0 }}>Deposit</p>
            <p style={{ fontSize: 12, color: S.light, margin: "3px 0 0" }}>Submit slip</p>
          </button>
        </div>

        {/* Breakdown */}
        <p style={{ fontSize: 11, fontWeight: 700, color: S.light, letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 10px" }}>TODAY'S BREAKDOWN</p>
        {[
          { label: "Cash Sales", value: "$1,283", pct: 34, color: S.green },
          { label: "Card Sales", value: "$2,241", pct: 59, color: S.primary },
          { label: "Contactless", value: "$296", pct: 7, color: S.orange },
        ].map((r, i) => (
          <div key={i} style={{ borderRadius: 14, background: S.card, padding: "14px 16px", marginBottom: 8, boxShadow: S.shadow, border: `1px solid ${S.border}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: S.dark }}>{r.label}</span>
              <span style={{ fontSize: 16, fontWeight: 800, color: S.dark }}>{r.value}</span>
            </div>
            <div style={{ height: 5, background: S.surface, borderRadius: 99, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${r.pct}%`, background: r.color, borderRadius: 99 }} />
            </div>
            <span style={{ fontSize: 11, color: S.light, marginTop: 4, display: "block" }}>{r.pct}% of today's total</span>
          </div>
        ))}

        {/* Recent deposits */}
        <p style={{ fontSize: 11, fontWeight: 700, color: S.light, letterSpacing: "0.08em", textTransform: "uppercase", margin: "16px 0 10px" }}>RECENT DEPOSITS</p>
        {[
          { date: "May 4", amount: "$1,244", status: "verified", by: "Taylor S." },
          { date: "May 3", amount: "$1,190", status: "verified", by: "Libby R." },
        ].map((d, i) => (
          <div key={i} style={{ borderRadius: 14, background: S.card, padding: "14px 16px", marginBottom: 8, boxShadow: S.shadow, border: `1px solid ${S.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <p style={{ fontSize: 14, fontWeight: 700, color: S.dark, margin: 0 }}>{d.date} · {d.by}</p>
              <span style={{ fontSize: 11, fontWeight: 700, color: S.green }}>✓ AI Verified</span>
            </div>
            <span style={{ fontSize: 18, fontWeight: 800, color: S.dark }}>{d.amount}</span>
          </div>
        ))}
        <div style={{ height: 16 }} />
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
