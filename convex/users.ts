import { mutation, query } from "./_generated/server";
import { requireUser } from "./lib";

function adminEmails() {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}

// Creates the user row on first sign-in. Role is decided here on the server only:
// it is never an argument, so a client cannot promote itself.
export const store = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const email = identity.email ?? "";
    const name = identity.name || email.split("@")[0] || "Neighbor";
    const isAdmin = email !== "" && adminEmails().includes(email.toLowerCase());

    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    if (existing) {
      // Self-heal a row that was created before the token carried an email.
      if (existing.email === "" && email !== "") {
        await ctx.db.patch(existing._id, { email, name, role: isAdmin ? "admin" : existing.role });
      }
      return existing._id;
    }

    return await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      name,
      email,
      role: isAdmin ? "admin" : "user",
      trustedLender: false,
    });
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const u = await requireUser(ctx);
    return { _id: u._id, name: u.name, role: u.role, trustedLender: u.trustedLender };
  },
});