/**
 * Next.js instrumentation file - runs once when the server starts
 * This is where we initialize environment variables from SSM
 */
import { initializeServerEnvironment } from "./src/lib/init-env";

export async function register() {
  if (process.env.NODE_ENV === "production") {
    await initializeServerEnvironment();
  }
}
