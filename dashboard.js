import { fileURLToPath } from 'node:url';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

for (const weight of ['Regular', 'Medium', 'SemiBold']) {
  GlobalFonts.registerFromPath(fileURLToPath(new URL(`./fonts/Poppins-${weight}.ttf`, import.meta.url)), 'Poppins');
}

const font = 'Poppins';
const pixelRatio = 2;
const width = 1200;
const padding = 32;
const gap = 16;
const radius = 16;
const tileHeight = 148;
const tableWidth = 540;
const rowHeight = 70;
const minChartHeight = 380;

const page = '#0d0d0d';
const surface = '#1a1a19';
const ink = {
  primary: '#f0efec',
  secondary: '#c3c2b7',
  muted: '#898781',
  grid: '#2c2c2a',
  baseline: '#383835',
  border: 'rgba(255, 255, 255, 0.08)',
};
const status = { up: '#0ca30c', down: '#d03b3b' };

export const colors = {
  total: ink.primary,
  projects: ['#3987e5', '#199e70'],
  community: '#d95926',
  other: ink.muted,
};

Chart.defaults.font.family = font;
Chart.defaults.color = ink.secondary;

const numberFormat = Intl.NumberFormat('pl', { maximumFractionDigits: 0 });
const compactFormat = Intl.NumberFormat('pl', { notation: 'compact' });
const changeFormat = Intl.NumberFormat('pl', { style: 'percent', maximumFractionDigits: 1, signDisplay: 'never' });
const shareFormat = Intl.NumberFormat('pl', { style: 'percent', maximumFractionDigits: 1 });
const dateFormat = Intl.DateTimeFormat('pl', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Warsaw' });
const timeFormat = Intl.DateTimeFormat('pl', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' });

function setFont(ctx, size, weight) {
  ctx.font = `${weight} ${size}px ${font}`;
}

function measure(ctx, value, size, weight = 400) {
  setFont(ctx, size, weight);

  return ctx.measureText(value).width;
}

function drawText(ctx, value, x, y, { size, weight = 400, color = ink.primary, align = 'left' }) {
  setFont(ctx, size, weight);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(value, x, y);
}

function fitText(ctx, value, maxWidth, size, weight) {
  if (measure(ctx, value, size, weight) <= maxWidth) {
    return value;
  }

  let fitted = value;
  while (fitted.length > 1 && measure(ctx, `${fitted}…`, size, weight) > maxWidth) {
    fitted = fitted.slice(0, -1);
  }

  return `${fitted.trimEnd()}…`;
}

function wrapText(ctx, value, maxWidth, size, weight) {
  const lines = [];
  let line = '';
  for (const word of value.split(' ')) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && measure(ctx, candidate, size, weight) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) {
    lines.push(line);
  }

  return lines;
}

function drawCard(ctx, x, y, w, h) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fillStyle = surface;
  ctx.fill();
  ctx.strokeStyle = ink.border;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawSwatch(ctx, x, y, size, color) {
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, 3);
  ctx.fillStyle = color;
  ctx.fill();
}

function drawTriangle(ctx, x, baseline, size, direction, color) {
  const half = size / 2;
  const top = baseline - size * 0.72;
  const bottom = baseline - size * 0.08;
  ctx.beginPath();
  if (direction > 0) {
    ctx.moveTo(x, bottom);
    ctx.lineTo(x + half, top);
    ctx.lineTo(x + size, bottom);
  } else {
    ctx.moveTo(x, top);
    ctx.lineTo(x + half, bottom);
    ctx.lineTo(x + size, top);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawChange(ctx, x, baseline, { current, previous }, { size, align = 'left', withPrevious = false }) {
  const parts = [];
  if (previous > 0) {
    const change = (current - previous) / previous;
    const direction = Math.sign(change);
    const color = direction > 0 ? status.up : direction < 0 ? status.down : ink.muted;
    if (direction !== 0) {
      parts.push({ triangle: direction, color, width: size * 0.7 + size * 0.3 });
    }
    parts.push({ text: changeFormat.format(change), color, weight: 500 });
  }
  if (withPrevious || previous === 0) {
    parts.push({ text: `${parts.length > 0 ? '  ' : ''}vs ${numberFormat.format(previous)}`, color: ink.muted, weight: 400 });
  }

  for (const part of parts) {
    part.width ??= measure(ctx, part.text, size, part.weight);
  }
  const total = parts.reduce((sum, part) => sum + part.width, 0);
  let cursor = align === 'right' ? x - total : x;
  for (const part of parts) {
    if (part.triangle) {
      drawTriangle(ctx, cursor, baseline, size * 0.7, part.triangle, part.color);
    } else {
      drawText(ctx, part.text, cursor, baseline, { size, weight: part.weight, color: part.color });
    }
    cursor += part.width;
  }
}

function drawHeader(ctx, to) {
  const baseline = padding + 36;
  drawText(ctx, 'myPolitics', padding, baseline, { size: 30, weight: 600 });
  drawText(ctx, 'raport dzienny', padding + measure(ctx, 'myPolitics ', 30, 600), baseline, { size: 30, color: ink.secondary });
  drawText(ctx, `${dateFormat.format(to)} · ${timeFormat.format(to)}`, width - padding, baseline, { size: 18, color: ink.secondary, align: 'right' });
}

function drawTotalTile(ctx, x, y, w, period) {
  drawCard(ctx, x, y, w, tileHeight);
  drawText(ctx, `Wszystkie quizy · ${period.label}`, x + 20, y + 36, { size: 16, weight: 500, color: ink.secondary });
  drawText(ctx, numberFormat.format(period.current), x + 20, y + 94, { size: 48, weight: 600 });
  drawChange(ctx, x + 20, y + 128, period, { size: 17, withPrevious: true });
}

function drawShareTile(ctx, x, y, w, { official, community }, days) {
  drawCard(ctx, x, y, w, tileHeight);
  drawText(ctx, `Udział społecznościowych · ${days} dni`, x + 20, y + 36, { size: 16, weight: 500, color: ink.secondary });

  const total = official + community;
  const ringRadius = 40;
  const ringWidth = 14;
  const centerX = x + 20 + ringRadius;
  const centerY = y + 94;
  const slices = [
    { value: community, color: colors.community },
    { value: official, color: colors.other },
  ].filter(slice => slice.value > 0);
  ctx.lineWidth = ringWidth;
  if (slices.length < 2) {
    ctx.beginPath();
    ctx.arc(centerX, centerY, ringRadius - ringWidth / 2, 0, Math.PI * 2);
    ctx.strokeStyle = slices[0]?.color ?? ink.grid;
    ctx.stroke();
  } else {
    let angle = -Math.PI / 2;
    for (const slice of slices) {
      const sweep = (slice.value / total) * Math.PI * 2;
      const spacer = Math.min(0.03, sweep / 4);
      ctx.beginPath();
      ctx.arc(centerX, centerY, ringRadius - ringWidth / 2, angle + spacer, angle + sweep - spacer);
      ctx.strokeStyle = slice.color;
      ctx.stroke();
      angle += sweep;
    }
  }

  const textX = centerX + ringRadius + 20;
  drawText(ctx, total > 0 ? shareFormat.format(community / total) : '—', textX, y + 86, { size: 30, weight: 600 });
  [
    { label: 'Społecznościowe', value: community, color: colors.community },
    { label: 'Oficjalne', value: official, color: colors.other },
  ].forEach((entry, index) => {
    const baseline = y + 110 + index * 20;
    drawSwatch(ctx, textX, baseline - 10, 10, entry.color);
    drawText(ctx, `${entry.label} ${numberFormat.format(entry.value)}`, textX + 16, baseline, { size: 14, color: ink.secondary });
  });
}

function tableHeight(ctx, rows, archived) {
  let height = 58 + rows.length * rowHeight + 12;
  if (archived) {
    height += wrapText(ctx, archived, tableWidth - 40, 13, 400).length * 18 + 10;
  }

  return height;
}

function drawTable(ctx, x, y, h, rows, archived, periodLabels) {
  drawCard(ctx, x, y, tableWidth, h);
  drawText(ctx, 'Projekty', x + 20, y + 38, { size: 18, weight: 600 });

  const columnWidth = 84;
  const columnRight = (index) => x + tableWidth - 20 - (periodLabels.length - 1 - index) * columnWidth;
  periodLabels.forEach((label, index) => {
    drawText(ctx, label, columnRight(index), y + 38, { size: 14, weight: 500, color: ink.muted, align: 'right' });
  });

  const nameWidth = columnRight(0) - columnWidth + 16 - (x + 38);
  rows.forEach((row, rowIndex) => {
    const top = y + 58 + rowIndex * rowHeight;
    ctx.fillStyle = ink.grid;
    ctx.fillRect(x + 20, top, tableWidth - 40, 1);

    drawSwatch(ctx, x + 20, top + 17, 11, row.color);
    drawText(ctx, fitText(ctx, row.name, nameWidth, 18, 500), x + 38, top + 28, { size: 18, weight: 500 });
    if (row.note) {
      drawText(ctx, fitText(ctx, row.note, nameWidth, 13, 400), x + 38, top + 52, { size: 13, color: ink.muted });
    }

    row.periods.forEach((period, index) => {
      drawText(ctx, numberFormat.format(period.current), columnRight(index), top + 28, { size: 19, weight: 600, align: 'right' });
      drawChange(ctx, columnRight(index), top + 52, period, { size: 14, align: 'right' });
    });
  });

  if (archived) {
    const lines = wrapText(ctx, archived, tableWidth - 40, 13, 400);
    const top = y + h - 12 - lines.length * 18 - 10;
    ctx.fillStyle = ink.grid;
    ctx.fillRect(x + 20, top, tableWidth - 40, 1);
    lines.forEach((line, index) => {
      drawText(ctx, line, x + 20, top + 26 + index * 18, { size: 13, color: ink.muted });
    });
  }
}

function renderTrendChart(w, h, labels, lines) {
  const canvas = createCanvas(w, h);
  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: lines.map((line) => ({
        label: line.label,
        data: line.data,
        borderColor: line.color,
        backgroundColor: line.color,
        borderWidth: line.width ?? 2,
        borderJoinStyle: 'round',
        borderCapStyle: 'round',
        pointRadius: (context) => (context.dataIndex === line.data.length - 1 ? 4 : 0),
        pointBorderColor: surface,
        pointBorderWidth: 2,
      })),
    },
    options: {
      responsive: false,
      animation: false,
      devicePixelRatio: pixelRatio,
      layout: { padding: { top: 0, right: 12, bottom: 4, left: 4 } },
      plugins: {
        legend: {
          position: 'top',
          align: 'start',
          labels: { boxWidth: 16, boxHeight: 3, padding: 14, font: { size: 14 } },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: ink.baseline },
          ticks: { color: ink.muted, font: { size: 13 }, maxRotation: 0, autoSkipPadding: 20 },
        },
        y: {
          beginAtZero: true,
          grid: { color: ink.grid },
          border: { display: false },
          ticks: {
            color: ink.muted,
            font: { size: 13 },
            maxTicksLimit: 5,
            callback: (value) => (value < 10000 ? numberFormat : compactFormat).format(value),
          },
        },
      },
    },
  });

  return { canvas, chart };
}

function drawTrend(ctx, x, y, w, h, trend) {
  drawCard(ctx, x, y, w, h);
  drawText(ctx, 'Trend', x + 20, y + 38, { size: 18, weight: 600 });
  drawText(ctx, trend.title, x + 20 + measure(ctx, 'Trend  ', 18, 600), y + 38, { size: 14, color: ink.muted });

  const { canvas, chart } = renderTrendChart(w - 24, h - 64, trend.labels, trend.lines);
  ctx.drawImage(canvas, x + 12, y + 52, w - 24, h - 64);
  chart.destroy();
}

export function renderDashboard(report) {
  const measuring = createCanvas(1, 1).getContext('2d');
  const tableCardHeight = tableHeight(measuring, report.rows, report.archived);
  const contentHeight = Math.max(tableCardHeight, minChartHeight);
  const contentTop = padding + 64 + tileHeight + gap;
  const height = contentTop + contentHeight + padding;

  const canvas = createCanvas(width * pixelRatio, height * pixelRatio);
  const ctx = canvas.getContext('2d');
  ctx.scale(pixelRatio, pixelRatio);
  ctx.fillStyle = page;
  ctx.fillRect(0, 0, width, height);

  drawHeader(ctx, report.to);

  const tileTop = padding + 64;
  const shareWidth = 320;
  const tileWidth = (width - padding * 2 - shareWidth - gap * report.totals.length) / report.totals.length;
  report.totals.forEach((period, index) => {
    drawTotalTile(ctx, padding + index * (tileWidth + gap), tileTop, tileWidth, period);
  });
  drawShareTile(ctx, width - padding - shareWidth, tileTop, shareWidth, report.share, report.shareDays);

  drawTable(ctx, padding, contentTop, contentHeight, report.rows, report.archived, report.totals.map(period => period.label));
  drawTrend(ctx, padding + tableWidth + gap, contentTop, width - padding * 2 - tableWidth - gap, contentHeight, report.trend);

  return canvas.toBuffer('image/png');
}
