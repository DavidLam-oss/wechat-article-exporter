# 图片分享类型文章导出修复

## 背景

用户报告：批量下载 112 篇文章后，**HTML 导出产出 112 个文件但全是空白页面**，**Markdown 导出只产出 66 个文件**。缺失的 46 篇均为"图片分享"类型（item_show_type=8，例如「跟着顶刊学配色」系列）。

观察到的现象：

| 导出格式 | 数量 | 内容质量 |
|---|---|---|
| HTML | 112 / 112 | ❌ 46 篇图片分享的 `index.html` 只有空 swiper 模板 |
| Markdown | 66 / 112 | ❌ 46 篇图片分享被静默跳过 |

## 根因

通过 `/dev/markdown` 加载一篇图片分享文章并观察控制台，定位到两条相互独立的 bug。

### Bug 1：`extractCgiScript` 对匹配数要求过严，导致 cgiData 拿不到

**位置：** `shared/utils/html.ts:142`

```typescript
function extractCgiScript(html: string) {
  const $ = cheerio.load(html);
  const scriptEl = $('script[type="text/javascript"][h5only]').filter((i, el) => {
    const content = $(el).html() || '';
    return content.includes('window.cgiDataNew = ');
  });
  if (scriptEl.length !== 1) {        // ← 只接受恰好 1 个匹配
    console.warn('未找到包含 cgiDataNew 的目标 script');
    return null;
  }
  ...
}
```

**触发条件：** 新版微信图片分享页面里 `h5only` 且 `type="text/javascript"` 的 script 有 **2 个**包含字面量 `window.cgiDataNew = `：

| Script | 大小 | 内容 |
|---|---|---|
| #2 | ~38 KB | **真正的 cgiDataNew 数据**（title / desc / picture_page_info_list 等） |
| #8 | ~330 KB | Vue 编译产物里有一行 `window.cgiDataNew = window.cgiDataNew || {}`（防御性初始化），也匹配 `includes()` |

`scriptEl.length !== 1` 判断导致 `extractCgiScript` 返回 `null`，进而 `parseCgiDataNew` → `getRenderedHTML` 返回 `''`，**markdown/word/txt 导出链路在该步静默失败**。

仓库里 `samples/图片分享/*.html` 都是旧版微信页面，只有 1 个匹配，所以测试从未发现这个 case。

### Bug 2：`normalizeHtml` 图片分享分支要求 `#js_image_desc` 元素存在

**位置：** `utils/download/Exporter.ts:791-862`

```typescript
const $js_image_desc = $jsArticleContent.querySelector('#js_image_desc');
if ($js_image_desc) {                  // ← 守卫
  bodyCls += 'pages_skin_pc page_share_img';
  ...
  const qmtplMatchResult = html.match(/...window\.__QMTPL_SSR_DATA__.../s);
  // 解析 desc 并写入 $js_image_desc.innerHTML
  ...
  const pictureMatchResult = html.match(/...window\.picture_page_info_list.../s);
  // 解析图片并写入 #js_share_content_page_hd
  ...
}
```

**触发条件：** wechat-article-exporter 下载到 IndexedDB 的原始微信页面（API 响应）只有空 swiper 模板：

```html
<div id="js_article" class="share_content_page">
  <div class="share_content_page_hd" id="js_share_content_page_hd">
    <div class="img_swiper_area">
      <div id="img_swiper_placeholder" ...>...</div>   ← 空模板
    </div>
  </div>
  <div class="share_content_page_bd" id="js_base_container"></div>
</div>
<script>window.cgiDataNew = { title, desc, picture_page_info_list, ... }</script>
<script>window.picture_page_info_list = [...]</script>
```

**没有 `#js_image_desc` 元素**——它是浏览器执行 JS 后由 Vue 运行时注入的。`if ($js_image_desc)` 守卫失败，整个图片分享提取分支被跳过，**HTML 导出产出空白**。

注意：仓库里的 `samples/图片分享/*.html` 也属于这种"原始 API 形态"（无 `#js_image_desc`），所以 `normalizeHtml` 这段代码对 sample 也一直不工作，只是没人发现。

## 修复方案

### Fix 1：放宽 `extractCgiScript` 匹配检查

`shared/utils/html.ts:142`

```typescript
// 旧
if (scriptEl.length !== 1) {

// 新
if (scriptEl.length === 0) {
```

理由：脚本 #2 永远是真正的数据（38 KB，包含 base_resp / title / desc / picture_page_info_list 等完整字段），脚本 #8 是 Vue 编译产物里的 `|| {}` 防御初始化，没有实质数据。取第一个匹配即可。

### Fix 2：让 `normalizeHtml` 不依赖 `#js_image_desc` 元素

`utils/download/Exporter.ts:791-862`

**思路：** 把 `__QMTPL_SSR_DATA__` 和 `picture_page_info_list` 的提取挪出 `if ($js_image_desc)` 守卫，并按需创建元素：

1. 尝试正则匹配 `window.picture_page_info_list` 脚本并 `eval` 拿到图片列表
2. 若 `$js_image_desc` 不存在，动态创建并 append 到 `#js_base_container`（兜底容器）
3. 优先从 `__QMTPL_SSR_DATA__.desc` 拿描述；若该脚本不存在（用户账号里的文章就没有），fallback 到 cgiDataNew 的 `desc` / `content_noencode`（依赖 Fix 1 让 `parseCgiDataNew` 能成功）

伪代码：

```typescript
const pictureMatchResult = html.match(/...window\.picture_page_info_list.../s);
if (pictureMatchResult) {
  eval(pictureMatchResult.groups.code);
  const list = (window as any).picture_page_info_list;
  const containerEl = $jsArticleContent.querySelector('#js_share_content_page_hd');
  if (containerEl) {
    containerEl.innerHTML = list.map((p, i) =>
      `<img src="${p.cdn_url}" ... />`).join('');
  }
}

// 描述：先尝试 QMTPL（老格式），失败则走 cgiDataNew（新格式）
const qmtplMatchResult = html.match(/...window\.__QMTPL_SSR_DATA__.../s);
let desc: string | null = null;
if (qmtplMatchResult) {
  eval(qmtplMatchResult.groups.code);
  desc = decode_html((window as any).__QMTPL_SSR_DATA__.desc, false);
}
if (!desc) {
  const cgiData = await parseCgiDataNew(html);  // Fix 1 已让这里能拿到
  desc = cgiData?.desc || cgiData?.content_noencode || '';
}
let $js_image_desc = $jsArticleContent.querySelector('#js_image_desc');
if (!$js_image_desc) {
  $js_image_desc = document.createElement('p');
  $js_image_desc.id = 'js_image_desc';
  $jsArticleContent.querySelector('#js_base_container')?.appendChild($js_image_desc);
}
if ($js_image_desc && desc) {
  $js_image_desc.innerHTML = desc;
  bodyCls += 'pages_skin_pc page_share_img';
}
```

## 影响范围

| 导出格式 | 修复前 | 修复后 |
|---|---|---|
| HTML | 46 篇空白 swiper | ✅ 正常内容（标题、描述、图片） |
| Markdown | 66 / 112（46 篇被跳过） | ✅ 接近 112 篇（仅文章本身下载失败的会缺） |
| TXT | 受 Bug 1 影响，部分缺 | ✅ 自动恢复 |
| Word | 受 Bug 1 影响，部分缺 | ✅ 自动恢复 |
| PDF | 受 Bug 1 影响，部分缺 | ✅ 自动恢复 |

## 风险

- Fix 1 改动一行，影响面广但语义清晰（之前的 `!== 1` 显然是个未预期的过严判断）。
- Fix 2 重构了一个原有代码块，需要回归 `samples/图片分享/*.html`（老格式）和 `samples/普通图文/*.html`（不受影响）确认不破坏现有行为。

## 验证

1. `yarn dev`，访问 `/dev/markdown`，加载 `https://mp.weixin.qq.com/s/FP-6oJxpALB83-P8aMBX8g`（任意一篇"跟着顶刊学配色"）：
   - 左边应出现完整 HTML（标题、描述、图片链接）
2. 实际跑一次 markdown 批量导出：文件数应从 66 涨到接近 112（只少那些**抓取阶段就失败的**）
3. 实际跑一次 HTML 批量导出：检查任一图片分享文章的 `index.html`，应有正文和图片
4. （回归）跑 `samples/图片分享/01.html` 经过 `normalizeHtml` 的输出目录 `test/output/`，对比新旧产物

## 未做

- 没写自动化单测。`normalizeHtml` 用 DOMParser + eval，测试基础设施（`test/` 下的 Node 脚本）覆盖不到，主要靠手动跑 dev 验证。
- 没动 markdown 导出加 fallback 那条最初设想的路 —— Fix 1 修好之后 `parseCgiDataNew` 能直接拿到 cgiData，`renderHTMLFromCgiDataNew` 已经能处理图片分享（`renderer.ts:285` 的 `renderContent_8`），markdown 链路自动通了，不需要再写 fallback。
