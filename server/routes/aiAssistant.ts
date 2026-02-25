import type { Express } from "express";
import type { IStorage } from "../storage";
import Anthropic from '@anthropic-ai/sdk';
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config } from "../lib/config";
import { askMAinager } from "../services/askMAinager";
import { generateTaskSuggestions } from "../services/smartTaskSuggestions";
import { db } from "../db";
import { aiFeedback, aiChatConversations, aiChatMessages } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

const DEFAULT_MODEL_STR = "claude-sonnet-4-20250514";

const anthropic = new Anthropic({
  apiKey: config.anthropic.apiKey,
});

const chatRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  message: { message: "Too many requests, please try again shortly" },
  standardHeaders: true,
  legacyHeaders: false,
});

const askRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: { message: "You've reached the question limit. Try again in a bit!" },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false, default: true },
});

export function registerAiAssistantRoutes(app: Express, storage: IStorage, isAuthenticated: any) {
  app.get('/api/ai-assistant/conversations', isAuthenticated, async (req: any, res) => {
    try {
      const conversations = await storage.getUserConversations(req.user.id);
      res.json(conversations);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post('/api/ai-assistant/conversations', isAuthenticated, async (req: any, res) => {
    try {
      const conversation = await storage.createAiChatConversation({
        userId: req.user.id,
        title: req.body.title || 'New conversation',
      });
      res.json(conversation);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete('/api/ai-assistant/conversations/:id', isAuthenticated, async (req: any, res) => {
    try {
      const conv = await storage.getConversation(req.params.id);
      if (!conv || conv.userId !== req.user.id) {
        return res.status(403).json({ message: "Access denied" });
      }
      await storage.deleteConversation(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get('/api/ai-assistant/conversations/:id/messages', isAuthenticated, async (req: any, res) => {
    try {
      const conv = await storage.getConversation(req.params.id);
      if (!conv || conv.userId !== req.user.id) {
        return res.status(403).json({ message: "Access denied" });
      }
      const messages = await storage.getConversationMessages(req.params.id);
      res.json(messages);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post('/api/ai-assistant/chat', isAuthenticated, chatRateLimiter, async (req: any, res) => {
    try {
      const chatSchema = z.object({
        message: z.string().min(1).max(2000),
        conversationId: z.string().optional(),
      });
      const { message, conversationId } = chatSchema.parse(req.body);

      if (conversationId) {
        const conv = await storage.getConversation(conversationId);
        if (!conv || conv.userId !== req.user.id) {
          return res.status(403).json({ message: "Access denied" });
        }
      }

      let convId = conversationId;
      if (!convId) {
        const conv = await storage.createAiChatConversation({
          userId: req.user.id,
          title: message.substring(0, 50),
        });
        convId = conv.id;
      }

      await storage.createAiChatMessage({
        conversationId: convId,
        role: 'user',
        content: message,
      });

      const allSops = await storage.getSopDocuments();
      const publishedSops = allSops.filter(s => s.isPublished);

      const sopContext = publishedSops.length > 0
        ? publishedSops.map(s => `## ${s.title}\n${s.content}\n${s.summary ? `Summary: ${s.summary}` : ''}`).join('\n\n---\n\n')
        : 'No SOPs have been published yet. Let the employee know that their admin is still setting up the knowledge base.';

      const categories = await storage.getSopCategories();
      const categoryList = categories.map(c => c.name).join(', ');

      const user = await storage.getUser(req.user.id);
      const userName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : 'Team member';

      const previousMessages = await storage.getConversationMessages(convId);
      const chatHistory = previousMessages
        .slice(-10)
        .map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

      const today = new Date();
      const schedules = await storage.getUserSchedules(req.user.id, today, new Date(today.getTime() + 24 * 60 * 60 * 1000));
      const userTasks = await storage.getUserTasks(req.user.id);
      const pendingTasks = userTasks.filter(t => t.status === 'pending' || t.status === 'in_progress');

      let contextInfo = '';
      if (schedules.length > 0) {
        contextInfo += `\nUpcoming shifts: ${schedules.map(s => `${new Date(s.startTime).toLocaleTimeString()} - ${new Date(s.endTime).toLocaleTimeString()}`).join(', ')}`;
      }
      if (pendingTasks.length > 0) {
        contextInfo += `\nPending tasks: ${pendingTasks.map(t => t.title).join(', ')}`;
      }

      const systemPrompt = `You are a friendly, knowledgeable AI Success Coach for a retail/service business team. Your name is Taime Assistant. You help employees succeed at their job by answering questions about store procedures, policies, and best practices.

IMPORTANT RULES:
- Base your answers on the Standard Operating Procedures (SOPs) provided below. Always reference which SOP your answer comes from.
- If a question cannot be answered from the SOPs, say so honestly and suggest the employee ask their manager.
- Be encouraging, supportive, and professional. Think of yourself as a helpful mentor.
- Give step-by-step instructions when explaining procedures.
- If the employee seems confused, offer to break things down further.
- Keep responses concise but thorough. Use bullet points and numbered lists for clarity.

EMPLOYEE CONTEXT:
- Name: ${userName}${contextInfo}

AVAILABLE SOP CATEGORIES: ${categoryList || 'No categories set up yet'}

STANDARD OPERATING PROCEDURES:
${sopContext}`;

      const response = await anthropic.messages.create({
        model: DEFAULT_MODEL_STR,
        max_tokens: 1024,
        system: systemPrompt,
        messages: chatHistory,
      });

      const assistantMessage = response.content[0].type === 'text'
        ? response.content[0].text
        : 'I apologize, I had trouble generating a response. Please try again.';

      const referencedSops = publishedSops
        .filter(s => assistantMessage.toLowerCase().includes(s.title.toLowerCase()))
        .map(s => s.id);

      const saved = await storage.createAiChatMessage({
        conversationId: convId,
        role: 'assistant',
        content: assistantMessage,
        sopReferences: referencedSops.length > 0 ? referencedSops : undefined,
      });

      res.json({
        message: assistantMessage,
        conversationId: convId,
        messageId: saved.id,
        sopReferences: referencedSops,
      });
    } catch (error: any) {
      console.error('AI Assistant chat error:', error);
      res.status(500).json({ message: "Failed to get AI response. Please try again." });
    }
  });

  app.post('/api/ai-assistant/briefing', isAuthenticated, chatRateLimiter, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.user.id);
      const userName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : 'Team member';

      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      today.setHours(0, 0, 0, 0);

      const schedules = await storage.getUserSchedules(req.user.id, today, tomorrow);
      const userTasks = await storage.getUserTasks(req.user.id);
      const pendingTasks = userTasks.filter(t => t.status === 'pending' || t.status === 'in_progress');

      const allSops = await storage.getSopDocuments();
      const publishedSops = allSops.filter(s => s.isPublished);

      let shiftInfo = 'No shifts scheduled today.';
      if (schedules.length > 0) {
        shiftInfo = schedules.map(s => {
          const start = new Date(s.startTime);
          const end = new Date(s.endTime);
          return `${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        }).join(', ');
      }

      let commuteInfo = '';
      if (user?.homeLatitude && user?.homeLongitude && schedules.length > 0) {
        const locations = await storage.getAllWorkLocations();
        const schedule = schedules[0];
        const location = locations.find(l => l.id === schedule.locationId);
        if (location?.latitude && location?.longitude) {
          const distance = calculateDistance(
            parseFloat(user.homeLatitude),
            parseFloat(user.homeLongitude),
            parseFloat(location.latitude),
            parseFloat(location.longitude)
          );
          const estimatedMinutes = Math.round(distance / 0.5);
          commuteInfo = `Estimated commute: ~${estimatedMinutes} minutes (${distance.toFixed(1)} miles).`;
        }
      }

      const systemPrompt = `You are Taime Assistant, a friendly AI Success Coach. Generate a brief, motivating pre-shift briefing for an employee.

Keep it concise (3-5 bullet points max). Include:
1. A warm greeting using their name
2. Their shift time today
3. Any pending tasks they should focus on
4. A relevant tip from the SOPs if applicable
5. An encouraging closing message

Employee: ${userName}
Today's shift: ${shiftInfo}
${commuteInfo}
Pending tasks: ${pendingTasks.length > 0 ? pendingTasks.map(t => `- ${t.title}${t.description ? ': ' + t.description.substring(0, 50) : ''}`).join('\n') : 'No pending tasks'}
Available SOPs: ${publishedSops.length > 0 ? publishedSops.map(s => s.title).join(', ') : 'None yet'}`;

      const response = await anthropic.messages.create({
        model: DEFAULT_MODEL_STR,
        max_tokens: 512,
        system: systemPrompt,
        messages: [{ role: 'user', content: 'Generate my pre-shift briefing for today.' }],
      });

      const briefing = response.content[0].type === 'text'
        ? response.content[0].text
        : 'Unable to generate briefing. Have a great shift!';

      res.json({
        briefing,
        shiftInfo,
        pendingTaskCount: pendingTasks.length,
        commuteInfo: commuteInfo || null,
      });
    } catch (error: any) {
      console.error('Briefing error:', error);
      res.status(500).json({ message: "Failed to generate briefing." });
    }
  });

  app.get('/api/ai-assistant/commute', isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.user.id);
      if (!user?.homeLatitude || !user?.homeLongitude) {
        return res.json({ hasHomeLocation: false, message: "Set your home location in your profile to get commute estimates." });
      }

      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      today.setHours(0, 0, 0, 0);

      const schedules = await storage.getUserSchedules(req.user.id, today, tomorrow);
      if (schedules.length === 0) {
        return res.json({ hasHomeLocation: true, noShift: true, message: "No shifts scheduled today." });
      }

      const locations = await storage.getAllWorkLocations();
      const nextShift = schedules[0];
      const location = locations.find(l => l.id === nextShift.locationId);

      if (!location?.latitude || !location?.longitude) {
        return res.json({ hasHomeLocation: true, message: "Work location coordinates not set up." });
      }

      const distance = calculateDistance(
        parseFloat(user.homeLatitude),
        parseFloat(user.homeLongitude),
        parseFloat(location.latitude),
        parseFloat(location.longitude)
      );

      const estimatedMinutes = Math.round(distance / 0.5);
      const shiftStart = new Date(nextShift.startTime);
      const leaveBy = new Date(shiftStart.getTime() - (estimatedMinutes + 15) * 60 * 1000);

      const now = new Date();
      const minutesUntilLeave = Math.round((leaveBy.getTime() - now.getTime()) / 60000);

      let urgency: 'relaxed' | 'soon' | 'now' | 'late' = 'relaxed';
      if (minutesUntilLeave <= 0) urgency = 'late';
      else if (minutesUntilLeave <= 15) urgency = 'now';
      else if (minutesUntilLeave <= 45) urgency = 'soon';

      res.json({
        hasHomeLocation: true,
        distance: Math.round(distance * 10) / 10,
        estimatedMinutes,
        leaveBy: leaveBy.toISOString(),
        shiftStart: shiftStart.toISOString(),
        minutesUntilLeave,
        urgency,
        locationName: location.name,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.put('/api/ai-assistant/home-location', isAuthenticated, async (req: any, res) => {
    try {
      const locationSchema = z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      });
      const { latitude, longitude } = locationSchema.parse(req.body);
      await storage.updateUser(req.user.id, {
        homeLatitude: latitude.toString(),
        homeLongitude: longitude.toString(),
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get('/api/ai-assistant/commute-alerts', isAuthenticated, async (req: any, res) => {
    try {
      const alerts = await storage.getUserCommuteAlerts(req.user.id);
      res.json(alerts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post('/api/ai/ask', isAuthenticated, askRateLimiter, async (req: any, res) => {
    try {
      const schema = z.object({
        question: z.string().min(1).max(1000),
        conversationId: z.string().optional(),
      });
      const { question, conversationId } = schema.parse(req.body);

      if (conversationId) {
        const conv = await db.select({ userId: aiChatConversations.userId })
          .from(aiChatConversations)
          .where(eq(aiChatConversations.id, conversationId))
          .then(r => r[0]);
        if (!conv || conv.userId !== req.user.id) {
          return res.status(403).json({ message: "Access denied" });
        }
      }

      const storeId = req.user.storeId || "default";

      const taskPatterns = /what should i (be doing|do|focus|work on)|what.s next|what now|priorit|where (do i|should i) start/i;
      let enrichedQuestion = question;
      if (taskPatterns.test(question) && storeId !== "default") {
        try {
          const suggestions = await generateTaskSuggestions(req.user.id, storeId);
          if (suggestions.suggestions.length > 0) {
            const sugList = suggestions.suggestions.map(s =>
              `${s.priority}. [${s.urgency}] ${s.title} — ${s.reason}${s.time_estimate_minutes ? ` (~${s.time_estimate_minutes}min)` : ""}`
            ).join("\n");
            enrichedQuestion = `${question}\n\n[SMART TASK ADVISOR DATA — use this to inform your answer]\nContext: ${suggestions.context_note}\nPrioritized suggestions:\n${sugList}`;
          }
        } catch {}
      }

      const result = await askMAinager({
        question: enrichedQuestion,
        employeeId: req.user.id,
        storeId,
        conversationId,
      });

      res.json(result);
    } catch (error: any) {
      console.error("[Ask MAinager] Error:", error.message);
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid request" });
      }
      res.status(500).json({
        answer: "I'm having a little trouble right now. Please try again in a moment.",
        confidence: "low",
        referencedSops: [],
        suggestedActions: [],
        conversationId: "",
      });
    }
  });

  app.post('/api/ai/feedback', isAuthenticated, async (req: any, res) => {
    try {
      const schema = z.object({
        conversationId: z.string(),
        messageIndex: z.number().int().min(0),
        helpful: z.boolean(),
        feedbackText: z.string().max(500).optional(),
      });
      const data = schema.parse(req.body);

      const conv = await db.select().from(aiChatConversations)
        .where(and(
          eq(aiChatConversations.id, data.conversationId),
          eq(aiChatConversations.userId, req.user.id),
        )).then(r => r[0]);

      if (!conv) {
        return res.status(403).json({ message: "Access denied" });
      }

      await db.insert(aiFeedback).values({
        conversationId: data.conversationId,
        messageIndex: data.messageIndex,
        helpful: data.helpful,
        feedbackText: data.feedbackText || null,
      });

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get('/api/ai/conversations', isAuthenticated, async (req: any, res) => {
    try {
      const conversations = await db.select({
        id: aiChatConversations.id,
        title: aiChatConversations.title,
        lastMessageAt: aiChatConversations.lastMessageAt,
        createdAt: aiChatConversations.createdAt,
      }).from(aiChatConversations)
        .where(eq(aiChatConversations.userId, req.user.id))
        .orderBy(desc(aiChatConversations.lastMessageAt))
        .limit(10);

      res.json(conversations);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
