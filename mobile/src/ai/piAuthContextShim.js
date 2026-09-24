/** Mobile replacement for Pi's Node env/file credential discovery. */
export function defaultProviderAuthContext() {
  return {
    async env() {
      return undefined;
    },
    async fileExists() {
      return false;
    },
  };
}
