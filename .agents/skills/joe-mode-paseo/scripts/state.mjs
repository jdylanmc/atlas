import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${label}`);
}

function validCoverage(coverage) {
  return Array.isArray(coverage) && coverage.length > 0 &&
    coverage.every(id => typeof id === 'string' && id.trim()) &&
    new Set(coverage).size === coverage.length;
}

function validateGraph(worker) {
  if (worker.assignment.graph === undefined) {
    if (worker.graph !== undefined || !isDeepStrictEqual(worker.assignment.coverage, worker.coverage)) {
      throw new Error('Invalid worker coverage');
    }
    return;
  }
  if (worker.assignment.graph !== true || worker.kind !== 'delivery' ||
    !validCoverage(worker.assignment.coverage) || typeof worker.graph?.complete !== 'boolean' ||
    !Array.isArray(worker.graph.receipts)) throw new Error('Invalid publication graph');
  let coverage = worker.assignment.coverage;
  let complete = false;
  for (const receipt of worker.graph.receipts) {
    requireText(receipt.evidence, 'publication evidence');
    if (!validCoverage(receipt.coverage) || typeof receipt.complete !== 'boolean' ||
      coverage.some(id => !receipt.coverage.includes(id)) ||
      (complete && (!receipt.complete || !isDeepStrictEqual(coverage, receipt.coverage)))) {
      throw new Error('Invalid publication receipt');
    }
    coverage = receipt.coverage;
    complete = receipt.complete;
  }
  if (!isDeepStrictEqual(coverage, worker.coverage) || complete !== worker.graph.complete ||
    (worker.agentId && !complete)) throw new Error('Invalid publication state');
}

function publicationPending(pm) {
  return pm.workers.some(worker => !worker.settled && worker.graph && !worker.graph.complete);
}

function validateConfig(input) {
  const config = { ...input, capacity: input?.capacity ?? 6 };
  for (const key of ['id', 'repository', 'commonDir', 'cwd', 'projectId', 'workspaceId',
    'humanOrigin', 'anchor', 'setupEvidence', 'authority', 'capabilities', 'mapping', 'retirement']) {
    requireText(config[key], key);
  }
  if (config.merge !== 'human') throw new Error('Automated merge unsupported');
  if (!Number.isSafeInteger(config.capacity) || config.capacity < 1) throw new Error('Invalid capacity');
  if (config.cron !== undefined && (typeof config.cron !== 'string' ||
    !/^(?:\*|\*\/(?:[1-9]|[1-5][0-9])) \* \* \* \*$/.test(config.cron))) {
    throw new Error('Invalid PM cadence');
  }
  if (config.wakeupMode !== undefined && !['fresh', 'heartbeat'].includes(config.wakeupMode)) {
    throw new Error('Invalid wakeup mode');
  }
  if (config.wakeupMode === 'heartbeat') {
    requireText(config.wakeupConsent, 'heartbeat consent');
    requireText(config.pmAgentId, 'bound PM agent ID');
  } else if (config.pmAgentId !== undefined) {
    throw new Error('Fresh wakeup cannot bind a heartbeat PM agent');
  }
  return config;
}

function validateJob(config, job) {
  requireText(job?.id, 'schedule ID');
  requireText(job.evidence, 'schedule readback');
  requireText(job.observation, 'initial observation');
  const heartbeat = config.wakeupMode === 'heartbeat';
  if (job.enabled !== true || job.cron !== (config.cron ?? '* * * * *') ||
    ['cwd', 'projectId', 'workspaceId'].some(key => job[key] !== config[key]) ||
    (heartbeat ? job.kind !== 'heartbeat' || job.targetAgentId !== config.pmAgentId :
      (job.kind !== undefined && job.kind !== 'schedule') || job.targetAgentId !== undefined)) {
    throw new Error('Unverified schedule binding');
  }
  if (heartbeat) requireText(job.settings, 'approved heartbeat settings');
}

function validateOwner(config, owner) {
  if (config.wakeupMode === 'heartbeat' && owner !== config.pmAgentId) {
    throw new Error('Claim owner must be the bound PM agent');
  }
}

function resume(pm, request) {
  const job = request.schedule;
  validateJob(pm.config, job);
  const heartbeat = pm.config.wakeupMode === 'heartbeat';
  const changed = pm.schedule && pm.schedule.id !== job.id;
  if (changed && !heartbeat) throw new Error('Different schedule; reconcile explicitly');
  if (heartbeat && pm.schedule && (changed || pm.mode !== 'enabled')) {
    if (pm.mode === 'enabled') throw new Error('Heartbeat replacement requires paused or stopped state');
    if (pm.lease) throw new Error('Heartbeat replacement requires released or fenced lease');
    const replacement = request.replacement;
    if (!changed || replacement?.oldId !== pm.schedule.id) throw new Error('Invalid heartbeat replacement');
    requireText(replacement.human, 'replacement human decision');
    requireText(replacement.absence, 'verified old heartbeat absence');
    requireText(replacement.reconciliation, 'replacement reconciliation');
    if (job.settings !== pm.schedule.settings) throw new Error('Changed heartbeat settings');
    pm.wakeupHistory ??= [];
    pm.wakeupHistory.push({ job: pm.schedule, replacement });
  } else if (request.replacement !== undefined) {
    throw new Error('Unexpected heartbeat replacement');
  }
  if (heartbeat && pm.schedule && job.settings !== pm.schedule.settings) throw new Error('Changed heartbeat settings');
  pm.schedule = job;
  pm.mode = 'enabled';
}

function validateState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Invalid board');
  if (!Object.hasOwn(state, 'pm')) return state;
  const pm = state.pm;
  if (pm?.version !== 1 || !['paused', 'enabled', 'stopped'].includes(pm.mode) ||
    !['workers', 'pending', 'runs'].every(key => Array.isArray(pm[key])) ||
    !isDeepStrictEqual(pm.config, validateConfig(pm.config))) throw new Error('Invalid PM state');
  if (pm.schedule !== undefined) validateJob(pm.config, pm.schedule);
  if (pm.wakeupHistory !== undefined && !Array.isArray(pm.wakeupHistory)) throw new Error('Invalid wakeup history');
  if (pm.mode === 'enabled' && !pm.schedule) throw new Error('Missing schedule binding');
  if (pm.lease !== null) {
    for (const key of ['owner', 'token', 'reconciliation']) requireText(pm.lease?.[key], `Invalid lease ${key}`);
    validateOwner(pm.config, pm.lease.owner);
  }
  const keys = new Set();
  const coverage = new Set();
  let discovery = 0;
  let deliveries = 0;
  for (const worker of pm.workers) {
    if (!worker || typeof worker.settled !== 'boolean' ||
      !['delivery', 'discovery', 'research'].includes(worker.kind) ||
      typeof worker.key !== 'string' || !worker.key.trim() || keys.has(worker.key) ||
      !validCoverage(worker.coverage) ||
      worker.assignment?.key !== worker.key || worker.assignment?.kind !== worker.kind ||
      !(worker.agentId === null || (typeof worker.agentId === 'string' && worker.agentId.trim()))) {
      throw new Error('Invalid worker state');
    }
    keys.add(worker.key);
    requireText(worker.assignment.packet, 'Invalid worker packet');
    validateGraph(worker);
    if (worker.settled) {
      for (const key of ['evidence', 'result', 'acceptance']) requireText(worker.return?.[key], `Invalid return ${key}`);
      continue;
    }
    if (worker.kind === 'discovery') discovery++;
    if (worker.kind === 'delivery') {
      deliveries++;
      for (const id of worker.coverage) {
        if (coverage.has(id)) throw new Error('Invalid overlapping coverage');
        coverage.add(id);
      }
    }
  }
  if (discovery > 1 || deliveries > pm.config.capacity) throw new Error('Invalid capacity state');
  return state;
}

function reserve(pm, worker) {
  requireText(worker?.key, 'worker key');
  requireText(worker.packet, 'worker packet');
  if (!['delivery', 'discovery', 'research'].includes(worker.kind)) throw new Error('Invalid worker kind');
  if (!validCoverage(worker.coverage)) throw new Error('Invalid coverage');
  if (worker.graph !== undefined && (worker.graph !== true || worker.kind !== 'delivery')) {
    throw new Error('Invalid publication group');
  }
  const existing = pm.workers.find(item => item.key === worker.key);
  if (existing) {
    if (!isDeepStrictEqual(existing.assignment, worker)) throw new Error('Different worker assignment');
    return 'reused';
  }
  const active = pm.workers.filter(item => !item.settled);
  if (worker.kind === 'discovery' && active.some(item => item.kind === 'discovery')) {
    throw new Error('Discovery conversation already reserved');
  }
  if (worker.kind === 'delivery') {
    if (publicationPending(pm)) throw new Error('Unresolved ticket publication; hold new delivery');
    if (active.some(item => item.kind === 'delivery' && item.coverage.some(id => worker.coverage.includes(id)))) {
      throw new Error('Overlapping delivery coverage');
    }
    if (active.filter(item => item.kind === 'delivery').length >= pm.config.capacity) {
      throw new Error('Delivery capacity exhausted');
    }
  }
  pm.workers.push({ key: worker.key, kind: worker.kind, coverage: worker.coverage,
    assignment: worker, settled: false, agentId: null,
    ...(worker.graph ? { graph: { complete: false, receipts: [] } } : {}) });
  return 'reserved';
}

function cover(pm, worker, request) {
  if (worker.settled || !worker.graph) throw new Error('Missing active publication group');
  if (!validCoverage(request.coverage) || typeof request.complete !== 'boolean' ||
    worker.coverage.some(id => !request.coverage.includes(id))) throw new Error('Invalid expanded coverage');
  if (worker.graph.complete && (!request.complete || !isDeepStrictEqual(worker.coverage, request.coverage))) {
    throw new Error('Completed publication coverage is immutable');
  }
  if (pm.workers.some(other => other !== worker && !other.settled && other.kind === 'delivery' &&
    other.coverage.some(id => request.coverage.includes(id)))) throw new Error('Overlapping delivery coverage');
  const receipt = { coverage: request.coverage, complete: request.complete, evidence: request.evidence };
  if (!isDeepStrictEqual(worker.graph.receipts.at(-1), receipt)) worker.graph.receipts.push(receipt);
  worker.coverage = request.coverage;
  worker.graph.complete = request.complete;
  return 'covered';
}

function updateWorker(pm, request) {
  const worker = pm.workers.find(item => item.key === request.key);
  if (!worker) throw new Error('Unknown worker');
  requireText(request.evidence, 'live evidence');
  if (request.op === 'cover') return cover(pm, worker, request);
  if (request.op === 'bind') {
    requireText(request.agentId, 'observed agent ID');
    if (worker.kind === 'delivery' && publicationPending(pm)) throw new Error('Unresolved ticket publication; hold delivery launch');
    if (worker.settled || (worker.agentId && worker.agentId !== request.agentId)) throw new Error('Worker already bound or settled');
    worker.agentId = request.agentId;
    worker.observation = request.evidence;
    return 'bound';
  }
  if (request.op === 'archive') {
    if (!worker.settled) throw new Error('Worker duties not settled');
    worker.archive = request.evidence;
    return 'archive-recorded';
  }
  if (request.noLiveWriters !== true || request.noUntransferredDuties !== true) throw new Error('Unreconciled live custody');
  if (worker.kind === 'discovery' && request.discoveryEnded !== true) throw new Error('Discovery alignment or explicit end required');
  requireText(request.result, 'preserved result');
  requireText(request.acceptance, 'receiver acceptance');
  if (worker.settled) throw new Error('Worker already settled');
  worker.settled = true;
  worker.return = { evidence: request.evidence, result: request.result, acceptance: request.acceptance };
  return 'settled';
}

function apply(state, request) {
  if (request.op === 'init') {
    const config = validateConfig(request.config);
    if (state.pm) {
      if (!isDeepStrictEqual(state.pm.config, config)) throw new Error('Existing activation is different');
      return 'existing';
    }
    state.pm = { version: 1, config, mode: 'paused', lease: null, workers: [], pending: [], runs: [] };
    return 'initialized';
  }
  if (request.op === 'inspect') return 'observed';
  const pm = state.pm;
  if (pm?.version !== 1) throw new Error('Missing or unsupported PM state');
  if (['pause', 'stop', 'resume', 'recover'].includes(request.op)) {
    requireText(request.human, 'human decision');
    if (request.op === 'resume') {
      resume(pm, request);
    } else if (request.op === 'recover') {
      requireText(request.fencing, 'stopped-owner fencing evidence');
      requireText(request.reconciliation, 'descendant and partial-work reconciliation');
      if (!pm.lease || pm.lease.token !== request.token) throw new Error('Stale recovery lease');
      pm.runs.push({ ...pm.lease, recovery: request });
      pm.lease = null;
    } else {
      requireText(request.disposition, 'active child disposition');
      pm.mode = request.op === 'pause' ? 'paused' : 'stopped';
    }
    pm.control = request;
    return pm.mode;
  }
  if (request.op === 'claim') {
    validateOwner(pm.config, request.owner);
    if (pm.mode !== 'enabled') return pm.mode;
    if (pm.lease) return 'busy';
    requireText(request.owner, 'run owner');
    requireText(request.reconciliation, 'live repository ownership reconciliation');
    pm.lease = { owner: request.owner, token: randomUUID(), reconciliation: request.reconciliation };
    return 'claimed';
  }
  if (!pm.lease || pm.lease.owner !== request.owner || pm.lease.token !== request.token) {
    throw new Error('Invalid run lease');
  }
  if (request.op === 'release') {
    requireText(request.result, 'preserved run result');
    requireText(request.duties, 'remaining duties');
    pm.runs.push({ ...pm.lease, result: request.result, duties: request.duties });
    pm.lease = null;
    return 'released';
  }
  if (request.op === 'reserve' || request.op === 'bind') {
    if (pm.mode !== 'enabled') throw new Error('PM is not enabled');
  }
  if (request.op === 'reserve') return reserve(pm, request.worker);
  if (['cover', 'bind', 'settle', 'archive'].includes(request.op)) return updateWorker(pm, request);
  if (request.op === 'record') {
    requireText(request.key, 'operation key');
    requireText(request.evidence, 'operation evidence');
    if (!['pending', 'accepted', 'blocked', 'observed'].includes(request.status)) throw new Error('Invalid record status');
    if (request.status === 'accepted') requireText(request.receiver, 'receiver observation');
    const previous = pm.pending.find(item => item.key === request.key);
    const record = { key: request.key, status: request.status, evidence: request.evidence };
    if (request.status === 'accepted') record.receiver = request.receiver;
    if (previous) {
      const { key, history = [], ...outcome } = previous;
      const { key: ignored, ...nextOutcome } = record;
      if (isDeepStrictEqual(outcome, nextOutcome)) return 'recorded';
      record.history = [...history, outcome];
      pm.pending[pm.pending.indexOf(previous)] = record;
    } else pm.pending.push(record);
    return 'recorded';
  }
  throw new Error('Unsupported operation');
}

export function transact(filename, request) {
  requireText(filename, 'board path');
  if (!request || typeof request !== 'object') throw new Error('Invalid request');
  if (existsSync(filename) && !lstatSync(filename).isFile()) throw new Error('Board must be a regular file');
  const read = () => validateState(existsSync(filename) ? JSON.parse(readFileSync(filename, 'utf8')) : {});
  if (request.op === 'inspect') return { status: 'observed', state: read() };
  const lock = `${filename}.write-lock`;
  // No age-based takeover: an abandoned transaction needs explicit, fenced repair.
  mkdirSync(lock, { mode: 0o700 });
  try {
    const state = read();
    const status = apply(state, request);
    const next = `${filename}.next`;
    const fd = openSync(next, 'wx', 0o600);
    try {
      writeFileSync(fd, `${JSON.stringify(state, null, 2)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(next, filename);
    return { status, state };
  } finally {
    rmdirSync(lock);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(transact(process.argv[2], JSON.parse(process.argv[3])))}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
