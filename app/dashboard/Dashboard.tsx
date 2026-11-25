"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

type Tab = "browse" | "listings" | "requests" | "incoming" | "admin";

export default function Dashboard() {
  const store = useMutation(api.users.store);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>("browse");
  useEffect(() => { store().then(() => setReady(true)); }, [store]);
  const me = useQuery(api.users.me, ready ? {} : "skip");
  if (!me) return <main className="wrap"><p className="muted">Loading&hellip;</p></main>;
  const tabs: [Tab, string][] = [["browse", "Browse tools"], ["listings", "My listings"], ["requests", "My requests"], ["incoming", "Incoming requests"]];
  if (me.role === "admin") tabs.push(["admin", "Admin"]);
  return (
    <main className="wrap">
      <header className="top">
        <div><h1><Link href="/">LendLoop</Link></h1><p className="tag">Hi {me.name}{me.role === "admin" ? " (admin)" : ""}</p></div>
        <UserButton />
      </header>
      <nav className="tabs">{tabs.map(([k, label]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}</button>)}</nav>
      {tab === "browse" && <Browse isAdmin={me.role === "admin"} />}
      {tab === "listings" && <Listings />}
      {tab === "requests" && <Loans mode="mine" />}
      {tab === "incoming" && <Loans mode="incoming" />}
      {tab === "admin" && me.role === "admin" && <Admin />}
    </main>
  );
}

function useAction() {
  const [error, setError] = useState("");
  const run = async (fn: () => Promise<unknown>) => {
    setError("");
    try { await fn(); } catch (e) { setError(String((e as Error).message).split("\n")[0].replace(/^.*Error: /, "")); }
  };
  return { error, run };
}

function Browse({ isAdmin }: { isAdmin: boolean }) {
  const tools = useQuery(api.tools.list);
  const [cat, setCat] = useState("all");
  const cats = [...new Set((tools ?? []).map((t) => t.category))];
  const shown = (tools ?? []).filter((t) => cat === "all" || t.category === cat);
  return (
    <>
      <div className="row"><h2>All tools</h2>
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="all">All categories</option>{cats.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      {tools?.length === 0 && <p className="muted">Nothing listed yet.</p>}
      {shown.map((t) => <ToolCard key={t._id} t={t} isAdmin={isAdmin} />)}
    </>
  );
}

function ToolCard({ t, isAdmin }: { t: any; isAdmin: boolean }) {
  const request = useMutation(api.loans.request);
  const adminRemove = useMutation(api.tools.adminRemove);
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(""); const [end, setEnd] = useState("");
  const { error, run } = useAction();
  return (
    <div className="card">
      <div className="row">
        <div><strong>{t.name}</strong> <span className="badge">{t.category}</span>{" "}
          <span className={`badge ${t.available ? "ok" : "warn"}`}>{t.available ? "Available" : "On loan"}</span>
          {t.trustedLender && <> <span className="badge ok">Trusted lender</span></>}
          <div className="muted">{t.condition} &middot; {t.isMine ? "yours" : `from ${t.ownerName}`}</div>
          {t.description && <div className="muted">{t.description}</div>}
        </div>
        <div>
          {!t.isMine && <button className="btn" onClick={() => setOpen(!open)}>Request</button>}{" "}
          {isAdmin && <button className="btn danger" onClick={() => run(() => adminRemove({ toolId: t._id }))}>Remove</button>}
        </div>
      </div>
      {open && (
        <div className="row" style={{ marginTop: 8, justifyContent: "flex-start" }}>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          <button className="btn" onClick={() => run(async () => { await request({ toolId: t._id, startDate: start, endDate: end }); setOpen(false); })}>Send request</button>
        </div>
      )}
      {error && <div className="err">{error}</div>}
    </div>
  );
}

function Listings() {
  const mine = useQuery(api.tools.mine);
  const create = useMutation(api.tools.create);
  const remove = useMutation(api.tools.remove);
  const [f, setF] = useState({ name: "", category: "power tools", condition: "good", description: "" });
  const { error, run } = useAction();
  return (
    <>
      <h2>List a tool</h2>
      <form className="grid" onSubmit={(e) => { e.preventDefault(); run(async () => { await create(f); setF({ ...f, name: "", description: "" }); }); }}>
        <input placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
          {["power tools", "hand tools", "garden", "kitchen", "camping", "other"].map((c) => <option key={c}>{c}</option>)}
        </select>
        <input placeholder="Condition (e.g. good)" value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })} />
        <input placeholder="Short description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <button className="btn full" type="submit">Add listing</button>
      </form>
      {error && <div className="err">{error}</div>}
      <h2>My listings</h2>
      {mine?.length === 0 && <p className="muted">You haven&rsquo;t listed anything.</p>}
      {mine?.map((t) => (
        <div className="card row" key={t._id}>
          <div><strong>{t.name}</strong> <span className="badge">{t.category}</span><div className="muted">{t.condition}</div></div>
          <button className="btn ghost" onClick={() => run(() => remove({ toolId: t._id }))}>Delete</button>
        </div>
      ))}
    </>
  );
}

const ago = (ms: number) => { const d = Math.floor((Date.now() - ms) / 86400000); return d <= 0 ? "today" : `${d} day${d === 1 ? "" : "s"} ago`; };

function Loans({ mode }: { mode: "mine" | "incoming" | "admin" }) {
  const mineQ = useQuery(api.loans.myRequests, mode === "mine" ? {} : "skip");
  const inQ = useQuery(api.loans.incoming, mode === "incoming" ? {} : "skip");
  const allQ = useQuery(api.loans.adminAll, mode === "admin" ? {} : "skip");
  const loans = mode === "mine" ? mineQ : mode === "incoming" ? inQ : allQ;
  const decide = useMutation(api.loans.decide);
  const returned = useMutation(api.loans.markReturned);
  const { error, run } = useAction();
  return (
    <>
      <h2>{mode === "mine" ? "My requests" : mode === "incoming" ? "Incoming requests" : "All loans"}</h2>
      {error && <div className="err">{error}</div>}
      {loans?.length === 0 && <p className="muted">Nothing here yet.</p>}
      {loans?.map((l) => {
        const reminder = l.automation.find((a) => a.kind === "overdue_reminder" && a.status === "sent");
        const failed = l.automation.find((a) => a.status === "failed");
        return (
          <div className="card" key={l._id}>
            <div className="row">
              <div><strong>{l.toolName}</strong> <span className={`badge ${l.overdue ? "bad" : l.status === "approved" ? "ok" : ""}`}>{l.overdue ? "overdue" : l.status}</span>
                <div className="muted">{l.startDate} &rarr; {l.endDate} &middot; {mode === "mine" ? `owner ${l.ownerName}` : `borrower ${l.borrowerName}`}</div>
                {reminder && <div className="muted">Reminder sent {ago(reminder.at)}</div>}
                {failed && <div className="muted">Automation failed (will show here until it succeeds)</div>}
              </div>
              <div>
                {mode === "incoming" && l.status === "pending" && <>
                  <button className="btn" onClick={() => run(() => decide({ loanId: l._id as Id<"loans">, decision: "approved" }))}>Approve</button>{" "}
                  <button className="btn ghost" onClick={() => run(() => decide({ loanId: l._id as Id<"loans">, decision: "declined" }))}>Decline</button></>}
                {mode !== "mine" && l.status === "approved" && <button className="btn" onClick={() => run(() => returned({ loanId: l._id as Id<"loans"> }))}>Mark returned</button>}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}

function Admin() {
  const users = useQuery(api.admin.users);
  const trust = useMutation(api.admin.setTrustedLender);
  const { error, run } = useAction();
  return (
    <>
      <h2>Lenders</h2>
      {error && <div className="err">{error}</div>}
      {users?.map((u) => (
        <div className="card row" key={u._id}>
          <span>{u.name} <span className="badge">{u.role}</span></span>
          <button className={`btn ${u.trustedLender ? "" : "ghost"}`} onClick={() => run(() => trust({ userId: u._id, trusted: !u.trustedLender }))}>
            {u.trustedLender ? "Trusted lender \u2713" : "Mark as trusted lender"}
          </button>
        </div>
      ))}
      <Loans mode="admin" />
    </>
  );
}
