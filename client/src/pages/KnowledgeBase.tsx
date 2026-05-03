import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BookOpen, Tag, Clock, Sparkles, X, ChevronRight, Layers } from "lucide-react";
import { useDebounce } from "@/hooks/useDebounce";

interface KbArticle {
  id: string;
  title: string;
  summary: string | null;
  content: string | null;
  tags: string[] | null;
  source: string | null;
  categoryName?: string;
  updatedAt: string | null;
  createdAt: string | null;
}

interface KbResponse {
  success: boolean;
  data: KbArticle[];
  tags: string[];
  categories: string[];
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string; accent: string }> = {
  "SOPs": { bg: "bg-blue-50 dark:bg-blue-950/30", text: "text-blue-700 dark:text-blue-300", border: "border-blue-200 dark:border-blue-800/50", accent: "bg-blue-500" },
  "Training": { bg: "bg-violet-50 dark:bg-violet-950/30", text: "text-violet-700 dark:text-violet-300", border: "border-violet-200 dark:border-violet-800/50", accent: "bg-violet-500" },
  "Knowledge Base": { bg: "bg-emerald-50 dark:bg-emerald-950/30", text: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-200 dark:border-emerald-800/50", accent: "bg-emerald-500" },
  "General": { bg: "bg-amber-50 dark:bg-amber-950/30", text: "text-amber-700 dark:text-amber-300", border: "border-amber-200 dark:border-amber-800/50", accent: "bg-amber-500" },
};
function catStyle(name: string) {
  return CATEGORY_COLORS[name] ?? { bg: "bg-muted/60", text: "text-muted-foreground", border: "border-border", accent: "bg-primary" };
}

function ArticleModal({ article, onClose }: { article: KbArticle; onClose: () => void }) {
  const displayTags = (article.tags ?? []).filter(t => t !== "ai-generated" && t !== "knowledge-base");
  const isAI = article.source === "ai_generated";
  const cs = catStyle(article.categoryName ?? "General");

  const renderContent = (content: string | null) => {
    if (!content) return null;
    return content.split("\n").map((line, i) => {
      if (line.startsWith("# ")) return null;
      if (line.startsWith("## ") || line.startsWith("### ")) {
        const text = line.replace(/^#{2,3}\s/, "");
        return <h3 key={i} className="text-sm font-bold text-foreground mt-5 mb-1.5 pb-1 border-b border-border">{text}</h3>;
      }
      if (line.startsWith("**Step ")) {
        return <h4 key={i} className="text-sm font-semibold text-foreground mt-3 mb-1">{line.replace(/\*\*/g, "")}</h4>;
      }
      if (line.startsWith("- ") || line.startsWith("* ")) {
        return (
          <li key={i} className="text-sm text-foreground/85 ml-4 leading-relaxed list-disc my-0.5">
            {line.replace(/^[-*]\s/, "")}
          </li>
        );
      }
      if (line.trim() === "") return <div key={i} className="h-2" />;
      return <p key={i} className="text-sm text-foreground/85 leading-relaxed">{line}</p>;
    });
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto p-0 gap-0">
        <div className={`${cs.bg} ${cs.border} border-b px-6 py-5`}>
          <DialogHeader>
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-xl ${cs.accent} flex items-center justify-center shrink-0 mt-0.5`}>
                <BookOpen className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  {article.categoryName && (
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${cs.text}`}>
                      {article.categoryName}
                    </span>
                  )}
                  {isAI && (
                    <Badge className="text-[10px] py-0 px-1.5 bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 border-0">
                      <Sparkles className="w-2.5 h-2.5 mr-0.5" />AI Generated
                    </Badge>
                  )}
                </div>
                <DialogTitle className="text-lg font-extrabold leading-snug text-foreground">{article.title}</DialogTitle>
                {article.summary && (
                  <p className="text-sm text-muted-foreground leading-relaxed mt-1">{article.summary}</p>
                )}
              </div>
            </div>
          </DialogHeader>
          {(displayTags.length > 0 || article.updatedAt) && (
            <div className="flex items-center gap-3 mt-3 flex-wrap">
              {displayTags.map(tag => (
                <Badge key={tag} variant="outline" className="text-xs px-2 py-0">{tag}</Badge>
              ))}
              {article.updatedAt && (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground ml-auto">
                  <Clock className="w-3 h-3" />Updated {timeAgo(article.updatedAt)}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="px-6 py-5 space-y-1">
          {renderContent(article.content)}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FeaturedCard({ article, onClick }: { article: KbArticle; onClick: () => void }) {
  const isAI = article.source === "ai_generated";
  const cs = catStyle(article.categoryName ?? "General");
  const displayTags = (article.tags ?? []).filter(t => t !== "ai-generated" && t !== "knowledge-base").slice(0, 2);

  return (
    <button
      onClick={onClick}
      data-search-target={`kb:${article.id}`}
      className={`w-full text-left rounded-2xl border ${cs.border} ${cs.bg} overflow-hidden hover:shadow-md transition-all group`}
    >
      <div className={`h-1.5 w-full ${cs.accent}`} />
      <div className="p-5">
        <div className="flex items-center gap-2 mb-2">
          <span className={`text-[10px] font-bold uppercase tracking-widest ${cs.text}`}>
            {article.categoryName ?? "General"}
          </span>
          {isAI && (
            <Badge className="text-[10px] py-0 px-1.5 bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 border-0">
              <Sparkles className="w-2.5 h-2.5 mr-0.5" />AI
            </Badge>
          )}
        </div>
        <h2 className="text-base font-extrabold text-foreground leading-snug mb-2 group-hover:text-primary transition-colors">
          {article.title}
        </h2>
        {article.summary && (
          <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed mb-3">{article.summary}</p>
        )}
        <div className="flex items-center justify-between">
          <div className="flex gap-1.5 flex-wrap">
            {displayTags.map(tag => (
              <span key={tag} className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${cs.bg} ${cs.text} border ${cs.border}`}>{tag}</span>
            ))}
          </div>
          <span className={`flex items-center gap-0.5 text-[10px] font-semibold ${cs.text}`}>
            Read <ChevronRight className="w-3 h-3" />
          </span>
        </div>
      </div>
    </button>
  );
}

function ArticleCard({ article, onClick }: { article: KbArticle; onClick: () => void }) {
  const isAI = article.source === "ai_generated";
  const cs = catStyle(article.categoryName ?? "General");

  return (
    <button
      onClick={onClick}
      data-search-target={`kb:${article.id}`}
      className="w-full text-left rounded-xl border border-border bg-card hover:border-primary/30 hover:shadow-sm transition-all group flex items-start gap-3 p-3.5"
    >
      <div className={`w-2 self-stretch rounded-full ${cs.accent} shrink-0 opacity-70`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <span className="font-semibold text-sm text-foreground leading-snug group-hover:text-primary transition-colors line-clamp-2">{article.title}</span>
          {isAI && (
            <Sparkles className="w-3 h-3 text-orange-400 shrink-0 mt-0.5" />
          )}
        </div>
        {article.summary && (
          <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5 leading-relaxed">{article.summary}</p>
        )}
        <div className="flex items-center gap-2 mt-1.5">
          <span className={`text-[9px] font-bold uppercase tracking-wider ${cs.text}`}>{article.categoryName}</span>
          {article.updatedAt && (
            <span className="text-[10px] text-muted-foreground ml-auto flex items-center gap-0.5">
              <Clock className="w-2.5 h-2.5" />{timeAgo(article.updatedAt)}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

export default function KnowledgeBase() {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<KbArticle | null>(null);
  const debouncedSearch = useDebounce(search, 350);

  const { data, isLoading } = useQuery<KbResponse>({
    queryKey: ["/api/knowledge-base", debouncedSearch || undefined, activeTag || undefined],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("q", debouncedSearch);
      if (activeTag) params.set("tag", activeTag);
      const qs = params.toString();
      const res = await fetch(`/api/knowledge-base${qs ? `?${qs}` : ""}`, { credentials: "include" });
      return res.json();
    },
  });

  const allArticles = data?.data ?? [];
  const tags = data?.tags ?? [];
  const categories = data?.categories ?? [];

  const articles = activeCategory
    ? allArticles.filter(a => a.categoryName === activeCategory)
    : allArticles;

  const featuredArticles = articles.slice(0, 3);
  const restArticles = articles.slice(3);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">

      {/* Article count */}
      {!isLoading && allArticles.length > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {allArticles.length} article{allArticles.length !== 1 ? "s" : ""} across {categories.length} section{categories.length !== 1 ? "s" : ""}
          </span>
          <span className="flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5" />
            {categories.length} section{categories.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {/* Search lives in the Learning Center hero — single, unified box. */}

      {/* Category tabs */}
      {categories.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setActiveCategory(null)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
              !activeCategory
                ? "bg-foreground text-background border-foreground"
                : "bg-muted text-muted-foreground border-border hover:border-foreground/30"
            }`}
          >
            All
          </button>
          {categories.map(cat => {
            const cs = catStyle(cat);
            const active = activeCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(prev => prev === cat ? null : cat)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                  active ? `${cs.bg} ${cs.text} ${cs.border}` : "bg-muted text-muted-foreground border-border hover:border-foreground/30"
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>
      )}

      {/* Tag pills */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map(tag => (
            <button
              key={tag}
              onClick={() => setActiveTag(prev => prev === tag ? null : tag)}
              className={`inline-flex items-center gap-1 text-[10px] font-medium px-2.5 py-1 rounded-full border transition-colors ${
                activeTag === tag
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/60 text-muted-foreground border-border hover:border-primary/40"
              }`}
            >
              <Tag className="w-2.5 h-2.5" />{tag}
              {activeTag === tag && <X className="w-2.5 h-2.5 ml-0.5" />}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-44 rounded-2xl" />)}
          </div>
          <div className="space-y-2">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}
          </div>
        </div>
      ) : articles.length === 0 ? (
        <div className="text-center py-20 space-y-4">
          <div className="w-16 h-16 rounded-3xl bg-muted flex items-center justify-center mx-auto">
            <BookOpen className="w-8 h-8 text-muted-foreground/50" />
          </div>
          <div>
            <p className="font-bold text-foreground text-lg">
              {search || activeTag || activeCategory ? "No articles found" : "Your library is empty"}
            </p>
            <p className="text-sm text-muted-foreground max-w-xs mx-auto mt-1 leading-relaxed">
              {search || activeTag || activeCategory
                ? "Try clearing your search or filters."
                : "Head to AI Studio, generate content from your uploaded documents, then click \"Approve & Publish All\" to fill this library instantly."}
            </p>
          </div>
          {(activeCategory || activeTag) && (
            <button
              onClick={() => { setActiveCategory(null); setActiveTag(null); }}
              className="text-xs text-primary underline-offset-2 hover:underline"
            >
              Clear all filters
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">

          {/* Result count when filtering */}
          {(search || activeTag || activeCategory) && (
            <p className="text-xs text-muted-foreground">
              {articles.length} result{articles.length !== 1 ? "s" : ""}
              {search ? ` for "${search}"` : ""}
              {activeCategory ? ` in ${activeCategory}` : ""}
              {activeTag ? ` tagged "${activeTag}"` : ""}
            </p>
          )}

          {/* Featured row — first 3 articles as large cards */}
          {featuredArticles.length > 0 && (
            <div className={`grid gap-3 ${featuredArticles.length === 1 ? "grid-cols-1" : featuredArticles.length === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-3"}`}>
              {featuredArticles.map(article => (
                <FeaturedCard key={article.id} article={article} onClick={() => setSelectedArticle(article)} />
              ))}
            </div>
          )}

          {/* Remaining articles as compact list rows */}
          {restArticles.length > 0 && (
            <div className="space-y-2">
              {!search && !activeCategory && !activeTag && (
                <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider mb-3">
                  More articles
                </p>
              )}
              {restArticles.map(article => (
                <ArticleCard key={article.id} article={article} onClick={() => setSelectedArticle(article)} />
              ))}
            </div>
          )}

        </div>
      )}

      {selectedArticle && (
        <ArticleModal article={selectedArticle} onClose={() => setSelectedArticle(null)} />
      )}
    </div>
  );
}
