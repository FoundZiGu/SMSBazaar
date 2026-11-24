const PUBLIC_HOST = "sms.fur.li";

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    if (incoming.hostname !== PUBLIC_HOST) {
      return new Response("Forbidden", {
        status: 403,
        headers: { "Cache-Control": "no-store" },
      });
    }

    const originHost = String(env.ORIGIN_HOST || "").trim();
    if (!/^[a-z0-9.-]+$/i.test(originHost) || originHost === PUBLIC_HOST) {
      return new Response("Configure ORIGIN_HOST with your DNS-only origin hostname", {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }

    const cacheStatic = ["GET", "HEAD"].includes(request.method)
      && /^\/(?:assets|fonts)\//.test(incoming.pathname)
      && !request.headers.has("Authorization")
      && !request.headers.has("Cookie");
    const upstream = new URL(incoming);
    upstream.hostname = originHost;
    upstream.protocol = "https:";
    upstream.port = "";
    const forwarded = new Request(upstream, request);
    forwarded.headers.set("X-Forwarded-Host", PUBLIC_HOST);
    forwarded.headers.set("X-Forwarded-Proto", "https");

    const options = {
      redirect: "manual",
      cf: {
        cacheEverything: cacheStatic,
        cacheTtlByStatus: cacheStatic
          ? { "200-299": 86400, "300-599": -1 }
          : { "100-599": -1 },
      },
    };
    if (!cacheStatic) options.cache = "no-store";
    const upstreamResponse = await fetch(forwarded, options);
    const response = new Response(upstreamResponse.body, upstreamResponse);
    const responseCacheable = cacheStatic && upstreamResponse.status >= 200 && upstreamResponse.status < 300;
    if (!responseCacheable) {
      response.headers.set("Cache-Control", "no-store, max-age=0");
      response.headers.set("CDN-Cache-Control", "no-store");
      response.headers.set("Cloudflare-CDN-Cache-Control", "no-store");
    }
    response.headers.set("X-SMSBazaar-Proxy-Version", "20261022");
    response.headers.set("X-SMSBazaar-Cache-Policy", responseCacheable ? "static-24h" : "bypass");
    return response;
  },
};
