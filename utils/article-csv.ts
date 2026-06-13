import dayjs from 'dayjs';

/**
 * 用于 CSV 导出的最小文章结构
 *
 * 任何包含 title / update_time / link 三个字段的对象都适用，不必是完整 Article。
 */
export interface CsvArticle {
  title: string;
  update_time: number;
  link: string;
}

/**
 * 按 CSV 规则转义单个字段
 *
 * - 含 `,` / `"` / 换行的字段需要用双引号包裹
 * - 双引号用 `""` 转义
 */
export function csvEscape(value: unknown): string {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * 将 Unix 秒时间戳格式化为 `YYYY-MM-DD HH:mm:ss`（本地时区）
 *
 * 0 视为「未设置」，返回空串。
 */
export function defaultCsvDateFormatter(unixSeconds: number): string {
  return unixSeconds > 0 ? dayjs.unix(unixSeconds).format('YYYY-MM-DD HH:mm:ss') : '';
}

/**
 * 构建文章列表 CSV 字符串
 *
 * - 列：标题、发布日期、链接
 * - 默认按 update_time 倒序
 * - 头部带 UTF-8 BOM，避免 Excel / WPS 打开时中文乱码
 * - `formatDate` 可注入，便于测试时避开本地时区影响
 */
export function buildArticlesCsv(
  articles: CsvArticle[],
  formatDate: (unixSeconds: number) => string = defaultCsvDateFormatter
): string {
  const header = '标题,发布日期,链接';
  const rows = articles
    .slice()
    .sort((a, b) => (b.update_time ?? 0) - (a.update_time ?? 0))
    .map(a => [csvEscape(a.title), csvEscape(formatDate(a.update_time)), csvEscape(a.link)].join(','));
  return '﻿' + [header, ...rows].join('\n');
}

/**
 * 触发浏览器下载给定内容的 CSV 文件
 *
 * 文件名会去掉/替换非法字符，避免在不同操作系统上下载失败。
 */
export function downloadCsv(filename: string, csv: string): void {
  const safeName = filename.replace(/[\\/:*?"<>|]/g, '_');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName.endsWith('.csv') ? safeName : `${safeName}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
