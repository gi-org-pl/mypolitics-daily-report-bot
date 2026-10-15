import { createCanvas } from '@napi-rs/canvas';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

const surface = '#1a1a19';
const ink = {
  primary: '#f0efec',
  secondary: '#c3c2b7',
  muted: '#898781',
  grid: '#2c2c2a',
  baseline: '#383835',
};

export const colors = {
  total: ink.primary,
  projects: ['#3987e5', '#199e70'],
  community: '#d95926',
  other: ink.muted,
};

Chart.defaults.font.family = "'Helvetica Neue', Helvetica, Arial, 'DejaVu Sans', 'Liberation Sans', sans-serif";
Chart.defaults.color = ink.secondary;

const numberFormat = Intl.NumberFormat('pl', { maximumFractionDigits: 0 });
const compactFormat = Intl.NumberFormat('pl', { notation: 'compact' });

const background = {
  id: 'background',
  beforeDraw(chart) {
    const { ctx, width, height } = chart;
    ctx.save();
    ctx.fillStyle = surface;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  },
};

function render(width, height, config) {
  const canvas = createCanvas(width, height);
  const chart = new Chart(canvas, {
    ...config,
    options: { ...config.options, responsive: false, animation: false, devicePixelRatio: 2 },
    plugins: [background, ...(config.plugins ?? [])],
  });
  const png = canvas.toBuffer('image/png');
  chart.destroy();

  return png;
}

export function renderTrendChart(labels, lines, title) {
  return render(600, 340, {
    type: 'line',
    data: {
      labels,
      datasets: lines.map((line) => ({
        label: line.label,
        data: line.data,
        borderColor: line.color,
        backgroundColor: line.color,
        borderWidth: line.width ?? 2.5,
        borderJoinStyle: 'round',
        borderCapStyle: 'round',
        pointRadius: (context) => (context.dataIndex === line.data.length - 1 ? 4 : 0),
        pointBorderColor: surface,
        pointBorderWidth: 2,
      })),
    },
    options: {
      layout: { padding: { top: 12, right: 20, bottom: 8, left: 8 } },
      plugins: {
        title: {
          display: true,
          text: title,
          align: 'start',
          color: ink.primary,
          font: { size: 17, weight: '600' },
          padding: { top: 0, bottom: 4 },
        },
        legend: {
          position: 'top',
          align: 'start',
          labels: { boxWidth: 18, boxHeight: 3, padding: 14, font: { size: 15 } },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: ink.baseline },
          ticks: { color: ink.muted, font: { size: 14 }, maxRotation: 0, autoSkipPadding: 20 },
        },
        y: {
          beginAtZero: true,
          grid: { color: ink.grid },
          border: { display: false },
          ticks: {
            color: ink.muted,
            font: { size: 14 },
            maxTicksLimit: 5,
            callback: (value) => (value < 10000 ? numberFormat : compactFormat).format(value),
          },
        },
      },
    },
  });
}

export function renderShareChart(slices, centerValue, centerLabel) {
  const values = slices.map((slice) => slice.value);

  const center = {
    id: 'center',
    afterDraw(chart) {
      const { x, y } = chart.getDatasetMeta(0).data[0];
      const { ctx } = chart;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = ink.primary;
      ctx.font = `600 34px ${Chart.defaults.font.family}`;
      ctx.fillText(centerValue, x, y - 10);
      ctx.fillStyle = ink.secondary;
      ctx.font = `15px ${Chart.defaults.font.family}`;
      ctx.fillText(centerLabel, x, y + 20);
      ctx.restore();
    },
  };

  return render(600, 280, {
    type: 'doughnut',
    data: {
      labels: slices.map((slice) => slice.label),
      datasets: [{
        data: values,
        backgroundColor: slices.map((slice) => slice.color),
        borderColor: surface,
        borderWidth: values.every((value) => value > 0) ? 2 : 0,
      }],
    },
    options: {
      cutout: '68%',
      layout: { padding: 16 },
      plugins: {
        legend: {
          position: 'right',
          labels: { boxWidth: 14, boxHeight: 14, padding: 16, font: { size: 16 } },
        },
      },
    },
    plugins: [center],
  });
}
