export function report(expected: Record<string, number>, got: Record<string, number>): never {
  let ok = true;
  for (const [key, want] of Object.entries(expected)) {
    const have = got[key];
    console.log(`${key}=${have}`);
    if (have !== want) ok = false;
  }
  process.exit(ok ? 0 : 1);
}
