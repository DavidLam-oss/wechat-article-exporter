import { USER_AGENT } from '~/config';

export default defineEventHandler(async event => {
  const query = getQuery(event);
  const url = query.url ? decodeURIComponent(query.url as string) : '';
  if (!url) {
    throw createError({
      statusCode: 400,
      statusMessage: 'URL is required',
    });
  }

  // 校验域名，防止 SSRF 滥用
  let hostname = '';
  try {
    hostname = new URL(url).hostname;
  } catch (e) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid URL format',
    });
  }

  const allowedDomains = ['mp.weixin.qq.com', 'api.weixin.qq.com'];

  const isAllowed = allowedDomains.some(domain => hostname === domain || hostname.endsWith('.' + domain));

  if (!isAllowed) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Domain not allowed',
    });
  }

  let headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Referer: 'https://mp.weixin.qq.com/',
  };

  const headersStr = query.headers as string;
  if (headersStr) {
    try {
      const parsedHeaders = JSON.parse(decodeURIComponent(headersStr));
      headers = { ...headers, ...parsedHeaders };
    } catch (e) {}
  }

  try {
    const res = await fetch(url, { headers });
    const buffer = await res.arrayBuffer();
    const contentType = res.headers.get('content-type') || 'text/html; charset=UTF-8';

    return new Response(buffer, {
      status: res.status,
      headers: {
        'Content-Type': contentType,
      },
    });
  } catch (err: any) {
    throw createError({
      statusCode: 500,
      statusMessage: err.message || 'Failed to fetch through local proxy',
    });
  }
});
