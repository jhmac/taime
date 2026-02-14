import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Store } from 'lucide-react';
import type { PosConnectionSectionProps } from '@/components/settings/types';

export default function PosConnectionSection({
  shopifyDomain,
  setShopifyDomain,
  connectedShop,
  connectShopifyMutation,
  disconnectShopifyMutation,
  syncSalesMutation,
  salesData,
}: PosConnectionSectionProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Store className="w-5 h-5" /> Shopify Integration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {connectedShop ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 border rounded-lg bg-green-50 dark:bg-green-900/10">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                    <Store className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">{connectedShop.shopDomain}</p>
                    <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">Connected</Badge>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => syncSalesMutation.mutate(connectedShop.shopDomain)} disabled={syncSalesMutation.isPending}>
                    {syncSalesMutation.isPending ? 'Syncing...' : 'Sync Sales'}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => disconnectShopifyMutation.mutate(connectedShop.shopDomain)} disabled={disconnectShopifyMutation.isPending}>
                    Disconnect
                  </Button>
                </div>
              </div>
              {salesData && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="p-3 border rounded-lg text-center">
                    <p className="text-2xl font-bold">{salesData.totalOrders || 0}</p>
                    <p className="text-xs text-muted-foreground">Total Orders</p>
                  </div>
                  <div className="p-3 border rounded-lg text-center">
                    <p className="text-2xl font-bold">${(salesData.totalRevenue || 0).toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Total Revenue</p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Connect your Shopify store to sync sales data and get AI-powered staffing recommendations.</p>
              <div className="flex gap-2">
                <Input placeholder="your-store.myshopify.com" value={shopifyDomain} onChange={e => setShopifyDomain(e.target.value)} />
                <Button onClick={() => connectShopifyMutation.mutate(shopifyDomain)} disabled={!shopifyDomain || connectShopifyMutation.isPending}>
                  {connectShopifyMutation.isPending ? 'Connecting...' : 'Connect'}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
