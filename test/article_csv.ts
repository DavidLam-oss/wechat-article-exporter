import { strict as assert } from 'node:assert';
import {
  buildArticlesCsv,
  csvEscape,
  defaultCsvDateFormatter,
  // @ts-expect-error -- Node --experimental-strip-types 需要显式 .ts 扩展名；allowImportingTsExtensions 未开启
} from '../utils/article-csv.ts';

// 固定日期格式化器，避开本地时区影响
const FIXED_FORMAT = (t: number) => {
  if (!t) return '';
  const d = new Date(t * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
};

// 2025-06-01 00:00:00 UTC = 1748736000
// 2025-06-15 00:00:00 UTC = 1749945600
// 2025-06-30 00:00:00 UTC = 1751241600
const JUNE_1 = 1748736000;
const JUNE_15 = 1749945600;
const JUNE_30 = 1751241600;

interface Case {
  desc: string;
  run: () => void;
}

const CASES: Case[] = [
  {
    desc: 'csvEscape:普通字符串原样返回',
    run: () => {
      assert.equal(csvEscape('hello'), 'hello');
      assert.equal(csvEscape(''), '');
      assert.equal(csvEscape(0), '0');
      assert.equal(csvEscape(null), '');
      assert.equal(csvEscape(undefined), '');
    },
  },
  {
    desc: 'csvEscape:含逗号/引号/换行的字段加双引号包裹,引号用 "" 转义',
    run: () => {
      assert.equal(csvEscape('a,b'), '"a,b"');
      assert.equal(csvEscape('say "hi"'), '"say ""hi"""');
      assert.equal(csvEscape('line1\nline2'), '"line1\nline2"');
      assert.equal(csvEscape('with\rreturn'), '"with\rreturn"');
    },
  },
  {
    desc: 'buildArticlesCsv:空数组只返回表头 + BOM',
    run: () => {
      const csv = buildArticlesCsv([], FIXED_FORMAT);
      assert.equal(csv, '﻿标题,发布日期,链接');
    },
  },
  {
    desc: 'buildArticlesCsv:单条文章生成表头 + 一行',
    run: () => {
      const csv = buildArticlesCsv(
        [{ title: '标题A', update_time: JUNE_15, link: 'https://example.com/a' }],
        FIXED_FORMAT
      );
      assert.equal(csv, '﻿标题,发布日期,链接\n标题A,2025-06-15 00:00:00,https://example.com/a');
    },
  },
  {
    desc: 'buildArticlesCsv:多条文章按 update_time 倒序',
    run: () => {
      const csv = buildArticlesCsv(
        [
          { title: '较早', update_time: JUNE_1, link: 'https://example.com/a' },
          { title: '较晚', update_time: JUNE_30, link: 'https://example.com/c' },
          { title: '中间', update_time: JUNE_15, link: 'https://example.com/b' },
        ],
        FIXED_FORMAT
      );
      const lines = csv.replace(/^﻿/, '').split('\n');
      assert.equal(lines[1].split(',')[0], '较晚');
      assert.equal(lines[2].split(',')[0], '中间');
      assert.equal(lines[3].split(',')[0], '较早');
    },
  },
  {
    desc: 'buildArticlesCsv:标题含逗号/引号/换行正确转义',
    run: () => {
      const csv = buildArticlesCsv(
        [{ title: 'a,b "c"\nd', update_time: JUNE_15, link: 'https://example.com/x' }],
        FIXED_FORMAT
      );
      // 直接断言整段 CSV(行内换行会被保留在引号包裹的字段里,所以不能按 \n 切)
      assert.equal(csv, '﻿标题,发布日期,链接\n"a,b ""c""\nd",2025-06-15 00:00:00,https://example.com/x');
    },
  },
  {
    desc: 'buildArticlesCsv:中文标题正常保留(UTF-8)',
    run: () => {
      const csv = buildArticlesCsv(
        [{ title: '乌鲁木齐市团委公告', update_time: JUNE_15, link: 'https://mp.weixin.qq.com/s/abc' }],
        FIXED_FORMAT
      );
      assert.ok(csv.includes('乌鲁木齐市团委公告'));
      assert.ok(csv.startsWith('﻿')); // BOM
    },
  },
  {
    desc: 'buildArticlesCsv:update_time=0 视为未设置,日期列为空',
    run: () => {
      const csv = buildArticlesCsv([{ title: 'T', update_time: 0, link: 'L' }], FIXED_FORMAT);
      const lines = csv.replace(/^﻿/, '').split('\n');
      assert.equal(lines[1], 'T,,L');
    },
  },
  {
    desc: 'buildArticlesCsv:不传 formatDate 时使用默认本地时区格式化器',
    run: () => {
      // 只验证函数存在且不抛错
      assert.equal(typeof defaultCsvDateFormatter, 'function');
      assert.equal(defaultCsvDateFormatter(0), '');
      assert.notEqual(defaultCsvDateFormatter(JUNE_15), '');
    },
  },
  {
    desc: 'buildArticlesCsv:输入数组不被修改(slice 拷贝)',
    run: () => {
      const input = [
        { title: 'A', update_time: JUNE_1, link: 'a' },
        { title: 'B', update_time: JUNE_30, link: 'b' },
      ];
      const before = JSON.stringify(input);
      buildArticlesCsv(input, FIXED_FORMAT);
      const after = JSON.stringify(input);
      assert.equal(before, after, '输入数组不应被修改');
    },
  },
];

function run() {
  let passed = 0;
  let failed = 0;
  for (const c of CASES) {
    try {
      c.run();
      console.log(`✓ ${c.desc}`);
      passed++;
    } catch (err) {
      console.error(`✗ ${c.desc}`);
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
