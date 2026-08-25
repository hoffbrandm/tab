import { createApp } from "./app.js";

const handle = createApp({ env: process.env });

export async function handleVercelRequest(request) {
  return handle(request);
}
