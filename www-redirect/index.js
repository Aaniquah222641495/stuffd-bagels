// www.stuffdbagels.co.za -> https://stuffdbagels.co.za (301, same path and query). Founder 2026-11-25.
export default {
  fetch(request) {
    const url = new URL(request.url);
    return new Response(null, {
      status: 301,
      headers: {
        Location: `https://stuffdbagels.co.za${url.pathname}${url.search}`,
        "Cache-Control": "public, max-age=86400",
        "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
      },
    });
  },
};
