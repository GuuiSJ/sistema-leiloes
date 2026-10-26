import "./env";

export function frontendOrigin(): string {
  return process.env.FRONTEND_URL ?? "http://localhost:5173";
}
