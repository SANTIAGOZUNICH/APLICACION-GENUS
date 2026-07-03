/** True in local Next.js development (not production build). */
export function isDevEnvironment(): boolean {
  return process.env.NODE_ENV === "development";
}
