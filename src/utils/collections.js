export function groupBy(items, getKey) {
  return items.reduce((map, item) => {
    const key = getKey(item);
    const bucket = map.get(key) ?? [];
    bucket.push(item);
    map.set(key, bucket);
    return map;
  }, new Map());
}
