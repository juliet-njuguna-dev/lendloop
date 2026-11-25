import { mutation, query, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { isDate, requireAdmin, requireUser, today } from "./lib";

async function hasApprovedOverlap(ctx: MutationCtx, toolId: Id<"tools">, start: string, end: string, ignore?: Id<"loans">) {
  const loans = await ctx.db.query("loans").withIndex("by_tool", (q) => q.eq("toolId", toolId)).collect();
  return loans.some((l) => l._id !== ignore && l.status === "approved" && l.startDate <= end && l.endDate >= start);
}

export const request = mutation({
  args: { toolId: v.id("tools"), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { toolId, startDate, endDate }) => {
    const me = await requireUser(ctx);
    if (!isDate(startDate) || !isDate(endDate)) throw new Error("Invalid dates");
    if (startDate > endDate) throw new Error("End date must be after start date");
    if (startDate < today()) throw new Error("Start date is in the past");
    const tool = await ctx.db.get(toolId);
    if (!tool || !tool.active) throw new Error("Tool not found");
    if (tool.ownerId === me._id) throw new Error("You cannot borrow your own tool");
    if (await hasApprovedOverlap(ctx, toolId, startDate, endDate)) throw new Error("Tool is already booked for those dates");
    const loanId = await ctx.db.insert("loans", {
      toolId, ownerId: tool.ownerId, borrowerId: me._id, startDate, endDate,
      status: "pending", reminderCount: 0,
    });
    await ctx.scheduler.runAfter(0, internal.notify.send, { loanId, event: "request_created", attempt: 0 });
    return loanId;
  },
});

// Only the OWNER of the tool can approve/decline, and only while pending.
export const decide = mutation({
  args: { loanId: v.id("loans"), decision: v.union(v.literal("approved"), v.literal("declined")) },
  handler: async (ctx, { loanId, decision }) => {
    const me = await requireUser(ctx);
    const loan = await ctx.db.get(loanId);
    if (!loan || loan.ownerId !== me._id) throw new Error("Not allowed");
    if (loan.status !== "pending") throw new Error("Request already handled");
    if (decision === "approved" && (await hasApprovedOverlap(ctx, loan.toolId, loan.startDate, loan.endDate, loanId)))
      throw new Error("Dates now overlap another approved loan");
    await ctx.db.patch(loanId, { status: decision });
    await ctx.scheduler.runAfter(0, internal.notify.send, { loanId, event: `request_${decision}`, attempt: 0 });
  },
});

// The tool's owner (or an admin) marks the loan returned.
export const markReturned = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const me = await requireUser(ctx);
    const loan = await ctx.db.get(loanId);
    if (!loan || (loan.ownerId !== me._id && me.role !== "admin")) throw new Error("Not allowed");
    if (loan.status !== "approved") throw new Error("Only approved loans can be returned");
    await ctx.db.patch(loanId, { status: "returned" });
    await ctx.scheduler.runAfter(0, internal.notify.send, { loanId, event: "loan_returned", attempt: 0 });
  },
});

async function shape(ctx: any, loans: any[]) {
  return await Promise.all(loans.map(async (l) => {
    const [tool, borrower, owner, events] = await Promise.all([
      ctx.db.get(l.toolId), ctx.db.get(l.borrowerId), ctx.db.get(l.ownerId),
      ctx.db.query("automationEvents").withIndex("by_loan", (q: any) => q.eq("loanId", l._id)).order("desc").take(3),
    ]);
    return {
      _id: l._id, toolName: tool?.name ?? "(removed)", borrowerName: borrower?.name, ownerName: owner?.name,
      startDate: l.startDate, endDate: l.endDate, status: l.status,
      overdue: l.status === "approved" && l.endDate < today(),
      automation: events.map((e: any) => ({ kind: e.kind, status: e.status, at: e._creationTime })),
    };
  }));
}

export const myRequests = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    return shape(ctx, await ctx.db.query("loans").withIndex("by_borrower", (q) => q.eq("borrowerId", me._id)).order("desc").collect());
  },
});

export const incoming = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    return shape(ctx, await ctx.db.query("loans").withIndex("by_owner", (q) => q.eq("ownerId", me._id)).order("desc").collect());
  },
});

export const adminAll = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return shape(ctx, await ctx.db.query("loans").order("desc").collect());
  },
});
