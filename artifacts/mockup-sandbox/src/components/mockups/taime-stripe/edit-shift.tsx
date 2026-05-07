import React, { useState } from "react";
import {
  ChevronLeft, MoreVertical, User, Clock, MapPin, Repeat,
  AlertTriangle, Trash2, Check, ChevronDown, Calendar, X,
} from "lucide-react";

const S = {
  bg: "#FFFFFF",
  surface: "#F8FAFF",
  card: "#FFFFFF",
  border: "#E8EDF8",
  borderFocus: "#5B6CF0",
  primary: "#5B6CF0",
  primarySoft: "#EEF0FF",
  dark: "#0D1F3C",
  mid: "#445578",
  light: "#8898AA",
  green: "#00C48C",
  greenSoft: "#E6FAF4",
  orange: "#FF7A45",
  orangeSoft: "#FFF3EE",
  red: "#F43F5E",
  redSoft: "#FFF0F3",
  purple: "#8B5CF6",
  purpleSoft: "#F3EEFF",
  teal: "#06B6D4",
  tealSoft: "#ECFEFF",
  shadow: "0 1px 3px rgba(0,18,60,0.06), 0 4px 16px rgba(0,18,60,0.04)",
  shadowMd: "0 4px 16px rgba(0,18,60,0.10), 0 1px 4px rgba(0,18,60,0.06)",
};

const employees = [
  { name: "Taylor Singh", role: "Store Lead", avatar: "TS", gradient: `linear-gradient(135deg, ${S.primary}, #8B5CF6)` },
  { name: "Libby Rodriguez", role: "Sales Associate", avatar: "LR", gradient: `linear-gradient(135deg, ${S.green}, #00A878)` },
  { name: "Jordan Mills", role: "Stock Lead", avatar: "JM", gradient: `linear-gradient(135deg, ${S.orange}, #FF5E2C)` },
  { name: "Sela Park", role: "Sales Associate", avatar: "SP", gradient: `linear-gradient(135deg, #8B5CF6, #7C3AED)` },
  { name: "Chris Torres", role: "Sales Associate", avatar: "CT", gradient: `linear-gradient(135deg, ${S.teal}, #0891B2)` },
];

const locations = ["Ridgeland — Main", "Flowood — Eastgate", "Jackson — Fondren"];
const roles = ["Sales Associate", "Store Lead", "Stock Lead", "Cashier", "Opener", "Closer"];

const hours12 = Array.from({ length: 13 }, (_, i) => {
  const h = i + 7;
  const label = h < 12 ? `${h}:00 AM` : h === 12 ? "12:00 PM" : `${h - 12}:00 PM`;
  return { value: h, label };
});

const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dates = [4, 5, 6, 7, 8, 9, 10];

type DropdownKey = "employee" | "location" | "role" | "startTime" | "endTime" | "repeat" | null;

export default function EditShift() {
  const [selectedDay, setSelectedDay] = useState(2);
  const [empIdx, setEmpIdx] = useState(0);
  const [locationIdx, setLocationIdx] = useState(0);
  const [roleIdx, setRoleIdx] = useState(0);
  const [startHour, setStartHour] = useState(9);
  const [endHour, setEndHour] = useState(17);
  const [breakEnabled, setBreakEnabled] = useState(true);
  const [breakMins, setBreakMins] = useState(30);
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [repeatType, setRepeatType] = useState<"weekly" | "biweekly">("weekly");
  const [notes, setNotes] = useState("");
  const [openDropdown, setOpenDropdown] = useState<DropdownKey>(null);
  const [saved, setSaved] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const emp = employees[empIdx];
  const location = locations[locationIdx];
  const role = roles[roleIdx];
  const hasConflict = startHour === 9 && selectedDay === 2; // simulated conflict

  const totalHours = endHour - startHour - (breakEnabled ? breakMins / 60 : 0);

  const fmtHour = (h: number) =>
    h < 12 ? `${h}:00 AM` : h === 12 ? "12:00 PM" : `${h - 12}:00 PM`;

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const toggle = (key: DropdownKey) =>
    setOpenDropdown(prev => (prev === key ? null : key));

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div style={{ marginBottom: 12 }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: S.light, textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 6px" }}>{label}</p>
      {children}
    </div>
  );

  const FieldCard = ({
    onClick, children, focused, danger,
  }: {
    onClick?: () => void; children: React.ReactNode; focused?: boolean; danger?: boolean;
  }) => (
    <div onClick={onClick}
      style={{
        background: S.card,
        border: `1.5px solid ${focused ? S.borderFocus : danger ? S.red : S.border}`,
        borderRadius: 14,
        padding: "12px 14px",
        cursor: onClick ? "pointer" : "default",
        boxShadow: focused ? `0 0 0 3px ${S.primarySoft}` : S.shadow,
        transition: "all 0.15s ease",
      }}>
      {children}
    </div>
  );

  const DropdownList = ({ items, selected, onSelect, close }: {
    items: string[]; selected: number; onSelect: (i: number) => void; close: () => void;
  }) => (
    <div style={{
      position: "absolute", left: 0, right: 0, top: "calc(100% + 6px)",
      background: S.card, border: `1px solid ${S.border}`, borderRadius: 14,
      boxShadow: S.shadowMd, zIndex: 100, overflow: "hidden",
    }}>
      {items.map((item, i) => (
        <div key={i} onClick={() => { onSelect(i); close(); }}
          style={{
            padding: "11px 16px", fontSize: 14, color: i === selected ? S.primary : S.dark,
            fontWeight: i === selected ? 700 : 500, background: i === selected ? S.primarySoft : "transparent",
            cursor: "pointer", borderBottom: i < items.length - 1 ? `1px solid ${S.border}` : "none",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
          {item}
          {i === selected && <Check size={14} color={S.primary} />}
        </div>
      ))}
    </div>
  );

  return (
    <div
      style={{
        fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif",
        background: S.surface,
        height: "100vh",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
      onClick={() => openDropdown && setOpenDropdown(null)}
    >
      {/* Header */}
      <div style={{ background: S.card, borderBottom: `1px solid ${S.border}`, padding: "44px 20px 0", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <button style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            <ChevronLeft size={20} color={S.primary} />
            <span style={{ fontSize: 15, fontWeight: 600, color: S.primary }}>Schedule</span>
          </button>
          <h1 style={{ fontSize: 17, fontWeight: 800, color: S.dark, margin: 0, position: "absolute", left: "50%", transform: "translateX(-50%)" }}>Edit Shift</h1>
          <button style={{ width: 32, height: 32, borderRadius: 10, background: S.surface, border: `1px solid ${S.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <MoreVertical size={16} color={S.mid} />
          </button>
        </div>

        {/* Day strip */}
        <div style={{ display: "flex", gap: 4, paddingBottom: 14 }}>
          {days.map((d, i) => (
            <button key={i} onClick={(e) => { e.stopPropagation(); setSelectedDay(i); }}
              style={{
                flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                padding: "8px 0", borderRadius: 12,
                background: selectedDay === i ? S.primary : "transparent",
                border: "none", cursor: "pointer",
              }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: selectedDay === i ? "rgba(255,255,255,0.7)" : S.light }}>{d}</span>
              <span style={{ fontSize: 15, fontWeight: 800, color: selectedDay === i ? "#fff" : S.dark }}>{dates[i]}</span>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: i === 2 ? (selectedDay === i ? "#fff" : S.primary) : "transparent" }} />
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable form */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 120px" }} onClick={e => e.stopPropagation()}>

        {/* Conflict warning */}
        {hasConflict && (
          <div style={{
            background: S.orangeSoft, border: `1.5px solid ${S.orange}`, borderRadius: 14,
            padding: "12px 14px", marginBottom: 16, display: "flex", alignItems: "flex-start", gap: 10,
          }}>
            <AlertTriangle size={16} color={S.orange} style={{ flexShrink: 0, marginTop: 1 }} />
            <div>
              <p style={{ fontSize: 13, fontWeight: 700, color: S.orange, margin: 0 }}>Scheduling conflict</p>
              <p style={{ fontSize: 12, color: "#9A4A00", margin: "3px 0 0" }}>
                {emp.name.split(" ")[0]} already has a shift 9–5 PM on this day. Saving will replace it.
              </p>
            </div>
          </div>
        )}

        {/* Employee */}
        <Row label="Employee">
          <div style={{ position: "relative" }}>
            <FieldCard onClick={(e) => { e?.stopPropagation(); toggle("employee"); }} focused={openDropdown === "employee"}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: emp.gradient, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <span style={{ color: "#fff", fontSize: 13, fontWeight: 800 }}>{emp.avatar}</span>
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 15, fontWeight: 700, color: S.dark, margin: 0 }}>{emp.name}</p>
                  <p style={{ fontSize: 12, color: S.light, margin: "2px 0 0" }}>{emp.role}</p>
                </div>
                <ChevronDown size={16} color={S.light} style={{ transform: openDropdown === "employee" ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
              </div>
            </FieldCard>
            {openDropdown === "employee" && (
              <DropdownList
                items={employees.map(e => `${e.name} · ${e.role}`)}
                selected={empIdx}
                onSelect={(i) => setEmpIdx(i)}
                close={() => setOpenDropdown(null)}
              />
            )}
          </div>
        </Row>

        {/* Time */}
        <Row label="Shift Hours">
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {/* Start */}
            <div style={{ flex: 1, position: "relative" }}>
              <FieldCard onClick={(e) => { e?.stopPropagation(); toggle("startTime"); }} focused={openDropdown === "startTime"}>
                <p style={{ fontSize: 11, fontWeight: 600, color: S.light, margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Start</p>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Clock size={14} color={S.primary} />
                  <span style={{ fontSize: 15, fontWeight: 800, color: S.dark }}>{fmtHour(startHour)}</span>
                </div>
              </FieldCard>
              {openDropdown === "startTime" && (
                <div style={{ position: "absolute", left: 0, right: 0, top: "calc(100% + 6px)", background: S.card, border: `1px solid ${S.border}`, borderRadius: 14, boxShadow: S.shadowMd, zIndex: 100, maxHeight: 200, overflowY: "auto" }}>
                  {hours12.filter(h => h.value < endHour).map(h => (
                    <div key={h.value} onClick={() => { setStartHour(h.value); setOpenDropdown(null); }}
                      style={{ padding: "10px 16px", fontSize: 14, color: h.value === startHour ? S.primary : S.dark, fontWeight: h.value === startHour ? 700 : 500, background: h.value === startHour ? S.primarySoft : "transparent", cursor: "pointer", borderBottom: `1px solid ${S.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      {h.label}
                      {h.value === startHour && <Check size={14} color={S.primary} />}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ color: S.light, fontWeight: 700, fontSize: 18 }}>→</div>

            {/* End */}
            <div style={{ flex: 1, position: "relative" }}>
              <FieldCard onClick={(e) => { e?.stopPropagation(); toggle("endTime"); }} focused={openDropdown === "endTime"}>
                <p style={{ fontSize: 11, fontWeight: 600, color: S.light, margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>End</p>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Clock size={14} color={S.green} />
                  <span style={{ fontSize: 15, fontWeight: 800, color: S.dark }}>{fmtHour(endHour)}</span>
                </div>
              </FieldCard>
              {openDropdown === "endTime" && (
                <div style={{ position: "absolute", left: 0, right: 0, top: "calc(100% + 6px)", background: S.card, border: `1px solid ${S.border}`, borderRadius: 14, boxShadow: S.shadowMd, zIndex: 100, maxHeight: 200, overflowY: "auto" }}>
                  {hours12.filter(h => h.value > startHour).map(h => (
                    <div key={h.value} onClick={() => { setEndHour(h.value); setOpenDropdown(null); }}
                      style={{ padding: "10px 16px", fontSize: 14, color: h.value === endHour ? S.primary : S.dark, fontWeight: h.value === endHour ? 700 : 500, background: h.value === endHour ? S.primarySoft : "transparent", cursor: "pointer", borderBottom: `1px solid ${S.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      {h.label}
                      {h.value === endHour && <Check size={14} color={S.primary} />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Duration badge */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, background: S.primarySoft, borderRadius: 8, padding: "4px 10px" }}>
              <Clock size={11} color={S.primary} />
              <span style={{ fontSize: 12, fontWeight: 700, color: S.primary }}>{totalHours.toFixed(1)} hrs paid</span>
            </div>
            {breakEnabled && (
              <div style={{ display: "flex", alignItems: "center", gap: 5, background: S.surface, borderRadius: 8, padding: "4px 10px", border: `1px solid ${S.border}` }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: S.mid }}>{breakMins}min break</span>
              </div>
            )}
          </div>
        </Row>

        {/* Break toggle */}
        <div style={{ background: S.card, border: `1.5px solid ${S.border}`, borderRadius: 14, padding: "12px 14px", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <p style={{ fontSize: 14, fontWeight: 700, color: S.dark, margin: 0 }}>Break</p>
            <p style={{ fontSize: 12, color: S.light, margin: "2px 0 0" }}>Unpaid break time</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {breakEnabled && (
              <div style={{ display: "flex", gap: 4 }}>
                {[15, 30, 45, 60].map(m => (
                  <button key={m} onClick={() => setBreakMins(m)}
                    style={{ padding: "4px 8px", borderRadius: 8, border: `1.5px solid ${breakMins === m ? S.primary : S.border}`, background: breakMins === m ? S.primarySoft : S.surface, fontSize: 11, fontWeight: 700, color: breakMins === m ? S.primary : S.light, cursor: "pointer" }}>
                    {m}m
                  </button>
                ))}
              </div>
            )}
            {/* Toggle */}
            <div onClick={() => setBreakEnabled(b => !b)}
              style={{ width: 44, height: 26, borderRadius: 13, background: breakEnabled ? S.primary : S.border, position: "relative", cursor: "pointer", transition: "background 0.2s", flexShrink: 0 }}>
              <div style={{ position: "absolute", top: 3, left: breakEnabled ? 21 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.15)", transition: "left 0.2s" }} />
            </div>
          </div>
        </div>

        {/* Location */}
        <Row label="Location">
          <div style={{ position: "relative" }}>
            <FieldCard onClick={(e) => { e?.stopPropagation(); toggle("location"); }} focused={openDropdown === "location"}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: S.tealSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <MapPin size={16} color={S.teal} />
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 15, fontWeight: 700, color: S.dark, margin: 0 }}>{location}</p>
                </div>
                <ChevronDown size={16} color={S.light} style={{ transform: openDropdown === "location" ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
              </div>
            </FieldCard>
            {openDropdown === "location" && (
              <DropdownList
                items={locations}
                selected={locationIdx}
                onSelect={(i) => setLocationIdx(i)}
                close={() => setOpenDropdown(null)}
              />
            )}
          </div>
        </Row>

        {/* Role */}
        <Row label="Role / Position">
          <div style={{ position: "relative" }}>
            <FieldCard onClick={(e) => { e?.stopPropagation(); toggle("role"); }} focused={openDropdown === "role"}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: S.purpleSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <User size={16} color={S.purple} />
                </div>
                <p style={{ flex: 1, fontSize: 15, fontWeight: 700, color: S.dark, margin: 0 }}>{role}</p>
                <ChevronDown size={16} color={S.light} style={{ transform: openDropdown === "role" ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
              </div>
            </FieldCard>
            {openDropdown === "role" && (
              <DropdownList
                items={roles}
                selected={roleIdx}
                onSelect={(i) => setRoleIdx(i)}
                close={() => setOpenDropdown(null)}
              />
            )}
          </div>
        </Row>

        {/* Repeat */}
        <div style={{ background: S.card, border: `1.5px solid ${S.border}`, borderRadius: 14, padding: "12px 14px", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: repeatEnabled ? 12 : 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: S.greenSoft, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Repeat size={16} color={S.green} />
              </div>
              <div>
                <p style={{ fontSize: 14, fontWeight: 700, color: S.dark, margin: 0 }}>Repeat shift</p>
                <p style={{ fontSize: 12, color: S.light, margin: "2px 0 0" }}>Apply to future weeks</p>
              </div>
            </div>
            <div onClick={() => setRepeatEnabled(r => !r)}
              style={{ width: 44, height: 26, borderRadius: 13, background: repeatEnabled ? S.primary : S.border, position: "relative", cursor: "pointer", transition: "background 0.2s", flexShrink: 0 }}>
              <div style={{ position: "absolute", top: 3, left: repeatEnabled ? 21 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.15)", transition: "left 0.2s" }} />
            </div>
          </div>

          {repeatEnabled && (
            <div>
              <div style={{ display: "flex", gap: 8 }}>
                {(["weekly", "biweekly"] as const).map(t => (
                  <button key={t} onClick={() => setRepeatType(t)}
                    style={{ flex: 1, padding: "8px", borderRadius: 10, border: `1.5px solid ${repeatType === t ? S.primary : S.border}`, background: repeatType === t ? S.primarySoft : S.surface, fontSize: 13, fontWeight: 700, color: repeatType === t ? S.primary : S.mid, cursor: "pointer" }}>
                    {t === "weekly" ? "Every week" : "Every 2 weeks"}
                  </button>
                ))}
              </div>
              <p style={{ fontSize: 12, color: S.light, margin: "8px 0 0" }}>
                Will apply to the next 4 {repeatType === "weekly" ? "Tuesdays" : "occurrences"}
              </p>
            </div>
          )}
        </div>

        {/* Notes */}
        <Row label="Notes">
          <div style={{ background: S.card, border: `1.5px solid ${notes ? S.borderFocus : S.border}`, borderRadius: 14, overflow: "hidden", boxShadow: notes ? `0 0 0 3px ${S.primarySoft}` : S.shadow }}>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Add a note for this shift… (e.g. open register, cover fitting room)"
              rows={3}
              style={{ width: "100%", padding: "12px 14px", border: "none", background: "transparent", fontSize: 14, color: S.dark, resize: "none", outline: "none", fontFamily: "inherit", boxSizing: "border-box", lineHeight: 1.5 }}
            />
          </div>
        </Row>

        {/* Danger zone */}
        {!showDeleteConfirm ? (
          <button onClick={() => setShowDeleteConfirm(true)}
            style={{ width: "100%", padding: "12px", borderRadius: 14, border: `1.5px solid ${S.red}`, background: S.redSoft, color: S.red, fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 4 }}>
            <Trash2 size={15} />
            Delete this shift
          </button>
        ) : (
          <div style={{ background: S.redSoft, border: `1.5px solid ${S.red}`, borderRadius: 14, padding: 14 }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: S.red, margin: "0 0 4px" }}>Delete this shift?</p>
            <p style={{ fontSize: 12, color: "#8A1A2E", margin: "0 0 12px" }}>
              This will remove {emp.name.split(" ")[0]}'s shift on {days[selectedDay]} {dates[selectedDay]}. This cannot be undone.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setShowDeleteConfirm(false)}
                style={{ flex: 1, padding: "10px", borderRadius: 10, border: `1px solid ${S.border}`, background: S.card, fontSize: 13, fontWeight: 700, color: S.mid, cursor: "pointer" }}>
                Cancel
              </button>
              <button style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", background: S.red, fontSize: 13, fontWeight: 700, color: "#fff", cursor: "pointer" }}>
                Yes, delete
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Fixed bottom action bar */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: S.card, borderTop: `1px solid ${S.border}`, padding: "12px 16px 28px", display: "flex", gap: 10 }}>
        <button style={{ flex: 1, padding: "14px", borderRadius: 14, border: `1.5px solid ${S.border}`, background: S.surface, fontSize: 15, fontWeight: 700, color: S.mid, cursor: "pointer" }}>
          Cancel
        </button>
        <button onClick={handleSave}
          style={{
            flex: 2, padding: "14px", borderRadius: 14, border: "none",
            background: saved ? S.green : S.primary,
            fontSize: 15, fontWeight: 800, color: "#fff", cursor: "pointer",
            boxShadow: `0 4px 14px ${saved ? S.green : S.primary}50`,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            transition: "background 0.3s ease",
          }}>
          {saved ? (
            <>
              <Check size={17} />
              Saved!
            </>
          ) : (
            "Save Changes"
          )}
        </button>
      </div>
    </div>
  );
}
