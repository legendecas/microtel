'use strict';

// Renders a markdown table comparing two `--bench-reporter=json` outputs:
//
//   node scripts/compare-benchmarks.js base.ndjson head.ndjson
//
// The input may come from untrusted pull request code, so benchmark names
// are escaped before they are written into the markdown.

const { readFileSync } = require('node:fs');

function readResults(file) {
  const results = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    const { type, data } = JSON.parse(line);
    if (type !== 'bench:complete') continue;
    let key = data.namePath.join(' > ');
    if (Object.keys(data.params).length > 0) {
      key += ` ${JSON.stringify(data.params)}`;
    }
    results.set(key, data.summary);
  }
  return results;
}

const escape = (text) =>
  String(text)
    .replace(/[\r\n]+/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\|/g, '\\|');

const formatRate = (rate) =>
  rate.toLocaleString('en-US', { maximumSignificantDigits: 4 });

// The mean rate with the half width of its 95% confidence interval.
function formatSummary(summary) {
  if (!summary) return '-';
  const { mean, confidenceInterval } = summary;
  const margin = ((confidenceInterval.upper - mean) / mean) * 100;
  return `${formatRate(mean)} ±${margin.toFixed(1)}%`;
}

// A change counts as significant when the 95% confidence intervals of
// the two means do not overlap.
function compare(name, base, head) {
  if (!base || !head) return { name, base, head, change: null };
  return {
    name,
    base,
    head,
    change: ((head.mean - base.mean) / base.mean) * 100,
    significant:
      head.confidenceInterval.lower > base.confidenceInterval.upper ||
      head.confidenceInterval.upper < base.confidenceInterval.lower,
  };
}

function formatChange({ change, significant }) {
  if (change === null) return '-';
  const text = `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`;
  if (!significant) return text;
  return `**${text}** ${change > 0 ? ':green_circle:' : ':red_circle:'}`;
}

function formatTable(rows) {
  const lines = [
    '| Benchmark | main (ops/s) | PR (ops/s) | Change |',
    '| --- | ---: | ---: | ---: |',
  ];
  for (const row of rows) {
    const cells = [
      escape(row.name),
      formatSummary(row.base),
      formatSummary(row.head),
      formatChange(row),
    ];
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

const [baseFile, headFile] = process.argv.slice(2);
const base = readResults(baseFile);
const head = readResults(headFile);
const names = [...new Set([...base.keys(), ...head.keys()])];
const rows = names.map((name) => compare(name, base.get(name), head.get(name)));
const significant = rows
  .filter((row) => row.significant)
  .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

// The full table is collapsed so that significant changes stay visible
// however many benchmarks there are.
console.log(
  [
    significant.length > 0
      ? formatTable(significant)
      : 'No significant changes.',
    '',
    '<details>',
    `<summary>All ${rows.length} benchmarks</summary>`,
    '',
    formatTable(rows),
    '',
    '</details>',
    '',
    'Rates are means with the half width of their 95% confidence interval.',
    'A bold change means the two confidence intervals do not overlap.',
  ].join('\n'),
);
