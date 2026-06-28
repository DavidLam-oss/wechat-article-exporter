# 图片分享文章导出改进 — 第二轮

## 背景

在第一轮修复（`plans/2026-06-28-image-share-export-fix.md`）解决了图片分享文章（item_show_type=8）导出空白/缺失 Markdown 的基础上，又发现两个新问题：

1. **Bug**：偏好设置中即使选择了"下载到本地"，导出的 HTML/MD 里图片仍然是微信 CDN 链接。
2. **特性**：原导出的图片分享文章只是一堆图片垂直堆叠，失去了公众号原网页那种横向滑动浏览的体验。

本文档描述两处修复与新增的 scroll-snap 横向滑动容器实现，供 Gemini review。

---

## 改动一：修复"下载到本地"不生效的 bug

### 根因

图片分享类文章（item_show_type=8）的图片**不在缓存 HTML 的 `<img>` 标签里**——它们只存在于 JS 脚本里的 `window.cgiDataNew.picture_page_info_list`。原始数据流是：

```
抓取缓存 HTML（包含 <script>，无 <img>）
  ↓
extractResources() 查询 <img> → 找不到图片分享的图片
  ↓
不加入下载队列
  ↓
processExportQueue() 实际下载
  ↓
urlmap 是空的
  ↓
normalizeHtml() 渲染图片分享时使用 CDN URL
  ↓
后续 URL 替换循环 urlmap.has() === false → CDN 链接保留
```

### 修复

#### `utils/download/Exporter.ts`（Exporter 类的导出管线：HTML / MD / PDF / Word）

`extractResources()`（line 137-149 新增）：

```typescript
if (downloadImages) {
  // 图片分享类（item_show_type=8）的图片不在 HTML 的 <img> 里，
  // 只在 window.cgiDataNew.picture_page_info_list，必须通过 parseCgiDataNew
  // 从 script 中解析出来，否则下载不到本地（会被 CDN 链接取代）。
  const cgiData = await parseCgiDataNew(html);
  const pictureList = cgiData?.picture_page_info_list;
  if (Array.isArray(pictureList)) {
    for (const picture of pictureList) {
      const cdnUrl = picture?.cdn_url;
      if (cdnUrl) {
        resources.push(cdnUrl);
        this.resources.add({ url: cdnUrl, fakeid: article.fakeid });
      }
    }
  }
  // ... 原有 <img> 提取逻辑 ...
}
```

后续 URL 替换循环（line 935-947）保持不变，会自动把渲染时插入的 `<img src="cdn_url">` 替换为本地路径。

#### `utils/index.ts`（合集 ZIP 下载的 `packHTMLAssets`）

把图片分享渲染块（原来在 line 442-472）**挪到图片下载循环（line 658-677）之前**。这样下载循环 `pool.downloads<HTMLImageElement>([...imgs], imgDownloadFn)` 能自动看到新插入的 `<img>` 并下载/替换 src。

修改后的执行顺序：

```
packHTMLAssets()
  ↓
[其他渲染：pub time / IP / 视频分享 / iframes / ...]
  ↓
[图片分享渲染]  ←  新位置，插入 <img> 到 DOM
  ↓
[下载所有的图片]  ←  querySelectorAll('img') 看到图片分享的 <img>
  ↓
[下载背景图片 / 样式表 / ...]
```

### 为什么不把 inline 渲染改为调用 renderContent_8

`Exporter.ts` 和 `utils/index.ts` 的 inline 渲染与 `renderer.ts` 的 `renderContent_8` 输出结构略有差异：
- `renderContent_8` 输出完整的 `<section class="item_show_type_8"><p class="text_content">...<div class="picture_content">...</div></section>`
- inline 渲染把文字描述单独放进 `#js_image_desc`，图片只放进 `#js_share_content_page_hd`

如果统一调用 `renderContent_8`，需要重构这两个文件的整体渲染结构，超出本次改动范围。所以只把"图片轮播"这部分抽出共用 helper。

### 性能守卫（Gemini review 第一轮反馈）

`parseCgiDataNew` 是高开销操作（客户端创建 iframe 服务端打沙箱）。在批量导出时，对每篇普通图文都解析一次代价太大，加短路守卫：

- `Exporter.ts` `extractResources`：有 `article` 元数据，优先用 `article.item_show_type === 8` 判断，兜底用 `html.includes('picture_page_info_list')` 字符串检查
- `Exporter.ts` `normalizeHtml` 图片分享渲染块、`utils/index.ts` `packHTMLAssets` 图片分享渲染块：无元数据，用 `html.includes('picture_page_info_list')` 短路

99% 普通图文 HTML 不含 `picture_page_info_list` 字符串（仅图片分享类文章的 cgiDataNew 才有此字段），直接早返回。

---

## 改动二：图片分享横向滑动容器（scroll-snap）

### 设计

纯 CSS 实现，**不依赖 JS**。复用现有 `window.cgiDataNew.picture_page_info_list` 数据，只改 HTML 输出和样式。

### 新增共享 helper：`shared/utils/renderer.ts`

```typescript
export function renderPictureCarouselHTML(pictures: Array<{ cdn_url: string }>): string {
  let html = '<div class="picture-carousel">';
  pictures.forEach((picture, idx) => {
    const url = String(picture?.cdn_url || '').replace(/&amp;/g, '&');
    const label = `图${idx + 1}`;
    html += `<div class="picture-item" id="${label}">
  <a href="${url}" target="_blank" rel="noopener noreferrer"><img class="picture-item-img" src="${url}" alt="${label}" /></a>
  <p class="picture-item-label">${label}</p>
</div>`;
  });
  html += '</div>';
  return html;
}
```

### CSS（Gemini review 第二轮反馈：抽到共享常量）

CSS 原本在三处硬编码重复（`renderer.ts` / `Exporter.ts` / `utils/index.ts`），后续调样式要改三遍。Gemini 建议提到 `shared/utils/renderer.ts` 导出 `carouselCSS` 常量，三处 `${carouselCSS}` 注入。已实施。

```typescript
// shared/utils/renderer.ts
export const carouselCSS = `
.picture-carousel {
  display: flex;
  flex-direction: row;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  gap: 12px;
  padding: 20px;
  scroll-padding: 0 20px;
  -webkit-overflow-scrolling: touch;  /* iOS 顺滑滚动 */
  scrollbar-width: thin;
}
.picture-item {
  flex: 0 0 calc(100% - 60px);   /* 每张图占满宽度，留出下一张的边角 */
  scroll-snap-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.picture-item-img {
  display: block;
  max-width: 100%;
  max-height: 70vh;             /* 防止超高图片撑爆屏幕 */
  border: 1px solid #ccc;
  border-radius: 5px;
  cursor: pointer;
}
.picture-item-label {
  font-size: 13px;
  color: #666;
}
```

### 三个使用点

| 文件 | 路径 | 用途 |
|------|------|------|
| `shared/utils/renderer.ts` `renderContent_8` | `renderHTMLFromCgiDataNew` → 预览 iframe | 文章预览侧栏 |
| `utils/download/Exporter.ts` `normalizeHtml` | `exportHtmlFiles` / `exportMarkdownFiles` | 单篇 HTML/MD 导出 |
| `utils/index.ts` `packHTMLAssets` | `useDownloadAlbum` | 合集 ZIP 批量下载 |

### 关键设计权衡

- **每张图占满宽度**（calc(100% - 60px)）：比 WeChat 原版的"全宽"略小，露出下一张的边角，明确告诉用户可滑动。
- **不显示分页指示器**：scroll-snap 本身的吸附手感已经足够反馈，额外加分页点会增加复杂度且在小屏幕上没空间。
- **保留 `<img onclick="window.open(...)">`**：点击图片跳原图查看大图的交互，仍然纯 inline attribute 实现，导出的 HTML 双击文件就能用。
- **`max-height: 70vh`**：公众号图片分享经常出现超高长图，限制最大高度防止图片溢出视口；用户可点击新窗口看完整原图。

---

## 涉及的文件

| 文件 | 行数变化 | 改动概要 |
|------|---------|---------|
| `shared/utils/renderer.ts` | +52 / -13 | 新增 `renderPictureCarouselHTML`；`renderContent_8` 改用 helper；替换 preview CSS |
| `utils/download/Exporter.ts` | +44 / -11 | `extractResources` 新增图片分享 URL 提取；inline 渲染改用 helper；`<style>` 加 carousel CSS |
| `utils/index.ts` | +74 / -76 | 把图片分享渲染块从 line 397 移到 line 579（下载循环之前）；inline 渲染改用 helper；`<style>` 加 carousel CSS |

---

## 验证

- `yarn nuxt typecheck` 在三个改动文件里 **0 错误**（剩下 13 个 pre-existing 错误都在其他文件，跟本次改动无关：AuthPopoverPanel.vue, single.vue, discuss.vue, html-docx-js vendor, CookieStore, proxy-request, store/v2/index.ts）。
- **未做浏览器实测**：项目无 unit test 框架，未启 dev server 手动验证；建议人工跑一遍三个使用点。

### 建议人工验证清单

1. **单篇 HTML 导出（"下载到本地"开启）**：
   - 选一篇图片分享文章 → 导出 HTML → 检查 `index.html` 里 `<img>` 引用是 `./assets/xxx.jpg` 而不是 CDN
   - 浏览器打开 `index.html` → 横向滑动是否流畅，每张图是否能对齐居中
2. **单篇 HTML 导出（"下载到本地"关闭）**：
   - 重复上述，但确认 CDN URL 仍然能正常显示（即"关闭"开关也仍然生效）
3. **单篇 Markdown 导出**：
   - 导出 → 打开 .md → 检查图片引用是 `./assets/xxx.jpg`
4. **合集 ZIP 下载**：
   - 选合集（含图片分享文章）→ 下载 → 解压 → 打开 HTML → 验证
5. **预览侧栏**：
   - 选图片分享文章 → 点"预览" → 横向滑动是否正常
6. **`/dev/markdown` 页面**：
   - 加载图片分享文章 → 看 MD 输出首行无 CSS 污染（前一轮已修）

---

## Gemini Review 第二轮：已处理的反馈

| # | 问题 | 处理 |
|---|------|------|
| 🔴 | `onclick` 被 DOMPurify strip，预览点图无反应 | `renderPictureCarouselHTML` 改为 `<a href target="_blank" rel="noopener noreferrer">` 包裹 `<img>` —— 天然兼容 DOMPurify，且支持右键/Cmd+点击新标签页 |
| ⚡ | `parseCgiDataNew` 在每篇文章上无条件调用 | 三处都加短路守卫：`Exporter.ts` extractResources 用 `article.item_show_type === 8 \|\| html.includes('picture_page_info_list')`；normalizeHtml / packHTMLAssets 用 `html.includes('picture_page_info_list')` |
| ✏️ | 三处完全重复的 carousel CSS（32 行 ×3） | 抽到 `shared/utils/renderer.ts` 的 `carouselCSS` 常量，三处通过 `${carouselCSS}` 模板插值注入 `<style>` |

---

## Gemini Review 第二轮：待确认 / 留给后续轮次

- **`max-height: 70vh` 在桌面端可能偏小**：超高长图只占 70vh，余下空间留白。用户拍板后可改为 `auto` 或更小阈值。
- **inline 渲染路径仍有大量与 `renderer.ts` 重叠的代码**（pub time / IP / title modify / share source / video share / comment 等）。彻底重构需统一调用 `renderHTMLFromCgiDataNew`，会改变导出 HTML 结构（多一层 `__page_content__` 包装），需要先确认兼容性。
- **空 `cdn_url` 优雅降级**：当前 render 输出 `<img src="">` 显示破图，未做 skip。建议对 `String(picture?.cdn_url || '')` 为空的对象直接 `continue`，但目前 cgiData 数据格式保证非空，留作兜底。

---

## Open Questions

1. 现有 inline 渲染逻辑（`Exporter.ts` line 851-928 和 `utils/index.ts` line 579-625）有大量与 `renderer.ts` 重叠的代码（pub time、IP、title modify、share source、comment、video share 等）。是否要重构为统一调用 `renderHTMLFromCgiDataNew`？这会改变输出的 HTML 结构（额外多一层 `<div class="__page_content__">` 包装），需要先确认导出文件的兼容性。
2. 上一轮删掉了 `Article.vue` 里的 `normalizeHtmlForPreview` 死代码。现在 preview 走 `renderHTMLFromCgiDataNew` 管线。是否需要把 inline 渲染（Exporter / packHTMLAssets）也改造为同一条管线？

---

## 关联

- 第一轮设计：`plans/2026-06-28-image-share-export-fix.md`
- 共享 helper：`shared/utils/renderer.ts:renderPictureCarouselHTML`
- 改动 commit：`fix: image share article export (extract cgiDataNew + cgiData picture_page_info_list)`（上一轮 dd1b5e7）