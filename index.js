/**
 * Host half of `dsh-reasoning-effort`.
 *
 * Why this exists: a hand-declared pi-ai model reaches the harness with no
 * reasoning metadata until its route declares `reasoningEfforts`, and only then
 * does the composer's model picker offer a thinking-strength switch the way the
 * native DeepSeek provider does. This plugin removes the manual step for every
 * third-party route: it sniffs each undeclared chat model and writes the level
 * set the endpoint actually accepts into the `llm-pi-ai` settings namespace.
 *
 * Each route also gets two switches, stored in this plugin's own config (so they
 * survive restarts and stay editable from the sidebar panel):
 *   - `reasoning` — declare levels at all. Off removes the declarations, which is
 *     how a provider disappears from the composer's strength menu.
 *   - `sniff` — how levels are decided. On: probe the endpoint (two tiny
 *     requests). Off: declare the full level set without touching the network.
 *
 * What "sniff" means, precisely:
 *   1. A `reasoning_effort: "low"` probe. Rejected as an unknown parameter means
 *      the model is not reasoning-capable → declare `reasoningEfforts: false`
 *      (the same posture as leaving it undeclared, but remembered).
 *   2. A `reasoning_effort: "max"` probe. Accepted → declare the full seven
 *      levels; rejected → declare the common five (off…high).
 *   3. Auth, rate-limit, network and unknown-model failures write nothing and are
 *      retried on the next interval.
 *
 * Every write goes through the settings service, so it is revision-guarded and
 * validated by the adapter's own schema before it reaches the profile patch.
 */
import z from '@deepseek-ai/schemastery';

/** Levels pi-ai accepts as `reasoningEfforts` keys, in escalation order. */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/** Full declaration, with `off` mapped to the explicit disable spelling. */
export const FULL_EFFORTS = {
  off: 'none',
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
};

/** Fallback declaration for endpoints that reason but reject the `max` spelling. */
export const COMMON_EFFORTS = { off: 'none', minimal: 'minimal', low: 'low', medium: 'medium', high: 'high' };

/** Settings namespace prefix owned by the pi-ai adapter. */
export const SETTINGS_NS_PREFIX = 'llm-pi-ai';

/** How long after mount the first pass runs. */
export const START_DELAY_MS = 5_000;
/** How often pending work is looked at again. */
export const INTERVAL_MS = 60_000;
/** Spacing between probes: this seam must not push a gateway into its rate limit. */
export const PROBE_GAP_MS = 1_500;
/** Per-request probe timeout. */
export const PROBE_TIMEOUT_MS = 8_000;
/** Upper bound of probe requests one pass may issue. */
export const MAX_PROBES_PER_RUN = 20;
/** Chat-request shapes this sniffer knows how to speak. */
export const SUPPORTED_APIS = new Set(['openai-completions']);

/** Models that are evidently not chat models: probing them proves nothing. */
export const NON_CHAT_ID = /(?:^|[^a-z])(ocr|embed|embedding|rerank|tts|whisper|transcribe)(?:[^a-z]|$)/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Per-route switches. A route absent from the dict uses the defaults: declare
 * levels (`reasoning: true`) and decide them by probing (`sniff: true`).
 */
export const Config = z.object({
  providers: z.dict(z.object({
    reasoning: z.boolean().default(true),
    sniff: z.boolean().default(true),
  })).default({}).volatile(),
});

/**
 * The effective switches for one route.
 * @param config - plugin config object (`{ providers: { … } }`) or undefined.
 * @param providerId - pi-ai route key.
 * @returns `{ reasoning, sniff }` with defaults applied.
 */
export function switchesFor(config, providerId) {
  const entry = config?.providers?.[providerId];
  return {
    reasoning: typeof entry?.reasoning === 'boolean' ? entry.reasoning : true,
    sniff: typeof entry?.sniff === 'boolean' ? entry.sniff : true,
  };
}

/**
 * Candidate chat-completions URLs for one route. pi-ai hands its base URL to the
 * OpenAI SDK, and deployments disagree about whether the SDK's `/v1` segment is
 * already part of the stored base URL, so both spellings are tried.
 * @param baseURL - configured route endpoint.
 * @returns absolute candidate URLs, most specific first.
 */
export function probeUrls(baseURL) {
  const trimmed = String(baseURL).trim().replace(/\/+$/, '');
  const urls = [trimmed + '/chat/completions'];
  if (!/\/v\d+$/.test(trimmed)) urls.push(trimmed + '/v1/chat/completions');
  return urls;
}

/**
 * Classify a probe response without guessing beyond its evidence.
 * @param status - HTTP status.
 * @param body - response text, read only for the rejection reason.
 * @returns `supported`, `unsupported`, `missing-model` (try another URL spelling)
 *   or `transient` (never a declaration).
 */
export function classifyProbe(status, body) {
  if (status === 200) return 'supported';
  if (status === 404) return 'missing-model';
  if (status === 400 || status === 422) {
    const text = String(body ?? '');
    // A wrong model id looks like a rejection too; never turn it into a declaration.
    if (/model[^.\n]{0,60}(?:not found|does not exist|not exist|unknown)|invalid model|no such model/i.test(text)) {
      return 'transient';
    }
    if (/(?:reasoning_effort|reasoning effort|reasoning\.|thinking)[^.\n]{0,80}(?:unsupported|not supported|unrecognized|unknown|invalid)/i.test(text)) {
      return 'unsupported';
    }
    if (/unsupported parameter|unrecognized request argument|extra fields not permitted|unknown (?:parameter|field)/i.test(text)) {
      return 'unsupported';
    }
    return 'transient';
  }
  return 'transient';
}

/**
 * One chat request asking a single model to think at a named level.
 * @param options - endpoint, credential, model id and probe controls.
 * @returns the classification, or `transient` when every URL spelling failed.
 */
export async function probeEffort(options) {
  const { baseURL, apiKey, modelId, effort, fetchImpl = globalThis.fetch, timeoutMs = PROBE_TIMEOUT_MS } = options;
  for (const url of probeUrls(baseURL)) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 32,
          stream: false,
          reasoning_effort: effort,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return 'transient';
    }
    let body = '';
    try {
      body = await response.text();
    } catch {
      body = '';
    }
    const verdict = classifyProbe(response.status, body);
    if (verdict === 'missing-model') continue; // wrong URL spelling, not a verdict
    return verdict;
  }
  return 'transient';
}

/**
 * The sniffer's view of every configured pi-ai route: which routes are declared
 * by hand, which their switches are, and which models still need a decision.
 * @param descriptors - snapshot from `settings.describe()`.
 * @param config - this plugin's config (route switches).
 * @returns `{ ns, routes }`, where each route carries its models by index.
 */
export function collectRoutes(descriptors, config) {
  for (const descriptor of descriptors ?? []) {
    if (typeof descriptor?.ns !== 'string' || !descriptor.ns.startsWith(SETTINGS_NS_PREFIX)) continue;
    const providers = descriptor.value?.providers;
    if (providers === null || typeof providers !== 'object') continue;
    const routes = Object.entries(providers)
      .filter(([, profile]) => profile !== null && typeof profile === 'object')
      .map(([providerId, profile]) => ({
        providerId,
        ns: descriptor.ns,
        revision: descriptor.revision,
        baseURL: typeof profile.baseURL === 'string' ? profile.baseURL : undefined,
        api: typeof profile.api === 'string' ? profile.api : 'openai-completions',
        apiKeyEnv: typeof profile.apiKeyEnv === 'string' ? profile.apiKeyEnv : undefined,
        compat: profile.compat !== null && typeof profile.compat === 'object' ? profile.compat : undefined,
        declaredByHand: !Array.isArray(profile.models),
        models: Array.isArray(profile.models)
          ? profile.models.map((model, index) => ({ model, index })).filter(({ model }) => model !== null && typeof model === 'object')
          : [],
        switches: switchesFor(config, providerId),
      }));
    return { ns: descriptor.ns, routes };
  }
  return { ns: undefined, routes: [] };
}

/**
 * The undeclared chat models a pass should decide, in configuration order.
 * @param routes - output of {@link collectRoutes}.
 * @returns probe targets carrying the namespace/index facts needed to write back.
 */
export function collectTargets(routes) {
  const targets = [];
  for (const route of routes ?? []) {
    if (route.declaredByHand) continue; // catalog route: capability ships with the catalog
    if (route.baseURL === undefined) continue; // nowhere to probe
    if (!SUPPORTED_APIS.has(route.api)) continue;
    if (!route.switches.reasoning) continue; // the route explicitly has no levels
    for (const { model, index } of route.models) {
      if (typeof model.id !== 'string' || model.id.length === 0) continue;
      if (model.reasoningEfforts !== undefined) continue; // already declared (or sniffed before)
      if (NON_CHAT_ID.test(model.id)) continue;
      targets.push({
        ns: route.ns,
        providerId: route.providerId,
        modelId: model.id,
        index,
        baseURL: route.baseURL,
        apiKeyEnv: route.apiKeyEnv,
        sniff: route.switches.sniff,
      });
    }
  }
  return targets;
}

/**
 * Models whose declarations must be withdrawn because their route was switched
 * off. A `false` declaration is left alone: it is the record of a finished probe,
 * not a strength control.
 * @param routes - output of {@link collectRoutes}.
 * @returns targets to clear.
 */
export function collectWithdrawals(routes) {
  const targets = [];
  for (const route of routes ?? []) {
    if (route.declaredByHand || route.switches.reasoning) continue;
    for (const { model, index } of route.models) {
      if (model.reasoningEfforts === undefined || model.reasoningEfforts === false) continue;
      targets.push({ ns: route.ns, providerId: route.providerId, modelId: model.id, index });
    }
  }
  return targets;
}

/**
 * Routes whose levels exist but whose wire switch is still missing. A declared
 * level set only reaches the endpoint when the route (or model) sets
 * `compat.supportsReasoningEffort`; a provider added by hand often forgets it, and
 * then the picker offers strengths that do nothing. Routes the user switched off
 * are left alone.
 * @param routes - output of {@link collectRoutes}.
 * @returns route targets that need the compat flag.
 */
export function collectCompatGaps(routes) {
  const targets = [];
  for (const route of routes ?? []) {
    if (route.declaredByHand) continue;
    if (!SUPPORTED_APIS.has(route.api)) continue;
    if (!route.switches.reasoning) continue;
    if (route.compat?.supportsReasoningEffort === true) continue;
    const declared = route.models.some(({ model }) => model.reasoningEfforts !== undefined && model.reasoningEfforts !== false);
    if (!declared) continue;
    targets.push({ ns: route.ns, providerId: route.providerId, compat: route.compat ?? {} });
  }
  return targets;
}

/**
 * Ensure one route sends the level it was given: merge
 * `compat.supportsReasoningEffort: true` into the route's compat block, keeping
 * every other compat field the user set. Revision-fenced like every other write.
 * @param ctx - host plugin context.
 * @param target - output of {@link collectCompatGaps}.
 * @returns whether the Host accepted the write.
 */
export async function ensureRouteCompat(ctx, target) {
  let descriptor;
  try {
    descriptor = ctx.settings.describe().find((row) => row.ns === target.ns);
  } catch (error) {
    ctx.logger?.warn('reasoning-effort: cannot read settings before a compat write');
    ctx.logger?.warn(error);
    return false;
  }
  const profile = descriptor?.value?.providers?.[target.providerId];
  if (descriptor === undefined || profile === null || typeof profile !== 'object') return false;
  if (profile.compat?.supportsReasoningEffort === true) return false; // someone else already fixed it
  const next = { ...(profile.compat !== null && typeof profile.compat === 'object' ? profile.compat : {}), supportsReasoningEffort: true };
  try {
    await ctx.settings.mutate(target.ns, [{
      op: 'set',
      path: ['providers', target.providerId, 'compat'],
      value: next,
    }], descriptor.revision);
    ctx.logger?.info(`reasoning-effort: ${target.providerId} -> compat.supportsReasoningEffort enabled`);
    return true;
  } catch (error) {
    ctx.logger?.warn(`reasoning-effort: could not enable reasoning_effort on ${target.providerId} (${error?.message ?? error})`);
    return false;
  }
}

/**
 * Resolve the credential one route names, preferring the harness credential seam
 * and falling back to the process environment exactly as the adapter does.
 * @param ctx - host plugin context.
 * @param apiKeyEnv - credential reference from the route profile.
 * @returns the secret, or undefined when the route has none configured.
 */
export async function resolveApiKey(ctx, apiKeyEnv) {
  if (apiKeyEnv === undefined) return undefined;
  try {
    const hit = await ctx.get?.('credentials')?.resolve(apiKeyEnv);
    if (hit !== undefined && hit !== null && typeof hit.value === 'string' && hit.value.length > 0) return hit.value;
  } catch {
    // fall through to the environment
  }
  const fromEnv = typeof process === 'object' && process.env !== undefined ? process.env[apiKeyEnv] : undefined;
  return typeof fromEnv === 'string' && fromEnv.length > 0 ? fromEnv : undefined;
}

/** @returns the model entry a target names in one settings snapshot, when it is still there. */
export function modelAt(value, target) {
  const models = value?.providers?.[target.providerId]?.models;
  if (!Array.isArray(models)) return undefined;
  const model = models[target.index];
  if (model === null || typeof model !== 'object') return undefined;
  if (model.id !== target.modelId) return undefined; // the array moved under us
  return model;
}

/**
 * Write one model's `reasoningEfforts` (or remove it), taking the revision fence
 * from a fresh snapshot so a user editing settings mid-scan is a conflict this
 * pass retries, never a lost edit.
 * @param ctx - host plugin context.
 * @param target - probe or withdrawal target.
 * @param value - declaration to set; `null` removes the field.
 * @param options - `expected` pre-condition: `absent` (only fill a missing field)
 *   or `declared` (only clear an existing declaration).
 * @returns whether the Host accepted the write.
 */
export async function writeEfforts(ctx, target, value, options = {}) {
  let descriptor;
  try {
    descriptor = ctx.settings.describe().find((row) => row.ns === target.ns);
  } catch (error) {
    ctx.logger?.warn('reasoning-effort: cannot read settings before a write');
    ctx.logger?.warn(error);
    return false;
  }
  if (descriptor === undefined) return false;
  const model = modelAt(descriptor.value, target);
  if (model === undefined) return false;
  const current = model.reasoningEfforts;
  if (options.expected === 'absent' && current !== undefined) return false; // decided by someone else
  if (options.expected === 'declared' && (current === undefined || current === false)) return false;
  try {
    await ctx.settings.mutate(target.ns, [value === null
      ? { op: 'unset', path: ['providers', target.providerId, 'models', target.index, 'reasoningEfforts'] }
      : { op: 'set', path: ['providers', target.providerId, 'models', target.index, 'reasoningEfforts'], value }],
    descriptor.revision);
    return true;
  } catch (error) {
    ctx.logger?.warn(`reasoning-effort: could not update ${target.providerId}/${target.modelId} (${error?.message ?? error})`);
    return false;
  }
}

/**
 * Decide one model's declaration.
 *
 * Sniffing routes probe the endpoint; a route with sniffing switched off is
 * declared from the full level set without any network request, which is what
 * "I know this gateway, stop testing it" means in the panel.
 * @param ctx - host context for credentials.
 * @param target - collected target.
 * @param options - fetch, spacing and timeout controls.
 * @returns `{ value }` to write, `{ value: false }` for non-reasoning, or
 *   `undefined` to retry later.
 */
export async function decideTarget(ctx, target, options = {}) {
  const { fetchImpl = globalThis.fetch, timeoutMs = PROBE_TIMEOUT_MS, gapMs = PROBE_GAP_MS } = options;
  const apiKey = target.sniff ? await resolveApiKey(ctx, target.apiKeyEnv) : undefined;
  if (!target.sniff) return { value: FULL_EFFORTS };
  if (apiKey === undefined) return undefined;
  const low = await probeEffort({ ...target, apiKey, effort: 'low', fetchImpl, timeoutMs });
  if (low === 'unsupported') return { value: false };
  if (low !== 'supported') return undefined;
  if (gapMs > 0) await sleep(gapMs);
  const max = await probeEffort({ ...target, apiKey, effort: 'max', fetchImpl, timeoutMs });
  if (max === 'supported') return { value: FULL_EFFORTS };
  // The endpoint reasons but rejects the top spelling: offer the common set.
  return { value: COMMON_EFFORTS };
}

/**
 * One pass: fix routes whose levels would not reach the wire, withdraw
 * declarations for switched-off routes, then decide the remaining undeclared
 * models within the probe budget.
 * @param ctx - host context (settings, credentials, logger).
 * @param config - this plugin's config, read fresh each pass.
 * @param options - injected fetch/timing and per-run budget.
 * @returns `{ declared, withdrawn, compat }`.
 */
export async function sniffOnce(ctx, config, options = {}) {
  let descriptors;
  try {
    descriptors = ctx.settings.describe();
  } catch (error) {
    ctx.logger?.warn('reasoning-effort: settings are not readable yet');
    ctx.logger?.warn(error);
    return { declared: 0, withdrawn: 0, compat: 0 };
  }
  const { routes } = collectRoutes(descriptors, config);
  let compat = 0;
  for (const target of collectCompatGaps(routes)) {
    if (await ensureRouteCompat(ctx, target)) compat += 1;
  }

  let withdrawn = 0;
  for (const target of collectWithdrawals(routes)) {
    if (await writeEfforts(ctx, target, null, { expected: 'declared' })) {
      withdrawn += 1;
      ctx.logger?.info(`reasoning-effort: ${target.providerId}/${target.modelId} -> strength switch off`);
    }
  }

  const targets = collectTargets(routes);
  if (targets.length === 0) return { declared: 0, withdrawn, compat };
  const { maxProbes = MAX_PROBES_PER_RUN, gapMs = PROBE_GAP_MS } = options;
  let probes = 0;
  let declared = 0;
  for (const target of targets) {
    if (target.sniff) {
      if (probes + 2 > maxProbes) {
        ctx.logger?.info(`reasoning-effort: probe budget reached; ${targets.length - declared} model(s) continue next pass`);
        break;
      }
      probes += 2;
    }
    const decision = await decideTarget(ctx, target, { ...options, gapMs });
    if (decision === undefined) continue;
    if (!await writeEfforts(ctx, target, decision.value, { expected: 'absent' })) continue;
    declared += 1;
    ctx.logger?.info(`reasoning-effort: ${target.providerId}/${target.modelId} -> ${decision.value === false ? 'not reasoning' : 'levels declared'}`);
  }
  return { declared, withdrawn, compat };
}

/** Host plugin: schedule the passes and keep them alive for the plugin's lifetime. */
export function apply(ctx, config) {
  let running = false;
  let stopped = false;

  /**
   * The switch dict. `providers` is a volatile config field, so the live value is
   * behind a reference whose `.get()` the loader refreshes on every write; a
   * plain object is accepted too so tests and direct calls stay simple.
   * @returns `{ providers: Record<string, { reasoning, sniff }> }`
   */
  const readSwitches = () => {
    const raw = config?.providers;
    const providers = raw !== null && typeof raw === 'object' && typeof raw.get === 'function' ? raw.get() : raw;
    return { providers: providers !== null && typeof providers === 'object' ? providers : {} };
  };

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await sniffOnce(ctx, readSwitches(), {});
    } catch (error) {
      ctx.logger?.warn('reasoning-effort: pass failed');
      ctx.logger?.warn(error);
    } finally {
      running = false;
    }
  };

  // A panel toggle must not wait for the next minute: re-run as soon as the
  // volatile config reference changes.
  ctx.on?.('loader/volatile-update', () => { void tick(); });

  ctx.effect(() => {
    const initial = setTimeout(() => { void tick(); }, START_DELAY_MS);
    const timer = setInterval(() => { void tick(); }, INTERVAL_MS);
    return () => {
      stopped = true;
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, 'reasoning-effort: schedule');
}
