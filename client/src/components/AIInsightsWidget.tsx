import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export default function AIInsightsWidget() {
  const { data: insights, isLoading } = useQuery({
    queryKey: ['/api/insights'],
  });

  const getInsightIcon = (type: string, severity: string) => {
    if (severity === 'critical') return 'fas fa-exclamation-circle text-red-600';
    if (severity === 'warning') return 'fas fa-exclamation-triangle text-yellow-600';
    
    switch (type) {
      case 'overtime_alert':
        return 'fas fa-clock text-orange-600';
      case 'anomaly_detected':
        return 'fas fa-search text-red-600';
      case 'optimization':
        return 'fas fa-lightbulb text-blue-600';
      default:
        return 'fas fa-info-circle text-blue-600';
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-50 border-red-200';
      case 'warning':
        return 'bg-yellow-50 border-yellow-200';
      default:
        return 'bg-blue-50 border-blue-200';
    }
  };

  const unreadInsights = insights?.filter((insight: any) => !insight.isRead) || [];

  if (isLoading) {
    return (
      <Card data-testid="ai-insights-widget">
        <CardHeader>
          <CardTitle className="text-base flex items-center">
            <i className="fas fa-brain text-primary mr-2"></i>
            Claude AI Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="animate-pulse h-16 bg-muted rounded-lg"></div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (unreadInsights.length === 0) {
    return (
      <Card data-testid="ai-insights-widget">
        <CardHeader>
          <CardTitle className="text-base flex items-center">
            <i className="fas fa-brain text-primary mr-2"></i>
            Claude AI Insights
            <Badge className="ml-2 bg-green-100 text-green-800">All Clear</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4">
            <div className="w-12 h-12 bg-gradient-to-r from-primary to-accent rounded-full flex items-center justify-center mx-auto mb-3">
              <i className="fas fa-check text-primary-foreground"></i>
            </div>
            <p className="text-sm text-muted-foreground">
              Claude AI is monitoring your team. All systems running smoothly!
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="ai-insights-widget">
      <CardHeader>
        <CardTitle className="text-base flex items-center">
          <i className="fas fa-brain text-primary mr-2"></i>
          Claude AI Insights
          {unreadInsights.length > 0 && (
            <Badge className="ml-2 bg-destructive text-destructive-foreground">
              {unreadInsights.length} new
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {unreadInsights.slice(0, 3).map((insight: any) => (
            <div
              key={insight.id}
              className={`border rounded-lg p-3 ${getSeverityColor(insight.severity)}`}
              data-testid={`ai-insight-${insight.id}`}
            >
              <div className="flex items-start space-x-2">
                <i className={`${getInsightIcon(insight.type, insight.severity)} text-sm mt-0.5`}></i>
                <div className="flex-1">
                  <p className="text-sm font-medium">{insight.title}</p>
                  <p className="text-xs text-muted-foreground mt-1">{insight.description}</p>
                  
                  {insight.metadata && (
                    <div className="mt-2">
                      {insight.metadata.recommendation && (
                        <p className="text-xs text-primary">
                          <i className="fas fa-lightbulb mr-1"></i>
                          Suggestion: {insight.metadata.recommendation}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
              
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-muted-foreground">
                  {new Date(insight.createdAt).toLocaleString()}
                </span>
                <Button variant="ghost" size="sm" className="text-xs h-6">
                  Take Action
                </Button>
              </div>
            </div>
          ))}

          {unreadInsights.length > 3 && (
            <Button variant="ghost" className="w-full text-sm">
              View All Insights ({unreadInsights.length})
              <i className="fas fa-arrow-right ml-2"></i>
            </Button>
          )}

          {/* AI Status Indicator */}
          <div className="flex items-center justify-center space-x-2 pt-2 text-xs text-muted-foreground">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <span>Claude AI actively monitoring</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
