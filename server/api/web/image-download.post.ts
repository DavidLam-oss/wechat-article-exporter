import { USER_AGENT } from '~/config';

export default defineEventHandler(async event => {
  // 获取请求参数
  const body = await readBody<{ url: string }>(event).catch(() => null);
  if (!body || !body.url) {
    throw createError({
      statusCode: 400,
      statusMessage: 'URL is required',
    });
  }

  const url = body.url.trim();

  // 严格域名校验，防 SSRF 滥用做代理跳板
  let hostname = '';
  try {
    hostname = new URL(url).hostname;
  } catch (e) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid URL format',
    });
  }

  const allowedDomains = [
    'qpic.cn',
    'q.cn',
    'wx.qq.com',
    'weixinbridge.com',
    'qq.com'
  ];

  const isAllowed = allowedDomains.some(domain => 
    hostname === domain || hostname.endsWith('.' + domain)
  );

  if (!isAllowed) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Domain not allowed',
    });
  }

  // 同源保护，防恶意盗用
  const headers = getHeaders(event);
  const referer = headers['referer'];
  const host = headers['host']; // 本站域名

  if (referer) {
    try {
      const refUrl = new URL(referer);
      const isLocalHost = refUrl.hostname === 'localhost' || refUrl.hostname === '127.0.0.1';
      if (host && refUrl.host !== host && !isLocalHost) {
        throw createError({
          statusCode: 403,
          statusMessage: 'Unauthorized request origin',
        });
      }
    } catch (e) {
      // 异常 Referer 直接拦截
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid referer header',
      });
    }
  }

  // 抓取微信图片
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Referer: 'https://mp.weixin.qq.com/',
      },
    });

    if (!res.ok) {
      throw createError({
        statusCode: res.status,
        statusMessage: `Failed to fetch image from CDN: ${res.statusText}`,
      });
    }

    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const buffer = await res.arrayBuffer();

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000', // 静态图片设置长缓存
      },
    });
  } catch (err: any) {
    throw createError({
      statusCode: 500,
      statusMessage: err.message || 'Internal server error during fetch',
    });
  }
});
