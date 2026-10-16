// ── Tool agent penetration ────────────────────────────────────────────────────
//
// Tool untuk agent penetration. Bentuknya OpenAI function-calling supaya
// langsung lewat /v1/chat/completions milik 9router sendiri — tanpa SDK agent
// dari luar, tanpa agent lain yang ikut mencampuri hasil pengujian.
//
// Tiap role dapat_subset berbeda: root bisa menurunkan agent baru lewat
// spawn_agent, agent pekerja bisa melaporkan kegagalan lewat report_failure.
// Sisanya sama untuk semua role.
//
// Yang belum ada dari daftar tool Strix (proxy/Caido, agent_browser,
// agents_graph, threat_model) ada di catatan ponytail di agentRuntime.js.

import { runInSandbox } from "@/shared/lib/pentestSandbox.js";
import { getStrixPayload, getStrixPayloads } from "open-sse/penetration/strixPayloads.js";

const STRIX_INDEX = getStrixPayloads()
  .map((p) => `${p.cat}/${p.name}`)
  .join(", ");

const MAX_FINDINGS = 100;
const MAX_FAILURES = 50;

const SHELL_DESCRIPTION =
  "Jalankan command shell di dalam sandbox Kali. Tersedia nmap, sqlmap, nuclei, subfinder, " +
  "naabu, ffuf, katana, curl, jq, python3, dan tool dasar Kali. Output kembali apa adanya " +
  "dan tercatat sebagai bukti bernomor. Backup: /work.";

const LOAD_SKILL_DESCRIPTION =
  "Tarik metodologi pengujian lengkap untuk satu kelas kerentanan sebelum mulai bekerja di " +
  "bidang itu. Panggil saat butuh prosedur, bukan saat sudah tahu caranya.";

const NOTES_DESCRIPTION = "Catat hasil antara, target yang sudah dicek, atau kredensial yang ditemukan.";

const FINDING_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Judul singkat kerentanan." },
    severity: {
      type: "string",
      enum: ["critical", "high", "medium", "low", "info"],
      description: "Nilai jujur. Menaikkan severity agar terlihat dramatis merusak penilaian keseluruhan.",
    },
    evidence_ids: {
      type: "array",
      items: { type: "integer" },
      description:
        "Nomor bukti dari balasan tool shell yang membuktikan temuan ini. Wajib diisi dan " +
        "nomornya harus benar-benar ada — klaim tanpa bukti nyata akan ditolak.",
    },
    evidence_quote: {
      type: "string",
      description:
        "Potongan teks yang ada persis di salah satu bukti yang kamu kutip. Harus cocok verbatim " +
        "dengan output shell itu, bukan ringkasanmu.",
    },
    cvss: {
      type: "string",
      description: "Skor CVSS v3.1 lengkap, mis. \"CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H\". Kosongkan kalau tidak dihitung.",
    },
    cve: {
      type: "string",
      description: "CVE terkait kalau kerentanan ini punya identitas CVE yang sudah dikonfirmasi. Kosongkan kalau tidak.",
    },
    impact: { type: "string", description: "Apa yang benar-benar bisa dilakukan penyerang karena temuan ini." },
    remediation: { type: "string", description: "Perbaikan yang nyata dan bisa dikerjakan." },
  },
  required: ["title", "severity", "evidence_ids", "evidence_quote"],
};

const FINISH_DESCRIPTION =
  "Tandai pekerjaan agent ini selesai dan serahkan hasilnya ke pemanggil. Panggil sekali saja di akhir.";

function shellTool() {
  return {
    type: "function",
    function: {
      name: "shell",
      description: SHELL_DESCRIPTION,
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Command shell, boleh compound dan pipeline." },
          timeout_s: {
            type: "integer",
            description: "Batas waktu detik. Default 120, maks 600. Naikkan untuk scan besar.",
          },
        },
        required: ["command"],
      },
    },
  };
}

function loadSkillTool() {
  return {
    type: "function",
    function: {
      name: "load_skill",
      description: LOAD_SKILL_DESCRIPTION,
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: `Nama skill, mis. "sql_injection", "cvss_scoring". Tersedia: ${STRIX_INDEX}`,
          },
        },
        required: ["name"],
      },
    },
  };
}

function notesTool() {
  return {
    type: "function",
    function: {
      name: "notes",
      description: NOTES_DESCRIPTION,
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Isi catatan." },
        },
        required: ["text"],
      },
    },
  };
}

function finishTool({ hasUntested }) {
  const properties = {
    summary: { type: "string", description: "Ringkasan eksekutif." },
    findings: {
      type: "array",
      description: "Hanya temuan yang buktinya sudah ada di output shell run ini.",
      items: FINDING_SCHEMA,
    },
  };
  const required = ["summary"];
  if (hasUntested) {
    properties.not_tested = {
      type: "array",
      items: { type: "string" },
      description:
        "Area yang tidak sempat diverifikasi, dengan alasannya. Bagian ini yang membuat laporan " +
        "jujur soal batas pengujian, jadi isi bagian yang memang belum diuji.",
    };
    required.push("not_tested");
  }
  return {
    type: "function",
    function: { name: "finish", description: FINISH_DESCRIPTION, parameters: { type: "object", properties, required } },
  };
}

function reportFailureTool() {
  return {
    type: "function",
    function: {
      name: "report_failure",
      description:
        "Laporkan bagian yang gagal diuji. Hasilnya masuk ke laporan root sebagai gap yang diketahui, " +
        "bukanFindings. Panggil begitu kamu yakin tidak bisa melanjutkan di area itu.",
      parameters: {
        type: "object",
        properties: {
          area: { type: "string", description: "Area atau target yang gagal diuji." },
          reason: { type: "string", description: "Alasan sebenarnya, mis. WAF memblokir atau host mati." },
          attempts: { type: "string", description: "Sudah coba apa saja sebelum menyerah." },
        },
        required: ["area", "reason"],
      },
    },
  };
}

function spawnAgentTool(roles) {
  return {
    type: "function",
    function: {
      name: "spawn_agent",
      description:
        "Turunkan agent baru dengan fokus khusus, jalankan sampai selesai, dan terima laporannya. " +
        "Semua agent berbagi sandbox yang sama, jadi hasil dan file dari agent lain tetap terlihat.",
      parameters: {
        type: "object",
        properties: {
          role: {
            type: "string",
            enum: Object.keys(roles),
            description: "Fokus kerja agent yang diturunkan.",
          },
          objective: {
            type: "string",
            description: "Tujuan tunggal yang harus dicapai agent ini, spesifik dan terukur.",
          },
          scope: { type: "string", description: "Target atau jalur yang boleh ia explore." },
          max_steps: {
            type: "integer",
            description: "Batas langkah untuk agent ini. Default 8, maks 20.",
          },
        },
        required: ["role", "objective"],
      },
    },
  };
}

/**
 * Tool untuk satu role. Root dapat spawn_agent; agent pekerja dapat
 * report_failure. Keduanya juga bisa mengirim not_tested, karena hanya root
 * yang menyusun laporan akhir.
 */
export function toolsForRole(role) {
  const tools = [shellTool(), loadSkillTool(), notesTool()];
  if (role === "root") {
    tools.push(spawnAgentTool(WORKER_ROLES));
  } else {
    tools.push(reportFailureTool());
  }
  tools.push(finishTool({ hasUntested: role === "root" }));
  return tools;
}

export const WORKER_ROLES = ["recon", "exploit", "privesc"];

export const AGENT_TOOLS = toolsForRole("root");

export const AGENT_TOOL_NAMES = AGENT_TOOLS.map((t) => t.function.name);

const MAX_NOTES_CHARS = 40_000;

/**
 * Jalankan satu tool call. Selalu mengembalikan string — model hanya boleh
 * melihat teks, jadi bentuk error cukup berupa pesan, bukan objek.
 */
export async function runAgentTool(name, rawArgs, ctx) {
  const args = safeParse(rawArgs);

  switch (name) {
    case "shell": {
      const command = String(args.command || "").trim();
      if (!command) return "ERROR: parameter `command` kosong.";
      const timeoutMs = clampTimeout(args.timeout_s);
      const result = await runInSandbox(ctx.sessionId, command, {
        timeout: timeoutMs,
        runtime: ctx.runtime,
      });
      const head = result.ok
        ? `$ ${command}\n${result.output || "(kosong — command sukses tanpa output)"}`
        : `$ ${command}\nEXIT ${result.exitCode ?? "?"}\n${result.output}`;

      // Bukti bernomor: ini yang membuat klaim palsu tidak mungkin, karena
      // temuan wajib mengutip nomor yang benar-benar ada di sini.
      const id = (ctx.evidence?.length || 0) + 1;
      if (ctx.evidence) {
        ctx.evidence.push({
          id,
          command,
          output: String(result.output || ""),
          exitCode: result.exitCode ?? null,
          ok: Boolean(result.ok),
          ms: result.ms ?? null,
        });
      }
      return `Bukti #${id}\n${head}`;
    }

    case "load_skill": {
      const key = normalizeSkillKey(args.name);
      const payload = key ? getStrixPayload(key) : null;
      if (!payload) {
        return `ERROR: skill "${args.name}" tidak dikenal.\nTersedia: ${STRIX_INDEX}`;
      }
      return `# ${payload.name} (${payload.cat})\n\n${String(payload.text || "").slice(0, 40_000)}`;
    }

    case "notes": {
      const text = String(args.text || "").trim();
      if (!text) return "ERROR: parameter `text` kosong.";
      ctx.notes.push(text);
      return `Tercatat (${ctx.notes.length} catatan, ${ctx.notes.join("\n").length} karakter total).`;
    }

    case "spawn_agent": {
      if (ctx.role !== "root" || typeof ctx.spawn !== "function") {
        return "ERROR: hanya agent root yang boleh menurunkan agent lain.";
      }
      return ctx.spawn(args);
    }

    case "report_failure": {
      const area = String(args.area || "").trim();
      const reason = String(args.reason || "").trim();
      if (!area || !reason) return "ERROR: parameter `area` dan `reason` wajib diisi.";
      ctx.failures.push({
        area,
        reason,
        attempts: String(args.attempts || "").trim(),
      });
      return "Gagal dilaporkan ke agent root. Lanjut ke area lain.";
    }

    case "finish": {
      const verdict = auditFindings(args.findings, ctx.evidence);
      if (!verdict.ok) return verdict.message;

      ctx.finished = true;
      ctx.report = {
        summary: String(args.summary || ""),
        findings: verdict.findings,
        notTested: Array.isArray(args.not_tested)
          ? args.not_tested.map((t) => String(t)).slice(0, MAX_FAILURES)
          : [],
      };
      return "Hasil diterima. Panggil finish sekali saja lalu berhenti memakai tool.";
    }

    default:
      return `ERROR: tool "${name}" tidak dikenal.`;
  }
}

/**
 * Gerbang anti-false-positive. Setiap temuan harus menunjuk bukti yang benar-benar
 * ada di run ini dan mengutipnya persis, sehingga model tidak bisa membuat
 * bukti sendiri. Klaim yang tidak bisa diaudit ditolak, bukan diterima diam-diam.
 */
export function auditFindings(rawFindings, evidence) {
  const list = Array.isArray(rawFindings) ? rawFindings.slice(0, MAX_FINDINGS) : [];
  if (!list.length) return { ok: true, findings: [] };

  const byId = new Map((evidence || []).map((e) => [e.id, e]));
  const accepted = [];

  for (const [index, raw] of list.entries()) {
    const title = String(raw?.title || "").trim();
    const ids = Array.isArray(raw?.evidence_ids)
      ? raw.evidence_ids.map((n) => Number(n)).filter((n) => Number.isInteger(n))
      : [];

    if (!title) {
      return reject(index, "judulnya kosong", evidence);
    }
    if (!ids.length) {
      return reject(index, "tidak menyertakan evidence_ids", evidence);
    }

    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length) {
      return reject(index, `evidence_ids ${missing.join(", ")} tidak ada di run ini`, evidence);
    }

    const quote = String(raw?.evidence_quote || "");
    if (!quote) return reject(index, "tidak menyertakan evidence_quote", evidence);

    const cited = ids.map((id) => byId.get(id));
    const haystack = normalizeForQuote(cited.map((e) => e.output).join("\n"));
    if (!haystack.includes(normalizeForQuote(quote))) {
      return reject(
        index,
        `evidence_quote tidak cocok persis dengan output bukti ${ids.join(", ")}`,
        evidence
      );
    }

    accepted.push({
      title,
      severity: String(raw?.severity || "info"),
      evidenceIds: ids,
      evidenceQuote: quote,
      cvss: String(raw?.cvss || "").trim(),
      cve: String(raw?.cve || "").trim(),
      impact: String(raw?.impact || "").trim(),
      remediation: String(raw?.remediation || "").trim(),
    });
  }

  return { ok: true, findings: accepted };
}

function reject(index, reason, evidence) {
  const valid = (evidence || []).map((e) => e.id);
  return {
    ok: false,
    message:
      `ERROR: temuan #${index + 1} ditolak — ${reason}.\n` +
      `Hanya klaim dengan bukti nyata yang diterima. Bukti yang tersedia: ` +
      `${valid.length ? valid.join(", ") : "(belum ada — jalankan shell dulu)"}.`,
  };
}

// Spasi lekukan tidak boleh menentukan lolos-tidaknya kutipan: model sering
// menyalin output dengan indentasi berbeda.
function normalizeForQuote(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function safeParse(raw) {
  if (raw && typeof raw === "object") return raw;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function clampTimeout(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return 120_000;
  return Math.min(Math.round(seconds * 1000), 600_000);
}

/**
 * Terima "sql_injection", "sql-injection", "vulnerabilities/sql_injection",
 * atau pun id lengkap "strix:vulnerabilities:sql_injection". Model menebak
 * format yang berbeda-beda; jangan biarkan itu menggagalkan pemanggilan.
 */
function normalizeSkillKey(name) {
  const raw = String(name || "").trim();
  if (!raw) return null;
  if (raw.startsWith("strix:")) return getStrixPayload(raw) ? raw : null;

  const slug = raw.toLowerCase().replace(/[\s-]+/g, "_");

  // Bentuk "vulnerabilities/sql_injection" atau "vulnerabilities/sql-injection":
  // model sering menebak format kategori/nama karena itu yang terlihat di UI.
  if (raw.includes("/")) {
    const [cat, ...rest] = raw.split("/");
    const catSlug = cat.trim().toLowerCase();
    const nameSlug = rest.join("/").trim().toLowerCase().replace(/[\s-]+/g, "_");
    for (const meta of getStrixPayloads()) {
      if (String(meta.cat).toLowerCase() === catSlug && meta.name === nameSlug) return meta.id;
    }
  }

  for (const meta of getStrixPayloads()) {
    if (meta.name === slug) return meta.id;
    if (String(meta.name).toLowerCase().replace(/[_-]+/g, "_") === slug.replace(/[_-]+/g, "_")) {
      return meta.id;
    }
  }
  return null;
}