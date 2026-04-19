import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Quote } from 'lucide-react';
import ErrorWithRetry from '@/components/ErrorWithRetry';
import { useOnlineRetry } from '@/hooks/useOnlineRetry';

interface QuoteData {
  quoteText: string;
  quoteAuthor: string;
}

export default function DailyQuoteCard() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery<{ success: boolean; data: QuoteData }>({
    queryKey: ['/api/rituals/quote/today'],
    staleTime: 5 * 60 * 1000,
  });

  const quote = data?.data;

  useOnlineRetry(refetch, isError);

  if (isLoading) {
    return (
      <Card className="overflow-hidden">
        <CardContent className="p-5">
          <Skeleton className="h-4 w-3/4 mb-2" />
          <Skeleton className="h-4 w-1/2" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return <ErrorWithRetry onRetry={() => refetch()} message="Failed to load daily quote" isRetrying={isFetching} />;
  }

  const text = quote?.quoteText || "Every day is a chance to get a little better.";
  const author = quote?.quoteAuthor || "Unknown";

  return (
    <Card className="overflow-hidden bg-gradient-to-br from-violet-50 via-purple-50 to-fuchsia-50 dark:from-violet-950/20 dark:via-purple-950/20 dark:to-fuchsia-950/20 border-violet-200/50 dark:border-violet-800/30">
      <CardContent className="p-5 relative">
        <Quote className="absolute top-3 right-3 h-8 w-8 text-violet-200 dark:text-violet-800/40" />
        <p className="text-base md:text-lg font-serif italic leading-relaxed text-foreground pr-8">
          "{text}"
        </p>
        <p className="text-xs font-medium text-violet-600 dark:text-violet-400 mt-3">
          — {author}
        </p>
      </CardContent>
    </Card>
  );
}
