import { handleVercelRequest } from "../_lib/vercel-handler.js";

export function GET(request) {
  return handleVercelRequest(request);
}
