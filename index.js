import fetch, { Blob, FormData } from 'node-fetch';
import dotenv from 'dotenv';
import { colors, renderShareChart, renderTrendChart } from './charts.js';

dotenv.config();

const baseApiUrl = process.env.MYPOLITICS_API_URL;
const allowedUserAgent = process.env.ALLOWED_USER_AGENT;
const projectListUrl = `${baseApiUrl}/api/v1/project`;
const projectUrl = (projectId) => `${baseApiUrl}/api/v1/project/${projectId}`;
const surveyStatsUrl = (surveyId) => `${baseApiUrl}/api/v1/survey/${surveyId}/stats`;
const dailyStatsUrl = `${baseApiUrl}/api/v1/survey/stats/daily`;

const dayInMilliseconds = 24 * 60 * 60 * 1000;
const trendDays = 90;
const shareDays = 30;
const periods = [
  { label: "Ostatnie 24h", days: 1 },
  { label: "Ostatnie 7 dni", days: 7 },
  { label: "Ostatnie 30 dni", days: 30 },
];

const numberFormat = Intl.NumberFormat("pl");
const changeFormat = Intl.NumberFormat("pl", { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" });
const shareFormat = Intl.NumberFormat("pl", { style: "percent", maximumFractionDigits: 1 });
const dateFormat = Intl.DateTimeFormat("pl", { day: "numeric", month: "numeric", timeZone: "Europe/Warsaw" });


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

async function sendMessageToDiscord(content, charts) {
  const form = new FormData();
  form.append('payload_json', JSON.stringify({
    content,
    embeds: charts.map((chart) => ({ title: chart.title, image: { url: `attachment://${chart.filename}` } })),
    attachments: charts.map((chart, index) => ({ id: index, filename: chart.filename })),
  }));
  charts.forEach((chart, index) => {
    form.append(`files[${index}]`, new Blob([chart.image], { type: 'image/png' }), chart.filename);
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

function formatChange(current, previous) {
  if (previous === 0) {
    return `(vs ${numberFormat.format(previous)})`;
  }

  const change = (current - previous) / previous;
  const arrow = change > 0 ? "▲" : change < 0 ? "▼" : "▬";

  return `(${arrow} ${changeFormat.format(change)} vs ${numberFormat.format(previous)})`;
}

function formatPeriods(counts) {
  let content = "";
  for (const period of periods) {
    const current = sumLastDays(counts, period.days);
    const previous = sumLastDays(counts, period.days, period.days);
    content += `*${period.label}:* **${numberFormat.format(current)}** ${formatChange(current, previous)}\n`;
  }

  return content;
}

function buildTrendLines(totalCounts, officialProjects, communityCounts) {
  const lines = [{ label: "Wszystkie", data: totalCounts, color: colors.total, width: 3 }];
  const activeProjects = officialProjects.filter(project => project.counts);
  const featuredProjects = [...activeProjects]
    .sort((a, b) => sumLastDays(b.counts, trendDays) - sumLastDays(a.counts, trendDays))
    .slice(0, colors.projects.length);

  activeProjects
    .filter(project => featuredProjects.includes(project))
    .forEach((project, index) => {
      lines.push({ label: project.name, data: project.counts, color: colors.projects[index] });
    });

  const otherProjects = activeProjects.filter(project => !featuredProjects.includes(project));
  if (otherProjects.length > 0) {
    lines.push({ label: "Pozostałe oficjalne", data: sumCounts(otherProjects), color: colors.other });
  }
  if (communityCounts) {
    lines.push({ label: "Społecznościowe", data: communityCounts, color: colors.community });
  }

  return lines;
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
  const totalCounts = sumCounts(dailyStats.series);
  const communityCounts = sumCounts(communitySeries);


  let content = "**Wszystkie quizy**\n";
  content += formatPeriods(totalCounts);
  content += '\n';

  for (const project of officialProjects) {
    content += `**${project.name}**\n`;
    if (project.lastSurvey) {
      content += `*Ostatnie 60m:* **${project.lastSurvey.last.hour}**\n`;
    }
    if (project.counts) {
      content += formatPeriods(project.counts);
    }
    content += `*Razem:* **${numberFormat.format(project.totalSolvedSurveys)}**\n`;

    content += '\n';
  }

  if (communitySeries.length > 0) {
    content += "**Quizy społecznościowe**\n";
    content += formatPeriods(communityCounts);
    content += '\n';
  }

  const to = new Date(dailyStats.to).getTime();
  const labels = totalCounts.map((_, index) => dateFormat.format(new Date(to - (trendDays - 1 - index) * dayInMilliseconds)));
  const charts = [{
    title: `Trend z ostatnich ${trendDays} dni`,
    filename: 'trend.png',
    image: renderTrendChart(labels, buildTrendLines(totalCounts, officialProjects, communitySeries.length > 0 ? communityCounts : null)),
  }];

  const officialShare = sumLastDays(sumCounts(officialSeries), shareDays);
  const communityShare = sumLastDays(communityCounts, shareDays);
  const shareTotal = officialShare + communityShare;
  if (shareTotal > 0) {
    const formatSlice = (label, value) => `${label}: ${numberFormat.format(value)} (${shareFormat.format(value / shareTotal)})`;
    charts.push({
      title: `Quizy oficjalne i społecznościowe z ostatnich ${shareDays} dni`,
      filename: 'share.png',
      image: renderShareChart(
        [
          { label: formatSlice("Oficjalne", officialShare), value: officialShare, color: colors.other },
          { label: formatSlice("Społecznościowe", communityShare), value: communityShare, color: colors.community },
        ],
        shareFormat.format(communityShare / shareTotal),
        "społecznościowe",
      ),
    });
  }

  await sendMessageToDiscord(content.trimEnd(), charts);
  console.log("✅ Message sent!");
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
