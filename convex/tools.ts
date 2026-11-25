import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireAdmin, requireUser, today } from "./lib";

// PUBLIC: no auth, and only name + category. No owner details, no ids.
export const listPublic = query({
  args: {},
  handler: async (ctx) => {
    const tools = await ctx.db.query("tools").collect();
    return tools.filter((t) => t.active).map((t) => ({ name: t.name, category: t.category }));
  },
});

// AUTHENTICATED: full list with availability, filterable client-side by category.
export const list = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const tools = (await ctx.db.query("tools").collect()).filter((t) => t.active);
    const now = today();
    return await Promise.all(tools.map(async (t) => {
      const loans = await ctx.db.query("loans").withIndex("by_tool", (q) => q.eq("toolId", t._id)).collect();
      const onLoan = loans.some((l) => l.status === "approved" && l.startDate <= now && l.endDate >= now);
      const owner = await ctx.db.get(t.ownerId);
      return {
        _id: t._id, name: t.name, category: t.category, condition: t.condition,
        description: t.description, available: !onLoan, isMine: t.ownerId === me._id,
        ownerName: owner?.name ?? "Neighbor", trustedLender: owner?.trustedLender ?? false,
      };
    }));
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const tools = await ctx.db.query("tools").withIndex("by_owner", (q) => q.eq("ownerId", me._id)).collect();
    return tools.filter((t) => t.active);
  },
});

const fields = {
  name: v.string(), category: v.string(), condition: v.string(), description: v.string(),
};
function validate(a: { name: string; category: string; condition: string; description: string }) {
  if (!a.name.trim() || a.name.length > 80) throw new Error("Name required (max 80 chars)");
  if (!a.category.trim() || a.category.length > 40) throw new Error("Category required (max 40 chars)");
  if (a.condition.length > 40) throw new Error("Condition too long");
  if (a.description.length > 500) throw new Error("Description too long (max 500)");
}

export const create = mutation({
  args: fields,
  handler: async (ctx, a) => {
    const me = await requireUser(ctx);
    validate(a);
    return await ctx.db.insert("tools", { ...a, ownerId: me._id, active: true });
  },
});

// Users edit/delete ONLY their own listings.
export const update = mutation({
  args: { toolId: v.id("tools"), ...fields },
  handler: async (ctx, { toolId, ...a }) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool || !tool.active || tool.ownerId !== me._id) throw new Error("Not allowed");
    validate(a);
    await ctx.db.patch(toolId, a);
  },
});

export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool || !tool.active || tool.ownerId !== me._id) throw new Error("Not allowed");
    await ctx.db.patch(toolId, { active: false });
  },
});

// Admin can remove ANY listing (separate function so the rule is explicit).
export const adminRemove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    await requireAdmin(ctx);
    await ctx.db.patch(toolId, { active: false });
  },
});
