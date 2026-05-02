import {
  messages,
  chatGroups,
  groupMembers,
  shoutouts,
  kudos,
  commuteAlerts,
  knowledgeDocuments,
  supplies,
  trainingModules,
  employeeTrainingProgress,
  trainingLessons,
  trainingQuestions,
  trainingLessonProgress,
  trainingPracticeSchedule,
  trainingFlags,
  morningLearningMoments,
  morningMomentAnswers,
  dailyQuestionnaires,
  questionnaireResponses,
  userBadges,
  type Message,
  type InsertMessage,
  type ChatGroup,
  type InsertChatGroup,
  type GroupMember,
  type InsertGroupMember,
  type Shoutout,
  type InsertShoutout,
  type CommuteAlert,
  type InsertCommuteAlert,
  type KnowledgeDocument,
  type InsertKnowledgeDocument,
  type Supply,
  type InsertSupply,
  type TrainingModule,
  type InsertTrainingModule,
  type EmployeeTrainingProgress,
  type InsertEmployeeTrainingProgress,
  type TrainingLesson,
  type InsertTrainingLesson,
  type TrainingQuestion,
  type InsertTrainingQuestion,
  type TrainingLessonProgress,
  type InsertTrainingLessonProgress,
  type TrainingPracticeSchedule,
  type InsertTrainingPracticeSchedule,
  type TrainingFlag,
  type InsertTrainingFlag,
  type MorningLearningMoment,
  type InsertMorningLearningMoment,
  type MorningMomentAnswer,
  type InsertMorningMomentAnswer,
  type DailyQuestionnaire,
  type InsertDailyQuestionnaire,
  type QuestionnaireResponse,
  type InsertQuestionnaireResponse,
  type UserBadge,
  type InsertUserBadge,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, desc, gte, lte, sql } from "drizzle-orm";

export interface IMiscStorage {
  createMessage(message: InsertMessage): Promise<Message>;
  getMessages(userId?: string): Promise<Message[]>;
  markMessageAsRead(messageId: string, userId: string): Promise<void>;

  createGroup(group: InsertChatGroup): Promise<ChatGroup>;
  getGroups(userId: string): Promise<ChatGroup[]>;
  addGroupMember(member: InsertGroupMember): Promise<GroupMember>;
  removeGroupMember(groupId: string, userId: string): Promise<void>;
  getGroupMessages(groupId: string): Promise<Message[]>;
  getGroupMembers(groupId: string): Promise<GroupMember[]>;

  createShoutout(shoutout: InsertShoutout): Promise<Shoutout>;
  getShoutouts(limit?: number): Promise<Shoutout[]>;
  addShoutoutReaction(id: string, userId: string, emoji: string): Promise<Shoutout>;
  addKudoReaction(id: string, userId: string, emoji: string): Promise<typeof kudos.$inferSelect>;

  createCommuteAlert(alert: InsertCommuteAlert): Promise<CommuteAlert>;
  getUserCommuteAlerts(userId: string): Promise<CommuteAlert[]>;

  createKnowledgeDocument(doc: InsertKnowledgeDocument): Promise<KnowledgeDocument>;
  getKnowledgeDocuments(storeId?: string): Promise<KnowledgeDocument[]>;
  getKnowledgeDocument(id: string): Promise<KnowledgeDocument | undefined>;
  updateKnowledgeDocument(id: string, updates: Partial<KnowledgeDocument>): Promise<KnowledgeDocument>;
  deleteKnowledgeDocument(id: string): Promise<void>;

  getSupplies(companyId: string, since?: Date): Promise<Supply[]>;
  createSupply(data: InsertSupply): Promise<Supply>;
  updateSupply(id: string, companyId: string, updates: Partial<Supply>): Promise<Supply>;

  createTrainingModule(module: InsertTrainingModule): Promise<TrainingModule>;
  getTrainingModules(storeId?: string): Promise<TrainingModule[]>;
  updateTrainingModule(id: string, updates: Partial<TrainingModule>): Promise<TrainingModule>;
  deleteTrainingModule(id: string): Promise<void>;

  getEmployeeTrainingProgress(userId: string): Promise<EmployeeTrainingProgress[]>;
  upsertEmployeeTrainingProgress(progress: InsertEmployeeTrainingProgress): Promise<EmployeeTrainingProgress>;

  createTrainingLesson(lesson: InsertTrainingLesson): Promise<TrainingLesson>;
  getTrainingLessons(moduleId: string): Promise<TrainingLesson[]>;
  updateTrainingLesson(id: string, updates: Partial<TrainingLesson>): Promise<TrainingLesson>;
  deleteTrainingLesson(id: string): Promise<void>;

  createTrainingQuestion(question: InsertTrainingQuestion): Promise<TrainingQuestion>;
  getTrainingQuestions(lessonId: string): Promise<TrainingQuestion[]>;
  getTrainingQuestion(id: string): Promise<TrainingQuestion | undefined>;

  upsertTrainingLessonProgress(progress: InsertTrainingLessonProgress): Promise<TrainingLessonProgress>;
  getTrainingLessonProgress(employeeId: string, moduleId?: string): Promise<TrainingLessonProgress[]>;
  getLessonProgress(employeeId: string, lessonId: string): Promise<TrainingLessonProgress | undefined>;

  upsertPracticeSchedule(item: InsertTrainingPracticeSchedule): Promise<TrainingPracticeSchedule>;
  getDuePracticeQuestions(employeeId: string, limit?: number): Promise<(TrainingPracticeSchedule & { question: TrainingQuestion })[]>;

  createTrainingFlag(flag: InsertTrainingFlag): Promise<TrainingFlag>;
  getTrainingFlags(status?: string): Promise<TrainingFlag[]>;
  updateTrainingFlag(id: string, updates: Partial<TrainingFlag>): Promise<TrainingFlag>;

  upsertMorningLearningMoment(moment: InsertMorningLearningMoment): Promise<MorningLearningMoment>;
  getMorningLearningMoment(storeId: string, date: string): Promise<MorningLearningMoment | undefined>;
  recordMorningMomentAnswer(answer: InsertMorningMomentAnswer): Promise<MorningMomentAnswer>;
  getMorningMomentAnswer(momentId: string, employeeId: string): Promise<MorningMomentAnswer | undefined>;

  getDailyQuestionnaire(storeId: string, date: string): Promise<DailyQuestionnaire | undefined>;
  getDailyQuestionnaireById(id: string): Promise<DailyQuestionnaire | undefined>;
  createDailyQuestionnaire(data: InsertDailyQuestionnaire): Promise<DailyQuestionnaire>;
  updateDailyQuestionnaire(id: string, updates: Partial<DailyQuestionnaire>): Promise<DailyQuestionnaire>;
  getQuestionnaireResponse(userId: string, questionnaireId: string): Promise<QuestionnaireResponse | undefined>;
  createQuestionnaireResponse(data: InsertQuestionnaireResponse): Promise<QuestionnaireResponse>;

  getUserBadges(userId: string): Promise<UserBadge[]>;
  getStoreBadges(storeId: string): Promise<UserBadge[]>;
  createUserBadge(data: InsertUserBadge): Promise<UserBadge>;
}

export class MiscStorage implements IMiscStorage {
  async createMessage(message: InsertMessage): Promise<Message> {
    const messageData = {
      ...message,
      readBy: Array.isArray(message.readBy) ? message.readBy : [],
    };
    const [created] = await db.insert(messages).values([messageData] as any).returning();
    return created;
  }

  async getMessages(userId?: string): Promise<Message[]> {
    const query = userId
      ? db.select().from(messages).where(
          and(
            eq(messages.isAnnouncement, true),
            sql`NOT (${messages.readBy} @> ${JSON.stringify([userId])})`
          )
        )
      : db.select().from(messages);

    return await query.orderBy(desc(messages.createdAt)).limit(200);
  }

  async markMessageAsRead(messageId: string, userId: string): Promise<void> {
    await db
      .update(messages)
      .set({
        readBy: sql`${messages.readBy} || ${JSON.stringify([userId])}`
      })
      .where(eq(messages.id, messageId));
  }

  async createGroup(group: InsertChatGroup): Promise<ChatGroup> {
    const [created] = await db.insert(chatGroups).values(group).returning();
    return created;
  }

  async getGroups(userId: string): Promise<ChatGroup[]> {
    const result = await db
      .select({ group: chatGroups })
      .from(chatGroups)
      .innerJoin(groupMembers, eq(chatGroups.id, groupMembers.groupId))
      .where(and(
        eq(groupMembers.userId, userId),
        eq(chatGroups.isActive, true)
      ))
      .orderBy(desc(chatGroups.updatedAt));

    return result.map(row => row.group);
  }

  async addGroupMember(member: InsertGroupMember): Promise<GroupMember> {
    const [created] = await db.insert(groupMembers).values(member).returning();
    return created;
  }

  async removeGroupMember(groupId: string, userId: string): Promise<void> {
    await db
      .delete(groupMembers)
      .where(and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.userId, userId)
      ));
  }

  async getGroupMessages(groupId: string): Promise<Message[]> {
    return await db
      .select()
      .from(messages)
      .where(eq(messages.groupId, groupId))
      .orderBy(desc(messages.createdAt))
      .limit(100);
  }

  async getGroupMembers(groupId: string): Promise<GroupMember[]> {
    return await db
      .select()
      .from(groupMembers)
      .where(eq(groupMembers.groupId, groupId))
      .orderBy(groupMembers.joinedAt);
  }

  async createShoutout(shoutout: InsertShoutout): Promise<Shoutout> {
    const [created] = await db.insert(shoutouts).values(shoutout as any).returning();
    return created;
  }

  async getShoutouts(limit: number = 50): Promise<Shoutout[]> {
    return await db
      .select()
      .from(shoutouts)
      .orderBy(desc(shoutouts.createdAt))
      .limit(limit);
  }

  async addShoutoutReaction(id: string, userId: string, emoji: string): Promise<Shoutout> {
    const [existing] = await db.select().from(shoutouts).where(eq(shoutouts.id, id));
    if (!existing) throw new Error("Shoutout not found");
    const currentReactions = (existing.reactions || []) as Array<{ userId: string; emoji: string }>;
    const alreadyReacted = currentReactions.find(r => r.userId === userId && r.emoji === emoji);
    let newReactions;
    if (alreadyReacted) {
      newReactions = currentReactions.filter(r => !(r.userId === userId && r.emoji === emoji));
    } else {
      newReactions = [...currentReactions, { userId, emoji }];
    }
    const [updated] = await db
      .update(shoutouts)
      .set({ reactions: newReactions })
      .where(eq(shoutouts.id, id))
      .returning();
    return updated;
  }

  async addKudoReaction(id: string, userId: string, emoji: string): Promise<typeof kudos.$inferSelect> {
    const [existing] = await db.select().from(kudos).where(eq(kudos.id, id));
    if (!existing) throw new Error("Kudo not found");
    const currentReactions = (existing.reactions || []) as Array<{ userId: string; emoji: string }>;
    const alreadyReacted = currentReactions.find(r => r.userId === userId && r.emoji === emoji);
    const newReactions = alreadyReacted
      ? currentReactions.filter(r => !(r.userId === userId && r.emoji === emoji))
      : [...currentReactions, { userId, emoji }];
    const [updated] = await db
      .update(kudos)
      .set({ reactions: newReactions })
      .where(eq(kudos.id, id))
      .returning();
    return updated;
  }

  async createCommuteAlert(alert: InsertCommuteAlert): Promise<CommuteAlert> {
    const [created] = await db.insert(commuteAlerts).values(alert).returning();
    return created;
  }

  async getUserCommuteAlerts(userId: string): Promise<CommuteAlert[]> {
    return await db
      .select()
      .from(commuteAlerts)
      .where(eq(commuteAlerts.userId, userId))
      .orderBy(desc(commuteAlerts.createdAt))
      .limit(50);
  }

  async createKnowledgeDocument(doc: InsertKnowledgeDocument): Promise<KnowledgeDocument> {
    const [created] = await db.insert(knowledgeDocuments).values(doc).returning();
    return created;
  }

  async getKnowledgeDocuments(storeId?: string): Promise<KnowledgeDocument[]> {
    if (storeId) {
      return await db
        .select()
        .from(knowledgeDocuments)
        .where(eq(knowledgeDocuments.storeId, storeId))
        .orderBy(desc(knowledgeDocuments.createdAt));
    }
    return await db
      .select()
      .from(knowledgeDocuments)
      .orderBy(desc(knowledgeDocuments.createdAt));
  }

  async getKnowledgeDocument(id: string): Promise<KnowledgeDocument | undefined> {
    const [doc] = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, id)).limit(1);
    return doc;
  }

  async updateKnowledgeDocument(id: string, updates: Partial<KnowledgeDocument>): Promise<KnowledgeDocument> {
    const [updated] = await db
      .update(knowledgeDocuments)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(knowledgeDocuments.id, id))
      .returning();
    return updated;
  }

  async deleteKnowledgeDocument(id: string): Promise<void> {
    await db.delete(knowledgeDocuments).where(eq(knowledgeDocuments.id, id));
  }

  async getSupplies(companyId: string, since?: Date): Promise<Supply[]> {
    const conditions = [eq(supplies.companyId, companyId)];
    if (since) conditions.push(gte(supplies.requestedAt, since));
    return db.select().from(supplies).where(and(...conditions)).orderBy(desc(supplies.requestedAt));
  }

  async createSupply(data: InsertSupply): Promise<Supply> {
    const [row] = await db.insert(supplies).values(data).returning();
    return row;
  }

  async updateSupply(id: string, companyId: string, updates: Partial<Supply>): Promise<Supply> {
    const [row] = await db.update(supplies).set(updates)
      .where(and(eq(supplies.id, id), eq(supplies.companyId, companyId)))
      .returning();
    if (!row) throw new Error('Supply not found or access denied');
    return row;
  }

  async createTrainingModule(module: InsertTrainingModule): Promise<TrainingModule> {
    const [created] = await db.insert(trainingModules).values(module).returning();
    return created;
  }

  async getTrainingModules(storeId?: string): Promise<TrainingModule[]> {
    if (storeId) {
      return await db.select().from(trainingModules).where(eq(trainingModules.storeId, storeId)).orderBy(trainingModules.createdAt);
    }
    return await db.select().from(trainingModules).orderBy(trainingModules.createdAt);
  }

  async updateTrainingModule(id: string, updates: Partial<TrainingModule>): Promise<TrainingModule> {
    const [updated] = await db
      .update(trainingModules)
      .set(updates)
      .where(eq(trainingModules.id, id))
      .returning();
    return updated;
  }

  async deleteTrainingModule(id: string): Promise<void> {
    await db.delete(trainingModules).where(eq(trainingModules.id, id));
  }

  async getEmployeeTrainingProgress(userId: string): Promise<EmployeeTrainingProgress[]> {
    return await db
      .select()
      .from(employeeTrainingProgress)
      .where(eq(employeeTrainingProgress.userId, userId))
      .orderBy(employeeTrainingProgress.createdAt);
  }

  async upsertEmployeeTrainingProgress(progress: InsertEmployeeTrainingProgress): Promise<EmployeeTrainingProgress> {
    const existing = await db
      .select()
      .from(employeeTrainingProgress)
      .where(
        and(
          eq(employeeTrainingProgress.userId, progress.userId),
          eq(employeeTrainingProgress.moduleId, progress.moduleId)
        )
      );

    if (existing.length > 0) {
      const [updated] = await db
        .update(employeeTrainingProgress)
        .set(progress)
        .where(eq(employeeTrainingProgress.id, existing[0].id))
        .returning();
      return updated;
    }

    const [created] = await db.insert(employeeTrainingProgress).values(progress).returning();
    return created;
  }

  async createTrainingLesson(lesson: InsertTrainingLesson): Promise<TrainingLesson> {
    const [row] = await db.insert(trainingLessons).values(lesson).returning();
    return row;
  }

  async getTrainingLessons(moduleId: string): Promise<TrainingLesson[]> {
    return db
      .select()
      .from(trainingLessons)
      .where(eq(trainingLessons.moduleId, moduleId))
      .orderBy(trainingLessons.orderIndex);
  }

  async updateTrainingLesson(id: string, updates: Partial<TrainingLesson>): Promise<TrainingLesson> {
    const [row] = await db.update(trainingLessons).set(updates).where(eq(trainingLessons.id, id)).returning();
    return row;
  }

  async deleteTrainingLesson(id: string): Promise<void> {
    await db.delete(trainingLessons).where(eq(trainingLessons.id, id));
  }

  async createTrainingQuestion(question: InsertTrainingQuestion): Promise<TrainingQuestion> {
    const [row] = await db.insert(trainingQuestions).values(question).returning();
    return row;
  }

  async getTrainingQuestions(lessonId: string): Promise<TrainingQuestion[]> {
    return db.select().from(trainingQuestions).where(eq(trainingQuestions.lessonId, lessonId));
  }

  async getTrainingQuestion(id: string): Promise<TrainingQuestion | undefined> {
    const [row] = await db.select().from(trainingQuestions).where(eq(trainingQuestions.id, id)).limit(1);
    return row;
  }

  async upsertTrainingLessonProgress(progress: InsertTrainingLessonProgress): Promise<TrainingLessonProgress> {
    const [row] = await db
      .insert(trainingLessonProgress)
      .values(progress)
      .onConflictDoUpdate({
        target: [trainingLessonProgress.employeeId, trainingLessonProgress.lessonId],
        set: { ...progress, updatedAt: new Date() },
      })
      .returning();
    return row;
  }

  async getTrainingLessonProgress(employeeId: string, moduleId?: string): Promise<TrainingLessonProgress[]> {
    const conditions = [eq(trainingLessonProgress.employeeId, employeeId)];
    if (moduleId) conditions.push(eq(trainingLessonProgress.moduleId, moduleId));
    return db.select().from(trainingLessonProgress).where(and(...conditions));
  }

  async getLessonProgress(employeeId: string, lessonId: string): Promise<TrainingLessonProgress | undefined> {
    const [row] = await db
      .select()
      .from(trainingLessonProgress)
      .where(and(eq(trainingLessonProgress.employeeId, employeeId), eq(trainingLessonProgress.lessonId, lessonId)))
      .limit(1);
    return row;
  }

  async upsertPracticeSchedule(item: InsertTrainingPracticeSchedule): Promise<TrainingPracticeSchedule> {
    const [row] = await db
      .insert(trainingPracticeSchedule)
      .values(item)
      .onConflictDoUpdate({
        target: [trainingPracticeSchedule.employeeId, trainingPracticeSchedule.questionId],
        set: item,
      })
      .returning();
    return row;
  }

  async getDuePracticeQuestions(employeeId: string, limit = 5): Promise<(TrainingPracticeSchedule & { question: TrainingQuestion })[]> {
    const now = new Date();
    const rows = await db
      .select()
      .from(trainingPracticeSchedule)
      .innerJoin(trainingQuestions, eq(trainingPracticeSchedule.questionId, trainingQuestions.id))
      .where(and(eq(trainingPracticeSchedule.employeeId, employeeId), lte(trainingPracticeSchedule.nextReviewAt, now)))
      .orderBy(trainingPracticeSchedule.nextReviewAt)
      .limit(limit);
    return rows.map(r => ({ ...r.training_practice_schedule, question: r.training_questions }));
  }

  async createTrainingFlag(flag: InsertTrainingFlag): Promise<TrainingFlag> {
    const [row] = await db.insert(trainingFlags).values(flag).returning();
    return row;
  }

  async getTrainingFlags(status?: string): Promise<TrainingFlag[]> {
    if (status) {
      return db.select().from(trainingFlags).where(eq(trainingFlags.status, status)).orderBy(desc(trainingFlags.createdAt));
    }
    return db.select().from(trainingFlags).orderBy(desc(trainingFlags.createdAt));
  }

  async updateTrainingFlag(id: string, updates: Partial<TrainingFlag>): Promise<TrainingFlag> {
    const [row] = await db.update(trainingFlags).set(updates).where(eq(trainingFlags.id, id)).returning();
    return row;
  }

  async upsertMorningLearningMoment(moment: InsertMorningLearningMoment): Promise<MorningLearningMoment> {
    const [row] = await db
      .insert(morningLearningMoments)
      .values(moment)
      .onConflictDoUpdate({
        target: [morningLearningMoments.storeId, morningLearningMoments.momentDate],
        set: moment,
      })
      .returning();
    return row;
  }

  async getMorningLearningMoment(storeId: string, date: string): Promise<MorningLearningMoment | undefined> {
    const [row] = await db
      .select()
      .from(morningLearningMoments)
      .where(and(eq(morningLearningMoments.storeId, storeId), eq(morningLearningMoments.momentDate, date)))
      .limit(1);
    return row;
  }

  async recordMorningMomentAnswer(answer: InsertMorningMomentAnswer): Promise<MorningMomentAnswer> {
    const [row] = await db.insert(morningMomentAnswers).values(answer).returning();
    return row;
  }

  async getMorningMomentAnswer(momentId: string, employeeId: string): Promise<MorningMomentAnswer | undefined> {
    const [row] = await db
      .select()
      .from(morningMomentAnswers)
      .where(and(eq(morningMomentAnswers.momentId, momentId), eq(morningMomentAnswers.employeeId, employeeId)))
      .limit(1);
    return row;
  }

  async getDailyQuestionnaire(storeId: string, date: string): Promise<DailyQuestionnaire | undefined> {
    const [row] = await db
      .select()
      .from(dailyQuestionnaires)
      .where(and(eq(dailyQuestionnaires.storeId, storeId), eq(dailyQuestionnaires.quizDate, date)))
      .limit(1);
    return row;
  }

  async getDailyQuestionnaireById(id: string): Promise<DailyQuestionnaire | undefined> {
    const [row] = await db.select().from(dailyQuestionnaires).where(eq(dailyQuestionnaires.id, id)).limit(1);
    return row;
  }

  async createDailyQuestionnaire(data: InsertDailyQuestionnaire): Promise<DailyQuestionnaire> {
    const [row] = await db.insert(dailyQuestionnaires).values(data).returning();
    return row;
  }

  async updateDailyQuestionnaire(id: string, updates: Partial<DailyQuestionnaire>): Promise<DailyQuestionnaire> {
    const [row] = await db
      .update(dailyQuestionnaires)
      .set(updates)
      .where(eq(dailyQuestionnaires.id, id))
      .returning();
    return row;
  }

  async getQuestionnaireResponse(userId: string, questionnaireId: string): Promise<QuestionnaireResponse | undefined> {
    const [row] = await db
      .select()
      .from(questionnaireResponses)
      .where(and(eq(questionnaireResponses.userId, userId), eq(questionnaireResponses.questionnaireId, questionnaireId)))
      .limit(1);
    return row;
  }

  async createQuestionnaireResponse(data: InsertQuestionnaireResponse): Promise<QuestionnaireResponse> {
    const [row] = await db.insert(questionnaireResponses).values(data).returning();
    return row;
  }

  async getUserBadges(userId: string): Promise<UserBadge[]> {
    return db.select().from(userBadges).where(eq(userBadges.userId, userId));
  }

  async getStoreBadges(storeId: string): Promise<UserBadge[]> {
    return db.select().from(userBadges).where(eq(userBadges.storeId, storeId));
  }

  async createUserBadge(data: InsertUserBadge): Promise<UserBadge> {
    const [row] = await db.insert(userBadges).values(data).returning();
    return row;
  }
}
