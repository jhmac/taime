import {
  sopCategories,
  sopDocuments,
  aiChatConversations,
  aiChatMessages,
  type SopCategory,
  type InsertSopCategory,
  type SopDocument,
  type InsertSopDocument,
  type AiChatConversation,
  type InsertAiChatConversation,
  type AiChatMessage,
  type InsertAiChatMessage,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, desc, sql } from "drizzle-orm";

export interface ISopStorage {
  createSopCategory(category: InsertSopCategory): Promise<SopCategory>;
  getSopCategories(storeId?: string): Promise<SopCategory[]>;
  updateSopCategory(id: string, updates: Partial<SopCategory>): Promise<SopCategory>;
  deleteSopCategory(id: string): Promise<void>;

  createSopDocument(doc: InsertSopDocument): Promise<SopDocument>;
  getSopDocuments(categoryId?: string): Promise<SopDocument[]>;
  getSopDocument(id: string): Promise<SopDocument | undefined>;
  updateSopDocument(id: string, updates: Partial<SopDocument>): Promise<SopDocument>;
  deleteSopDocument(id: string): Promise<void>;
  searchSopDocuments(query: string): Promise<SopDocument[]>;

  createAiChatConversation(conv: InsertAiChatConversation): Promise<AiChatConversation>;
  getUserConversations(userId: string): Promise<AiChatConversation[]>;
  getConversation(id: string): Promise<AiChatConversation | undefined>;
  deleteConversation(id: string): Promise<void>;

  createAiChatMessage(msg: InsertAiChatMessage): Promise<AiChatMessage>;
  getConversationMessages(conversationId: string): Promise<AiChatMessage[]>;
}

export class SopStorage implements ISopStorage {
  async createSopCategory(category: InsertSopCategory): Promise<SopCategory> {
    const [created] = await db.insert(sopCategories).values(category).returning();
    return created;
  }

  async getSopCategories(storeId?: string): Promise<SopCategory[]> {
    if (storeId) {
      return await db.select().from(sopCategories).where(eq(sopCategories.storeId, storeId)).orderBy(sopCategories.sortOrder);
    }
    return await db.select().from(sopCategories).orderBy(sopCategories.sortOrder);
  }

  async updateSopCategory(id: string, updates: Partial<SopCategory>): Promise<SopCategory> {
    const [updated] = await db
      .update(sopCategories)
      .set(updates)
      .where(eq(sopCategories.id, id))
      .returning();
    return updated;
  }

  async deleteSopCategory(id: string): Promise<void> {
    await db.delete(sopCategories).where(eq(sopCategories.id, id));
  }

  async createSopDocument(doc: InsertSopDocument): Promise<SopDocument> {
    const [created] = await db.insert(sopDocuments).values(doc).returning();
    return created;
  }

  async getSopDocuments(categoryId?: string): Promise<SopDocument[]> {
    if (categoryId) {
      return await db
        .select()
        .from(sopDocuments)
        .where(eq(sopDocuments.categoryId, categoryId))
        .orderBy(sopDocuments.title)
        .limit(200);
    }
    return await db.select().from(sopDocuments).orderBy(sopDocuments.title).limit(200);
  }

  async getSopDocument(id: string): Promise<SopDocument | undefined> {
    const [doc] = await db.select().from(sopDocuments).where(eq(sopDocuments.id, id));
    return doc;
  }

  async updateSopDocument(id: string, updates: Partial<SopDocument>): Promise<SopDocument> {
    const [updated] = await db
      .update(sopDocuments)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(sopDocuments.id, id))
      .returning();
    return updated;
  }

  async deleteSopDocument(id: string): Promise<void> {
    await db.delete(sopDocuments).where(eq(sopDocuments.id, id));
  }

  async searchSopDocuments(query: string): Promise<SopDocument[]> {
    const searchPattern = `%${query}%`;
    return await db
      .select()
      .from(sopDocuments)
      .where(
        and(
          eq(sopDocuments.isPublished, true),
          sql`(${sopDocuments.title} ILIKE ${searchPattern} OR ${sopDocuments.content} ILIKE ${searchPattern} OR ${sopDocuments.summary} ILIKE ${searchPattern})`
        )
      )
      .orderBy(sopDocuments.title);
  }

  async createAiChatConversation(conv: InsertAiChatConversation): Promise<AiChatConversation> {
    const [created] = await db.insert(aiChatConversations).values(conv).returning();
    return created;
  }

  async getUserConversations(userId: string): Promise<AiChatConversation[]> {
    return await db
      .select()
      .from(aiChatConversations)
      .where(eq(aiChatConversations.userId, userId))
      .orderBy(desc(aiChatConversations.lastMessageAt))
      .limit(50);
  }

  async getConversation(id: string): Promise<AiChatConversation | undefined> {
    const [conv] = await db.select().from(aiChatConversations).where(eq(aiChatConversations.id, id));
    return conv;
  }

  async deleteConversation(id: string): Promise<void> {
    await db.delete(aiChatMessages).where(eq(aiChatMessages.conversationId, id));
    await db.delete(aiChatConversations).where(eq(aiChatConversations.id, id));
  }

  async createAiChatMessage(msg: InsertAiChatMessage): Promise<AiChatMessage> {
    const [created] = await db.insert(aiChatMessages).values(msg).returning();
    await db
      .update(aiChatConversations)
      .set({ lastMessageAt: new Date() })
      .where(eq(aiChatConversations.id, msg.conversationId));
    return created;
  }

  async getConversationMessages(conversationId: string): Promise<AiChatMessage[]> {
    return await db
      .select()
      .from(aiChatMessages)
      .where(eq(aiChatMessages.conversationId, conversationId))
      .orderBy(aiChatMessages.createdAt)
      .limit(200);
  }
}
