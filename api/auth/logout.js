import { handleVercelRequest } from "../_lib/vercel-handler.js";

export function POST(request) {
  return handleVercelRequest(request);
}
