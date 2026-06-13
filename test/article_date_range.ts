import { strict as assert } from 'node:assert';
import dayjs from 'dayjs';
import {
  ARTICLE_DATE_RANGE_OPTIONS,
  type ArticleDateRange,
  getArticleDateRangeBounds,
  // @ts-expect-error -- Node --experimental-strip-types 需要显式 .ts 扩展名；allowImportingTsExtensions 未开启
} from '../utils/article-date-range.ts';

// 固定参考时间：2026-06-13 12:34:56
// - "今天" = 2026-06-13
// - endOf('day') = 2026-06-13 23:59:59 → 1749849599
const NOW = dayjs('2026-06-13T12:34:56+08:00');
const TODAY_END = NOW.endOf('day').unix(); // 1749849599

interface Case {
  range: ArticleDateRange;
  point?: number;
  expected: { lower: number; upper: number };
  desc: string;
}

const CASES: Case[] = [
  { range: 'all', expected: { lower: 0, upper: TODAY_END }, desc: '全部：下界 0，上界 今天 23:59:59' },
  {
    range: '1d',
    expected: { lower: NOW.subtract(1, 'day').startOf('day').unix(), upper: TODAY_END },
    desc: '最近一天：从昨天 00:00 到今天 23:59:59',
  },
  {
    range: '3d',
    expected: { lower: NOW.subtract(3, 'day').startOf('day').unix(), upper: TODAY_END },
    desc: '最近三天：3 天前 00:00 到今天 23:59:59',
  },
  {
    range: '7d',
    expected: { lower: NOW.subtract(7, 'day').startOf('day').unix(), upper: TODAY_END },
    desc: '最近一周：7 天前 00:00 到今天 23:59:59',
  },
  {
    range: '1m',
    expected: { lower: NOW.subtract(1, 'month').startOf('day').unix(), upper: TODAY_END },
    desc: '最近一个月：1 个月前 00:00 到今天 23:59:59',
  },
  {
    range: '3m',
    expected: { lower: NOW.subtract(3, 'month').startOf('day').unix(), upper: TODAY_END },
    desc: '最近三个月：3 个月前 00:00 到今天 23:59:59',
  },
  {
    range: '6m',
    expected: { lower: NOW.subtract(6, 'month').startOf('day').unix(), upper: TODAY_END },
    desc: '最近半年：6 个月前 00:00 到今天 23:59:59',
  },
  {
    range: '1y',
    expected: { lower: NOW.subtract(1, 'year').startOf('day').unix(), upper: TODAY_END },
    desc: '最近一年：1 年前 00:00 到今天 23:59:59',
  },
  // 自定义：2025-06-01 → lower = 2025-06-01 00:00:00 = 1748707200
  {
    range: 'point',
    point: dayjs('2025-06-01T00:00:00+08:00').unix(),
    expected: { lower: dayjs('2025-06-01T00:00:00+08:00').startOf('day').unix(), upper: TODAY_END },
    desc: '自定义 2025-06-01：从 2025-06-01 00:00 到今天 23:59:59',
  },
  // 自定义 point=0：降级为 all
  {
    range: 'point',
    point: 0,
    expected: { lower: 0, upper: TODAY_END },
    desc: '自定义 point=0：降级为 all（下界 0）',
  },
];

function run() {
  console.log(`参考时间 (NOW): ${NOW.format('YYYY-MM-DD HH:mm:ss')}`);
  console.log(`今天结束 (TODAY_END): ${TODAY_END}  (${dayjs.unix(TODAY_END).format('YYYY-MM-DD HH:mm:ss')})`);
  console.log();

  // 选项完整性
  console.log(`选项数量: ${ARTICLE_DATE_RANGE_OPTIONS.length}（期望 9）`);
  assert.equal(ARTICLE_DATE_RANGE_OPTIONS.length, 9, 'ARTICLE_DATE_RANGE_OPTIONS 应当恰好 9 项');
  const labels = ARTICLE_DATE_RANGE_OPTIONS.map(o => o.label).join(', ');
  console.log(`选项: ${labels}`);
  console.log();

  let passed = 0;
  let failed = 0;
  for (const c of CASES) {
    const got = getArticleDateRangeBounds(c.range, c.point ?? 0, NOW);
    try {
      assert.equal(got.lower, c.expected.lower, `[${c.range}] lower 不匹配`);
      assert.equal(got.upper, c.expected.upper, `[${c.range}] upper 不匹配`);
      console.log(`✓ ${c.range.padEnd(4)} → ${c.desc}`);
      console.log(`        lower=${got.lower} (${dayjs.unix(got.lower).format('YYYY-MM-DD HH:mm:ss')})`);
      console.log(`        upper=${got.upper} (${dayjs.unix(got.upper).format('YYYY-MM-DD HH:mm:ss')})`);
      passed++;
    } catch (err) {
      console.error(`✗ ${c.range} → ${c.desc}`);
      console.error(`  expected: lower=${c.expected.lower}, upper=${c.expected.upper}`);
      console.error(`  got:      lower=${got.lower}, upper=${got.upper}`);
      console.error(`  ${(err as Error).message}`);
      failed++;
    }
  }

  console.log();
  console.log(`总计: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

run();
