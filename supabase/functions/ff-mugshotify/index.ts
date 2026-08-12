const OPENAI_IMAGE_EDIT_URL = 'https://api.openai.com/v1/images/edits';
const DEFAULT_IMAGE_MODEL = 'gpt-image-1.5';
const DEFAULT_IMAGE_QUALITY = 'medium';
const MAX_IMAGE_DATA_URL_LENGTH = 20 * 1024 * 1024;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin'
};

const prompt = `
Transform this uploaded face photo into a square fantasy-football police lineup
mugshot avatar. Keep the person's recognizable facial structure, expression,
hair, facial hair, eyewear, and general pose. Render it as clean, bold,
high-quality cartoon pixel art with crisp black ink outlines, limited but rich
colors, simple cel shading, and a plain muted blue-gray mugshot background.
Frame the head and shoulders like a booking photo. No text, logos, badges,
numbers, watermarks, weapons, gore, or extra people.
`.trim();

function jsonResponse(body: Record<string, unknown>, status = 200){
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    }
  });
}

function isSupportedImageDataUrl(value: unknown){
  if(typeof value !== 'string') return false;
  if(value.length < 40 || value.length > MAX_IMAGE_DATA_URL_LENGTH) return false;
  return /^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i.test(value);
}

function hasExpectedClientKey(request: Request){
  const expectedKey = Deno.env.get('FF_MUGSHOT_CLIENT_KEY');
  if(!expectedKey) return true;

  const apikey = request.headers.get('apikey') || '';
  const authorization = request.headers.get('authorization') || '';
  return apikey === expectedKey || authorization === `Bearer ${expectedKey}`;
}

function safeOpenAIError(text: string){
  try {
    const parsed = JSON.parse(text);
    const message = parsed?.error?.message || parsed?.message;
    return typeof message === 'string' ? message : 'OpenAI image edit failed.';
  } catch {
    return text.slice(0, 240) || 'OpenAI image edit failed.';
  }
}

Deno.serve(async (request) => {
  if(request.method === 'OPTIONS'){
    return new Response('ok', { headers: corsHeaders });
  }

  if(request.method !== 'POST'){
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  if(!hasExpectedClientKey(request)){
    return jsonResponse({ error: 'Unauthorized.' }, 401);
  }

  const openAIKey = Deno.env.get('OPENAI_API_KEY');
  if(!openAIKey){
    return jsonResponse({ error: 'OPENAI_API_KEY is not configured.' }, 500);
  }

  let body: { imageDataUrl?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Expected JSON body.' }, 400);
  }

  if(!isSupportedImageDataUrl(body.imageDataUrl)){
    return jsonResponse({ error: 'Expected a PNG, JPEG, or WebP data URL under 20 MB.' }, 400);
  }

  const imageModel = Deno.env.get('OPENAI_IMAGE_MODEL') || DEFAULT_IMAGE_MODEL;
  const imageQuality = Deno.env.get('OPENAI_IMAGE_QUALITY') || DEFAULT_IMAGE_QUALITY;

  const openAIResponse = await fetch(OPENAI_IMAGE_EDIT_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openAIKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: imageModel,
      images: [{ image_url: body.imageDataUrl }],
      prompt,
      size: '1024x1024',
      quality: imageQuality,
      output_format: 'png',
      background: 'opaque',
      input_fidelity: 'high',
      moderation: 'auto',
      n: 1
    })
  });

  const responseText = await openAIResponse.text();
  if(!openAIResponse.ok){
    return jsonResponse({
      error: safeOpenAIError(responseText)
    }, 502);
  }

  let parsed: {
    data?: Array<{ b64_json?: string; revised_prompt?: string }>;
    output_format?: string;
  };

  try {
    parsed = JSON.parse(responseText);
  } catch {
    return jsonResponse({ error: 'OpenAI returned invalid JSON.' }, 502);
  }

  const b64 = parsed.data?.[0]?.b64_json;
  if(!b64){
    return jsonResponse({ error: 'OpenAI returned no image data.' }, 502);
  }

  return jsonResponse({
    dataUrl: `data:image/png;base64,${b64}`,
    revisedPrompt: parsed.data?.[0]?.revised_prompt || null
  });
});
