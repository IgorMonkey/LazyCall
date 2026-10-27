/** Every turn has an inactivity limit as well as a fixed upper bound. */
export function startTurnTimeout(expired: (reason: "idle" | "total") => void) {
  let closed = false;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let total: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { closed = true; if (idle) clearTimeout(idle); if (total) clearTimeout(total); };
  const expire = (reason: "idle" | "total") => { if (!closed) { clear(); expired(reason); } };
  const touch = () => {
    if (closed) return;
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => expire("idle"), 120_000);
  };
  total = setTimeout(() => expire("total"), 300_000);
  touch();
  return { touch, clear };
}
