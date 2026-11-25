"use client";
import { useQuery } from "convex/react";
import { SignInButton, Show } from "@clerk/nextjs";
import Link from "next/link";
import { api } from "@/convex/_generated/api";

// PUBLIC page: shows only tool name + category (owner details never leave the backend).
export default function Home() {
  const tools = useQuery(api.tools.listPublic);
  return (
    <main className="wrap">
      <header className="top">
        <div><h1>LendLoop</h1><p className="tag">Borrow what you need. Lend what you don&rsquo;t.</p></div>
        <div>
          <Show when="signed-out"><SignInButton mode="modal"><button className="btn">Sign in to lend or borrow</button></SignInButton></Show>
          <Show when="signed-in"><Link href="/dashboard"><button className="btn">Open dashboard</button></Link></Show>
        </div>
      </header>
      <h2>Available tools</h2>
      {tools === undefined && <p className="muted">Loading&hellip;</p>}
      {tools?.length === 0 && <p className="muted">No tools listed yet.</p>}
      {tools?.map((t, i) => (
        <div className="card row" key={i}><strong>{t.name}</strong><span className="badge">{t.category}</span></div>
      ))}
    </main>
  );
}