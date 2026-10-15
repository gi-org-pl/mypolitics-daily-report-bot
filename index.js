import fetch, { Blob, FormData } from 'node-fetch';
import dotenv from 'dotenv';
import { colors, renderDashboard } from './dashboard.js';

dotenv.config();

const baseApiUrl = process.env.MYPOLITICS_API_URL;
const allowedUserAgent = process.env.ALLOWED_USER_AGENT;
const projectListUrl = `${baseApiUrl}/api/v1/project`;
const projectUrl = (projectId) => `${baseApiUrl}/api/v1/project/${projectId}`;
const surveyStatsUrl = (surveyId) => `${baseApiUrl}/api/v1/survey/${surveyId}/stats`;
const dailyStatsUrl = `${baseApiUrl}/api/v1/survey/stats/daily`;

const dayInMilliseconds = 24 * 60 * 60 * 1000;
const trendDays = 90;
const averageDays = 7;
const shareDays = 30;
const periods = [
  { label: "24h", days: 1 },
  { label: "7 dni", days: 7 },
  { label: "30 dni", days: 30 },
];

const numberFormat = Intl.NumberFormat("pl");
const dateFormat = Intl.DateTimeFormat("pl", { day: "numeric", month: "numeric", timeZone: "Europe/Warsaw" });
const reportDateFormat = Intl.DateTimeFormat("pl", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Warsaw" });


async function fetchFromApi(url) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': allowedUserAgent,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
}

async function sendMessageToDiscord(content, files) {
  const form = new FormData();
  form.append('payload_json', JSON.stringify({
    content,
    attachments: files.map((file, index) => ({ id: index, filename: file.filename })),
  }));
  files.forEach((file, index) => {
    form.append(`files[${index}]`, new Blob([file.image], { type: 'image/png' }), file.filename);
  });

  const response = await fetch(process.env.DISCORD_WEBHOOK_URL, {
    method: 'POST',
    body: form
  });

  if (!response.ok) {
    throw new Error(`Failed to send message to Discord: ${response.statusText}`);
  }
}

function sumCounts(series) {
  const counts = new Array(trendDays).fill(0);
  for (const { counts: seriesCounts } of series) {
    seriesCounts.forEach((count, index) => { counts[index] += count; });
  }

  return counts;
}

function sumLastDays(counts, days, offset = 0) {
  return counts.slice(counts.length - offset - days, counts.length - offset).reduce((sum, count) => sum + count, 0);
}

function movingAverage(counts) {
  return counts.map((_, index) => (
    index < averageDays - 1 ? null : sumLastDays(counts, averageDays, counts.length - 1 - index) / averageDays
  ));
}

function shortName(name) {
  return name.replace(/^myPolitics\s+(Quiz\s+)?/, "");
}

function periodStats(counts) {
  return periods.map((period) => ({
    label: period.label,
    current: sumLastDays(counts, period.days),
    previous: sumLastDays(counts, period.days, period.days),
  }));
}

function assignColors(activeProjects) {
  const featuredProjects = [...activeProjects]
    .sort((a, b) => sumLastDays(b.counts, trendDays) - sumLastDays(a.counts, trendDays))
    .slice(0, colors.projects.length);

  activeProjects
    .filter(project => featuredProjects.includes(project))
    .forEach((project, index) => { project.color = colors.projects[index]; });
}

function buildTrendLines(totalCounts, activeProjects, communityCounts) {
  const lines = [{ label: "Wszystkie", data: movingAverage(totalCounts), color: colors.total, width: 3.5 }];
  for (const project of activeProjects.filter(project => project.color)) {
    lines.push({ label: shortName(project.name), data: movingAverage(project.counts), color: project.color });
  }

  const otherProjects = activeProjects.filter(project => !project.color);
  if (otherProjects.length > 0) {
    lines.push({ label: "Pozostałe oficjalne", data: movingAverage(sumCounts(otherProjects)), color: colors.other });
  }
  if (communityCounts) {
    lines.push({ label: "Społecznościowe", data: movingAverage(communityCounts), color: colors.community });
  }

  return lines;
}

function projectRow(project) {
  const note = [`razem ${numberFormat.format(project.totalSolvedSurveys)}`];
  if (project.lastSurvey) {
    note.unshift(`60 min: ${numberFormat.format(project.lastSurvey.last.hour)}`);
  }

  return {
    name: shortName(project.name),
    color: project.color ?? colors.other,
    note: note.join(" · "),
    periods: periodStats(project.counts),
  };
}

async function main() {
  const shortProjectList = await fetchFromApi(projectListUrl);
  const projects = await Promise.all(shortProjectList.map(project => fetchFromApi(projectUrl(project.id))));
  for (const project of projects) {
    if (project.surveys.length === 0) { continue; }

    const lastSurveyId = project.surveys[project.surveys.length - 1].id;
    project.lastSurvey = await fetchFromApi(surveyStatsUrl(lastSurveyId));
  }

  const dailyStats = await fetchFromApi(dailyStatsUrl);
  const officialSeries = dailyStats.series.filter(series => series.type === 'OFFICIAL');
  const communitySeries = dailyStats.series.filter(series => series.type === 'COMMUNITY');
  for (const project of projects) {
    const projectSeries = dailyStats.series.filter(series => series.projectId === project.id);
    project.isCommunity = projectSeries.length > 0 && projectSeries.every(series => series.type === 'COMMUNITY');
    if (projectSeries.length > 0) {
      project.counts = sumCounts(projectSeries.filter(series => series.type === 'OFFICIAL'));
    }
  }
  const officialProjects = projects.filter(project => !project.isCommunity);
  const activeProjects = officialProjects.filter(project => project.counts);
  const archivedProjects = officialProjects.filter(project => !project.counts);
  const totalCounts = sumCounts(dailyStats.series);
  const communityCounts = sumCounts(communitySeries);
  assignColors(activeProjects);


  const to = new Date(dailyStats.to);
  const labels = totalCounts.map((_, index) => dateFormat.format(new Date(to.getTime() - (trendDays - 1 - index) * dayInMilliseconds)));
  const rows = activeProjects.map(projectRow);
  if (communitySeries.length > 0) {
    rows.push({ name: "Społecznościowe", color: colors.community, note: "wszystkie quizy społecznościowe", periods: periodStats(communityCounts) });
  }

  const dashboard = renderDashboard({
    to,
    totals: periodStats(totalCounts),
    share: {
      official: sumLastDays(sumCounts(officialSeries), shareDays),
      community: sumLastDays(communityCounts, shareDays),
    },
    shareDays,
    rows,
    archived: archivedProjects.length > 0
      ? `Archiwalne: ${archivedProjects.map(project => `${shortName(project.name)} (${numberFormat.format(project.totalSolvedSurveys)})`).join(" · ")}`
      : null,
    trend: {
      title: `średnia ${averageDays}-dniowa z ostatnich ${trendDays} dni`,
      labels,
      lines: buildTrendLines(totalCounts, activeProjects, communitySeries.length > 0 ? communityCounts : null),
    },
  });

  await sendMessageToDiscord(`📊 Raport dzienny · ${reportDateFormat.format(to)}`, [{ filename: 'dashboard.png', image: dashboard }]);
  console.log("✅ Message sent!");
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
