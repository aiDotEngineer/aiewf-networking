import { v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server";

const accountRoleValidator = v.union(
  v.literal("admin"),
  v.literal("participant"),
);

const ticketCategoryValidator = v.union(
  v.literal("leadership"),
  v.literal("speaker"),
  v.literal("sponsor"),
  v.literal("other"),
);

export const inspectAccountByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const account = await ctx.db
      .query("accounts")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (!account) return { found: false as const, email };
    return {
      found: true as const,
      account: {
        _id: account._id,
        email: account.email,
        displayName: account.displayName,
        role: account.role,
        ticketType: account.ticketType,
        ticketCategory: account.ticketCategory,
        registrationStatus: account.registrationStatus,
        signedUp: account.signedUp,
        directoryOptIn: account.directoryOptIn,
        profileComplete: account.profileComplete,
        hasAvailability: account.hasAvailability,
        active: account.active,
        title: account.title,
        company: account.company,
      },
    };
  },
});

export const updateAccountByEmail = internalMutation({
  args: {
    email: v.string(),
    role: v.optional(accountRoleValidator),
    ticketCategory: v.optional(ticketCategoryValidator),
    ticketType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const account = await ctx.db
      .query("accounts")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (!account) throw new Error(`No account for ${email}`);
    const patch: {
      role?: "admin" | "participant";
      ticketCategory?: "leadership" | "speaker" | "sponsor" | "other";
      ticketType?: string;
      updatedAt: number;
    } = { updatedAt: Date.now() };
    if (args.role !== undefined) patch.role = args.role;
    if (args.ticketCategory !== undefined) patch.ticketCategory = args.ticketCategory;
    if (args.ticketType !== undefined) patch.ticketType = args.ticketType;
    await ctx.db.patch(account._id, patch);
    const updated = await ctx.db.get(account._id);
    return {
      _id: updated?._id,
      email: updated?.email,
      role: updated?.role,
      ticketCategory: updated?.ticketCategory,
      ticketType: updated?.ticketType,
    };
  },
});
