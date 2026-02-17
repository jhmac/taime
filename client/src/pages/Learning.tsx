import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { useAuth } from '@/hooks/useAuth';
import {
  BookOpen, CheckCircle, Clock, ChevronRight, ChevronLeft,
  GraduationCap, Play, Trophy, FileText, Loader2
} from 'lucide-react';
import type { TrainingModule, EmployeeTrainingProgress, SopDocument } from '@shared/schema';

export default function Learning() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedModule, setSelectedModule] = useState<TrainingModule | null>(null);
  const [viewingSop, setViewingSop] = useState<SopDocument | null>(null);

  const { data: modules = [], isLoading: modulesLoading } = useQuery<TrainingModule[]>({
    queryKey: ['/api/training/modules'],
  });

  const { data: progress = [] } = useQuery<EmployeeTrainingProgress[]>({
    queryKey: ['/api/training/progress'],
  });

  const { data: sopDocs = [] } = useQuery<SopDocument[]>({
    queryKey: ['/api/sop/documents'],
  });

  const updateProgressMutation = useMutation({
    mutationFn: async (data: { moduleId: string; status: string; quizScore?: number }) => {
      return apiRequest('POST', '/api/training/progress', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/training/progress'] });
    },
  });

  const getModuleProgress = (moduleId: string) => {
    return progress.find(p => p.moduleId === moduleId);
  };

  const activeModules = modules.filter(m => m.isActive);
  const completedCount = activeModules.filter(m => getModuleProgress(m.id)?.status === 'completed').length;
  const totalRequired = activeModules.filter(m => m.isRequired).length;
  const completedRequired = activeModules.filter(m => m.isRequired && getModuleProgress(m.id)?.status === 'completed').length;
  const overallProgress = activeModules.length > 0 ? Math.round((completedCount / activeModules.length) * 100) : 0;

  const handleStartModule = (module: TrainingModule) => {
    const prog = getModuleProgress(module.id);
    if (!prog || prog.status === 'not_started') {
      updateProgressMutation.mutate({
        moduleId: module.id,
        status: 'in_progress',
      });
    }
    setSelectedModule(module);
  };

  const handleCompleteModule = (module: TrainingModule) => {
    updateProgressMutation.mutate({
      moduleId: module.id,
      status: 'completed',
    });
    toast({
      title: "Module Completed!",
      description: `You've completed "${module.title}". Great job!`,
    });
    setSelectedModule(null);
  };

  const getModuleSopDocs = (module: TrainingModule): SopDocument[] => {
    if (!module.sopDocumentIds || module.sopDocumentIds.length === 0) return [];
    return sopDocs.filter(d => module.sopDocumentIds?.includes(d.id));
  };

  if (modulesLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (viewingSop) {
    return (
      <div className="p-4 md:p-6 max-w-3xl mx-auto">
        <Button variant="ghost" size="sm" onClick={() => setViewingSop(null)} className="mb-4">
          <ChevronLeft className="w-4 h-4 mr-1" />
          Back to module
        </Button>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              {viewingSop.title}
            </CardTitle>
            {viewingSop.summary && (
              <p className="text-sm text-muted-foreground">{viewingSop.summary}</p>
            )}
          </CardHeader>
          <CardContent>
            <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
              {viewingSop.content}
            </div>
            {viewingSop.tags && viewingSop.tags.length > 0 && (
              <div className="flex gap-2 mt-4 pt-4 border-t">
                {viewingSop.tags.map(tag => (
                  <Badge key={tag} variant="outline">{tag}</Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (selectedModule) {
    const moduleSops = getModuleSopDocs(selectedModule);
    const moduleProgress = getModuleProgress(selectedModule.id);

    return (
      <div className="p-4 md:p-6 max-w-3xl mx-auto">
        <Button variant="ghost" size="sm" onClick={() => setSelectedModule(null)} className="mb-4">
          <ChevronLeft className="w-4 h-4 mr-1" />
          Back to Learning Path
        </Button>

        <Card className="mb-4">
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <BookOpen className="w-5 h-5" />
                  {selectedModule.title}
                </CardTitle>
                {selectedModule.description && (
                  <p className="text-sm text-muted-foreground mt-1">{selectedModule.description}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {selectedModule.isRequired && <Badge>Required</Badge>}
                {selectedModule.estimatedMinutes && (
                  <Badge variant="outline">
                    <Clock className="w-3 h-3 mr-1" />
                    {selectedModule.estimatedMinutes} min
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {moduleProgress?.status === 'completed' ? (
              <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                <CheckCircle className="w-5 h-5" />
                <span className="font-medium">Completed</span>
              </div>
            ) : (
              <Badge variant="secondary">In Progress</Badge>
            )}
          </CardContent>
        </Card>

        <h3 className="font-semibold text-sm mb-3">Study Materials</h3>
        {moduleSops.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-muted-foreground text-sm">
              No SOPs linked to this module yet. Your admin will add them soon.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2 mb-6">
            {moduleSops.map((sop, index) => (
              <Card key={sop.id} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setViewingSop(sop)}>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold">
                    {index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{sop.title}</div>
                    {sop.summary && (
                      <div className="text-xs text-muted-foreground truncate">{sop.summary}</div>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {moduleProgress?.status !== 'completed' && (
          <Button
            className="w-full"
            onClick={() => handleCompleteModule(selectedModule)}
            disabled={updateProgressMutation.isPending}
          >
            {updateProgressMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <CheckCircle className="w-4 h-4 mr-2" />
            )}
            Mark as Complete
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <GraduationCap className="w-6 h-6 text-primary" />
          <h1 className="text-xl font-bold">Learning Path</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Complete these training modules to master your role. Your progress is tracked automatically.
        </p>
      </div>

      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Overall Progress</span>
            <span className="text-sm text-muted-foreground">{completedCount}/{activeModules.length} modules</span>
          </div>
          <Progress value={overallProgress} className="h-3 mb-2" />
          {totalRequired > 0 && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Trophy className="w-3 h-3" />
              Required: {completedRequired}/{totalRequired} complete
            </div>
          )}
        </CardContent>
      </Card>

      {activeModules.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <GraduationCap className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
            <h3 className="font-semibold mb-1">No Training Modules Yet</h3>
            <p className="text-sm text-muted-foreground">
              Your admin hasn't set up any training modules yet. Check back soon!
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {activeModules.map((module) => {
            const prog = getModuleProgress(module.id);
            const isCompleted = prog?.status === 'completed';
            const isInProgress = prog?.status === 'in_progress';

            return (
              <Card
                key={module.id}
                className={`cursor-pointer transition-all hover:shadow-md ${isCompleted ? 'border-green-200 dark:border-green-900' : ''}`}
                onClick={() => handleStartModule(module)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      isCompleted ? 'bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-400' :
                      isInProgress ? 'bg-primary/10 text-primary' :
                      'bg-muted text-muted-foreground'
                    }`}>
                      {isCompleted ? <CheckCircle className="w-5 h-5" /> :
                       isInProgress ? <Play className="w-5 h-5" /> :
                       <BookOpen className="w-5 h-5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{module.title}</span>
                        {module.isRequired && <Badge variant="outline" className="text-xs shrink-0">Required</Badge>}
                      </div>
                      {module.description && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{module.description}</p>
                      )}
                      <div className="flex items-center gap-3 mt-1">
                        {module.estimatedMinutes && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {module.estimatedMinutes} min
                          </span>
                        )}
                        {module.sopDocumentIds && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <FileText className="w-3 h-3" />
                            {module.sopDocumentIds.length} topic{module.sopDocumentIds.length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
