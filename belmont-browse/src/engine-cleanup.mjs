/** Close every acquired resource once, even when an earlier cleanup fails. */
export function createEngineCleanup() {
  const resources = [];
  let promise;
  return {
    add(name, close) {
      if (promise) throw new Error(`Cannot acquire ${name} after shutdown`);
      resources.push({ name, close });
    },
    close() {
      return promise ??= Promise.resolve().then(async () => {
        const errors = [];
        for (const resource of resources.toReversed()) {
          try { await resource.close(); }
          catch (cause) { errors.push(new Error(`${resource.name}: ${cause?.message ?? String(cause)}`, { cause })); }
        }
        if (errors.length) throw new AggregateError(errors, "Aside resource cleanup failed");
      });
    },
  };
}
