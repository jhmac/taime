import type { Express } from "express";
import type { IStorage } from "../storage";

export function registerDayNoteRoutes(app: Express, storage: IStorage, isAuthenticated: any) {
  app.get('/api/day-notes', isAuthenticated, async (req: any, res) => {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        return res.status(400).json({ message: "startDate and endDate are required" });
      }
      const isAdmin = req.user?.role?.name === 'admin' || req.user?.role?.name === 'owner';

      if (isAdmin) {
        const notes = await storage.getDayNotes(startDate as string, endDate as string);
        return res.json(notes);
      }

      const notes = await storage.getDayNotesByUser(startDate as string, endDate as string, req.user.id);
      res.json(notes);
    } catch (error) {
      console.error("Error fetching day notes:", error);
      res.status(500).json({ message: "Failed to fetch day notes" });
    }
  });

  app.post('/api/day-notes', isAuthenticated, async (req: any, res) => {
    try {
      const { date, noteText, isManagerNote } = req.body;
      const userId = req.user.id;
      const isAdmin = req.user?.role?.name === 'admin' || req.user?.role?.name === 'owner';

      if (!date || !noteText) {
        return res.status(400).json({ message: "date and noteText are required" });
      }

      if (isManagerNote && !isAdmin) {
        return res.status(403).json({ message: "Only managers can create manager notes" });
      }

      const note = await storage.createDayNote({
        userId,
        date,
        noteText,
        isManagerNote: isManagerNote ?? false,
      });
      res.json(note);
    } catch (error) {
      console.error("Error creating day note:", error);
      res.status(500).json({ message: "Failed to create day note" });
    }
  });

  app.patch('/api/day-notes/:id', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { noteText } = req.body;
      const userId = req.user.id;
      const isAdmin = req.user?.role?.name === 'admin' || req.user?.role?.name === 'owner';

      if (!noteText) {
        return res.status(400).json({ message: "noteText is required" });
      }

      const existing = await storage.getDayNote(id);
      if (!existing) {
        return res.status(404).json({ message: "Note not found" });
      }

      if (existing.userId !== userId && !isAdmin) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const updated = await storage.updateDayNote(id, noteText);
      res.json(updated);
    } catch (error) {
      console.error("Error updating day note:", error);
      res.status(500).json({ message: "Failed to update day note" });
    }
  });

  app.delete('/api/day-notes/:id', isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const isAdmin = req.user?.role?.name === 'admin' || req.user?.role?.name === 'owner';

      const existing = await storage.getDayNote(id);
      if (!existing) {
        return res.status(404).json({ message: "Note not found" });
      }

      if (existing.userId !== userId && !isAdmin) {
        return res.status(403).json({ message: "Not authorized" });
      }

      await storage.deleteDayNote(id);
      res.json({ message: "Note deleted" });
    } catch (error) {
      console.error("Error deleting day note:", error);
      res.status(500).json({ message: "Failed to delete day note" });
    }
  });
}
