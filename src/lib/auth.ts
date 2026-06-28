/**
 * Read and clear the post-auth redirect destination from sessionStorage.
 *
 * Falls back to "/dashboard" when no valid destination is stored or storage
 * is unavailable.
 */
export function readAndClearDest(): string {
  try {
    const dest = window.sessionStorage.getItem("marq.postAuthDest");
    if (dest) {
      window.sessionStorage.removeItem("marq.postAuthDest");
      if (dest.startsWith("/") && !dest.startsWith("//")) return dest;
    }
  } catch {
    /* storage may be blocked */
  }
  return "/dashboard";
}
