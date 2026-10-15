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
const averageDays = 7;
const shareDays = 30;
const periods = [
  { label: "24h", days: 1 },
  { label: "7 dni", days: 7 },
  { label: "30 dni", days: 30 },
];

const numberFormat = Intl.NumberFormat("pl");
const changeFormat = Intl.NumberFormat("pl", { style: "percent", maximumFractionDigits: 1, signDisplay: "never" });
const shareFormat = Intl.NumberFormat("pl", { style: "percent", maximumFractionDigits: 1 });
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

async function sendMessageToDiscord(content, embeds, files) {
  const form = new FormData();
  form.append('payload_json', JSON.stringify({
    content,
    embeds,
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

function embedColor(hex) {
  return parseInt(hex.slice(1), 16);
}

function formatChange(current, previous) {
  if (previous === 0) {
    return `⚪ —\nvs ${numberFormat.format(previous)}`;
  }

  const change = (current - previous) / previous;
  const indicator = change > 0 ? "🟢 ▲" : change < 0 ? "🔴 ▼" : "⚪ ▬";

  return `${indicator} ${changeFormat.format(change)}\nvs ${numberFormat.format(previous)}`;
}

function periodFields(counts) {
  return periods.map((period) => {
    const current = sumLastDays(counts, period.days);
    const previous = sumLastDays(counts, period.days, period.days);

    return { name: period.label, value: `**${numberFormat.format(current)}**\n${formatChange(current, previous)}`, inline: true };
  });
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

function projectEmbed(project) {
  const footer = [`Razem: ${numberFormat.format(project.totalSolvedSurveys)}`];
  if (project.lastSurvey) {
    footer.unshift(`Ostatnie 60 min: ${numberFormat.format(project.lastSurvey.last.hour)}`);
  }

  return {
    title: shortName(project.name),
    color: embedColor(project.color ?? colors.other),
    fields: periodFields(project.counts),
    footer: { text: footer.join(" · ") },
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


  const to = new Date(dailyStats.to).getTime();
  const labels = totalCounts.map((_, index) => dateFormat.format(new Date(to - (trendDays - 1 - index) * dayInMilliseconds)));
  const files = [{
    filename: 'trend.png',
    image: renderTrendChart(
      labels,
      buildTrendLines(totalCounts, activeProjects, communitySeries.length > 0 ? communityCounts : null),
      `Średnia ${averageDays}-dniowa z ostatnich ${trendDays} dni`,
    ),
  }];
  const embeds = [{
    title: "Wszystkie quizy",
    fields: periodFields(totalCounts),
    image: { url: "attachment://trend.png" },
  }];

  embeds.push(...activeProjects.map(projectEmbed));

  if (communitySeries.length > 0) {
    embeds.push({ title: "Quizy społecznościowe", color: embedColor(colors.community), fields: periodFields(communityCounts) });
  }

  const officialShare = sumLastDays(sumCounts(officialSeries), shareDays);
  const communityShare = sumLastDays(communityCounts, shareDays);
  const shareTotal = officialShare + communityShare;
  if (shareTotal > 0) {
    const formatSlice = (label, value) => `${label}: ${numberFormat.format(value)} (${shareFormat.format(value / shareTotal)})`;
    files.push({
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
    embeds.push({
      title: `Oficjalne vs społecznościowe · ${shareDays} dni`,
      color: embedColor(colors.community),
      image: { url: "attachment://share.png" },
    });
  }

  if (archivedProjects.length > 0) {
    const archived = archivedProjects
      .map(project => `${shortName(project.name)} (${numberFormat.format(project.totalSolvedSurveys)})`)
      .join(" · ");
    const lastEmbed = embeds[embeds.length - 1];
    lastEmbed.footer = { text: [lastEmbed.footer?.text, `Archiwalne: ${archived}`].filter(Boolean).join("\n") };
  }

  await sendMessageToDiscord(`## 📊 Raport dzienny · ${reportDateFormat.format(to)}`, embeds, files);
  console.log("✅ Message sent!");
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
