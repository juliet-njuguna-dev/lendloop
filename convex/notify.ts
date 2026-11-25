import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { sign } from "./hmac";

const MAX_ATTEMPTS = 4;

// Convex -> n8n. Signed webhook, retried with backoff, failures are recorded (never silent).
export const send = internalAction({
  args: { loanId: v.id("loans"), event: v.string(), attempt: v.number() },
  handler: async (ctx, { loanId, event, attempt }): Promise<void> => {
    const url = process.env.N8N_WEBHOOK_URL;
    const secret = process.env.LENDLOOP_WEBHOOK_SECRET;
    const key = `notify:${loanId}:${event}`;
    const fail = async (detail: string): Promise<void> => {
      if (attempt + 1 < MAX_ATTEMPTS)
        await ctx.scheduler.runAfter(2 ** attempt * 30_000, internal.notify.send, { loanId, event, attempt: attempt + 1 });
      else
        await ctx.runMutation(internal.automation.logEvent, {
          loanId, kind: "request_notification", status: "failed", idempotencyKey: `${key}:failed`, detail,
        });
    };
    if (!url || !secret) return fail("Webhook not configured");
    const payload = await ctx.runQuery(internal.automation.eventPayload, { loanId, event });
    if (!payload) return;
    const body: string = JSON.stringify(payload);
    const ts = String(Date.now());
    const path = new URL(url).pathname;
    try {
      const res: Response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-timestamp": ts,
          "x-signature": await sign(secret, ts, "POST", path, body),
          "x-idempotency-key": key,
        },
        body,
      });
      if (!res.ok) return fail(`n8n responded ${res.status}`);
      await ctx.runMutation(internal.automation.logEvent, {
        loanId, kind: "request_notification", status: "sent", idempotencyKey: `${key}:${attempt}`,
      });
    } catch (e) {
      return fail(String(e).slice(0, 200));
    }
  },
});