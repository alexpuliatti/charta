import { aiEndpoint, requestCanvasAI } from '../shared/canvas-ai.mjs';

export function canvasAIConfig(env = process.env) {
  const key = env.CHARTA_AI_API_KEY || env.SUMMARY_API_KEY;
  const endpoint = env.CHARTA_AI_ENDPOINT || env.SUMMARY_ENDPOINT;
  const model = env.CHARTA_AI_MODEL || env.SUMMARY_MODEL;
  if (!key || !endpoint || !model) return null;
  try { return { key, endpoint: aiEndpoint(endpoint), model }; } catch { return null; }
}
export async function expandCanvasNote(input, options = {}) {
  const config = canvasAIConfig(options.env);
  if (!config) throw new Error('Connect an AI provider in Canvas, or configure CHARTA_AI_API_KEY, CHARTA_AI_ENDPOINT, and CHARTA_AI_MODEL on the local server.');
  return requestCanvasAI(input, { ...config, signal: AbortSignal.timeout(60000), fetchImpl: options.fetchImpl });
}
