import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Plus, Edit2, Trash2, FolderOpen, FileText, Search, Eye, EyeOff, Sparkles, Wand2 } from 'lucide-react';
import { useLocation } from 'wouter';
import type { SopCategory, SopDocument } from '@shared/schema';

export default function SOPManagementSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState<'documents' | 'categories'>('documents');
  const [editingDoc, setEditingDoc] = useState<SopDocument | null>(null);
  const [editingCategory, setEditingCategory] = useState<SopCategory | null>(null);
  const [showDocForm, setShowDocForm] = useState(false);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const [docForm, setDocForm] = useState({
    title: '',
    content: '',
    summary: '',
    categoryId: '',
    tags: '',
    isPublished: false,
  });

  const [catForm, setCatForm] = useState({
    name: '',
    description: '',
    icon: '',
    sortOrder: 0,
  });

  const { data: categories = [] } = useQuery<SopCategory[]>({
    queryKey: ['/api/sop/categories'],
  });

  const { data: documents = [], isLoading } = useQuery<SopDocument[]>({
    queryKey: ['/api/sop/documents'],
  });

  const createDocMutation = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/sop/documents', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sop/documents'] });
      resetDocForm();
      toast({ title: "SOP Created", description: "The SOP document has been created." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create SOP.", variant: "destructive" });
    },
  });

  const updateDocMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiRequest('PUT', `/api/sop/documents/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sop/documents'] });
      resetDocForm();
      toast({ title: "Updated", description: "SOP document updated." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update SOP.", variant: "destructive" });
    },
  });

  const deleteDocMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/sop/documents/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sop/documents'] });
      toast({ title: "Deleted", description: "SOP document removed." });
    },
  });

  const createCatMutation = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/sop/categories', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sop/categories'] });
      resetCatForm();
      toast({ title: "Category Created" });
    },
  });

  const updateCatMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiRequest('PUT', `/api/sop/categories/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sop/categories'] });
      resetCatForm();
      toast({ title: "Category Updated" });
    },
  });

  const deleteCatMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/sop/categories/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sop/categories'] });
      toast({ title: "Category Deleted" });
    },
  });

  const resetDocForm = () => {
    setDocForm({ title: '', content: '', summary: '', categoryId: '', tags: '', isPublished: false });
    setEditingDoc(null);
    setShowDocForm(false);
  };

  const resetCatForm = () => {
    setCatForm({ name: '', description: '', icon: '', sortOrder: 0 });
    setEditingCategory(null);
    setShowCategoryForm(false);
  };

  const handleEditDoc = (doc: SopDocument) => {
    setEditingDoc(doc);
    setDocForm({
      title: doc.title,
      content: doc.content,
      summary: doc.summary || '',
      categoryId: doc.categoryId || '',
      tags: doc.tags?.join(', ') || '',
      isPublished: doc.isPublished ?? false,
    });
    setShowDocForm(true);
  };

  const handleEditCategory = (cat: SopCategory) => {
    setEditingCategory(cat);
    setCatForm({
      name: cat.name,
      description: cat.description || '',
      icon: cat.icon || '',
      sortOrder: cat.sortOrder || 0,
    });
    setShowCategoryForm(true);
  };

  const handleSaveDoc = () => {
    const payload = {
      title: docForm.title,
      content: docForm.content,
      summary: docForm.summary || undefined,
      categoryId: docForm.categoryId || undefined,
      tags: docForm.tags ? docForm.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      isPublished: docForm.isPublished,
    };

    if (editingDoc) {
      updateDocMutation.mutate({ id: editingDoc.id, data: payload });
    } else {
      createDocMutation.mutate(payload);
    }
  };

  const handleSaveCategory = () => {
    if (editingCategory) {
      updateCatMutation.mutate({ id: editingCategory.id, data: catForm });
    } else {
      createCatMutation.mutate(catForm);
    }
  };

  const filteredDocs = documents.filter(doc => {
    const matchesSearch = !searchQuery || 
      doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.content.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || doc.categoryId === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const getCategoryName = (categoryId: string | null) => {
    if (!categoryId) return 'Uncategorized';
    const cat = categories.find(c => c.id === categoryId);
    return cat?.name || 'Unknown';
  };

  return (
    <div className="space-y-6">
      <div
        className="flex items-center gap-3 p-4 bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 rounded-xl cursor-pointer hover:bg-violet-100 dark:hover:bg-violet-950/50 transition-colors"
        onClick={() => navigate('/ai-studio')}
      >
        <div className="w-9 h-9 rounded-xl bg-violet-100 dark:bg-violet-900/50 flex items-center justify-center flex-shrink-0">
          <Wand2 className="w-5 h-5 text-violet-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-violet-900 dark:text-violet-200">Generate SOPs with AI Studio</p>
          <p className="text-xs text-violet-700 dark:text-violet-400">Upload documents and let Claude generate structured SOPs automatically.</p>
        </div>
        <Sparkles className="w-4 h-4 text-violet-500 shrink-0" />
      </div>

      <div className="flex gap-2">
        <Button
          variant={activeTab === 'documents' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setActiveTab('documents')}
        >
          <FileText className="w-4 h-4 mr-1" />
          SOPs ({documents.length})
        </Button>
        <Button
          variant={activeTab === 'categories' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setActiveTab('categories')}
        >
          <FolderOpen className="w-4 h-4 mr-1" />
          Categories ({categories.length})
        </Button>
      </div>

      {activeTab === 'documents' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search SOPs..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map(cat => (
                  <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => { resetDocForm(); setShowDocForm(true); }}>
              <Plus className="w-4 h-4 mr-1" />
              New SOP
            </Button>
          </div>

          {showDocForm && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{editingDoc ? 'Edit SOP' : 'Create New SOP'}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  placeholder="SOP Title (e.g., Opening Procedures)"
                  value={docForm.title}
                  onChange={e => setDocForm(f => ({ ...f, title: e.target.value }))}
                />
                <Select
                  value={docForm.categoryId || 'none'}
                  onValueChange={v => setDocForm(f => ({ ...f, categoryId: v === 'none' ? '' : v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No category</SelectItem>
                    {categories.map(cat => (
                      <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Textarea
                  placeholder="Write the full SOP content here. Include step-by-step instructions, tips, and important notes. The AI assistant will use this to answer employee questions."
                  value={docForm.content}
                  onChange={e => setDocForm(f => ({ ...f, content: e.target.value }))}
                  rows={12}
                  className="font-mono text-sm"
                />
                <Input
                  placeholder="Brief summary (used for quick reference)"
                  value={docForm.summary}
                  onChange={e => setDocForm(f => ({ ...f, summary: e.target.value }))}
                />
                <Input
                  placeholder="Tags (comma-separated, e.g., opening, safety, cleaning)"
                  value={docForm.tags}
                  onChange={e => setDocForm(f => ({ ...f, tags: e.target.value }))}
                />
                <div className="flex items-center gap-2">
                  <Switch
                    checked={docForm.isPublished}
                    onCheckedChange={v => setDocForm(f => ({ ...f, isPublished: v }))}
                  />
                  <span className="text-sm">
                    {docForm.isPublished ? 'Published — visible to employees and AI assistant' : 'Draft — only visible to admins'}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleSaveDoc} disabled={!docForm.title || !docForm.content || createDocMutation.isPending || updateDocMutation.isPending}>
                    {editingDoc ? 'Update SOP' : 'Create SOP'}
                  </Button>
                  <Button variant="outline" onClick={resetDocForm}>Cancel</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : filteredDocs.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                {documents.length === 0
                  ? "No SOPs yet. Create your first SOP to build your team's knowledge base."
                  : "No SOPs match your search."}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredDocs.map(doc => (
                <Card key={doc.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h3 className="font-medium truncate">{doc.title}</h3>
                          {doc.isPublished ? (
                            <Badge variant="default" className="text-xs shrink-0">
                              <Eye className="w-3 h-3 mr-1" />
                              Published
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs shrink-0">
                              <EyeOff className="w-3 h-3 mr-1" />
                              Draft
                            </Badge>
                          )}
                          {doc.source === 'ai_generated' && (
                            <Badge className="text-xs shrink-0 bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200">
                              <Sparkles className="w-3 h-3 mr-1" />
                              AI Generated
                            </Badge>
                          )}
                        </div>
                        {doc.summary && (
                          <p className="text-sm text-muted-foreground mb-2">{doc.summary}</p>
                        )}
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline" className="text-xs">{getCategoryName(doc.categoryId)}</Badge>
                          {doc.tags && doc.tags.length > 0 && doc.tags.map(tag => (
                            <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
                          ))}
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button variant="ghost" size="sm" onClick={() => handleEditDoc(doc)}>
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => deleteDocMutation.mutate(doc.id)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'categories' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => { resetCatForm(); setShowCategoryForm(true); }}>
              <Plus className="w-4 h-4 mr-1" />
              New Category
            </Button>
          </div>

          {showCategoryForm && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{editingCategory ? 'Edit Category' : 'Create Category'}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  placeholder="Category name (e.g., Opening & Closing)"
                  value={catForm.name}
                  onChange={e => setCatForm(f => ({ ...f, name: e.target.value }))}
                />
                <Textarea
                  placeholder="Description (optional)"
                  value={catForm.description}
                  onChange={e => setCatForm(f => ({ ...f, description: e.target.value }))}
                  rows={3}
                />
                <div className="flex gap-2">
                  <Button onClick={handleSaveCategory} disabled={!catForm.name}>
                    {editingCategory ? 'Update' : 'Create'}
                  </Button>
                  <Button variant="outline" onClick={resetCatForm}>Cancel</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {categories.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No categories yet. Create categories to organize your SOPs.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {categories.map(cat => {
                const docCount = documents.filter(d => d.categoryId === cat.id).length;
                return (
                  <Card key={cat.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-medium">{cat.name}</h3>
                          {cat.description && (
                            <p className="text-sm text-muted-foreground">{cat.description}</p>
                          )}
                          <span className="text-xs text-muted-foreground">{docCount} document{docCount !== 1 ? 's' : ''}</span>
                        </div>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => handleEditCategory(cat)}>
                            <Edit2 className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => deleteCatMutation.mutate(cat.id)}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
