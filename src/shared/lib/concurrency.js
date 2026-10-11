/**
 * Per-provider concurrency pool for the Developer page runners (Single /
 * Race / A-B / Council).
 *
 * Why not "just fire them all": the router picks ONE provider credential per
 * request (see sse/services/auth.js → getProviderCredentials). Under the
 * default `fill-first` strategy that is literally the same connection for
 * every concurrent request, so an N-way race fans N simultaneous upstream
 * calls onto a single API key and trips its rate limit. The router recovers
 * (429 → mark the account unavailable → retry on another key), but that costs
 * a full failed round trip per raced model.
 *
 * This module caps in-flight requests *per provider* instead of globally, so
 * racing 10 models across 10 different providers still runs 10 at once, while
 * 10 requests aimed at one provider are metered against that provider's real
 * key budget.
 */

/** Simultaneous requests a single API key tolerates before rate limiting. */
export const PER_KEY_CONCURRENCY = 2;

/** Ceiling for one provider regardless of how many keys it holds. */
export const MAX_PROVIDER_CONCURRENCY = 8;

/**
 * In-flight allowance for one provider.
 *
 * `connections` is the number of active provider connections reported by
 * /v1/models. It only buys headroom under `round-robin`: `fill-first` always
 * resolves to availableConnections[0], so extra keys stay idle no matter how
 * wide we open the gate.
 */
export function providerBudget(model, strategy) {
  const keys = strategy === "round-robin" ? Math.max(1, Number(model?.connections) || 1) : 1;
  return Math.max(1, Math.min(keys * PER_KEY_CONCURRENCY, MAX_PROVIDER_CONCURRENCY));
}

/**
 * Run `worker(item, index)` over every item, gating concurrency per key.
 *
 * This replaces the old fixed-wave scheduler, which had a barrier per batch:
 * one slow model stalled every other model in its wave even though their slots
 * were already free. A semaphore refills a slot the moment it opens, so total
 * wall time tracks the slowest request rather than the slowest per wave.
 *
 * All items are always settled before returning; results stay in input order.
 * If any item rejects, the first error is thrown after the rest finish.
 */
export async function runPooled(items, worker, options = {}) {
  const { keyFor = () => "default", budgetFor = () => 1 } = options;
  const results = new Array(items.length);
  if (items.length === 0) return results;

  const active = new Map();  // key -> in-flight count
  const waiting = new Map(); // key -> queued items
  const errors = [];
  let finished = 0;
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });

  const start = (key, next) => {
    active.set(key, (active.get(key) || 0) + 1);
    Promise.resolve()
      .then(() => worker(next.item, next.index))
      .then(
        (value) => {
          results[next.index] = value;
        },
        (error) => {
          errors.push(error);
        }
      )
      .then(() => {
        active.set(key, active.get(key) - 1);
        finished += 1;
        if (finished === items.length) {
          resolveDone();
          return;
        }
        drain();
      });
  };

  // Deleting the current key while iterating a Map is safe and keeps the loop
  // from revisiting emptied queues; keys added below are picked up in turn.
  function drain() {
    for (const [key, queue] of waiting) {
      while (queue.length && (active.get(key) || 0) < budgetFor(key, queue[0].item)) {
        start(key, queue.shift());
      }
      if (!queue.length) waiting.delete(key);
    }
  }

  for (let index = 0; index < items.length; index += 1) {
    const key = keyFor(items[index], index);
    if (!waiting.has(key)) waiting.set(key, []);
    waiting.get(key).push({ item: items[index], index });
  }
  drain();
  await done;

  if (errors.length) throw errors[0];
  return results;
}