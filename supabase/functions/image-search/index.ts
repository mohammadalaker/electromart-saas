import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { query } = await req.json();

    if (!query || typeof query !== 'string' || !query.trim()) {
      return new Response(JSON.stringify({ error: 'query is required' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const apiKey = Deno.env.get('SCALESERP_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'SCALESERP_KEY secret not set' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const url = new URL('https://api.scaleserp.com/search');
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('search_type', 'images');
    url.searchParams.set('q', query.trim());

    const serpRes = await fetch(url.toString());
    if (!serpRes.ok) {
      const errText = await serpRes.text();
      return new Response(JSON.stringify({ error: 'ScaleSerp error', detail: errText }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const serpData = await serpRes.json();
    const imageResults: Array<{ src: string; thumb: string }> = (serpData.image_results ?? [])
      .slice(0, 5)
      .map((it: { image?: { src?: string } }) => {
        const src = String(it.image?.src ?? '').trim();
        return { src, thumb: src };
      })
      .filter((r: { src: string }) => /^https?:\/\//i.test(r.src));

    return new Response(JSON.stringify({ images: imageResults }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
