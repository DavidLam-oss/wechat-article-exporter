import dayjs from 'dayjs';

/**
 * 文章抓取页面日期筛选支持的取值
 *
 * - `1d` ~ `1y`：以日为粒度的相对范围，结束日期 = 今天
 * - `all`：不筛选
 * - `point`：由调用方传入起止日期（`point.start` / `point.end`，Unix 秒）
 */
export type ArticleDateRange = '1d' | '3d' | '7d' | '1m' | '3m' | '6m' | '1y' | 'all' | 'point';

export const ARTICLE_DATE_RANGE_OPTIONS: Array<{ value: ArticleDateRange; label: string }> = [
  { value: '1d', label: '最近一天' },
  { value: '3d', label: '最近三天' },
  { value: '7d', label: '最近一周' },
  { value: '1m', label: '最近一个月' },
  { value: '3m', label: '最近三个月' },
  { value: '6m', label: '最近半年' },
  { value: '1y', label: '最近一年' },
  { value: 'all', label: '全部' },
  { value: 'point', label: '自定义时间' },
];

/**
 * 自定义时间模式下的起止日期
 *
 * - `start = 0`：不限制下界（等价于「最早」）
 * - `end = 0`：不限制上界（等价于「今天 23:59:59」）
 * - 二者均会按「日」对齐：`start` 取当日 00:00:00，`end` 取当日 23:59:59
 */
export interface ArticleDatePoint {
  start: number;
  end: number;
}

interface DateRangeBounds {
  /** 包含的下界，Unix 秒 */
  lower: number;
  /** 包含的上界，Unix 秒 */
  upper: number;
}

/**
 * 根据日期范围取值计算 [lower, upper] 闭区间（Unix 秒）
 *
 * - `now` 用于把"今天"固定到一个具体时间，便于测试和函数式调用
 * - 预设范围（`1d` ~ `1y`）的 lower 对齐到「日 00:00:00」
 * - `point` 模式下使用 `point.start` / `point.end`，二者为 0 时分别视为「无下界」「今天」
 */
export function getArticleDateRangeBounds(
  range: ArticleDateRange,
  now: dayjs.Dayjs,
  point?: ArticleDatePoint
): DateRangeBounds {
  const todayEnd = now.endOf('day').unix();
  switch (range) {
    case '1d':
      return { lower: now.subtract(1, 'day').startOf('day').unix(), upper: todayEnd };
    case '3d':
      return { lower: now.subtract(3, 'day').startOf('day').unix(), upper: todayEnd };
    case '7d':
      return { lower: now.subtract(7, 'day').startOf('day').unix(), upper: todayEnd };
    case '1m':
      return { lower: now.subtract(1, 'month').startOf('day').unix(), upper: todayEnd };
    case '3m':
      return { lower: now.subtract(3, 'month').startOf('day').unix(), upper: todayEnd };
    case '6m':
      return { lower: now.subtract(6, 'month').startOf('day').unix(), upper: todayEnd };
    case '1y':
      return { lower: now.subtract(1, 'year').startOf('day').unix(), upper: todayEnd };
    case 'point': {
      const start = point?.start ?? 0;
      const end = point?.end ?? 0;
      return {
        lower: start > 0 ? dayjs.unix(start).startOf('day').unix() : 0,
        upper: end > 0 ? dayjs.unix(end).endOf('day').unix() : todayEnd,
      };
    }
    case 'all':
    default:
      return { lower: 0, upper: todayEnd };
  }
}
