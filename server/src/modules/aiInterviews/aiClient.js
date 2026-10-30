const env = require('../../config/env');

// One thin wrapper around the Anthropic Messages API (plain fetch, no SDK). Tests swap the provider with setProvider().
const API_URL = 'https://api.anthropic.com/v1/messages';
const TIMEOUT_MS = 45000;

class AiUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

// PDFs (the candidate's CV) go in front of the first user message as document blocks.
function withDocuments(messages, documents) {
  if (!documents.length) return messages;
  const [first, ...rest] = messages;
  const blocks = documents.map((d) => ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: d.base64 } }));
  return [{ ...first, content: [...blocks, { type: 'text', text: first.content }] }, ...rest];
}

async function anthropicProvider({ system, messages, maxTokens, documents = [] }) {
  const { apiKey, model } = env.aiInterview;
  if (!apiKey) throw new AiUnavailableError('ANTHROPIC_API_KEY is not set');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: maxTokens || env.aiInterview.maxOutputTokens, system, messages: withDocuments(messages, documents) }),
    });
    if (!res.ok) throw new AiUnavailableError(`AI provider answered ${res.status}`);
    const body = await res.json();
    const text = (body.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    return { text, usage: { input: body.usage?.input_tokens || 0, output: body.usage?.output_tokens || 0 } };
  } catch (err) {
    if (err instanceof AiUnavailableError) throw err;
    throw new AiUnavailableError(err.name === 'AbortError' ? 'AI provider timed out' : `AI provider unreachable: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

let provider = anthropicProvider;
const setProvider = (fn) => { provider = fn || anthropicProvider; };

// Asks for JSON only and parses it; tolerates a ```json fence. Returns { data, usage }; throws AiUnavailableError when the
// reply is not usable JSON, so every caller has one failure path.
async function askJson({ system, user, maxTokens, documents }) {
  const { text, usage } = await provider({ system, messages: [{ role: 'user', content: user }], maxTokens, documents });
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new AiUnavailableError('AI reply was not JSON');
  try {
    return { data: JSON.parse(cleaned.slice(start, end + 1)), usage };
  } catch {
    throw new AiUnavailableError('AI reply was not valid JSON');
  }
}

module.exports = { askJson, setProvider, AiUnavailableError };
