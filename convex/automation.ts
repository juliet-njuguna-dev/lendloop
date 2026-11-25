import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { today } from "./lib";

// Payload for n8n: ONLY the fields the workflow needs (data minimization).
export const eventPayload = internalQuery({
  args: { loanId: v.id("loans"), event: v.string() },
  handler: async (ctx, { loanId, event }) => {
    const loan = await ctx.db.get(loanId);
    if (!loan) return null;
    const [tool, owner, borrower] = await Promise.all([ctx.db.get(loan.toolId), ctx.db.get(loan.ownerId), ctx.db.get(loan.borrowerId)]);
    // New requests notify the owner; every other event notifies the borrower.
    const recipient = event === "request_created" ? owner : borrower;
    if (!tool || !recipient) return null;
    return {
      event, loanId, toolName: tool.name, status: loan.status,
      startDate: loan.startDate, endDate: loan.endDate,
      recipientName: recipient.name, recipientEmail: recipient.email,
    };
  },
});

export const overdue = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = today();
    const approved = await ctx.db.query("loans").withIndex("by_status", (q) => q.eq("status", "approved")).collect();
    const due = approved.filter((l) => l.endDate < now && l.lastReminderDate !== now);
    return (await Promise.all(due.map(async (l) => {
      const [tool, borrower] = await Promise.all([ctx.db.get(l.toolId), ctx.db.get(l.borrowerId)]);
      if (!tool || !borrower) return null;
      return {
        loanId: l._id, toolName: tool.name, endDate: l.endDate,
        recipientName: borrower.name, recipientEmail: borrower.email,
      };
    }))).filter(Boolean);
  },
});

export const logEvent = internalMutation({
  args: { loanId: v.id("loans"), kind: v.string(), status: v.union(v.literal("sent"), v.literal("failed")), idempotencyKey: v.string(), detail: v.optional(v.string()) },
  handler: async (ctx, a) => { await ctx.db.insert("automationEvents", a); },
});

// IDEMPOTENT write-back: the same key twice (an n8n retry) changes nothing the second time.
export const applyReminderResult = internalMutation({
  args: { loanId: v.id("loans"), runDate: v.string(), status: v.union(v.literal("sent"), v.literal("failed")) },
  handler: async (ctx, { loanId, runDate, status }) => {
    const key = `reminder:${loanId}:${runDate}`;
    const seen = await ctx.db.query("automationEvents").withIndex("by_key", (q) => q.eq("idempotencyKey", key)).first();
    if (seen) return { duplicate: true };
    const loan = await ctx.db.get(loanId);
    if (!loan) throw new Error("Unknown loan");
    await ctx.db.insert("automationEvents", { loanId, kind: "overdue_reminder", status, idempotencyKey: key });
    if (status === "sent") await ctx.db.patch(loanId, { lastReminderDate: runDate, reminderCount: loan.reminderCount + 1 });
    return { duplicate: false };
  },
});
