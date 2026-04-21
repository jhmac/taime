import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Search, BookOpen, Tag, Clock, Sparkles, Library, FileText, X } from "lucide-react";
import { useDebounce } from "@/hooks/useDebounce";

interface KbArticle {
  id: string;
  title: string;
  summary: string | null;
  content: string | null;
  tags: string[] | null;
  source: string | null;
  updatedAt: string | null;
  createdAt: string | null;
}

interface KbResponse {
  success: boolean;
  data: KbArticle[];
  tags: string[];
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function ArticleCard({ article, onClick }: { article: KbArticle; onClick: () => void }) {
  const isAI = article.source === "ai_generated";
  const displayTags = (article.tags ?? []).filter(t => t !== "ai-generated" && t !== "knowledge-base").slice(0, 3);

  return (
    <button
      onClick={onClick}
      className="w-full text-left p-4 rounded-2xl border border-border bg-card hover:border-primary/40 hover:shadow-sm transition-all group"
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 mt-0.5 group-hover:bg-primary/20 transition-colors">
          <FileText className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-semibold text-sm text-foreground truncate">{article.title}</span>
            {isAI && (
              <Badge className="text-[10px] py-0 px-1.5 bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 border-0 shrink-0">
                <Sparkles className="w-2.5 h-2.5 mr-0.5" />AI
              </Badge>
            )}
          </div>
          {article.summary && (
            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{article.summary}</p>
          )}
          <div className="flex items-center gap-3 mt-2">
            {displayTags.map(tag => (
              <span key={tag} className="flex items-center gap-0.5 text-[10px] text-muted-foreground font-medium">
                <Tag className="w-2.5 h-2.5" />{tag}
              </span>
            ))}
            {article.updatedAt && (
              <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground ml-auto">
                <Clock className="w-2.5 h-2.5" />{timeAgo(article.updatedAt)}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

function ArticleModal({ article, onClose }: { article: KbArticle; onClose: () => void }) {
  const displayTags = (article.tags ?? []).filter(t => t !== "ai-generated" && t !== "knowledge-base");
  const isAI = article.source === "ai_generated";

  const renderContent = (content: string | null) => {
    if (!content) return null;
    const lines = content.split("\n");
    return lines.map((line, i) => {
      if (line.startsWith("# ")) return null;
      if (line.startsWith("## ") || line.startsWith("### ")) {
        const text = line.replace(/^#{2,3}\s/, "");
        return <h3 key={i} className="text-sm font-bold text-foreground mt-4 mb-1">{text}</h3>;
      }
      if (line.startsWith("- ") || line.startsWith("* ")) {
        return (
          <li key={i} className="text-sm text-foreground/90 ml-3 leading-relaxed list-disc">
            {line.replace(/^[-*]\s/, "")}
          </li>
        );
      }
      if (line.trim() === "") return <div key={i} className="h-2" />;
      return <p key={i} className="text-sm text-foreground/90 leading-relaxed">{line}</p>;
    });
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2 flex-wrap">
            <DialogTitle className="text-base font-bold leading-snug">{article.title}</DialogTitle>
            {isAI && (
              <Badge className="text-[10px] py-0 px-1.5 bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 border-0">
                <Sparkles className="w-2.5 h-2.5 mr-0.5" />AI Generated
              </Badge>
            )}
          </div>
          {article.summary && (
            <p className="text-sm text-muted-foreground leading-relaxed mt-1">{article.summary}</p>
          )}
          {displayTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {displayTags.map(tag => (
                <Badge key={tag} variant="outline" className="text-xs px-2 py-0">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </DialogHeader>
        <div className="mt-2 space-y-1">
          {renderContent(article.content)}
        </div>
        {article.updatedAt && (
          <p className="text-xs text-muted-foreground mt-4 pt-3 border-t border-border">
            Last updated {timeAgo(article.updatedAt)}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function KnowledgeBase() {
  const [search, setSearch] = useState("");
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

  const articles = data?.data ?? [];
  const tags = data?.tags ?? [];

  const handleTagClick = (tag: string) => {
    setActiveTag(prev => (prev === tag ? null : tag));
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-primary/15 flex items-center justify-center">
          <Library className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-extrabold text-foreground">Knowledge Base</h1>
          <p className="text-xs text-muted-foreground">Reference articles and AI-generated guides</p>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search articles..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9 rounded-xl"
        />
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tags.map(tag => (
            <button
              key={tag}
              onClick={() => handleTagClick(tag)}
              className={`inline-flex items-center gap-1 text-xs font-medium px-3 py-1 rounded-full border transition-colors ${
                activeTag === tag
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
              }`}
            >
              <Tag className="w-3 h-3" />
              {tag}
              {activeTag === tag && <X className="w-3 h-3 ml-0.5" />}
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-20 w-full rounded-2xl" />
          ))}
        </div>
      ) : articles.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mx-auto">
            <BookOpen className="w-7 h-7 text-muted-foreground" />
          </div>
          <p className="font-semibold text-foreground">
            {search || activeTag ? "No articles matched your filters" : "No knowledge base articles yet"}
          </p>
          <p className="text-sm text-muted-foreground max-w-xs mx-auto">
            {search || activeTag
              ? "Try clearing your search or selected filter."
              : "Upload documents in AI Studio and approve Knowledge Base items to populate this library."}
          </p>
          {activeTag && (
            <button
              onClick={() => setActiveTag(null)}
              className="text-xs text-primary underline-offset-2 hover:underline"
            >
              Clear filter
            </button>
          )}
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground font-medium">
            {articles.length} article{articles.length !== 1 ? "s" : ""}
            {search ? ` matching "${search}"` : ""}
            {activeTag ? ` tagged "${activeTag}"` : ""}
          </p>
          <div className="space-y-2">
            {articles.map(article => (
              <ArticleCard
                key={article.id}
                article={article}
                onClick={() => setSelectedArticle(article)}
              />
            ))}
          </div>
        </>
      )}

      {selectedArticle && (
        <ArticleModal article={selectedArticle} onClose={() => setSelectedArticle(null)} />
      )}
    </div>
  );
}
