# 服务端图片下载方案

## 背景

最近几轮修复让图片分享（item_show_type=8）文章能在解析 `cgiDataNew.picture_page_info_list` 后通过浏览器代理（xiaoweibox.top / worker-proxy.asia / 等）把图片下载到本地，HTML/MD 用本地路径引用。但实测发现：

- **`xiaoweibox.top`（00-07）全部 400**：连 `GET /` 都返 400，代理池已死
- **`worker-proxy.asia`（00-07）全部 403**：Cloudflare 拒绝
- 这意味着 HTML/MD 导出时 "下载到本地" 选项**全部失败**

但是：
- **mmbiz.qpic.cn CDN 不挡请求**——实测 curl 无 referer 直连 4 张图，全部 200 OK（3-5MB/张）
- **Word 导出不受影响**：html-docx 库把 HTML 嵌入 .docx 的 `altChunk`，`<img src>` 是 CDN URL，Word 程序自己拉图
- **PDF 导出不受影响**：服务端 Puppeteer 没有浏览器 CORS 限制，直接 fetch mmbiz
- **HTML/MD 导出在浏览器里打开其实也能看到图**：浏览器加载 `<img src="https://mmbiz.qpic.cn/...">` 不受 CORS 拦（因为 `<img>` 不是 fetch），用户只是觉得"CDN 链接 = 没下载到本地 = 图片缺失"

## 目标

让 HTML / Markdown 导出在**浏览器代理全挂**的情况下也能完成"下载到本地"，不依赖任何第三方 CORS 代理。

**关键洞察**：服务端拉图不被 CORS 限制——PDF 已经在用这个能力。让 HTML/MD 也复用同一条管线。

---

## 方案 A：服务端图片下载接口

### 设计

新增一个 server route `/api/web/image-download`，接收图片 URL，服务端直接 fetch mmbiz（或其他任意 URL），返回 Blob。浏览器侧的 Exporter 在代理下载失败时 fallback 到调这个接口，把返回的 Blob 存进 IndexedDB resource cache，后续 urlmap 替换流程保持不变。

### 数据流

```
[Exporter.extractResources]
  ├─ picture_page_info_list → URLs
  └─ <img> → URLs
[processExportQueue]
  └─ downloadResourceTask(url, fakeid)
       ├─ 1. try getResourceCache (已有缓存跳过)
       ├─ 2. try this.download via proxy       ← 现在经常 400/403
       ├─ 3. fallback: fetch('/api/web/image-download?url=...')  ← 新增
       └─ 4. updateResourceCache(blob)
[exportHtmlFiles / exportMarkdownFiles]
  └─ getResourceCache → urlmap → normalizeHtml 替换 src
```

### 为什么这是最小改动

- **服务端用现成的 Nuxt Nitro server route**（项目已经有 `/api/web/pdf/generate`）
- **客户端 Exporter 只加 1 个 catch 分支**：原 `download` 抛错时不进 `failed`，再试服务端
- **零侵入现有数据流**：urlmap、resource-map、normalizeHtml 都不变

### 实现要点

#### 1. server route `server/api/web/image-download.post.ts`

```typescript
import { defineEventHandler, readBody, setResponseHeader } from 'h3';

export default defineEventHandler(async (event) => {
  const { url } = await readBody<{ url: string }>(event);
  if (!url) {
    throw createError({ statusCode: 400, message: 'url required' });
  }

  // 转发请求到目标 URL，模拟浏览器 UA，让 mmbiz 等 CDN 不挡
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    },
    // 不要缓存，每次重新拉（避免 CDN 内容更新拉不到）
    cache: 'no-store',
  });

  if (!response.ok) {
    throw createError({
      statusCode: response.status,
      message: `Upstream fetch failed: ${response.status} ${response.statusText}`,
    });
  }

  const blob = await response.blob();
  // 把 Blob 直接作为响应体返回
  setResponseHeader(event, 'Content-Type', response.headers.get('Content-Type') || 'application/octet-stream');
  setResponseHeader(event, 'Content-Length', String(blob.size));
  return blob;
});
```

**注意**：
- 不用 `proxyUrl` 包裹，直接服务端 fetch 目标 URL（没有 CORS 限制）
- mmbiz 不挡 referer，所以不传 Referer 也行
- 返回 Blob 二进制，浏览器用 `response.blob()` 接

#### 2. 客户端 `utils/download/BaseDownloader.ts` 加 fallback 方法

在 `downloadResourceTask` 的 catch 分支里调服务端。但要注意：fallback 不能简单替换 try/catch，因为外层已经在重试循环里。

更干净的做法是在 `Exporter` 里包一层：

```typescript
// utils/download/Exporter.ts downloadResourceTask 重写
private async downloadResourceTask(url: string, fakeid: string): Promise<void> {
  this.pending.add(url);

  const cached = await getResourceCache(url);
  if (cached) {
    this.pending.delete(url);
    this.completed.add(url);
    return;
  }

  // 阶段 1：尝试代理下载（保留原有重试 + 代理池逻辑）
  const proxySuccess = await this.tryProxyDownload(url, fakeid);
  if (proxySuccess) return;

  // 阶段 2：服务端 fallback（不走代理，绕过 CORS）
  console.log(`[Exporter] 代理全部失败，尝试服务端下载: ${url}`);
  const serverSuccess = await this.tryServerDownload(url, fakeid);
  if (serverSuccess) return;

  // 全部失败
  this.pending.delete(url);
  this.failed.add(url);
  console.warn(`[Exporter] 下载资源失败 (代理 + 服务端都试了): ${url}`);
}

private async tryProxyDownload(url: string, fakeid: string): Promise<boolean> {
  for (let attempt = 0; attempt < this.options.maxRetries; attempt++) {
    const proxy = this.proxyManager.getBestProxy();
    try {
      const blob = await this.download(fakeid, url, proxy);
      await updateResourceCache({ fakeid, url, file: blob });
      this.proxyManager.recordSuccess(proxy);
      return true;
    } catch (error) {
      await this.handleDownloadFailure(proxy, url, attempt, error);
    }
  }
  return false;
}

private async tryServerDownload(url: string, fakeid: string): Promise<boolean> {
  try {
    const response = await fetch('/api/web/image-download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!response.ok) {
      console.warn(`[Exporter] 服务端下载失败: ${response.status}`);
      return false;
    }
    const blob = await response.blob();
    await updateResourceCache({ fakeid, url, file: blob });
    return true;
  } catch (error) {
    console.warn(`[Exporter] 服务端下载异常:`, error);
    return false;
  }
}
```

#### 3. `usePreferences` 加开关

不希望每次都走服务端（万一服务端挂了呢），可以让用户选择：

```typescript
// composables/usePreferences.ts
exportConfig: {
  ...,
  // 新增
  enableServerImageFallback: true,  // 默认开启，代理挂了自动用服务端
}
```

#### 4. 防御性设计

- **服务端超时**：Nitro route 默认没超时，加 `Promise.race([fetch, timeout(20_000)])`
- **服务端拒绝过大文件**：超过 20MB 的图直接拒（CDN 攻击防护），返 413
- **服务端白名单**：只允许 mmbiz.qpic.cn / mmbiz.q.cn 等微信 CDN 域名（防滥用做跳板）
- **浏览器侧同一 URL 不要重复打服务端**：在 `processExportQueue` 里 `this.resources` 是 Set，每个 URL 只跑一次，已经天然去重

### 改动文件清单

| 文件 | 改动 |
|------|------|
| `server/api/web/image-download.post.ts` | 新增 ~30 行 |
| `utils/download/Exporter.ts` | 重构 `downloadResourceTask` 加 fallback ~40 行 |
| `composables/usePreferences.ts` | 加 `enableServerImageFallback` 字段 |
| `types/preferences.ts` | 同步类型定义 |

### 验证清单

1. **本地 dev server** (`yarn nuxt dev`) 启动后访问 `http://localhost:3000`
2. **正常情况（代理可用）**：导出图片分享文章 → console 看 `[Exporter] 解析到 N 张图` 但**没有**"代理全部失败"日志 → 走原有路径，本地 assets/xxx.png 正常下载
3. **代理挂的情况**（清空 preferences.privateProxyList，或改 PUBLIC_PROXY_LIST 为空）：导出同一文章 → console 看"代理全部失败 → 服务端下载" → assets/xxx.png 仍然下载成功
4. **服务端也挂的情况**：临时把 server route 改 500 → 导出应该 fallback 到 CDN（HTML 还能打开看图，只是非本地）
5. **跨域保护**：从浏览器直接 fetch `http://localhost:3000/api/web/image-download` 不带白名单参数 → 应被服务端拒绝

### 风险与权衡

| 风险 | 缓解 |
|------|------|
| 服务端变慢（多篇文章 N×M 张图都走服务端）| 用 Nitro 的 stream 返回，单图下载 3-5MB 在本地很快；并发由现有 processExportQueue 控制（5 并发） |
| 服务端被打成跳板 | URL 白名单 + Referer 检查（只允许本站调用） |
| CDN 防盗链变更（未来某天 mmbiz 改成必须 referer）| 服务端加 `Referer: https://mp.weixin.qq.com/` 兜底（实测当前不需要） |
| 服务端中转消耗服务器带宽 | 仅在浏览器代理全部失败时才 fallback，正常情况代理负担大部分流量 |

---

## 方案 B：直接放弃本地下载，所有导出都用 CDN refs

最简单但有 trade-off：

- **HTML/MD 打开必须联网**——离线打开看到破图
- **和 Word/PDF 行为对齐**——三者都是"嵌入 CDN refs，渲染时拉"
- 用户偏好设置里的"下载到本地" 选项失效（但 UI 文字改成"下载图片到本地（实验性，依赖代理）"）

适合：**只想要快速导出、不在意离线** 的用户。

实现：~5 行代码改动（`downloadResources` 整个方法变成 noop，`extractResources` 只记录 URLs 不下载，normalizeHtml 直接用 CDN URL 渲染）。

---

## 方案 C：自建 CORS 代理（Workder / VPS）

部署一个简单的 Cloudflare Worker / Node 服务，专门做 CORS proxy。

```typescript
// Cloudflare Worker 示例
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const target = url.searchParams.get('url');
    if (!target) return new Response('url required', { status: 400 });
    
    const response = await fetch(target, {
      headers: { 'User-Agent': 'Mozilla/5.0 ...' },
    });
    
    const body = await response.body;
    return new Response(body, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream',
      },
    });
  },
};
```

部署到 `cors-proxy.your-domain.workers.dev`，在 preferences.privateProxyList 里配置。

适合：愿意自己部署的用户，长期最稳。

---

## 推荐

**方案 A** 是当前最合适的 trade-off：
- ✅ 不依赖第三方代理池（xiaoweibox / worker-proxy 全挂也能用）
- ✅ 不增加运维成本（复用现有 Nuxt 服务端）
- ✅ 改动小、风险可控（fallback，不破坏现有流程）
- ✅ 跟 PDF 用同一条服务端管线，架构一致
- ⚠️ 服务端要消耗一点带宽（兜底流量）

方案 B 太简单粗暴，违背用户预期（"下载到本地" 应该真的下载）。方案 C 需要用户额外部署，超出本项目范围。

---

## 相关代码位置

- 代理下载：`utils/download/BaseDownloader.ts:141` (`download` 方法) / `utils/download/Exporter.ts:285` (`downloadResourceTask`)
- PDF 服务端渲染参考：`utils/download/Exporter.ts:530` (`exportPdfFiles`) + `server/api/web/pdf/generate.ts`
- 资源缓存：`store/v2/resource.ts` (`updateResourceCache` / `getResourceCache`)
- 图片分享 URL 提取：`utils/download/Exporter.ts:142` (`extractResources` cgiData 分支)

---

## Open Questions

1. **服务端域名白名单要严格到什么程度？** 允许所有 URL（用户自己负责）vs 只允许 mmbiz.qpic.cn / res.wx.qq.com（防滥用）。倾向后者。
2. **是否需要上传进度？** 大图（5MB+）通过服务端中转需要 1-2 秒，是否要给前端加进度事件？目前 processExportQueue 已有 `emit('export:download:progress')`，复用即可。
3. **服务端 route 是否需要 auth？** 现在 PDF route `/api/web/pdf/generate` 也没 auth（同源访问）。沿用。
4. **是否同时支持 GET / image-download?url=...** 简化客户端 fetch？POST + JSON body 更显式，倾向 POST。