export const HEATMAP_COLORS = ["#FFFFB2", "#FECC5C", "#FD8D3C", "#F03B20", "#BD0026"];

export function heatmapPlugin(timestamps, unitNames, values) {
  const count = timestamps.length;
  const unitCount = unitNames.length;

  return {
    hooks: {
      draw: (u) => {
        const { ctx } = u;
        const interval = timestamps.length > 1 ? timestamps[1] - timestamps[0] : 0;
        if (interval === 0 || unitCount === 0) return;

        const rawCellH = Math.floor(u.bbox.height / unitCount);
        const minCellH = 16;
        const cellH = Math.max(minCellH, rawCellH);
        const gap = rawCellH >= minCellH + 2 ? 2 : (rawCellH >= minCellH + 1 ? 1 : 0);
        const drawH = cellH - gap;

        ctx.save();
        ctx.beginPath();
        ctx.rect(u.bbox.left, u.bbox.top, u.bbox.width, u.bbox.height);
        ctx.clip();

        for (let xi = 0; xi < count; xi++) {
          const colStart = u.valToPos(timestamps[xi], "x", true);
          const colEnd = xi < count - 1
            ? u.valToPos(timestamps[xi + 1], "x", true)
            : colStart + (timestamps.length > 1 ? timestamps[1] - timestamps[0] : 0);

          const xPos = Math.round(colStart);
          const xEnd = Math.round(colEnd);
          const drawW = Math.max(1, xEnd - xPos);

          const row = values[xi];
          if (!row) continue;
          if (xPos + drawW < u.bbox.left || xPos > u.bbox.left + u.bbox.width) continue;

          for (let yi = 0; yi < unitCount; yi++) {
            const val = row[yi];
            if (val == null) continue;
            const yPos = Math.round(u.valToPos(yi, "y", true) - cellH / 2);
            if (yPos + drawH < u.bbox.top || yPos > u.bbox.top + u.bbox.height) continue;

            const ci = Math.min(HEATMAP_COLORS.length - 1, Math.floor(val / 100 * HEATMAP_COLORS.length));
            ctx.fillStyle = HEATMAP_COLORS[ci];
            ctx.fillRect(xPos, yPos, drawW, drawH);
          }
        }

        ctx.restore();
      },
    },
  };
}
