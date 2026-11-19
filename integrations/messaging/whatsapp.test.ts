import { expect, it } from "bun:test";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WhatsAppAdapter } from "./whatsapp.ts";

it("pins the executable, isolates accounts, maps real CLI envelopes/cursors and terminates only its follower", async () => {
  const directory = await mkdtemp(join(tmpdir(), "herdr-whatsapp-fixture-"));
  const executable = join(directory, "fixture"), audit = join(directory, "audit.jsonl");
  const source = `#!${process.execPath}\nconst args=process.argv.slice(2);const store=args[args.indexOf('--store')+1];
await Bun.write(Bun.file(${JSON.stringify(audit)}), (await Bun.file(${JSON.stringify(audit)}).text().catch(()=>''))+JSON.stringify({args,home:process.env.HOME,leak:process.env.WACLI_WEBHOOK_URL??null,pid:process.pid})+'\\n');
const out=data=>console.log(JSON.stringify({success:true,data,error:null}));
if(args.includes('auth')&&args.includes('status'))out({authenticated:true});
else if(args.includes('auth')||args.includes('sync')){console.error(JSON.stringify({event:'qr_code',data:{code:'fictional-qr-payload'}}));await new Promise(r=>setTimeout(r,30));console.error(JSON.stringify({event:'connected',data:{}}));setInterval(()=>{},1000);}
else if(args.includes('chats'))out([{jid:'fixture@g.us',kind:'group',name:'Business fixture'}]);
else if(args.includes('messages'))out({messages:[{ChatJID:args[args.indexOf('--chat')+1],MsgID:'opaque-ABC',Timestamp:'2026-10-18T00:00:00Z',FromMe:false,Text:'Fictional brief',MediaType:'image'}],page:{has_more:!args.includes('--cursor'),next_cursor:'eyJhIjoxfQ=='}});
else process.exit(2);`;
  await writeFile(executable, source, { mode: 0o700 });
  const sha = new Bun.CryptoHasher("sha256").update(source).digest("hex");
  const id = crypto.randomUUID(), controller = new AbortController();
  const adapter = new WhatsAppAdapter(directory, id, executable, sha);
  const previous = process.env.WACLI_WEBHOOK_URL; process.env.WACLI_WEBHOOK_URL = "must-not-inherit";
  try {
    const bad = new WhatsAppAdapter(directory, crypto.randomUUID(), executable, "0".repeat(64));
    await expect(bad.chats(controller.signal)).rejects.toThrow("identity changed");
    expect(await Bun.file(audit).exists()).toBe(false);
    let challenge: string | undefined;
    await adapter.link({ phone: "", label: "Fixture", scope: "business", api_id: 0, api_hash: "" }, async (kind, display) => { expect(kind).toBe("qr"); challenge = display; return ""; }, controller.signal);
    expect(challenge).toBe("fictional-qr-payload"); expect(adapter.status()).toBe("live");
    expect((await stat(join(directory, id))).mode & 0o777).toBe(0o700);
    expect(await adapter.chats(controller.signal)).toEqual([{ id: "fixture@g.us", title: "Business fixture", kind: "group" }]);
    const first = await adapter.messages("fixture@g.us", null, controller.signal);
    expect(first.before).toBe("eyJhIjoxfQ=="); expect(first.messages[0]).toMatchObject({ id: "opaque-ABC", chat_id: "fixture@g.us", has_attachment: true, text: "Fictional brief" });
    expect((await adapter.messages("fixture@g.us", first.before, controller.signal)).before).toBeNull();
    await adapter.close(); expect(adapter.status()).toBe("offline");
    expect(await adapter.resume(controller.signal)).toBe(true);
    controller.abort(); await adapter.close();
    const calls = (await readFile(audit, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    expect(calls).toHaveLength(6);
    for (const call of calls) { expect(call.home).toBe(join(directory, id)); expect(call.leak).toBeNull(); expect(call.args).not.toContain("send"); expect(call.args.slice(0, 2)).toEqual(["--store", join(directory, id)]); }
    expect(calls[0].args).toContain("--full-history");
    for (const call of calls.filter(c => c.args.includes("list") || c.args.includes("status"))) expect(call.args).toContain("--read-only");
    expect(calls[3].args.slice(-2)).toEqual(["--cursor", "eyJhIjoxfQ=="]);
    expect(calls.at(-1).args.slice(-2)).toEqual(["sync", "--follow"]);
    const cancelled = new AbortController(); cancelled.abort();
    await expect(adapter.resume(cancelled.signal)).rejects.toThrow();
  } finally { await adapter.close(); if (previous === undefined) delete process.env.WACLI_WEBHOOK_URL; else process.env.WACLI_WEBHOOK_URL = previous; await rm(directory, { recursive: true, force: true }); }
});
