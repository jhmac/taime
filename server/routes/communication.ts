import type { Express } from "express";
import type { IStorage } from "../storage";
import { insertMessageSchema, insertShoutoutSchema } from "@shared/schema";
import { z } from "zod";

export function registerCommunicationRoutes(app: Express, storage: IStorage, isAuthenticated: any, broadcastToAll: (data: any) => void) {
  app.post('/api/messages', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const data = insertMessageSchema.parse({ ...req.body, senderId: userId });
      
      const message = await storage.createMessage(data);
      
      broadcastToAll({
        type: 'message_created',
        data: { message },
      });

      res.json(message);
    } catch (error) {
      console.error("Error creating message:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.get('/api/messages', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const messages = await storage.getMessages(userId);
      res.json(messages);
    } catch (error) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });

  app.post('/api/groups', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const userPermissions = await storage.getUserPermissions(userId);
      const canCreateGroups = userPermissions.some(p => p.name === 'communication.create_groups');
      
      if (!canCreateGroups) {
        return res.status(403).json({ message: "Group creation access required" });
      }

      const { name, description, memberIds } = req.body;
      
      const group = await storage.createGroup({ 
        name, 
        description, 
        createdBy: userId 
      });
      
      await storage.addGroupMember({ groupId: group.id, userId });
      
      if (memberIds && Array.isArray(memberIds)) {
        for (const memberId of memberIds) {
          await storage.addGroupMember({ groupId: group.id, userId: memberId });
        }
      }

      res.json(group);
    } catch (error) {
      console.error("Error creating group:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.get('/api/groups', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const groups = await storage.getGroups(userId);
      res.json(groups);
    } catch (error) {
      console.error("Error fetching groups:", error);
      res.status(500).json({ message: "Failed to fetch groups" });
    }
  });

  app.get('/api/groups/:groupId/messages', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { groupId } = req.params;
      
      const members = await storage.getGroupMembers(groupId);
      const isMember = members.some(m => m.userId === userId);
      
      if (!isMember) {
        return res.status(403).json({ message: "Not a member of this group" });
      }

      const messages = await storage.getGroupMessages(groupId);
      res.json(messages);
    } catch (error) {
      console.error("Error fetching group messages:", error);
      res.status(500).json({ message: "Failed to fetch group messages" });
    }
  });

  app.get('/api/groups/:groupId/members', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { groupId } = req.params;
      
      const members = await storage.getGroupMembers(groupId);
      const isMember = members.some(m => m.userId === userId);
      
      if (!isMember) {
        return res.status(403).json({ message: "Not a member of this group" });
      }

      res.json(members);
    } catch (error) {
      console.error("Error fetching group members:", error);
      res.status(500).json({ message: "Failed to fetch group members" });
    }
  });

  app.post('/api/groups/:groupId/members', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { groupId } = req.params;
      const { userIds } = req.body;
      
      const userPermissions = await storage.getUserPermissions(userId);
      const canManageGroups = userPermissions.some(p => p.name === 'communication.manage_groups');
      
      if (!canManageGroups) {
        return res.status(403).json({ message: "Group management access required" });
      }

      const addedMembers = [];
      for (const newUserId of userIds) {
        const member = await storage.addGroupMember({ groupId, userId: newUserId });
        addedMembers.push(member);
      }

      res.json(addedMembers);
    } catch (error) {
      console.error("Error adding group members:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.get('/api/shoutouts', isAuthenticated, async (req: any, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const shoutoutsList = await storage.getShoutouts(limit);
      res.json(shoutoutsList);
    } catch (error) {
      console.error("Error fetching shoutouts:", error);
      res.status(500).json({ message: "Failed to fetch shoutouts" });
    }
  });

  app.post('/api/shoutouts', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const settings = await storage.getCompanySettings();
      if (settings && settings.allowShoutOuts === false) {
        return res.status(403).json({ message: "Shout-outs are disabled" });
      }
      const data = {
        senderId: userId,
        recipientId: req.body.recipientId,
        category: req.body.category,
        message: req.body.message,
        emoji: req.body.emoji || null,
        reactions: [],
      };
      const shoutout = await storage.createShoutout(data);
      broadcastToAll({ type: 'shoutout_created', data: { shoutout } });
      res.json(shoutout);
    } catch (error) {
      console.error("Error creating shoutout:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });

  app.post('/api/shoutouts/:id/react', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const emoji = req.body.emoji || '❤️';
      const shoutout = await storage.addShoutoutReaction(id, userId, emoji);
      res.json(shoutout);
    } catch (error) {
      console.error("Error reacting to shoutout:", error);
      res.status(400).json({ message: (error as Error).message });
    }
  });
}
