// ── Runtime agent penetration ─────────────────────────────────────────────────
//
// Satu loop agent yang dipakai berulang. Root menurunkan agent kerja lewat
// spawn_agent; tiap agent punya tool subset dan system prompt sendiri, tapi
// semuanya berbagi satu sandbox dan satu buku bukti, jadi hasil recon bisa
// langsung dirujuk agent exploit tanpa disalin manual.
//
// ponytail: hanya root boleh menurunkan agent dan jumlahnya dibatasi. Kalau
// nanti butuh agen tiga tingkat, naikkan MAX_CHILDREN di sini.

import { runAgentTool, toolsForRole, WORKER_ROLES } from "@/shared/lib/agentTools.js";

export const MAX_CHILDREN = 6;
export const WORKER_ROLES_EXPORT = WORKER_ROLES;

const ROLE_BRIEF = {
  root:
    "agent root yang mengoordinasikan pengujian keamanan. Kamu yang memecah pekerjaan, " +
    "menurunkan agent speci dengan fokus berbeda, lalu merangkum laporan akhir.",
  recon:
    "agent recon. Fokusmu menemukan surface serangan: port, layanan, versi, endpoint, dan " +
    "vektor yang mungkin bisa diserang. Jangan mencoba eksploit mendalam di sini.",
  exploit:
    "agent exploit. Fokusmu membuktikan satu vektor dengan bukti yang bisa diaudit, lalu " +
    "menyerahkan Proof of Concept-nya. Bukti harus nyata dan bisa diulang.",
  privesc:
    "agent privesc. Fokusmu mencari dan membuktikan jalur privilege escalation. Klaim akses " +
    "root hanya sah bila memang terlihat perintahnya berhasil dijalankan.",
};

const ROOT_DELEGATION =
  "\n\nSebelum turunkan agent, putuskan sendiri: kalau butuh peta permukaan target atau " +
  "petunjuk awal, pakai recon; kalau sudah punya vektor konkret yang perlu dibuktikan, pakai " +
  "exploit; kalau menyangkut naiknya hak akses, pakai privesc. Satu agent satu tujuan. " +
  "Setelah laporannya kembali, tetapkan sendiri agent berikutnya.";

const EVIDENCE_RULE =
  "\n\nTidak ada temuan tanpa bukti nyata. Kalau tidak bisa membuktikan, itu bukan temuan — " +
  "cukup sebut sebagai area yang belum terverifikasi.";

/** System prompt satu role. Sengaja pendek: aturan lengkap ada di tool. */
export function systemPrompt(role, { target, scope } = {}) {
  const parts = [`Kamu ${ROLE_BRIEF[role] || ROLE_BRIEF.recon}.`];
  if (target) parts.push(`Target: ${target}`);
  if (scope) parts.push(`Scope: ${scope}`);
  if (role === "root") parts.push(ROOT_DELEGATION);
  parts.push(EVIDENCE_RULE);
  return parts.join("\n");
}

/** State yang dibagi semua agent dalam satu run. */
export function createRunState() {
  return { evidence: [], failures: [], notes: [], children: [] };
}

/**
 * Jalankan satu agent sampai selesai.
 *
 * @param {object} o
 * @param {string} o.role              root | recon | exploit | privesc
 * @param {string} o.objective         Tujuan agent ini.
 * @param {(messages, tools) => Promise<{content: string, tool_calls?: object[]}>} o.callModel
 * @param {(event: object) => void} [o.emit]
 * @returns {Promise<{report: object|null, failed: boolean, reason: string}>}
 */
export async function runAgent({
  role = "root",
  objective,
  scope = "",
  target = "",
  sessionId,
  runtime,
  callModel,
  state,
  emit = () => {},
  maxSteps = 12,
  name = role,
}) {
  const ctx = {
    role,
    name,
    sessionId,
    runtime,
    notes: state.notes,
    evidence: state.evidence,
    failures: state.failures,
    finished: false,
    report: null,
    spawn: null,
  };

  // Menurunkan agent adalah satu-satunya cara root bekerja. Anaknya menjalankan
  // loop sendiri dan laporannya balik sebagai hasil tool call.
  if (role === "root") {
    ctx.spawn = async (rawArgs) => {
      const childRole = String(rawArgs.role || "recon");
      if (!WORKER_ROLES.includes(childRole)) {
        return `ERROR: role "${childRole}" tidak dikenal. Pilihan: ${WORKER_ROLES.join(", ")}.`;
      }
      if (state.children.length >= MAX_CHILDREN) {
        return `ERROR: batas ${MAX_CHILDREN} agent anak sudah tercapai. Rangkum dengan yang ada.`;
      }

      const childName = `${childRole}-${state.children.length + 1}`;
      const before = state.failures.length;
      const record = { name: childName, role: childRole, objective: rawArgs.objective };
      state.children.push(record);
      emit({ type: "agent_start", agent: childName, role: childRole, objective: rawArgs.objective });

      const result = await runAgent({
        role: childRole,
        objective: rawArgs.objective,
        scope: rawArgs.scope || scope,
        target,
        sessionId,
        runtime,
        callModel,
        state,
        emit,
        maxSteps: clampSteps(rawArgs.max_steps, 8, 20),
        name: childName,
      });

      record.failed = result.failed;
      record.reason = result.reason;

      // Anak yang berhenti karena kehabisan langkah atau error model tidak
      // sempat memanggil report_failure sendiri. Tanpa baris ini kegagalannya
      // hilang: root masih melihatnya di teks laporan, tapi tidak masuk daftar
      // kegagalan — persis yang tidak boleh terjadi.
      if (result.failed && state.failures.length === before) {
        state.failures.push({
          agent: childName,
          area: String(rawArgs.objective || childRole).slice(0, 120),
          reason: String(result.reason || "gagal tanpa alasan"),
        });
      }

      emit({ type: "agent_end", agent: childName, role: childRole, failed: result.failed, reason: result.reason });
      return renderChildReport(childName, result);
    };
  }

  const tools = toolsForRole(role);
  const messages = [
    { role: "system", content: systemPrompt(role, { target, scope }) },
    { role: "user", content: objective || "Mulai pengujian." },
  ];

  let nudged = false;

  for (let step = 1; step <= maxSteps; step++) {
    if (ctx.finished) break;
    emit({ type: "agent_step", agent: name, step, maxSteps });

    let message;
    try {
      message = await callModel(messages, tools);
    } catch (error) {
      const reason = textOf(error);
      emit({ type: "agent_error", agent: name, message: reason });
      return { report: ctx.report, failed: true, reason: reason };
    }

    if (message?.content) {
      emit({ type: "text", agent: name, content: message.content });
    }
    messages.push(message);

    const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
    if (!calls.length) {
      // Model bicara tanpa memakai tool. Ingatkan sekali saja supaya agent
      // tidak berhenti di tengah tanpa menyerahkan hasil.
      if (nudged) {
        return { report: ctx.report, failed: true, reason: "model berhenti tanpa finish" };
      }
      nudged = true;
      messages.push({
        role: "user",
        content: "Rangkum hasilmu sekarang dengan tool finish, atau lanjutkan dengan tool yang ada.",
      });
      continue;
    }

    for (const call of calls) {
      const fnName = call?.function?.name;
      const rawArgs = call?.function?.arguments;
      emit({ type: "tool_start", agent: name, tool: fnName, args: rawArgs });

      let result;
      try {
        result = await runAgentTool(fnName, rawArgs, ctx);
      } catch (error) {
        result = `ERROR: tool gagal — ${textOf(error)}`;
      }

      emit({
        type: "tool_end",
        agent: name,
        tool: fnName,
        output: String(result).slice(0, 2_000),
      });

      messages.push({
        role: "tool",
        tool_call_id: call?.id,
        content: String(result),
      });

      if (ctx.finished) break;
    }
  }

  if (!ctx.finished) {
    return { report: ctx.report, failed: true, reason: `batas ${maxSteps} langkah habis` };
  }
  return { report: ctx.report, failed: false, reason: "finish" };
}

function renderChildReport(childName, result) {
  if (result.failed) {
    const failures = result.report?.notTested || [];
    return (
      `[${childName}] GAGAT: ${result.reason}\n` +
      (failures.length ? `Belum terverifikasi: ${failures.join("; ")}\n` : "") +
      "Jangan diperlakukan sebagai temuan."
    );
  }
  const report = result.report || { summary: "(tanpa laporan)", findings: [] };
  const lines = [`[${childName}] selesai`, `Ringkasan: ${report.summary || "(kosong)"}`];
  for (const f of report.findings || []) {
    lines.push(`- ${f.title} (${f.severity}) bukti #${(f.evidenceIds || []).join(", #")}`);
  }
  if (report.notTested?.length) {
    lines.push(`Belum terverifikasi: ${report.notTested.join("; ")}`);
  }
  return lines.join("\n");
}

function clampSteps(value, fallback, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.round(n), max);
}

function textOf(error) {
  if (!error) return "Gagal tidak diketahui";
  return String(error.message || error).trim().slice(0, 500);
}