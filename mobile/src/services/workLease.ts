/** Shared ownership: one analysis finishing must not stop another's foreground
 * service. Serialize start/stop transitions, including failed acquisitions. */
export function createWorkLease(start: () => Promise<void>, stop: () => Promise<void>) {
  let owners = 0;
  let pending = 0;
  let transitions = Promise.resolve();
  const serial = (action: () => Promise<void>) => {
    const next = transitions.then(action);
    transitions = next.catch(() => undefined);
    return next;
  };
  return {
    active: () => owners > 0,
    // Installation must also wait for acquisitions still starting the service.
    busy: () => owners > 0 || pending > 0,
    async acquire() {
      pending++;
      try { await serial(async () => { if (owners === 0) await start(); owners++; }); }
      finally { pending--; }
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        await serial(async () => { owners--; if (owners === 0) await stop(); });
      };
    },
  };
}
