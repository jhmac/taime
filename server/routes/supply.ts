import type { Express } from "express";
import { db } from "../db";
import { eq, and, desc, inArray } from "drizzle-orm";
import {
  supplyItems,
  inventoryCountSessions,
  inventoryCountEntries,
  tasks,
  insertSupplyItemSchema,
  insertInventoryCountSessionSchema,
  users,
  roles,
} from "@shared/schema";
import type { IStorage } from "../storage";
import { resolveStoreId } from "../lib/storeResolver";
import logger from "../lib/logger";
import { z } from "zod";

async function isAdminOrManager(storage: IStorage, userId: string): Promise<boolean> {
  const user = await storage.getUserWithRole(userId);
  return ["owner", "admin", "manager"].includes(user?.role?.name || "");
}

/**
 * Resolve the default admin assignee for reorder tasks.
 * Uses a single JOIN query scoped to users with a management role.
 * Falls back to the requesting user if no admin is found.
 */
async function resolveAdminAssignee(storage: IStorage, requestUserId: string): Promise<string> {
  // If the requesting user is already admin/manager/owner, use them directly
  const reqUser = await storage.getUserWithRole(requestUserId);
  if (["owner", "admin", "manager"].includes(reqUser?.role?.name || "")) {
    return requestUserId;
  }
  // Find first admin/owner/manager via a single scoped JOIN (no broad user table scan)
  const [adminUser] = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(inArray(roles.name, ["owner", "admin", "manager"]))
    .limit(1);
  return adminUser?.id ?? requestUserId;
}

export function registerSupplyRoutes(app: Express, storage: IStorage, isAuthenticated: any) {

  // ── Supply Items ────────────────────────────────────────────────────────

  app.get("/api/supply/items", isAuthenticated, async (req: any, res) => {
    try {
      const storeId = (await resolveStoreId()) || "default";
      const includeArchived = req.query.archived === "true";
      const items = await db
        .select()
        .from(supplyItems)
        .where(
          includeArchived
            ? eq(supplyItems.storeId, storeId)
            : and(eq(supplyItems.storeId, storeId), eq(supplyItems.isActive, true))
        )
        .orderBy(supplyItems.category, supplyItems.name);
      res.json(items);
    } catch (err: any) {
      logger.error({ error: err.message }, "[Supply] Failed to fetch items");
      res.status(500).json({ message: "Failed to fetch supply items" });
    }
  });

  app.post("/api/supply/items", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isAdminOrManager(storage, req.user.id))) {
        return res.status(403).json({ message: "Admin access required" });
      }
      const storeId = (await resolveStoreId()) || "default";
      const data = insertSupplyItemSchema.parse({
        ...req.body,
        storeId,
        createdBy: req.user.id,
      });
      const [item] = await db.insert(supplyItems).values(data).returning();
      res.status(201).json(item);
    } catch (err: any) {
      logger.error({ error: err.message }, "[Supply] Failed to create item");
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/supply/items/:id", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isAdminOrManager(storage, req.user.id))) {
        return res.status(403).json({ message: "Admin access required" });
      }
      const { id } = req.params;
      const allowed = [
        "name", "category", "unit", "parLevel", "safetyStock",
        "orderUrl", "supplierName", "isLocalPickup", "notes", "isActive",
      ];
      const updates: Record<string, any> = {};
      for (const key of allowed) {
        if (key in req.body) updates[key] = req.body[key];
      }
      updates.updatedAt = new Date();

      const [updated] = await db
        .update(supplyItems)
        .set(updates)
        .where(eq(supplyItems.id, id))
        .returning();
      if (!updated) return res.status(404).json({ message: "Item not found" });
      res.json(updated);
    } catch (err: any) {
      logger.error({ error: err.message }, "[Supply] Failed to update item");
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/supply/items/:id", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isAdminOrManager(storage, req.user.id))) {
        return res.status(403).json({ message: "Admin access required" });
      }
      await db
        .update(supplyItems)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(supplyItems.id, req.params.id));
      res.json({ message: "Item archived" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Weekly Recurring Task Template ──────────────────────────────────────

  app.post("/api/supply/weekly-schedule", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isAdminOrManager(storage, req.user.id))) {
        return res.status(403).json({ message: "Admin access required" });
      }
      const { dayOfWeek, timeOfDay } = z.object({
        dayOfWeek: z.string(),
        timeOfDay: z.string(),
      }).parse(req.body);

      const storeId = (await resolveStoreId()) || "default";
      const userId = req.user.id;

      // Deactivate any existing inventory count recurring tasks first
      await db
        .update(tasks)
        .set({ status: "cancelled" })
        .where(
          and(
            eq(tasks.isRecurring, true),
            eq(tasks.createdBy, userId)
          )
        );

      // Create the recurring task — the AI auto-assign will pick it up
      const [task] = await db
        .insert(tasks)
        .values({
          title: "📦 Weekly Inventory Count",
          description:
            `Complete the store supply inventory count. Open this task and tap the link to start counting:\n\n` +
            `/supply/count/new\n\n` +
            `Count every supply item, enter current quantities. The app will automatically flag low-stock items and generate reorder tasks.`,
          createdBy: userId,
          locationId: null,
          status: "pending",
          isRecurring: true,
          dayOfWeek,
          timeOfDay,
          estimatedMinutes: 20,
          priority: "medium",
        })
        .returning();

      res.json({ task, message: `Inventory count scheduled for ${dayOfWeek} ${timeOfDay}` });
    } catch (err: any) {
      logger.error({ error: err.message }, "[Supply] Failed to set weekly schedule");
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/supply/weekly-schedule", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const [existing] = await db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.isRecurring, true),
            eq(tasks.title, "📦 Weekly Inventory Count"),
            eq(tasks.status, "pending")
          )
        )
        .limit(1);
      res.json(existing || null);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Inventory Count Sessions ─────────────────────────────────────────────

  app.get("/api/supply/sessions", isAuthenticated, async (req: any, res) => {
    try {
      const storeId = (await resolveStoreId()) || "default";
      const sessions = await db
        .select()
        .from(inventoryCountSessions)
        .where(eq(inventoryCountSessions.storeId, storeId))
        .orderBy(desc(inventoryCountSessions.createdAt))
        .limit(20);
      res.json(sessions);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/supply/sessions", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isAdminOrManager(storage, req.user.id))) {
        return res.status(403).json({ message: "Admin access required" });
      }
      const storeId = (await resolveStoreId()) || "default";
      const { assignedTo, categories, notes } = z.object({
        assignedTo: z.string().optional(),
        categories: z.array(z.string()).optional(),
        notes: z.string().optional(),
      }).parse(req.body);

      const assignee = assignedTo || req.user.id;

      // Create the linked task
      const [linkedTask] = await db
        .insert(tasks)
        .values({
          title: "📦 Inventory Count",
          description:
            `You've been assigned an inventory count. Open the app and go to:\n\n/supply/count/new\n\nCount each item and enter the current quantity.`,
          assignedTo: assignee,
          createdBy: req.user.id,
          status: "pending",
          priority: "medium",
          estimatedMinutes: 20,
          isRecurring: false,
          dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        })
        .returning();

      const [session] = await db
        .insert(inventoryCountSessions)
        .values({
          storeId,
          assignedTo: assignee,
          assignedBy: req.user.id,
          status: "pending",
          categories: categories || null,
          taskId: linkedTask.id,
          notes: notes || null,
        })
        .returning();

      // Update task description with actual session link
      await db
        .update(tasks)
        .set({
          description:
            `You've been assigned an inventory count. Tap the link below to start:\n\n` +
            `/supply/count/${session.id}\n\n` +
            `Count each supply item and enter the current quantity. The app will handle the rest.`,
        })
        .where(eq(tasks.id, linkedTask.id));

      res.status(201).json({ session, task: linkedTask });
    } catch (err: any) {
      logger.error({ error: err.message }, "[Supply] Failed to create session");
      res.status(400).json({ message: err.message });
    }
  });

  // Start a "new" session for the current user (used from recurring task link)
  app.post("/api/supply/sessions/quick-start", isAuthenticated, async (req: any, res) => {
    try {
      const storeId = (await resolveStoreId()) || "default";
      const userId = req.user.id;

      // Check if there's already an active session for this user
      const [existing] = await db
        .select()
        .from(inventoryCountSessions)
        .where(
          and(
            eq(inventoryCountSessions.storeId, storeId),
            eq(inventoryCountSessions.assignedTo, userId),
            eq(inventoryCountSessions.status, "in_progress")
          )
        )
        .limit(1);

      if (existing) {
        return res.json({ session: existing, existing: true });
      }

      // Create a fresh session assigned to the current user
      const [session] = await db
        .insert(inventoryCountSessions)
        .values({
          storeId,
          assignedTo: userId,
          assignedBy: userId,
          status: "pending",
          categories: null,
        })
        .returning();

      res.status(201).json({ session, existing: false });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/supply/sessions/:id", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const [session] = await db
        .select()
        .from(inventoryCountSessions)
        .where(eq(inventoryCountSessions.id, id))
        .limit(1);

      if (!session) return res.status(404).json({ message: "Session not found" });

      const storeId = session.storeId;
      let itemQuery = db
        .select()
        .from(supplyItems)
        .where(and(eq(supplyItems.storeId, storeId), eq(supplyItems.isActive, true)));

      const items = await itemQuery.orderBy(supplyItems.category, supplyItems.name);

      // Filter by categories if specified
      const filtered =
        session.categories && session.categories.length > 0
          ? items.filter((i) => session.categories!.includes(i.category))
          : items;

      // Get existing entries for this session
      const entries = await db
        .select()
        .from(inventoryCountEntries)
        .where(eq(inventoryCountEntries.sessionId, id));

      const entryByItemId = new Map(entries.map((e) => [e.supplyItemId, e]));

      res.json({ session, items: filtered, entries: Object.fromEntries(entryByItemId) });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Submit counts and auto-generate reorder tasks
  app.post("/api/supply/sessions/:id/submit", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { counts } = z.object({
        counts: z.array(
          z.object({
            supplyItemId: z.string(),
            countedQty: z.number().int().min(0),
            notes: z.string().optional(),
          })
        ),
      }).parse(req.body);

      const [session] = await db
        .select()
        .from(inventoryCountSessions)
        .where(eq(inventoryCountSessions.id, id))
        .limit(1);

      if (!session) return res.status(404).json({ message: "Session not found" });

      // Upsert entries and update supply items
      const lowItems: Array<{ item: any; counted: number; needed: number }> = [];

      for (const count of counts) {
        const [item] = await db
          .select()
          .from(supplyItems)
          .where(eq(supplyItems.id, count.supplyItemId))
          .limit(1);
        if (!item) continue;

        // Record the count entry
        await db
          .insert(inventoryCountEntries)
          .values({
            sessionId: id,
            supplyItemId: count.supplyItemId,
            countedQty: count.countedQty,
            previousQty: item.lastCountedQty,
            notes: count.notes || null,
          });

        // Update last counted on the item
        await db
          .update(supplyItems)
          .set({ lastCountedQty: count.countedQty, lastCountedAt: new Date(), updatedAt: new Date() })
          .where(eq(supplyItems.id, count.supplyItemId));

        // Track low items
        if (count.countedQty < item.parLevel) {
          lowItems.push({
            item,
            counted: count.countedQty,
            needed: item.parLevel - count.countedQty,
          });
        }
      }

      // Auto-generate reorder tasks for low items.
      // - Online/unspecified items → assigned to admin (deterministic via resolveAdminAssignee)
      // - Local-pickup items → created unassigned (assignedTo: null); returned in a separate
      //   localPickupTasks list so the UI can present an explicit assignment gate before finalization.
      const adminAssignee = await resolveAdminAssignee(storage, req.user.id);
      const reorderTasks: any[] = [];
      const localPickupTasks: any[] = [];

      for (const { item, counted, needed } of lowItems) {
        const isUrgent = counted <= item.safetyStock;
        const isLocalPickup = !!item.isLocalPickup;

        const orderLine = item.orderUrl
          ? `\nOrder online: ${item.orderUrl}`
          : isLocalPickup
          ? `\nLocal pickup needed — contact ${item.supplierName || "supplier"} to arrange in-store pickup.`
          : item.supplierName
          ? `\nSupplier: ${item.supplierName}`
          : "";

        // Local-pickup reorder tasks are left unassigned so a manager can explicitly assign
        // before the task is actioned. Online-order tasks are auto-assigned to admin.
        const taskAssignee = isLocalPickup ? null : adminAssignee;

        const [task] = await db
          .insert(tasks)
          .values({
            title: `${isUrgent ? "🔴" : "🟡"} Reorder: ${item.name} (need ${needed} ${item.unit})${isLocalPickup ? " — Pickup" : ""}`,
            description:
              `Inventory count: ${counted} ${item.unit} on hand, par ${item.parLevel}. ` +
              `Need to reorder ${needed} ${item.unit}.` + orderLine,
            createdBy: req.user.id,
            assignedTo: taskAssignee,
            status: "pending",
            priority: isUrgent ? "high" : "medium",
            estimatedMinutes: 10,
          })
          .returning();

        if (isLocalPickup) {
          localPickupTasks.push({ task, item });
        } else {
          reorderTasks.push({ task, item });
        }
      }

      // Mark session complete
      await db
        .update(inventoryCountSessions)
        .set({ status: "completed", completedAt: new Date() })
        .where(eq(inventoryCountSessions.id, id));

      // Mark linked task complete if it exists
      if (session.taskId) {
        await db
          .update(tasks)
          .set({ status: "completed", completedAt: new Date() })
          .where(eq(tasks.id, session.taskId));
      }

      res.json({
        message: "Inventory count submitted",
        lowItems: lowItems.length,
        reorderTasksCreated: reorderTasks.length + localPickupTasks.length,
        reorderTasks,
        localPickupTasks, // Unassigned — UI must present assignment gate before actioning
      });
    } catch (err: any) {
      logger.error({ error: err.message }, "[Supply] Failed to submit session");
      res.status(400).json({ message: err.message });
    }
  });

  // Assign a reorder task to a team member
  app.patch("/api/supply/reorder-tasks/:taskId/assign", isAuthenticated, async (req: any, res) => {
    try {
      if (!(await isAdminOrManager(storage, req.user.id))) {
        return res.status(403).json({ message: "Admin access required" });
      }
      const { assignedTo } = z.object({ assignedTo: z.string() }).parse(req.body);
      const [updated] = await db
        .update(tasks)
        .set({ assignedTo })
        .where(eq(tasks.id, req.params.taskId))
        .returning();
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ── Supply Dashboard Stats ───────────────────────────────────────────────
  // Returns aggregated stock status counts and recent session info for the dashboard summary.

  app.get("/api/supply/stats", isAuthenticated, async (req: any, res) => {
    try {
      const storeId = (await resolveStoreId()) || "default";

      const allItems = await db
        .select()
        .from(supplyItems)
        .where(and(eq(supplyItems.storeId, storeId), eq(supplyItems.isActive, true)));

      let stocked = 0, low = 0, critical = 0, unknown = 0;
      const reorderNeeded: { id: string; name: string; unit: string; parLevel: number; lastCountedQty: number | null; orderUrl: string | null; supplierName: string | null; isLocalPickup: boolean | null }[] = [];

      for (const item of allItems) {
        if (item.lastCountedQty === null) {
          unknown++;
        } else if (item.lastCountedQty <= item.safetyStock) {
          critical++;
          reorderNeeded.push({ id: item.id, name: item.name, unit: item.unit, parLevel: item.parLevel, lastCountedQty: item.lastCountedQty, orderUrl: item.orderUrl, supplierName: item.supplierName, isLocalPickup: item.isLocalPickup });
        } else if (item.lastCountedQty < item.parLevel) {
          low++;
          reorderNeeded.push({ id: item.id, name: item.name, unit: item.unit, parLevel: item.parLevel, lastCountedQty: item.lastCountedQty, orderUrl: item.orderUrl, supplierName: item.supplierName, isLocalPickup: item.isLocalPickup });
        } else {
          stocked++;
        }
      }

      const [lastSession] = await db
        .select({ id: inventoryCountSessions.id, completedAt: inventoryCountSessions.completedAt, status: inventoryCountSessions.status })
        .from(inventoryCountSessions)
        .where(and(eq(inventoryCountSessions.storeId, storeId), eq(inventoryCountSessions.status, "completed")))
        .orderBy(desc(inventoryCountSessions.completedAt))
        .limit(1);

      res.json({
        total: allItems.length,
        stocked,
        low,
        critical,
        unknown,
        reorderNeeded,
        lastCountedAt: lastSession?.completedAt || null,
      });
    } catch (err: any) {
      logger.error({ error: err.message }, "[Supply] Failed to fetch stats");
      res.status(500).json({ message: err.message });
    }
  });
}
