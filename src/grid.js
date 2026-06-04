// Uniform spatial hash over the toroidal world. Entities are bucketed into
// fixed-size cells so a neighbour query only has to scan a small window of
// cells around a point instead of the whole population — turning per-creature
// "nearest" lookups from O(n) into roughly O(1). Cells wrap at the world edges
// to match the world's toroidal topology.

export class SpatialGrid {
  constructor(width, height, cellSize) {
    this.width = width;
    this.height = height;
    // At least one cell per axis; size the grid so cells tile the world
    // exactly (the effective cell size may differ slightly from `cellSize`).
    this.cols = Math.max(1, Math.floor(width / cellSize));
    this.rows = Math.max(1, Math.floor(height / cellSize));
    this.cellW = width / this.cols;
    this.cellH = height / this.rows;
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
  }

  _colOf(x) {
    let c = Math.floor(x / this.cellW);
    if (c < 0) c = 0;
    else if (c >= this.cols) c = this.cols - 1;
    return c;
  }

  _rowOf(y) {
    let r = Math.floor(y / this.cellH);
    if (r < 0) r = 0;
    else if (r >= this.rows) r = this.rows - 1;
    return r;
  }

  // Replace the grid's contents with `items` (each must have numeric x, y).
  rebuild(items) {
    for (const cell of this.cells) cell.length = 0;
    for (const item of items) {
      const idx = this._rowOf(item.y) * this.cols + this._colOf(item.x);
      this.cells[idx].push(item);
    }
  }

  // Invoke `fn(item)` for every item bucketed in a cell that overlaps the
  // square window of half-width `radius` around (x, y). It may visit items
  // slightly outside `radius` — the caller does the precise distance test.
  // The window wraps toroidally and never visits a cell twice.
  forEachNear(x, y, radius, fn) {
    const { cols, rows, cells } = this;
    const reachC = Math.ceil(radius / this.cellW);
    const reachR = Math.ceil(radius / this.cellH);
    // If the window spans the whole axis, walk every index once rather than
    // wrapping (which would revisit cells).
    const fullC = 2 * reachC + 1 >= cols;
    const fullR = 2 * reachR + 1 >= rows;
    const col = this._colOf(x);
    const row = this._rowOf(y);

    const rStart = fullR ? 0 : -reachR;
    const rEnd = fullR ? rows - 1 : reachR;
    const cStart = fullC ? 0 : -reachC;
    const cEnd = fullC ? cols - 1 : reachC;

    for (let dr = rStart; dr <= rEnd; dr++) {
      const r = fullR ? dr : (((row + dr) % rows) + rows) % rows;
      const base = r * cols;
      for (let dc = cStart; dc <= cEnd; dc++) {
        const c = fullC ? dc : (((col + dc) % cols) + cols) % cols;
        const cell = cells[base + c];
        for (let i = 0; i < cell.length; i++) fn(cell[i]);
      }
    }
  }
}
