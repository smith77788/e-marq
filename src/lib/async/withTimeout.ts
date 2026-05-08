export function withTimeout<T>(
  promise: PromiseLike<T>,
  timeoutMs: number,
  message = "Операція триває занадто довго. Спробуйте ще раз.",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}