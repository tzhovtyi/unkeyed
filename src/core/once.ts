/** Caches a resolved value, but never a rejection, so one failure isn't permanent. */
export function once<T>(produce: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    pending ??= produce().catch((error: unknown) => {
      pending = null;
      throw error;
    });
    return pending;
  };
}
