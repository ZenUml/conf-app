// Groups are indivisible: a file may contain serial suites or shared state.
// Unknown and invalid estimates use a fixed default rather than zero.
export function balanceGroups(groups, shardCount, estimates, defaultDuration) {
  const duration = test => {
    const value = estimates[`${test.project}:${test.file}`];
    return Number.isFinite(value) && value > 0 ? value : defaultDuration;
  };
  const ordered = groups.map((tests, index) => ({ tests, index, duration: tests.reduce((sum, test) => sum + duration(test), 0) }))
    .sort((a, b) => b.duration - a.duration || a.index - b.index);
  const buckets = Array.from({ length: Math.min(Math.max(1, Number(shardCount) || 1), groups.length) }, () => ({ tests: [], duration: 0 }));
  for (const group of ordered) {
    const bucket = buckets.reduce((best, candidate) => candidate.duration < best.duration ? candidate : best);
    bucket.tests.push(...group.tests);
    bucket.duration += group.duration;
  }
  return buckets.map(bucket => bucket.tests);
}
