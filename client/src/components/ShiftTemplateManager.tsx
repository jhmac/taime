import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface ShiftTemplate {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  color: string;
  defaultRole?: string;
  description?: string;
}

interface ShiftTemplateManagerProps {
  templates: ShiftTemplate[];
  onTemplateSelect: (template: ShiftTemplate) => void;
  onTemplateCreate?: (template: Omit<ShiftTemplate, 'id'>) => void;
  onTemplateDelete?: (templateId: string) => void;
  selectedEmployee?: string;
}

const shiftColors = [
  { value: 'bg-blue-500', label: 'Blue', preview: 'bg-blue-500' },
  { value: 'bg-green-500', label: 'Green', preview: 'bg-green-500' },
  { value: 'bg-purple-500', label: 'Purple', preview: 'bg-purple-500' },
  { value: 'bg-orange-500', label: 'Orange', preview: 'bg-orange-500' },
  { value: 'bg-red-500', label: 'Red', preview: 'bg-red-500' },
  { value: 'bg-pink-500', label: 'Pink', preview: 'bg-pink-500' },
  { value: 'bg-indigo-500', label: 'Indigo', preview: 'bg-indigo-500' },
  { value: 'bg-teal-500', label: 'Teal', preview: 'bg-teal-500' },
];

export default function ShiftTemplateManager({
  templates,
  onTemplateSelect,
  onTemplateCreate,
  onTemplateDelete,
  selectedEmployee
}: ShiftTemplateManagerProps) {
  const [showCreateTemplate, setShowCreateTemplate] = useState(false);

  const calculateDuration = (startTime: string, endTime: string) => {
    const start = new Date(`2000-01-01T${startTime}`);
    const end = new Date(`2000-01-01T${endTime}`);
    if (end < start) end.setDate(end.getDate() + 1); // Handle overnight shifts
    return (end.getTime() - start.getTime()) / (1000 * 60 * 60);
  };

  const handleCreateTemplate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    const template = {
      name: formData.get('name') as string,
      startTime: formData.get('startTime') as string,
      endTime: formData.get('endTime') as string,
      color: formData.get('color') as string,
      defaultRole: formData.get('defaultRole') as string,
      description: formData.get('description') as string,
    };

    onTemplateCreate?.(template);
    setShowCreateTemplate(false);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="text-sm">Shift Templates</CardTitle>
        {onTemplateCreate && (
          <Dialog open={showCreateTemplate} onOpenChange={setShowCreateTemplate}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-create-template">
                <i className="fas fa-plus mr-1"></i>
                New
              </Button>
            </DialogTrigger>
            <DialogContent data-testid="dialog-create-template">
              <DialogHeader>
                <DialogTitle>Create Shift Template</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreateTemplate} className="space-y-4">
                <div>
                  <Label htmlFor="name">Template Name</Label>
                  <Input
                    id="name"
                    name="name"
                    placeholder="e.g., Morning Shift"
                    required
                    data-testid="input-template-name"
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="startTime">Start Time</Label>
                    <Input
                      id="startTime"
                      name="startTime"
                      type="time"
                      required
                      data-testid="input-template-start-time"
                    />
                  </div>
                  <div>
                    <Label htmlFor="endTime">End Time</Label>
                    <Input
                      id="endTime"
                      name="endTime"
                      type="time"
                      required
                      data-testid="input-template-end-time"
                    />
                  </div>
                </div>
                
                <div>
                  <Label htmlFor="color">Color</Label>
                  <Select name="color" required>
                    <SelectTrigger data-testid="select-template-color">
                      <SelectValue placeholder="Select color" />
                    </SelectTrigger>
                    <SelectContent>
                      {shiftColors.map((color) => (
                        <SelectItem key={color.value} value={color.value}>
                          <div className="flex items-center">
                            <div className={`w-4 h-4 rounded-full ${color.preview} mr-2`}></div>
                            {color.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div>
                  <Label htmlFor="defaultRole">Default Role (Optional)</Label>
                  <Input
                    id="defaultRole"
                    name="defaultRole"
                    placeholder="e.g., Cashier, Manager"
                    data-testid="input-template-role"
                  />
                </div>
                
                <div>
                  <Label htmlFor="description">Description (Optional)</Label>
                  <Input
                    id="description"
                    name="description"
                    placeholder="Additional details..."
                    data-testid="input-template-description"
                  />
                </div>
                
                <div className="flex justify-end space-x-2">
                  <Button type="button" variant="outline" onClick={() => setShowCreateTemplate(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" data-testid="button-save-template">
                    Create Template
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {templates.map((template) => {
            const duration = calculateDuration(template.startTime, template.endTime);
            const isDisabled = !selectedEmployee;
            
            return (
              <Button
                key={template.id}
                variant="outline"
                className={`h-auto p-3 justify-start ${isDisabled ? 'opacity-50' : ''}`}
                onClick={() => !isDisabled && onTemplateSelect(template)}
                disabled={isDisabled}
                data-testid={`template-${template.id}`}
              >
                <div className="flex items-start space-x-3 w-full">
                  <div className={`w-4 h-4 rounded-full ${template.color} mt-1 flex-shrink-0`}></div>
                  <div className="text-left flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{template.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {template.startTime} - {template.endTime}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="secondary" className="text-xs">
                        {duration}h
                      </Badge>
                      {template.defaultRole && (
                        <Badge variant="outline" className="text-xs">
                          {template.defaultRole}
                        </Badge>
                      )}
                    </div>
                    {template.description && (
                      <div className="text-xs text-muted-foreground mt-1 truncate">
                        {template.description}
                      </div>
                    )}
                  </div>
                  {onTemplateDelete && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-red-600 hover:text-red-700"
                      onClick={(e) => {
                        e.stopPropagation();
                        onTemplateDelete(template.id);
                      }}
                      data-testid={`button-delete-template-${template.id}`}
                    >
                      <i className="fas fa-times text-xs"></i>
                    </Button>
                  )}
                </div>
              </Button>
            );
          })}
        </div>
        
        {templates.length === 0 && (
          <div className="text-center py-6">
            <i className="fas fa-clock text-muted-foreground text-2xl mb-2"></i>
            <p className="text-muted-foreground text-sm">No shift templates yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Create templates to quickly assign common shift patterns
            </p>
          </div>
        )}
        
        {!selectedEmployee && templates.length > 0 && (
          <div className="mt-3 p-3 bg-muted/50 rounded-lg">
            <p className="text-xs text-muted-foreground text-center">
              <i className="fas fa-info-circle mr-1"></i>
              Click on an employee cell to select them for quick template assignment
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}