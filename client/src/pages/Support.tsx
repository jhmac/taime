import { useLocation } from 'wouter';
import { useToast } from '@/hooks/use-toast';

interface SupportItem {
  icon: string;
  label: string;
  action: () => void;
}

export default function SupportPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const items: SupportItem[] = [
    {
      icon: 'fas fa-headset',
      label: 'Chat with Support',
      action: () => toast({ title: 'Support', description: 'Live chat support coming soon.' }),
    },
    {
      icon: 'fas fa-question-circle',
      label: 'Help guides and tutorials',
      action: () => navigate('/learning'),
    },
    {
      icon: 'fas fa-file-alt',
      label: 'Terms of Service',
      action: () => toast({ title: 'Terms of Service', description: 'Terms page coming soon.' }),
    },
    {
      icon: 'fas fa-shield-alt',
      label: 'Privacy Policy',
      action: () => toast({ title: 'Privacy Policy', description: 'Privacy page coming soon.' }),
    },
    {
      icon: 'fas fa-ban',
      label: 'Close account',
      action: () => toast({ title: 'Close Account', description: 'Please contact support to close your account.', variant: 'destructive' }),
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <button onClick={() => navigate('/more')} className="text-primary">
          <i className="fas fa-chevron-left text-lg"></i>
        </button>
        <h1 className="text-lg font-bold">Support</h1>
        <div className="w-6"></div>
      </div>

      <div className="px-4">
        {items.map((item, i) => (
          <button
            key={i}
            onClick={item.action}
            className="w-full flex items-center gap-4 py-4 border-b border-border text-left hover:bg-muted/30 transition-colors"
          >
            <i className={`${item.icon} w-6 text-center text-lg text-muted-foreground`}></i>
            <div className="flex-1">
              <div className="text-sm font-medium">{item.label}</div>
            </div>
            <i className="fas fa-chevron-right text-xs text-muted-foreground"></i>
          </button>
        ))}
      </div>
    </div>
  );
}
