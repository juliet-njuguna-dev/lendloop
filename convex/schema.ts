import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    name: v.string(),
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("user")),
    trustedLender: v.boolean(),
  }).index("by_token", ["tokenIdentifier"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: v.string(),
    condition: v.string(),
    description: v.string(),
    active: v.boolean(), // soft delete keeps loan history intact
  }).index("by_owner", ["ownerId"]),

  loans: defineTable({
    toolId: v.id("tools"),
    ownerId: v.id("users"),
    borrowerId: v.id("users"),
    startDate: v.string(), // YYYY-MM-DD
    endDate: v.string(),
    status: v.union(
      v.literal("pending"), v.literal("approved"),
      v.literal("declined"), v.literal("returned"),
    ),
    lastReminderDate: v.optional(v.string()),
    reminderCount: v.number(),
  })
    .index("by_tool", ["toolId"])
    .index("by_owner", ["ownerId"])
    .index("by_borrower", ["borrowerId"])
    .index("by_status", ["status"]),

  // Automation audit log + idempotency keys. Shown on each loan in the UI.
  automationEvents: defineTable({
    loanId: v.id("loans"),
    kind: v.string(), // request_notification | overdue_reminder
    status: v.union(v.literal("sent"), v.literal("failed")),
    idempotencyKey: v.string(),
    detail: v.optional(v.string()),
  })
    .index("by_key", ["idempotencyKey"])
    .index("by_loan", ["loanId"]),
});
