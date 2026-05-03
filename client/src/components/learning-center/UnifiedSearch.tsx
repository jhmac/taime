import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Search, X, GraduationCap, BookMarked, FileText, History, Film, Loader2 } from "lucide-react";
import { useDebounce } from "@/hooks/useDebounce";
import { cn } from "@/lib/utils";
import type { TrainingModule } from "@shared/schema";

type Group = "modules" | "kb" | "sops" | "revisions" | "videos";

interface KbArticle {
  id: string;
  title: string;
  summary: string | null;
  tags: string[] | null;
  categoryName?: string;
}
interface KbResponse { data: KbArticle[] }
interface Revision {
  id: string;
  title: string;
  description: string;
  sopTitle: string | null;
  sopTemplateId: string;
  status: string;
}
interface VideoLite {
  id: string;
  title: string;
  description: string | null;
  category: string;
}
interface VideoFeed { videos: VideoLite[] }

interface ResultItem {
  group: Group;
  id: string;
  title: string;
  subtitle?: string | null;
  href: string;
}

const GROUP_META: Record<Group, { label: string; icon: any; color: string }> = {
  modules:   { label: "Modules",   icon: GraduationCap, color: "text-violet-600 dark:text-violet-400" },
  kb:        { label: "Docs",      icon: BookMarked,    color: "text-emerald-600 dark:text-emerald-400" },
  sops:      { label: "SOPs",      icon: FileText,      color: "text-blue-600 dark:text-blue-400" },
  revisions: { label: "Revisions", icon: History,       color: "text-amber-600 dark:text-amber-400" },
  videos:    { label: "Videos",    icon: Film,          color: "text-orange-600 dark:text-orange-400" },
};

const GROUP_ORDER: Group[] = ["modules", "kb", "sops", "revisions", "videos"];

function matches(q: string, ...fields: (string | null | undefined)[]): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return false;
  return fields.some(f => (f || "").toLowerCase().includes(needle));
}

export default function UnifiedSearch() {
  const [, navigate] = useLocation();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounced = useDebounce(query, 200);
  const enabled = debounced.trim().length >= 2;

  const modulesQ = useQuery<TrainingModule[]>({ queryKey: ["/api/training/modules"], enabled });
  const kbQ = useQuery<KbResponse>({ queryKey: ["/api/knowledge-base"], enabled });
  const revisionsQ = useQuery<Revision[]>({
    queryKey: ["/api/sops/revisions", "search-all"],
    queryFn: async () => {
      // Fetch all statuses so search covers the full revisions history.
      const [pending, approved, rejected] = await Promise.all(
        ["pending", "approved", "rejected"].map(async s => {
          const res = await fetch(`/api/sops/revisions?status=${s}`, { credentials: "include" });
          if (!res.ok) return [] as Revision[];
          return res.json() as Promise<Revision[]>;
        })
      );
      return [...pending, ...approved, ...rejected];
    },
    enabled,
  });
  const videosQ = useQuery<VideoFeed>({
    queryKey: ["/api/videos", "search-all"],
    queryFn: async () => {
      const res = await fetch("/api/videos?sort_by=recent&limit=100", { credentials: "include" });
      if (!res.ok) return { videos: [] };
      return res.json();
    },
    enabled,
  });

  const isLoading =
    enabled &&
    (modulesQ.isLoading || kbQ.isLoading || revisionsQ.isLoading || videosQ.isLoading);

  const grouped: Record<Group, ResultItem[]> = useMemo(() => {
    const out: Record<Group, ResultItem[]> = { modules: [], kb: [], sops: [], revisions: [], videos: [] };
    if (!enabled) return out;
    const q = debounced;

    (modulesQ.data || []).filter(m => m.isActive).forEach(m => {
      if (matches(q, m.title, m.description)) {
        out.modules.push({
          group: "modules", id: m.id, title: m.title, subtitle: m.description ?? null,
          href: `/learning?focus=module:${m.id}`,
        });
      }
    });
    // Knowledge-base endpoint returns ALL published documents in this store
    // (KB articles, SOPs, training docs, …). Split into the SOPs group when
    // the document lives in the "SOPs" category, otherwise the Docs group.
    // Both navigate to the Knowledge Base tab where they're rendered.
    (kbQ.data?.data || []).forEach(a => {
      if (!matches(q, a.title, a.summary, (a.tags || []).join(" "), a.categoryName)) return;
      const isSop = (a.categoryName || "").toLowerCase() === "sops";
      const item: ResultItem = {
        group: isSop ? "sops" : "kb",
        id: a.id,
        title: a.title,
        subtitle: a.summary ?? a.categoryName ?? null,
        href: `/learning?tab=knowledge-base&focus=kb:${a.id}`,
      };
      if (isSop) out.sops.push(item); else out.kb.push(item);
    });
    (revisionsQ.data || []).forEach(r => {
      if (matches(q, r.title, r.description, r.sopTitle)) {
        out.revisions.push({
          group: "revisions", id: r.id, title: r.title,
          subtitle: r.sopTitle ? `for ${r.sopTitle}` : r.description,
          href: `/learning?tab=sop-revisions&focus=revision:${r.id}`,
        });
      }
    });
    (videosQ.data?.videos || []).forEach(v => {
      if (matches(q, v.title, v.description, v.category.replaceAll("_", " "))) {
        out.videos.push({
          group: "videos", id: v.id, title: v.title,
          subtitle: v.description ?? v.category.replaceAll("_", " "),
          href: `/learning?tab=improvements&focus=video:${v.id}`,
        });
      }
    });

    GROUP_ORDER.forEach(g => { out[g] = out[g].slice(0, 5); });
    return out;
  }, [enabled, debounced, modulesQ.data, kbQ.data, revisionsQ.data, videosQ.data]);

  const flat = useMemo<ResultItem[]>(
    () => GROUP_ORDER.flatMap(g => grouped[g]),
    [grouped]
  );
  const total = flat.length;

  useEffect(() => { setActiveIndex(0); }, [debounced]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function selectItem(item: ResultItem) {
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    navigate(item.href);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!open || total === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex(i => (i + 1) % total);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(i => (i - 1 + total) % total);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flat[activeIndex];
      if (item) selectItem(item);
    }
  }

  let cursor = -1;

  return (
    <div ref={wrapRef} className="relative w-full" data-testid="learning-center-search">
      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/70 pointer-events-none" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { if (query) setOpen(true); }}
        onKeyDown={onKeyDown}
        placeholder="Search modules, docs, SOPs, revisions, videos…"
        aria-label="Search the Learning Center"
        className="w-full h-11 pl-10 pr-9 rounded-xl bg-white/15 hover:bg-white/20 focus:bg-white/25 backdrop-blur border border-white/25 placeholder:text-white/60 text-white text-sm outline-none focus:ring-2 focus:ring-white/40 transition"
        data-testid="learning-center-search-input"
      />
      {query && (
        <button
          type="button"
          onClick={() => { setQuery(""); inputRef.current?.focus(); }}
          aria-label="Clear search"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/70 hover:text-white p-1"
        >
          <X className="w-4 h-4" />
        </button>
      )}

      {open && enabled && (
        <div
          role="listbox"
          className="absolute left-0 right-0 mt-2 z-50 max-h-[420px] overflow-y-auto rounded-xl border bg-popover text-popover-foreground shadow-2xl"
          data-testid="learning-center-search-results"
        >
          {isLoading && total === 0 ? (
            <div className="py-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Searching…
            </div>
          ) : total === 0 ? (
            <div className="py-8 px-4 text-center">
              <p className="text-sm font-medium text-foreground">No results for "{debounced}"</p>
              <p className="text-xs text-muted-foreground mt-1">
                Try a different keyword across modules, docs, SOPs, revisions or videos.
              </p>
            </div>
          ) : (
            <div className="py-1">
              {GROUP_ORDER.map(g => {
                const items = grouped[g];
                if (items.length === 0) return null;
                const meta = GROUP_META[g];
                const Icon = meta.icon;
                return (
                  <div key={g} className="py-1">
                    <div className="px-3 pt-2 pb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      <Icon className={cn("w-3.5 h-3.5", meta.color)} /> {meta.label}
                    </div>
                    {items.map(item => {
                      cursor++;
                      const active = cursor === activeIndex;
                      return (
                        <button
                          key={`${g}-${item.id}`}
                          type="button"
                          role="option"
                          aria-selected={active}
                          onMouseEnter={() => setActiveIndex(cursor)}
                          onClick={() => selectItem(item)}
                          className={cn(
                            "w-full text-left px-3 py-2 flex items-start gap-2.5 transition-colors",
                            active ? "bg-muted" : "hover:bg-muted/60"
                          )}
                          data-testid={`search-result-${g}-${item.id}`}
                        >
                          <Icon className={cn("w-4 h-4 mt-0.5 shrink-0", meta.color)} />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-foreground truncate">{item.title}</p>
                            {item.subtitle && (
                              <p className="text-xs text-muted-foreground truncate">{item.subtitle}</p>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Hook for use inside LearningCenter — looks for a `?focus=type:id` query
 * param, scrolls to the matching `data-search-target` element and flashes it.
 * Retries for a short window so it works even when the target tab's data is
 * still loading. Strips the param afterwards.
 */
export function useSearchFocus(searchString: string) {
  const [, navigate] = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const focus = params.get("focus");
    if (!focus) return;

    let attempts = 0;
    let cancelled = false;
    const tab = params.get("tab");

    const tryFocus = () => {
      if (cancelled) return;
      attempts += 1;
      const el = document.querySelector(`[data-search-target="${CSS.escape(focus)}"]`) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.remove("search-highlight-flash");
        // restart animation
        void el.offsetWidth;
        el.classList.add("search-highlight-flash");
        setTimeout(() => el.classList.remove("search-highlight-flash"), 2000);

        // strip focus param while preserving tab
        const next = tab ? `/learning?tab=${tab}` : "/learning";
        navigate(next, { replace: true });
        return;
      }
      if (attempts < 25) setTimeout(tryFocus, 200);
    };

    const initial = setTimeout(tryFocus, 150);
    return () => { cancelled = true; clearTimeout(initial); };
  }, [searchString, navigate]);
}
