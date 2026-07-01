// Deterministic port assignment. Each loop gets a "slot"; a repo's port is
// basePort + slot*portStride. Slot 0 is reserved for the root checkouts.

// Smallest positive slot not already used by an active loop.
function nextSlot(registry) {
  const taken = new Set(Object.values(registry.loops || {}).map((l) => l.slot));
  let s = 1;
  while (taken.has(s)) s += 1;
  return s;
}

// Ports for EVERY repo in the config at a given slot (so cross-repo env
// templates always resolve, even if a repo's worktree wasn't created).
function portsForSlot(cfg, slot) {
  const out = {};
  for (const r of cfg.repos) out[r.name] = r.basePort + slot * cfg.portStride;
  return out;
}

module.exports = { nextSlot, portsForSlot };
