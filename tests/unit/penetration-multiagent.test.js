import { describe, it, expect } from "vitest";
import { auditFindings, toolsForRole, runAgentTool } from "@/shared/lib/agentTools.js";
import { createRunState, runAgent, systemPrompt } from "@/shared/lib/agentRuntime.js";

// Bukti palsu adalah kegagalan yang paling merusak laporan, jadi setiap
// cabang gerbang ini punya test sendiri.
const EVIDENCE = [
  { id: 1, command: "curl -i http://t/", output: "HTTP/1.1 200 OK\nServer: nginx/1.18.0", ok: true },
  { id: 2, command: "nmap -sV t", output: "22/tcp open ssh OpenSSH 8.2p1", ok: true },
];

describe("auditFindings — gerbang anti-klaim palsu", () => {
  it("menerima temuan yang buktinya ada dan kutipannya cocok", () => {
    const result = auditFindings(
      [{ title: "Versi nginx lama", severity: "low", evidence_ids: [1], evidence_quote: "nginx/1.18.0" }],
      EVIDENCE
    );
    expect(result.ok).toBe(true);
    expect(result.findings[0].evidenceIds).toEqual([1]);
  });

  it("menolak temuan tanpa evidence_ids", () => {
    const result = auditFindings(
      [{ title: "Dugaan SQLi", severity: "high", evidence_quote: "apa saja" }],
      EVIDENCE
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("evidence_ids");
  });

  it("menolak temuan yang mengutip bukti yang tidak ada", () => {
    const result = auditFindings(
      [{ title: "Khayalan", severity: "high", evidence_ids: [99], evidence_quote: "root:x:0:0" }],
      EVIDENCE
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("tidak ada di run ini");
  });

  it("menolak kutipan yang tidak ada di output aslinya", () => {
    const result = auditFindings(
      [{ title: "Palsu", severity: "critical", evidence_ids: [1], evidence_quote: "database_dump.sql" }],
      EVIDENCE
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("tidak cocok persis");
  });

  it("tetap menerima kutipan yang hanya beda indentasi", () => {
    const result = auditFindings(
      [{ title: "SSH tua", severity: "info", evidence_ids: [2], evidence_quote: "OpenSSH 8.2p1" }],
      EVIDENCE
    );
    expect(result.ok).toBe(true);
  });

  it("tolak seluruh batch kalau satu temuan palsu di dalamnya", () => {
    const result = auditFindings(
      [
        { title: "Asli", severity: "low", evidence_ids: [1], evidence_quote: "nginx" },
        { title: "Palsu", severity: "critical", evidence_ids: [7], evidence_quote: "apa saja" },
      ],
      EVIDENCE
    );
    expect(result.ok).toBe(false);
  });

  it("lolos tanpa temuan", () => {
    expect(auditFindings([], EVIDENCE).ok).toBe(true);
  });
});

describe("toolsForRole", () => {
  const names = (role) => toolsForRole(role).map((t) => t.function.name);

  it("root boleh menurunkan agent, agent kerja tidak", () => {
    expect(names("root")).toContain("spawn_agent");
    for (const role of ["recon", "exploit", "privesc"]) {
      expect(names(role)).not.toContain("spawn_agent");
    }
  });

  it("agent kerja bisa melaporkan kegagalan", () => {
    for (const role of ["recon", "exploit", "privesc"]) {
      expect(names(role)).toContain("report_failure");
    }
  });

  it("root wajib mengisi not_tested, agent kerja tidak", () => {
    const rootFinish = toolsForRole("root").find((t) => t.function.name === "finish");
    const workerFinish = toolsForRole("recon").find((t) => t.function.name === "finish");
    expect(rootFinish.function.parameters.required).toContain("not_tested");
    expect(workerFinish.function.parameters.required).not.toContain("not_tested");
  });

  it("semua role punya tool dasar yang sama", () => {
    for (const role of ["root", "recon", "exploit", "privesc"]) {
      for (const tool of ["shell", "load_skill", "notes", "finish"]) {
        expect(names(role)).toContain(tool);
      }
    }
  });

  it("temuan wajib punya bukti di skema, bukan cuma di deskripsi", () => {
    const finish = toolsForRole("root").find((t) => t.function.name === "finish");
    const item = finish.function.parameters.properties.findings.items;
    expect(item.required).toEqual(["title", "severity", "evidence_ids", "evidence_quote"]);
  });
});

function ctxWith(overrides = {}) {
  return {
    role: "root",
    name: "root",
    sessionId: "test-session",
    notes: [],
    evidence: [],
    failures: [],
    finished: false,
    report: null,
    ...overrides,
  };
}

describe("runAgentTool — finish dan report_failure", () => {
  it("finish ditolak dan tidak menutup run saat temuan tanpa bukti", async () => {
    const ctx = ctxWith({ evidence: [...EVIDENCE] });
    const out = await runAgentTool("finish", { summary: "s", findings: [{ title: "x", severity: "high" }] }, ctx);
    expect(out).toContain("ditolak");
    expect(ctx.finished).toBe(false);
  });

  it("finish diterima saat bukti valid", async () => {
    const ctx = ctxWith({ evidence: [...EVIDENCE] });
    const out = await runAgentTool(
      "finish",
      { summary: "s", findings: [{ title: "nginx tua", severity: "low", evidence_ids: [1], evidence_quote: "nginx/1.18.0" }], not_tested: [] },
      ctx
    );
    expect(out).not.toContain("ditolak");
    expect(ctx.finished).toBe(true);
    expect(ctx.report.findings).toHaveLength(1);
  });

  it("report_failure masuk ke ledger kegagalan", async () => {
    const ctx = ctxWith();
    await runAgentTool("report_failure", { area: "/admin", reason: "WAF memblokir", attempts: "curl, sqlmap" }, ctx);
    expect(ctx.failures).toHaveLength(1);
    expect(ctx.failures[0].area).toBe("/admin");
  });

  it("report_failure menolak area kosong", async () => {
    const ctx = ctxWith();
    const out = await runAgentTool("report_failure", { area: "", reason: "" }, ctx);
    expect(out).toContain("ERROR");
    expect(ctx.failures).toHaveLength(0);
  });

  it("agent kerja tidak bisa memanggil spawn_agent walau ctx punya spawn", async () => {
    const ctx = ctxWith({ role: "recon", spawn: async () => "tidak seharusnya dipanggil" });
    const out = await runAgentTool("spawn_agent", { role: "exploit" }, ctx);
    expect(out).toContain("hanya agent root");
  });

  it("spawn_agent meneruskan ke ctx.spawn", async () => {
    const ctx = ctxWith({ spawn: async () => "laporan anak" });
    const out = await runAgentTool("spawn_agent", { role: "recon", objective: "petakan port" }, ctx);
    expect(out).toBe("laporan anak");
  });

  it("notes merekam ke ctx", async () => {
    const ctx = ctxWith();
    await runAgentTool("notes", { text: "target pakai nginx" }, ctx);
    expect(ctx.notes[0]).toContain("nginx");
  });
});

// callModel palsu: meniru model yang memakai tool. Berbeda tool yang ditawarkan
// menentukan percakapan mana yang sedang berjalan, jadi root dan anaknya bisa
// memakai satu fungsi yang sama.
function scriptedModel(script) {
  // Indeks langkah harus dipisah per peran: root dan anak berjalan di loop
  // yang sama, jadi satu penghitung bersama membuat anak melompat-nomor script.
  const counters = { root: 0, worker: 0 };
  return async (messages, tools) => {
    const name = tools.map((t) => t.function.name);
    const branch = name.includes("spawn_agent") ? "root" : "worker";
    const pick = script[branch];
    const index = counters[branch]++;
    const step = pick[Math.min(index, pick.length - 1)];
    if (!step) throw new Error("script habis");
    if (step.text) return { role: "assistant", content: step.text };
    return {
      role: "assistant",
      content: null,
      tool_calls: [
        { id: `${branch}-${index}`, type: "function", function: { name: step.tool, arguments: step.args } },
      ],
    };
  };
}

describe("runAgent — delegasi root ke agent kerja", () => {
  it("root menurunkan agent lalu menyerahkan laporannya", async () => {
    const state = createRunState();
    const callModel = scriptedModel({
      root: [
        { tool: "spawn_agent", args: JSON.stringify({ role: "recon", objective: "petakan port", scope: "22/tcp" }) },
        { tool: "finish", args: JSON.stringify({ summary: "selesai", findings: [], not_tested: ["SSL belum dicek"] }) },
      ],
      worker: [
        { tool: "report_failure", args: JSON.stringify({ area: "port 443", reason: "tertutup" }) },
        { tool: "finish", args: JSON.stringify({ summary: "hanya 22 terbuka", findings: [] }) },
      ],
    });

    const events = [];
    const result = await runAgent({
      role: "root",
      objective: "uji target",
      target: "10.0.0.5",
      state,
      callModel,
      emit: (e) => events.push(e),
      maxSteps: 5,
    });

    expect(result.failed).toBe(false);
    expect(state.children).toHaveLength(1);
    expect(state.children[0].role).toBe("recon");
    expect(state.failures).toHaveLength(1);
    expect(result.report.notTested).toContain("SSL belum dicek");
    expect(events.some((e) => e.type === "agent_start" && e.agent === "recon-1")).toBe(true);
    expect(events.some((e) => e.type === "agent_end" && e.agent === "recon-1")).toBe(true);
  });

  it("kegagalan anak masuk daftar kegagalan walau tidak sempat melapor sendiri", async () => {
    const state = createRunState();
    let firstWorkerCall = true;
    const callModel = scriptedModel({
      root: [
        { tool: "spawn_agent", args: JSON.stringify({ role: "recon", objective: "petakan semua port" }) },
        { tool: "finish", args: JSON.stringify({ summary: "ok", findings: [], not_tested: [] }) },
      ],
      worker: [],
    });
    // Anak berhenti karena bicara tanpa tool — model tidak pernah memanggil
    // report_failure, jadi runtime yang harus mencatat kegagalannya.
    const wrapped = async (messages, tools) => {
      if (tools.map((t) => t.function.name).includes("spawn_agent")) return callModel(messages, tools);
      if (firstWorkerCall) {
        firstWorkerCall = false;
        return { role: "assistant", content: "saya rasa sudah cukup" };
      }
      return callModel(messages, tools);
    };
    await runAgent({ role: "root", objective: "o", state, callModel: wrapped, maxSteps: 5 });
    expect(state.children[0].failed).toBe(true);
    expect(state.failures).toHaveLength(1);
    expect(state.failures[0].agent).toBe(state.children[0].name);
    expect(state.failures[0].area).toContain("petakan semua port");
  });

  it("kegagalan anak yang sudah melapor sendiri tidak dicatat dua kali", async () => {
    const state = createRunState();
    const callModel = scriptedModel({
      root: [
        { tool: "spawn_agent", args: JSON.stringify({ role: "recon", objective: "petakan" }) },
        { tool: "finish", args: JSON.stringify({ summary: "satu anak cukup", findings: [], not_tested: [] }) },
      ],
      worker: [
        { tool: "report_failure", args: JSON.stringify({ area: "port 443", reason: "tertutup" }) },
        { tool: "notes", args: JSON.stringify({ text: "terus jalan" }) },
      ],
    });
    await runAgent({ role: "root", objective: "o", state, callModel, maxSteps: 4 });
    expect(state.failures).toHaveLength(1);
    expect(state.failures[0].area).toBe("port 443");
  });

  it("root tidak boleh menurunkan lebih dari enam anak", async () => {
    const state = createRunState();
    const callModel = scriptedModel({
      root: [{ tool: "spawn_agent", args: JSON.stringify({ role: "recon", objective: "x" }) }],
      worker: [{ tool: "finish", args: JSON.stringify({ summary: "ok", findings: [] }) }],
    });
    // Delapan langkah: spawn sampai ke-7 ditolak batasnya.
    const result = await runAgent({ role: "root", objective: "o", state, callModel, maxSteps: 12 });
    expect(state.children.length).toBeLessThanOrEqual(6);
    expect(result.failed).toBe(true);
  });

  it("role anak tidak dikenal ditolak lewat jalur spawn yang sebenarnya", async () => {
    const state = createRunState();
    let sawRejection = false;
    const callModel = scriptedModel({
      root: [
        { tool: "spawn_agent", args: JSON.stringify({ role: "database-destroyer" }) },
        { tool: "finish", args: JSON.stringify({ summary: "selesai", findings: [], not_tested: [] }) },
      ],
      worker: [],
    });
    // Bungkus callModel supaya pesan error dari spawn ikut teramati.
    const wrapped = async (messages, tools) => {
      const message = await callModel(messages, tools);
      const last = messages[messages.length - 1];
      if (last?.role === "tool") sawRejection = String(last.content).includes("tidak dikenal");
      return message;
    };
    const result = await runAgent({ role: "root", objective: "o", state, callModel: wrapped, maxSteps: 4 });
    expect(sawRejection).toBe(true);
    expect(state.children).toHaveLength(0);
    expect(result.failed).toBe(false);
  });

  it("model yang bicara tanpa tool dikejar satu kali lalu menyerah", async () => {
    const state = createRunState();
    const callModel = async () => ({ role: "assistant", content: "saya selesai memikirkannya" });
    const result = await runAgent({ role: "root", objective: "o", state, callModel, maxSteps: 6 });
    expect(result.failed).toBe(true);
    expect(result.reason).toContain("tanpa finish");
  });

  it("batas langkah habis dilaporkan sebagai kegagalan, bukan laporan palsu", async () => {
    const state = createRunState();
    const callModel = scriptedModel({
      root: [{ tool: "notes", args: JSON.stringify({ text: "terus jalan" }) }],
      worker: [],
    });
    const result = await runAgent({ role: "root", objective: "o", state, callModel, maxSteps: 3 });
    expect(result.failed).toBe(true);
    expect(result.report).toBe(null);
  });

  it("error model diteruskan sebagai kegagalan, bukan exception", async () => {
    const state = createRunState();
    const callModel = async () => {
      throw new Error("provider down");
    };
    const result = await runAgent({ role: "root", objective: "o", state, callModel, maxSteps: 3 });
    expect(result.failed).toBe(true);
    expect(result.reason).toContain("provider down");
  });
});

describe("systemPrompt", () => {
  it("memakai brief role yang sesuai", () => {
    expect(systemPrompt("recon", {})).toContain("agent recon");
    expect(systemPrompt("exploit", {})).toContain("Proof of Concept");
  });

  it("root punya panduan delegasi, agent kerja tidak", () => {
    expect(systemPrompt("root", {})).toContain("exploit");
    expect(systemPrompt("recon", {})).not.toContain("turunkan agent");
  });

  it("scope masuk ke prompt", () => {
    expect(systemPrompt("recon", { target: "10.0.0.5", scope: "hanya 443" })).toContain("hanya 443");
  });
});