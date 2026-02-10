import { db } from "./server/db";
import { users, tasks, roles } from "./shared/schema";
import { eq } from "drizzle-orm";

async function run() {
  console.log("Starting seed script...");
  
  // 1. Create employee role
  let employeeRoleId;
  const existingRole = await db.select().from(roles).where(eq(roles.name, "employee")).limit(1);
  if (existingRole.length > 0) {
    employeeRoleId = existingRole[0].id;
    console.log("Found existing employee role:", employeeRoleId);
  } else {
    const [newRole] = await db.insert(roles).values({
      name: "employee",
      displayName: "Employee",
      description: "Standard staff member"
    }).returning();
    employeeRoleId = newRole.id;
    console.log("Created new employee role:", employeeRoleId);
  }

  const ownerId = "demo-owner-001";

  // 2. Create users
  const employeeNames = ["Baleigh", "Amber", "Taylor", "Kate", "Sela", "Braylee", "Avery", "Reagan", "Stephanie", "Kayla", "Josie"];
  const userMap = new Map();
  for (const name of employeeNames) {
    const existingUser = await db.select().from(users).where(eq(users.firstName, name)).limit(1);
    if (existingUser.length > 0) {
      userMap.set(name, existingUser[0].id);
      console.log("Found existing user:", name, existingUser[0].id);
    } else {
      const [user] = await db.insert(users).values({
        firstName: name,
        lastName: "Staff",
        roleId: employeeRoleId,
        isActive: true,
      }).returning();
      userMap.set(name, user.id);
      console.log("Created new user:", name, user.id);
    }
  }

  // 3. Prepare chores
  const chores = [
    // Monday
    { title: "Vacuum Dressing Rooms", dayOfWeek: "monday", timeOfDay: "morning", assignedTo: "Kayla" },
    { title: "Vacuum zone 1 (under tables/walls)", dayOfWeek: "monday", timeOfDay: "morning", assignedTo: "Kayla" },
    { title: "Put out holds from day before", dayOfWeek: "monday", timeOfDay: "morning", assignedTo: "Kayla" },
    { title: "Clean front display windows (zone 1)", dayOfWeek: "monday", timeOfDay: "morning", assignedTo: "Kayla" },
    { title: "Check shoe display (no security tags)", dayOfWeek: "monday", timeOfDay: "afternoon", assignedTo: "Braylee" },
    { title: "Check all mannequins", dayOfWeek: "monday", timeOfDay: "afternoon", assignedTo: "Braylee" },
    { title: "Sweep front/back wood floors", dayOfWeek: "monday", timeOfDay: "afternoon", assignedTo: "Braylee" },
    { title: "Clean break area", dayOfWeek: "monday", timeOfDay: "afternoon", assignedTo: "Braylee" },
    { title: "Steam and security tag new merch", dayOfWeek: "monday", timeOfDay: "afternoon", assignedTo: "Josie" },
    { title: "Straighten all tables and dresses in zone 4", dayOfWeek: "monday", timeOfDay: "afternoon", assignedTo: "Josie" },
    { title: "Dressing room duty (put go backs back)", dayOfWeek: "monday", timeOfDay: "afternoon", assignedTo: "Josie" },
    { title: "Clean bathroom", dayOfWeek: "monday", timeOfDay: "afternoon", assignedTo: "Josie" },

    // Tuesday
    { title: "Vacuum zone 2 (under tables/baseboards)", dayOfWeek: "tuesday", timeOfDay: "morning", assignedTo: "Kate" },
    { title: "Put out holds from day before", dayOfWeek: "tuesday", timeOfDay: "morning", assignedTo: "Kate" },
    { title: "Change mannequins in entry and windows", dayOfWeek: "tuesday", timeOfDay: "morning", assignedTo: "Kate" },
    { title: "Check shoe display (one non-censored out)", dayOfWeek: "tuesday", timeOfDay: "morning", assignedTo: "Amber" },
    { title: "Sweep front/back wood floors", dayOfWeek: "tuesday", timeOfDay: "morning", assignedTo: "Amber" },
    { title: "Steam and security tag new items", dayOfWeek: "tuesday", timeOfDay: "morning", assignedTo: "Amber" },
    { title: "Organize denim (size order)", dayOfWeek: "tuesday", timeOfDay: "afternoon", assignedTo: "Sela" },
    { title: "Wrap 5-10 gift boxes", dayOfWeek: "tuesday", timeOfDay: "afternoon", assignedTo: "Sela" },
    { title: "Straighten all tables in zone 2", dayOfWeek: "tuesday", timeOfDay: "afternoon", assignedTo: "Sela" },
    { title: "Sweep behind register", dayOfWeek: "tuesday", timeOfDay: "afternoon", assignedTo: "Braylee" },
    { title: "Make 5 small and 5 large bows", dayOfWeek: "tuesday", timeOfDay: "afternoon", assignedTo: "Braylee" },
    { title: "Steam and security tag all new items", dayOfWeek: "tuesday", timeOfDay: "afternoon", assignedTo: "Braylee" },
    { title: "Straighten Sale room", dayOfWeek: "tuesday", timeOfDay: "afternoon", assignedTo: "Avery" },
    { title: "Clean the bathroom", dayOfWeek: "tuesday", timeOfDay: "afternoon", assignedTo: "Avery" },
    { title: "Clean break area", dayOfWeek: "tuesday", timeOfDay: "afternoon", assignedTo: "Avery" },

    // Wednesday
    { title: "Vacuum zone 3", dayOfWeek: "wednesday", timeOfDay: "morning", assignedTo: "Reagan" },
    { title: "Check go-back rack", dayOfWeek: "wednesday", timeOfDay: "morning", assignedTo: "Reagan" },
    { title: "Check all mannequins", dayOfWeek: "wednesday", timeOfDay: "morning", assignedTo: "Reagan" },
    { title: "Straighten all tables in zone 3", dayOfWeek: "wednesday", timeOfDay: "morning", assignedTo: "Braylee" },
    { title: "Sweep front/back wood floors", dayOfWeek: "wednesday", timeOfDay: "morning", assignedTo: "Braylee" },
    { title: "Dust and lint roll jewelry tables", dayOfWeek: "wednesday", timeOfDay: "morning", assignedTo: "Braylee" },
    { title: "Windex glass jewelry cases", dayOfWeek: "wednesday", timeOfDay: "afternoon", assignedTo: "Amber" },
    { title: "Update shoe display in dressing room", dayOfWeek: "wednesday", timeOfDay: "afternoon", assignedTo: "Amber" },
    { title: "Straighten Sale room", dayOfWeek: "wednesday", timeOfDay: "afternoon", assignedTo: "Amber" },
    { title: "Dust all candles and purses", dayOfWeek: "wednesday", timeOfDay: "afternoon", assignedTo: "Kate" },
    { title: "Take out all trash", dayOfWeek: "wednesday", timeOfDay: "afternoon", assignedTo: "Kate" },
    { title: "Clean bathroom", dayOfWeek: "wednesday", timeOfDay: "afternoon", assignedTo: "Kate" },

    // Thursday
    { title: "Vacuum zone 4 (under tables/rugs)", dayOfWeek: "thursday", timeOfDay: "morning", assignedTo: "Sela" },
    { title: "Check all mannequins in front", dayOfWeek: "thursday", timeOfDay: "morning", assignedTo: "Sela" },
    { title: "Check go-back rack", dayOfWeek: "thursday", timeOfDay: "morning", assignedTo: "Sela" },
    { title: "Straighten all tables in zone 4", dayOfWeek: "thursday", timeOfDay: "afternoon", assignedTo: "Josie" },
    { title: "Check shoe display in dressing room", dayOfWeek: "thursday", timeOfDay: "afternoon", assignedTo: "Josie" },
    { title: "Steam and security tag new items", dayOfWeek: "thursday", timeOfDay: "afternoon", assignedTo: "Josie" },
    { title: "Windex mirrors in dressing rooms", dayOfWeek: "thursday", timeOfDay: "afternoon", assignedTo: "Amber" },
    { title: "Straighten Jewelry", dayOfWeek: "thursday", timeOfDay: "afternoon", assignedTo: "Amber" },
    { title: "Sweep front/back wood floors", dayOfWeek: "thursday", timeOfDay: "afternoon", assignedTo: "Amber" },
    { title: "Sweep behind register & merch room", dayOfWeek: "thursday", timeOfDay: "afternoon", assignedTo: "Braylee" },
    { title: "Clean bathroom", dayOfWeek: "thursday", timeOfDay: "afternoon", assignedTo: "Braylee" },
    { title: "Clean break area", dayOfWeek: "thursday", timeOfDay: "afternoon", assignedTo: "Braylee" },

    // Friday
    { title: "Vacuum zone 5", dayOfWeek: "friday", timeOfDay: "morning", assignedTo: "Amber" },
    { title: "Check go-back rack", dayOfWeek: "friday", timeOfDay: "morning", assignedTo: "Amber" },
    { title: "Check all mannequins", dayOfWeek: "friday", timeOfDay: "morning", assignedTo: "Amber" },
    { title: "Check shoe display", dayOfWeek: "friday", timeOfDay: "afternoon", assignedTo: "Braylee" },
    { title: "Check supply list", dayOfWeek: "friday", timeOfDay: "afternoon", assignedTo: "Braylee" },
    { title: "Sweep behind register & merch room", dayOfWeek: "friday", timeOfDay: "afternoon", assignedTo: "Braylee" },
    { title: "Sweep front/back wood floors", dayOfWeek: "friday", timeOfDay: "afternoon", assignedTo: "Kate" },
    { title: "Steam and security tag new items", dayOfWeek: "friday", timeOfDay: "afternoon", assignedTo: "Kate" },
    { title: "Make 5 small and 5 large bows", dayOfWeek: "friday", timeOfDay: "afternoon", assignedTo: "Kate" },
    { title: "Straighten tables in zone 5", dayOfWeek: "friday", timeOfDay: "afternoon", assignedTo: "Stephanie" },
    { title: "Steam and security tag new items", dayOfWeek: "friday", timeOfDay: "afternoon", assignedTo: "Stephanie" },
    { title: "Clean bathroom", dayOfWeek: "friday", timeOfDay: "afternoon", assignedTo: "Stephanie" },
    { title: "Wrap 5-10 gift boxes", dayOfWeek: "friday", timeOfDay: "afternoon", assignedTo: "Reagan" },
    { title: "Vacuum and Clorox wipe lunch station", dayOfWeek: "friday", timeOfDay: "afternoon", assignedTo: "Reagan" },
    { title: "Take out all trash", dayOfWeek: "friday", timeOfDay: "afternoon", assignedTo: "Reagan" },

    // Saturday
    { title: "Vacuum zone 1 and dressing rooms", dayOfWeek: "saturday", timeOfDay: "morning", assignedTo: "Reagan" },
    { title: "Check go-back rack", dayOfWeek: "saturday", timeOfDay: "morning", assignedTo: "Reagan" },
    { title: "Sweep front/back entries", dayOfWeek: "saturday", timeOfDay: "morning", assignedTo: "Reagan" },
    { title: "Check all mannequins", dayOfWeek: "saturday", timeOfDay: "morning", assignedTo: "Amber" },
    { title: "Check shoe display", dayOfWeek: "saturday", timeOfDay: "morning", assignedTo: "Amber" },
    { title: "Sweep behind register & merch room", dayOfWeek: "saturday", timeOfDay: "morning", assignedTo: "Amber" },
    { title: "Clean baseboards - Free People room", dayOfWeek: "saturday", timeOfDay: "afternoon", assignedTo: "Braylee" },
    { title: "Straighten merch in zone 1 & 3", dayOfWeek: "saturday", timeOfDay: "afternoon", assignedTo: "Braylee" },
    { title: "Clean baseboards - front middle", dayOfWeek: "saturday", timeOfDay: "afternoon", assignedTo: "Kate" },
    { title: "Straighten merch in zone 2 & 5", dayOfWeek: "saturday", timeOfDay: "afternoon", assignedTo: "Kate" },
    { title: "Straighten merch in zone 4", dayOfWeek: "saturday", timeOfDay: "afternoon", assignedTo: "Stephanie" },
    { title: "Clean bathroom", dayOfWeek: "saturday", timeOfDay: "afternoon", assignedTo: "Stephanie" },
    { title: "Take out all trash", dayOfWeek: "saturday", timeOfDay: "afternoon", assignedTo: "Stephanie" },

    // Sunday
    { title: "Check all mannequins", dayOfWeek: "sunday", timeOfDay: "afternoon", assignedTo: "Baleigh" },
    { title: "Check go-back rack", dayOfWeek: "sunday", timeOfDay: "afternoon", assignedTo: "Baleigh" },
    { title: "Check shoe display in dressing room", dayOfWeek: "sunday", timeOfDay: "afternoon", assignedTo: "Baleigh" },
    { title: "Steam and security tag new merchandise", dayOfWeek: "sunday", timeOfDay: "afternoon", assignedTo: "Amber" },
    { title: "Wrap 5 small and 5 large gift boxes", dayOfWeek: "sunday", timeOfDay: "afternoon", assignedTo: "Amber" },
    { title: "Sweep front/back wood floors", dayOfWeek: "sunday", timeOfDay: "afternoon", assignedTo: "Amber" },
    { title: "Straighten all tables and dresses", dayOfWeek: "sunday", timeOfDay: "afternoon", assignedTo: "Taylor" },
    { title: "Wrap 5 small and 5 large gift boxes", dayOfWeek: "sunday", timeOfDay: "afternoon", assignedTo: "Taylor" },
    { title: "Clean bathroom", dayOfWeek: "sunday", timeOfDay: "afternoon", assignedTo: "Taylor" },
  ];

  for (const chore of chores) {
    await db.insert(tasks).values({
      title: chore.title,
      dayOfWeek: chore.dayOfWeek,
      timeOfDay: chore.timeOfDay,
      assignedTo: userMap.get(chore.assignedTo),
      createdBy: ownerId,
      isRecurring: true,
      status: "pending",
      priority: "medium",
      requiresSignature: true,
    });
  }

  console.log("Successfully inserted all chores and created users.");
  process.exit(0);
}

run();
