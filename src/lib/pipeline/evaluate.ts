export type IntentLabel = "buyer" | "seller" | "ad" | "chat" | "unknown";
export function classificationMetrics(rows: { expected: IntentLabel; predicted: IntentLabel }[]) {
  const labels: IntentLabel[] = ["buyer", "seller", "ad", "chat", "unknown"];
  return {
    count: rows.length,
    accuracy: rows.length ? rows.filter(row => row.expected === row.predicted).length / rows.length : null,
    byIntent: Object.fromEntries(labels.map(label => {
      const tp = rows.filter(row => row.expected === label && row.predicted === label).length;
      const fp = rows.filter(row => row.expected !== label && row.predicted === label).length;
      const fn = rows.filter(row => row.expected === label && row.predicted !== label).length;
      return [label, { tp, fp, fn, precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null }];
    })),
  };
}
