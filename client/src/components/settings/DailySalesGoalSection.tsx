import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Target, TrendingUp, ArrowRight, ShoppingBag, Info } from 'lucide-react';
import type { SettingsSectionProps } from '@/components/settings/types';

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default function DailySalesGoalSection({ settingsForm, updateForm }: SettingsSectionProps) {
  const enabled = !!settingsForm.dailySalesGoalEnabled;
  const increaseType: string = settingsForm.salesGoalIncreaseType || 'percentage';
  const increaseValue: number = parseFloat(settingsForm.salesGoalIncreaseValue || '0') || 0;

  const { data: goalData } = useQuery<any>({
    queryKey: ['/api/dashboard/daily-goal'],
    enabled,
  });

  const lastYearRevenue: number = goalData?.lastYearRevenue ?? 0;
  const hasLastYearData = goalData?.hasGoal && lastYearRevenue > 0;
  const dayName: string = goalData?.dayName ?? 'today';

  const previewIncreaseAmount = hasLastYearData
    ? increaseType === 'percentage'
      ? Math.round(lastYearRevenue * (increaseValue / 100) * 100) / 100
      : increaseValue
    : 0;
  const previewGoal = hasLastYearData ? lastYearRevenue + previewIncreaseAmount : 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            Daily Sales Goal
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">
            When enabled, a sales goal is shown on the team dashboard every day. The goal is based on
            the same day of the week from last year, so the team always has a relevant, seasonal target to hit.
          </p>

          <div className="flex items-center justify-between py-1">
            <div>
              <p className="text-sm font-medium">Show daily goal on dashboard</p>
              <p className="text-xs text-muted-foreground mt-0.5">Displays current sales vs. goal in real time for the whole team</p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={val => updateForm('dailySalesGoalEnabled', val)}
            />
          </div>
        </CardContent>
      </Card>

      {enabled && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              Goal increase
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-sm text-muted-foreground">
              Optionally set a stretch target above last year's performance. Leave at 0 to use last year's number as-is.
            </p>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="mb-2 block">Increase by</Label>
                <Select
                  value={increaseType}
                  onValueChange={val => updateForm('salesGoalIncreaseType', val)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Percentage (%)</SelectItem>
                    <SelectItem value="dollar">Dollar amount ($)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="mb-2 block">
                  {increaseType === 'percentage' ? 'Percent increase' : 'Dollar increase'}
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                    {increaseType === 'percentage' ? '' : '$'}
                  </span>
                  <Input
                    type="number"
                    min="0"
                    step={increaseType === 'percentage' ? '0.1' : '1'}
                    value={increaseValue || ''}
                    placeholder="0"
                    className={increaseType === 'dollar' ? 'pl-6' : ''}
                    onChange={e => updateForm('salesGoalIncreaseValue', e.target.value)}
                  />
                  {increaseType === 'percentage' && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
                  )}
                </div>
              </div>
            </div>

            {/* Live preview */}
            {hasLastYearData ? (
              <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Goal preview — this {dayName}</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="text-center">
                    <p className="text-lg font-bold">${fmt(lastYearRevenue)}</p>
                    <p className="text-[10px] text-muted-foreground">Last year's {dayName}</p>
                  </div>
                  {increaseValue > 0 && (
                    <>
                      <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <div className="text-center">
                        <p className="text-lg font-bold text-primary">
                          +${fmt(previewIncreaseAmount)}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {increaseType === 'percentage' ? `${increaseValue}% increase` : 'Fixed increase'}
                        </p>
                      </div>
                    </>
                  )}
                  <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <div className="text-center">
                    <p className="text-lg font-bold text-green-600 dark:text-green-400">${fmt(previewGoal)}</p>
                    <p className="text-[10px] text-muted-foreground">Today's goal</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg p-3">
                <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <span>
                  Goal preview will appear here once Shopify sales data has been synced.
                  Connect your Shopify store and run a historical sync from the POS connection settings.
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {enabled && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShoppingBag className="h-4 w-4 text-primary" />
              What the team sees
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>On the dashboard, team members will see:</p>
            <ul className="list-disc list-inside space-y-1 ml-1">
              <li>A live progress bar showing today's sales vs. the goal</li>
              <li>How much is still needed to reach the goal in dollars</li>
              <li>How many more sales are needed based on the average order value</li>
              {increaseValue > 0 && (
                <li>A breakdown showing last year's number and the stretch target</li>
              )}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
