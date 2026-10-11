import { randomUUID } from "node:crypto";
import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { getApiKeys } from "@/lib/db/repos/apiKeysRepo.js";
import { assertPenetrationAuth } from "@/lib/auth/payloadAuth";
import { createRunState, runAgent } from "@/shared/lib/agentRuntime.js";
import { stopSandbox } from "@/shared/lib/pentestSandbox.js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_MAX_STEPS = 12;
const HARD_MAX_STEPS = 40;

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

/**
 * POST /api/developer/penetration/agent
 *
 * Agent penetration milik 9router sendiri. Root menurunkan agent kerja
 * (recon, exploit, privesc) lewat tool spawn_agent; semuanya berbagi satu
 * sandbox container dan satu buku bukti, nol agent luar yang ikut campur —
 * itulah yang bikin pengujian blackbox-nya bisa dipercaya.
 *
 * Yang dipakai loop ini:
 *   - handleChat internal (router milik kita sendiri, bukan HTTP ke diri sendiri)
 *   - header x-9router-inject: off secara default supaya pengukuran tidak
 *     tercemar prompt global. Body inject mengaktifkannya kembali untuk run
 *     yang memang sengaja menguji injection stack.
 *   - session id baru per run, sama seperti A/B di Developer tab: kalau id
 *     ikut koneksi yang stabil, model memutar ulang turn sebelumnya dan
 *     hasil run kedua membawa prompt run pertama.
 *
 * Balasan: SSE dengan bentuk { type: start|text|tool_start|tool_end|agent_*|done|error }.
 */
export async function POST(request) {
  if (!(await assertPenetrationAuth(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureInitialized();

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const target = String(body?.target || "").trim();
  const scope = String(body?.scope || "").trim();
  const model = String(body?.model || "").trim();
  const instructions = String(body?.instructions || "").trim();
  const containerRuntime = String(body?.containerRuntime || "").trim() || undefined;
  const useInjection = body?.inject === true;
  const maxSteps = Math.min(
    Math.max(1, Number(body?.maxSteps) || DEFAULT_MAX_STEPS),
    HARD_MAX_STEPS
  );

  if (!target) return Response.json({ error: "Target wajib diisi" }, { status: 400 });
  if (!model) return Response.json({ error: "Model wajib dipilih" }, { status: 400 });

  const keys = await getApiKeys().catch(() => []);
  const activeKey = Array.isArray(keys) ? keys.find((k) => k?.isActive && k.key) : null;
  if (!activeKey) {
    return Response.json(
      { error: "Tidak ada API key aktif — buat di Endpoint settings dulu" },
      { status: 503 }
    );
  }

  const sessionId = `pent-${randomUUID()}`;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          /* client sudah disconnect */
        }
      };

      try {
        send({ type: "start", sessionId, model, maxSteps, inject: useInjection });

        const objective = [
          `Target: ${target}`,
          scope ? `Scope: ${scope}` : "Scope: hanya yang tercantum di target.",
          instructions ? `\nInstruksi tambahan:\n${instructions}` : "",
          "\nLakukan pengujian keamanan blackbox terhadap target. Pakai tool, jangan menebak.",
        ].join("\n");

        const state = createRunState();

        const result = await runAgent({
          role: "root",
          objective,
          scope,
          target,
          sessionId,
          runtime: containerRuntime,
          state,
          emit: send,
          maxSteps,
          callModel: (messages, tools) =>
            callModel(request, { model, messages, tools, activeKey, sessionId, useInjection }),
        });

        send({
          type: "done",
          finished: Boolean(result.report),
          failed: result.failed,
          reason: result.reason,
          report: result.report,
          notes: state.notes,
          failures: state.failures,
          children: state.children,
          evidenceCount: state.evidence.length,
        });
      } catch (error) {
        send({ type: "error", message: String(error?.message || error) });
      } finally {
        // Sapu containernya supaya tidak ada proses container yang nyangkut
        // setelah run selesai. Kegagalan di sini tidak boleh menutup stream.
        await stopSandbox(sessionId).catch(() => {});
        try {
          controller.close();
        } catch {
          /* sudah tertutup */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

/**
 * Satu putaran model. Non-streaming supaya tool_calls datang sebagai array
 * utuh — parsing delta tool_call per index jauh lebih rapuh, dan yang kita
 * tampilkan ke user adalah progres per tool, bukan token per token.
 */
async function callModel(request, { model, messages, tools, activeKey, sessionId, useInjection }) {
  const headers = new Headers();
  headers.set("content-type", "application/json");
  headers.set("authorization", `Bearer ${activeKey.key}`);
  headers.set("accept", "application/json");
  headers.set("x-session-id", sessionId);
  if (!useInjection) headers.set("x-9router-inject", "off");

  const url = new URL("/api/v1/chat/completions", request.url);
  const forwarded = new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages,
      tools,
      tool_choice: "auto",
      stream: false,
    }),
  });

  const response = await handleChat(forwarded);
  if (!response || !response.ok) {
    const detail = await response?.text?.().catch(() => "");
    const message = `Model gagal: ${response?.status || "tidak diketahui"} ${detail || ""}`.trim();
    throw new Error(message);
  }

  const contentType = response.headers.get("content-type") || "";
  const raw = await response.text();

  // Executor sebagian tetap mengembalikan SSE walau stream:false. Ambil objek
  // message dari chunk data terakhir yang punya choices, bukan andalkan JSON.
  if (contentType.includes("text/event-stream")) {
    const message = lastMessageFromSse(raw);
    if (!message) throw new Error("Respons model tidak bisa dibaca");
    return message;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Respons model bukan JSON yang valid");
  }
  if (parsed?.error) {
    throw new Error(parsed.error?.message || String(parsed.error));
  }
  const message = parsed?.choices?.[0]?.message;
  if (!message) throw new Error("Respons model tidak punya message");
  return message;
}

function lastMessageFromSse(raw) {
  let message = null;
  for (const line of String(raw).split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const chunk = JSON.parse(payload);
      const candidate = chunk?.choices?.[0]?.message;
      if (candidate && (candidate.tool_calls?.length || candidate.content)) message = candidate;
    } catch {
      /* chunk bukan JSON — abaikan */
    }
  }
  return message;
}