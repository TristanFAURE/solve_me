import { WEDDING_TABLE_SHAPES } from './tableTopology.js';

const SHAPES = new Set(Object.values(WEDDING_TABLE_SHAPES));
const MAX_POSITIONS = 1000;

export function normalizeWeddingTableShape(shape) {
  return SHAPES.has(shape) ? shape : WEDDING_TABLE_SHAPES.ROUND;
}

function finitePercent(value) {
  return Math.round(Math.min(92, Math.max(8, Number.isFinite(value) ? value : 50)) * 1000) / 1000;
}

function rectanglePosition(index, count, shape) {
  if (count === 1) return { x: 50, y: 8, side: 'top' };
  if (count === 2) return index === 0 ? { x: 50, y: 8, side: 'top' } : { x: 50, y: 92, side: 'bottom' };
  const width = shape === WEDDING_TABLE_SHAPES.RECTANGLE ? 84 : 72;
  const height = shape === WEDDING_TABLE_SHAPES.RECTANGLE ? 52 : 72;
  const left = (100 - width) / 2;
  const top = (100 - height) / 2;
  const perimeter = (2 * width) + (2 * height);
  let distance = ((index / count) * perimeter) + (width / (count + 1));
  distance %= perimeter;
  if (distance < width) return { x: left + distance, y: top, side: 'top' };
  distance -= width;
  if (distance < height) return { x: left + width, y: top + distance, side: 'right' };
  distance -= height;
  if (distance < width) return { x: left + width - distance, y: top + height, side: 'bottom' };
  distance -= width;
  return { x: left, y: top + height - distance, side: 'left' };
}

export function getDisplayPosition(shape, index, count) {
  if (!Number.isInteger(count) || count < 1 || count > MAX_POSITIONS || !Number.isInteger(index) || index < 0 || index >= count) {
    return { x: 50, y: 50, side: 'center' };
  }
  const normalizedShape = normalizeWeddingTableShape(shape);
  let position;
  if (normalizedShape === WEDDING_TABLE_SHAPES.ROUND) {
    const angle = (-Math.PI / 2) + ((2 * Math.PI * index) / count);
    position = { x: 50 + (42 * Math.cos(angle)), y: 50 + (42 * Math.sin(angle)), side: 'perimeter' };
  } else {
    position = rectanglePosition(index, count, normalizedShape);
  }
  return { x: finitePercent(position.x), y: finitePercent(position.y), side: position.side };
}

export function getTableDisplayGeometry(shape, count) {
  const normalizedShape = normalizeWeddingTableShape(shape);
  const safeCount = Number.isInteger(count) && count > 0 && count <= MAX_POSITIONS ? count : 0;
  return {
    shape: normalizedShape,
    positions: Array.from({ length: safeCount }, (_, index) => getDisplayPosition(normalizedShape, index, safeCount)),
  };
}
