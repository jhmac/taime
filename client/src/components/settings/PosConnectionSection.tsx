import { useState, useEffect, useRef, useCallback } from 'react';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Store, ExternalLink, RefreshCw, Unlink, TrendingUp, ShoppingCart, Wifi, WifiOff, Database, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { PosConnectionSectionProps } from '@/components/settings/types';

function formatTimeAgo(date: string | Date | null): string {
  if (!date) return 'Never';
  const d = new Date(date);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'Just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

export default function PosConnectionSection({
  shopifyDomain,
  setShopifyDomain,
  connectedShop,
  connectShopifyMutation,
  disconnectShopifyMutation,
  syncSalesMutation,
  salesData,
}: PosConnectionSectionProps) {
  const { toast } = useToast();
  const [storeName, setStoreName] = useState('');
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<{
    live: boolean;
    shopName?: string | null;
    lastSyncAt?: string | Date | null;
    error?: string;
  } | null>(null);

  // Backfill range state
  const [backfillStart, setBackfillStart] = useState('');
  const [backfillEnd, setBackfillEnd] = useState('');
  const [backfillPending, setBackfillPending] = useState(false);
  const [backfillResult, setBackfillResult] = useState<{
    ordersProcessed: number;
    daysSynced: number;
    dateRange: { from: string; to: string };
  } | null>(null);
  const [backfillError, setBackfillError] = useState<string | null>(null);
  const [backfillProgress, setBackfillProgress] = useState<{
    chunksCompleted: number;
    totalChunks: number;
    ordersProcessed: number;
  } | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Default to the known historical gap that breaks the Sales vs. Goal engine
  useEffect(() => {
    if (!connectedShop) return;
    setBackfillStart('2025-05-07');
    setBackfillEnd('2025-10-03');
  }, [connectedShop?.shopDomain]);

  // Polling effect: starts/stops based on activeJobId; cleans up on unmount or when jobId changes
  useEffect(() => {
    if (!activeJobId) return;

    const poll = async () => {
      try {
        const statusRes = await apiRequest('GET', `/api/shopify/backfill-status/${activeJobId}`);
        if (!statusRes.ok) {
          setActiveJobId(null);
          setBackfillPending(false);
          setBackfillError('Lost track of the backfill job. It may still be running in the background.');
          return;
        }
        const job = await statusRes.json();
        setBackfillProgress({
          chunksCompleted: job.chunksCompleted,
          totalChunks: job.totalChunks,
          ordersProcessed: job.ordersProcessed,
        });

        if (job.status === 'done') {
          setActiveJobId(null);
          setBackfillPending(false);
          setBackfillProgress(null);
          setBackfillResult({
            ordersProcessed: job.ordersProcessed,
            daysSynced: job.daysSynced,
            dateRange: job.dateRange,
          });
          toast({
            title: 'Backfill complete',
            description: `Pulled ${job.ordersProcessed.toLocaleString()} orders across ${job.daysSynced} days.`,
          });
        } else if (job.status === 'error') {
          setActiveJobId(null);
          setBackfillPending(false);
          setBackfillProgress(null);
          const msg = job.error || 'An error occurred during the backfill.';
          setBackfillError(`Failed after ${job.chunksCompleted} of ${job.totalChunks} chunks (${job.ordersProcessed.toLocaleString()} orders synced so far). ${msg}`);
          toast({ title: 'Backfill failed', description: msg, variant: 'destructive' });
        }
      } catch {
        // transient network error — keep polling
      }
    };

    poll(); // immediate first tick so UI shows progress without waiting 2s
    pollIntervalRef.current = setInterval(poll, 2000);
    return () => {
      if (pollIntervalRef.current !== null) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [activeJobId]);

  async function runConnectionTest(showToast = false) {
    setTestingConnection(true);
    try {
      const res = await apiRequest('GET', '/api/shopify/connection-status');
      const data = await res.json();
      setConnectionStatus(data);
      if (showToast) {
        if (data.live) {
          toast({
            title: 'Connection confirmed',
            description: `${data.shopName || data.shopDomain || 'Your Shopify store'} is live and reachable.`,
          });
        } else {
          toast({
            title: 'Connection issue',
            description: data.error || 'Could not reach Shopify. The token may have expired — try reconnecting.',
            variant: 'destructive',
          });
        }
      }
    } catch (err: any) {
      const errMsg = err?.message || 'Failed to reach server';
      setConnectionStatus({ live: false, error: errMsg });
      if (showToast) {
        toast({ title: 'Connection failed', description: errMsg, variant: 'destructive' });
      }
    } finally {
      setTestingConnection(false);
    }
  }

  useEffect(() => {
    if (connectedShop) {
      runConnectionTest();
    } else {
      setConnectionStatus(null);
    }
  }, [connectedShop?.shopDomain]);

  function handleConnect() {
    const raw = storeName.trim();
    if (!raw) return;
    const domain = raw.includes('.myshopify.com')
      ? raw.toLowerCase()
      : `${raw.toLowerCase()}.myshopify.com`;
    setShopifyDomain(domain);
    connectShopifyMutation.mutate(domain);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleConnect();
  }

  const handleBackfillRange = useCallback(async () => {
    if (!connectedShop || !backfillStart || !backfillEnd) return;
    setBackfillPending(true);
    setBackfillResult(null);
    setBackfillError(null);
    setBackfillProgress(null);

    try {
      const res = await apiRequest('POST', '/api/shopify/backfill-range', {
        shopDomain: connectedShop.shopDomain,
        startDate: backfillStart,
        endDate: backfillEnd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.message || `Server error ${res.status}`);
      }
      const { jobId } = await res.json();
      // Triggers the polling useEffect
      setActiveJobId(jobId);
    } catch (err: any) {
      setBackfillPending(false);
      const msg = err.message || 'Could not fetch historical data from Shopify.';
      setBackfillError(msg);
      toast({ title: 'Backfill failed', description: msg, variant: 'destructive' });
    }
  }, [connectedShop, backfillStart, backfillEnd, toast]);

  const backfillDiffDays = backfillStart && backfillEnd
    ? Math.ceil((new Date(backfillEnd).getTime() - new Date(backfillStart).getTime()) / (24 * 60 * 60 * 1000))
    : 0;
  const estimatedMinutes = backfillDiffDays > 0 ? Math.ceil(backfillDiffDays / 60) : 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Store className="w-5 h-5" /> Shopify Integration
          </CardTitle>
          <CardDescription>
            Connect your Shopify store to unlock AI-powered staffing recommendations based on your real sales data.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {connectedShop ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 border rounded-lg bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                    <Store className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-green-900 dark:text-green-100">{connectedShop.shopName || connectedShop.shopDomain}</p>
                    <p className="text-xs text-green-700 dark:text-green-400">{connectedShop.shopDomain}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 text-xs">
                        Connected
                      </Badge>
                      {connectionStatus !== null && (
                        connectionStatus.live ? (
                          <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 text-xs flex items-center gap-1">
                            <Wifi className="w-3 h-3" /> Live
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="text-xs flex items-center gap-1">
                            <WifiOff className="w-3 h-3" />
                            {connectionStatus.error ? 'Connection error' : 'Unreachable'}
                          </Badge>
                        )
                      )}
                    </div>
                    {connectionStatus?.lastSyncAt && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Last synced {formatTimeAgo(connectionStatus.lastSyncAt)}
                      </p>
                    )}
                    {connectionStatus?.live === false && connectionStatus?.error && (
                      <p className="text-xs text-red-600 dark:text-red-400 mt-1 max-w-xs truncate" title={connectionStatus.error}>
                        {connectionStatus.error}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0 flex-col items-end">
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => runConnectionTest(true)}
                      disabled={testingConnection}
                      className="gap-1.5"
                    >
                      <Wifi className={`w-3.5 h-3.5 ${testingConnection ? 'animate-pulse' : ''}`} />
                      {testingConnection ? 'Testing…' : 'Test Connection'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => syncSalesMutation.mutate(connectedShop.shopDomain)}
                      disabled={syncSalesMutation.isPending}
                      className="gap-1.5"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${syncSalesMutation.isPending ? 'animate-spin' : ''}`} />
                      {syncSalesMutation.isPending ? 'Syncing…' : 'Sync Sales'}
                    </Button>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => disconnectShopifyMutation.mutate(connectedShop.shopDomain)}
                    disabled={disconnectShopifyMutation.isPending}
                    className="gap-1.5 text-red-600 hover:text-red-700 border-red-200 hover:border-red-300"
                  >
                    <Unlink className="w-3.5 h-3.5" />
                    Disconnect
                  </Button>
                </div>
              </div>

              {salesData && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-4 border rounded-lg flex items-center gap-3">
                    <ShoppingCart className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    <div>
                      <p className="text-2xl font-bold">
                        {((salesData.summary?.totalOrders ?? salesData.totalOrders) || 0).toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">Total Orders Synced</p>
                    </div>
                  </div>
                  <div className="p-4 border rounded-lg flex items-center gap-3">
                    <TrendingUp className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    <div>
                      <p className="text-2xl font-bold">
                        ${((salesData.summary?.totalRevenue ?? salesData.totalRevenue) || 0).toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">Total Revenue</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border border-dashed p-6 bg-muted/30 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-[#96bf48]/10 flex items-center justify-center mx-auto">
                  <Store className="w-6 h-6 text-[#96bf48]" />
                </div>
                <div>
                  <p className="font-medium text-sm">Connect your Shopify store</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    You'll be redirected to Shopify to authorize access. Once connected, Taime will sync your sales data automatically.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Store name</label>
                <div className="flex gap-2 items-center">
                  <div className="flex-1 flex items-center border rounded-md overflow-hidden focus-within:ring-2 focus-within:ring-ring">
                    <Input
                      className="border-0 ring-0 focus-visible:ring-0 rounded-none"
                      placeholder="your-store"
                      value={storeName}
                      onChange={e => setStoreName(e.target.value)}
                      onKeyDown={handleKeyDown}
                      disabled={connectShopifyMutation.isPending}
                    />
                    <span className="px-3 text-sm text-muted-foreground bg-muted border-l py-2 whitespace-nowrap">.myshopify.com</span>
                  </div>
                  <Button
                    onClick={handleConnect}
                    disabled={!storeName.trim() || connectShopifyMutation.isPending}
                    className="gap-2 bg-[#96bf48] hover:bg-[#7ea33c] text-white flex-shrink-0"
                  >
                    <ExternalLink className="w-4 h-4" />
                    {connectShopifyMutation.isPending ? 'Opening…' : 'Connect'}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  A Shopify authorization window will open. Click <strong>Install</strong> to grant access.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Historical Data Backfill — only shown when connected */}
      {connectedShop && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Database className="w-5 h-5" /> Historical Data Backfill
            </CardTitle>
            <CardDescription>
              The Sales vs. Goal panel compares today to the same day last year. If that data is missing, the goal will use an older date instead. Use this to fill in any gaps.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/10 p-3 flex gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-amber-800 dark:text-amber-300 space-y-1">
                <p className="font-medium">Gap detected in historical data</p>
                <p>
                  Your database is missing sales data from approximately <strong>May 7 – Oct 3, 2025</strong>. Today's goal engine is falling back to April 30, 2025 instead of the correct same-week date from last year.
                  Run the backfill below to fetch the missing period from Shopify.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Start date</label>
                <Input
                  type="date"
                  value={backfillStart}
                  onChange={e => setBackfillStart(e.target.value)}
                  disabled={backfillPending}
                  max={backfillEnd || undefined}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">End date</label>
                <Input
                  type="date"
                  value={backfillEnd}
                  onChange={e => setBackfillEnd(e.target.value)}
                  disabled={backfillPending}
                  min={backfillStart || undefined}
                />
              </div>
            </div>

            {backfillDiffDays > 0 && (
              <p className="text-xs text-muted-foreground">
                {backfillDiffDays} day{backfillDiffDays !== 1 ? 's' : ''} selected
                {estimatedMinutes > 0 && ` · typically takes ~${estimatedMinutes} minute${estimatedMinutes !== 1 ? 's' : ''}`}
              </p>
            )}

            <Button
              onClick={handleBackfillRange}
              disabled={backfillPending || !backfillStart || !backfillEnd || backfillDiffDays <= 0 || backfillDiffDays > 730}
              className="w-full gap-2"
            >
              <Database className={`w-4 h-4 ${backfillPending ? 'animate-pulse' : ''}`} />
              {backfillPending
                ? backfillProgress
                  ? `Syncing chunk ${backfillProgress.chunksCompleted + 1} of ${backfillProgress.totalChunks} — ${backfillProgress.ordersProcessed.toLocaleString()} orders so far…`
                  : 'Starting backfill…'
                : 'Backfill Historical Data'}
            </Button>

            {backfillPending && backfillProgress && (
              <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-primary h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${Math.round((backfillProgress.chunksCompleted / backfillProgress.totalChunks) * 100)}%` }}
                />
              </div>
            )}

            {backfillError && (
              <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/10 p-3 flex gap-2.5">
                <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-red-800 dark:text-red-300">
                  <p className="font-medium">Backfill failed</p>
                  <p>{backfillError}</p>
                </div>
              </div>
            )}

            {backfillResult && (
              <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/10 p-3 flex gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-green-800 dark:text-green-300">
                  <p className="font-medium">Backfill complete</p>
                  <p>
                    Pulled <strong>{backfillResult.ordersProcessed.toLocaleString()}</strong> orders across{' '}
                    <strong>{backfillResult.daysSynced}</strong> days
                    ({backfillResult.dateRange.from} → {backfillResult.dateRange.to}).
                  </p>
                  <p className="mt-1">The Sales vs. Goal panel will now use the correct date from last year.</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
