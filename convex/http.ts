import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { verify } from "./hmac";

const http = httpRouter();
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

// n8n -> Convex: fetch overdue loans (signed GET).
http.route({
  path: "/automation/overdue",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const secret = process.env.LENDLOOP_WEBHOOK_SECRET;
    if (!secret || !(await verify(secret, req, new URL(req.url).pathname, ""))) return json({ error: "unauthorized" }, 401);
    return json(await ctx.runQuery(internal.automation.overdue, {}));
  }),
});

// n8n -> Convex: write the reminder outcome back (signed, idempotent).
http.route({
  path: "/automation/reminder-result",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secret = process.env.LENDLOOP_WEBHOOK_SECRET;
    const body = await req.text();
    if (!secret || !(await verify(secret, req, new URL(req.url).pathname, body))) return json({ error: "unauthorized" }, 401);
    let data: any;
    try { data = JSON.parse(body); } catch { return json({ error: "bad json" }, 400); }
    if (!data.loanId || !/^\d{4}-\d{2}-\d{2}$/.test(data.runDate ?? "") || !["sent", "failed"].includes(data.status))
      return json({ error: "bad payload" }, 400);
    return json(await ctx.runMutation(internal.automation.applyReminderResult, { loanId: data.loanId, runDate: data.runDate, status: data.status }));
  }),
});

export default http;
