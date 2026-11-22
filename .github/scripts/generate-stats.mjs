import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, "../..");
const ASSETS_DIR = resolve(ROOT_DIR, "assets");
const USERNAME = process.env.GITHUB_USERNAME || "paulusesthis";

const QUERY = `
query($login: String!) {
  user(login: $login) {
    name
    login
    createdAt
    followers {
      totalCount
    }
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC) {
      totalCount
      nodes {
        name
        stargazerCount
        forkCount
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
          edges {
            size
            node {
              name
              color
            }
          }
        }
      }
    }
    contributionsCollection {
      totalCommitContributions
      restrictedContributionsCount
      totalPullRequestContributions
      totalIssueContributions
      totalRepositoryContributions
      contributionCalendar {
        totalContributions
      }
    }
    pullRequests {
      totalCount
    }
    issues {
      totalCount
    }
    repositoriesContributedTo(contributionTypes: [COMMIT, ISSUE, PULL_REQUEST, REPOSITORY]) {
      totalCount
    }
  }
}
`;

async function fetchGitHubData(username) {
  const token = process.env.GITHUB_TOKEN;

  if (token) {
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "profile-stats-generator",
      },
      body: JSON.stringify({ query: QUERY, variables: { login: username } }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub GraphQL API error (${response.status}): ${body}`);
    }

    const payload = await response.json();
    if (payload.errors?.length) {
      throw new Error(`GraphQL errors: ${JSON.stringify(payload.errors)}`);
    }
    return payload.data.user;
  }

  // Fallback for local runs where gh CLI is authenticated
  const output = execFileSync(
    "gh",
    ["api", "graphql", "-f", `query=${QUERY}`, "-f", `login=${username}`],
    { encoding: "utf8" }
  );
  const payload = JSON.parse(output);
  if (payload.errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(payload.errors)}`);
  }
  return payload.data.user;
}

function escapeXml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatNumber(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}m`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function calculateRank({ commits, prs, issues, stars, followers }) {
  const expCdf = (x) => 1 - Math.pow(2, -x);
  const logCdf = (x) => x / (1 + x);

  const weights = {
    commits: 2,
    prs: 3,
    issues: 1,
    stars: 4,
    followers: 1,
  };
  const totalWeight =
    weights.commits + weights.prs + weights.issues + weights.stars + weights.followers;

  const rankScore =
    (weights.commits * expCdf(commits / 250) +
      weights.prs * expCdf(prs / 50) +
      weights.issues * expCdf(issues / 25) +
      weights.stars * logCdf(stars / 50) +
      weights.followers * logCdf(followers / 10)) /
    totalWeight;

  const percentile = Math.max(1, Math.min(99, Math.round((1 - rankScore) * 100)));

  let level = "C";
  if (percentile <= 1) level = "S";
  else if (percentile <= 12.5) level = "A+";
  else if (percentile <= 25) level = "A";
  else if (percentile <= 37.5) level = "A-";
  else if (percentile <= 50) level = "B+";
  else if (percentile <= 62.5) level = "B";
  else if (percentile <= 75) level = "B-";
  else if (percentile <= 87.5) level = "C+";

  return { level, percentile, progress: Math.round(rankScore * 100) };
}

function renderStatsSvg(stats) {
  const title = `${stats.name.trim() || stats.login}'s GitHub Stats`;
  const rank = calculateRank(stats);
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = (circumference * (1 - rank.progress / 100)).toFixed(2);

  const rows = [
    {
      label: "Total Stars Earned:",
      value: formatNumber(stats.stars),
      icon: `<path fill-rule="evenodd" d="M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25z"/>`,
    },
    {
      label: `Total Commits (${new Date().getUTCFullYear()}):`,
      value: formatNumber(stats.commits),
      icon: `<path fill-rule="evenodd" d="M1.643 3.143L.427 1.927A.25.25 0 000 2.104V5.75c0 .138.112.25.25.25h3.646a.25.25 0 00.177-.427L2.715 4.215a6.5 6.5 0 11-1.18 4.458.75.75 0 10-1.493.154 8.001 8.001 0 101.6-5.684zM7.75 4a.75.75 0 01.75.75v2.992l2.028.812a.75.75 0 01-.557 1.392l-2.5-1A.75.75 0 017 8.25v-3.5A.75.75 0 017.75 4z"/>`,
    },
    {
      label: "Total PRs:",
      value: formatNumber(stats.prs),
      icon: `<path fill-rule="evenodd" d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z"/>`,
    },
    {
      label: "Total Issues:",
      value: formatNumber(stats.issues),
      icon: `<path fill-rule="evenodd" d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8zm9 3a1 1 0 11-2 0 1 1 0 012 0zm-.25-6.25a.75.75 0 00-1.5 0v3.5a.75.75 0 001.5 0v-3.5z"/>`,
    },
    {
      label: "Contributed to:",
      value: formatNumber(stats.contributedTo),
      icon: `<path fill-rule="evenodd" d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 110-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1V9h-8c-.356 0-.694.074-1 .208V2.5a1 1 0 011-1h8zM5 12.25v3.25a.25.25 0 00.4.2l1.45-1.087a.25.25 0 01.3 0L8.6 15.7a.25.25 0 00.4-.2v-3.25a.25.25 0 00-.25-.25h-3.5a.25.25 0 00-.25.25z"/>`,
    },
  ];

  const rowsMarkup = rows
    .map(
      (row, idx) => `
    <g transform="translate(25, ${56 + idx * 25})">
      <svg x="0" y="-12" width="16" height="16" viewBox="0 0 16 16" fill="#3b82f6">
        ${row.icon}
      </svg>
      <text x="25" y="0" class="stat-label">${escapeXml(row.label)}</text>
      <text x="215" y="0" class="stat-value">${escapeXml(row.value)}</text>
    </g>`
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="467" height="195" viewBox="0 0 467 195" fill="none" role="img" aria-label="${escapeXml(title)}">
  <title>${escapeXml(title)}</title>
  <style>
    .header { font: 600 18px 'Segoe UI', Ubuntu, Sans-Serif; fill: #3b82f6; }
    .stat-label { font: 600 14px 'Segoe UI', Ubuntu, Sans-Serif; fill: #c9d1d9; }
    .stat-value { font: 700 14px 'Segoe UI', Ubuntu, Sans-Serif; fill: #3b82f6; }
    .rank-text { font: 800 24px 'Segoe UI', Ubuntu, Sans-Serif; fill: #3b82f6; }
    .rank-sub { font: 600 10px 'Segoe UI', Ubuntu, Sans-Serif; fill: #8b949e; }
  </style>
  <rect x="0.5" y="0.5" rx="6" width="466" height="194" stroke="#30363d" stroke-opacity="1" fill="#000000" fill-opacity="0"/>
  <text x="25" y="33" class="header">${escapeXml(title)}</text>
  ${rowsMarkup}
  <g transform="translate(385, 108)">
    <circle cx="0" cy="0" r="${radius}" stroke="#3b82f6" stroke-opacity="0.2" stroke-width="6" fill="none"/>
    <circle cx="0" cy="0" r="${radius}" stroke="#3b82f6" stroke-width="6" stroke-linecap="round"
      stroke-dasharray="${circumference.toFixed(2)}" stroke-dashoffset="${dashOffset}"
      transform="rotate(-90)" fill="none"/>
    <text x="0" y="6" text-anchor="middle" class="rank-text">${escapeXml(rank.level)}</text>
    <text x="0" y="22" text-anchor="middle" class="rank-sub">RANK</text>
  </g>
</svg>
`;
}

function renderTopLangsSvg(languages) {
  const top = languages.slice(0, 6);
  const totalBytes = top.reduce((sum, l) => sum + l.size, 0) || 1;
  const barWidth = 250;

  let currentX = 0;
  const barSegments = top
    .map((lang) => {
      const pct = lang.size / totalBytes;
      const segW = Math.max(2, pct * barWidth);
      const x = currentX;
      currentX += segW;
      return `<rect x="${x.toFixed(2)}" y="0" width="${segW.toFixed(2)}" height="8" fill="${escapeXml(lang.color)}"/>`;
    })
    .join("");

  const legendItems = top
    .map((lang, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const x = 25 + col * 140;
      const y = 92 + row * 28;
      const pct = ((lang.size / totalBytes) * 100).toFixed(1);
      return `
    <g transform="translate(${x}, ${y})">
      <circle cx="5" cy="-4" r="5" fill="${escapeXml(lang.color)}"/>
      <text x="16" y="0" class="lang-name">${escapeXml(lang.name)} <tspan class="lang-pct">${pct}%</tspan></text>
    </g>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="195" viewBox="0 0 300 195" fill="none" role="img" aria-label="Most Used Languages">
  <title>Most Used Languages</title>
  <style>
    .header { font: 600 18px 'Segoe UI', Ubuntu, Sans-Serif; fill: #3b82f6; }
    .lang-name { font: 600 12px 'Segoe UI', Ubuntu, Sans-Serif; fill: #c9d1d9; }
    .lang-pct { font: 400 11px 'Segoe UI', Ubuntu, Sans-Serif; fill: #8b949e; }
  </style>
  <defs>
    <clipPath id="bar-clip">
      <rect x="0" y="0" width="${barWidth}" height="8" rx="4"/>
    </clipPath>
  </defs>
  <rect x="0.5" y="0.5" rx="6" width="299" height="194" stroke="#30363d" stroke-opacity="1" fill="#000000" fill-opacity="0"/>
  <text x="25" y="33" class="header">Most Used Languages</text>
  <g transform="translate(25, 52)" clip-path="url(#bar-clip)">
    ${barSegments}
  </g>
  ${legendItems}
</svg>
`;
}

function getTrophyTier(value, thresholds) {
  const tiers = [
    { name: "S", label: "Master", color: "#f59e0b" },
    { name: "A", label: "Expert", color: "#3b82f6" },
    { name: "B", label: "Skilled", color: "#38bdf8" },
    { name: "C", label: "Rising", color: "#60a5fa" },
  ];
  for (let i = 0; i < thresholds.length; i++) {
    if (value >= thresholds[i]) {
      const next = i > 0 ? thresholds[i - 1] : thresholds[0];
      const progress = i === 0 ? 1 : Math.min(1, value / next);
      return { ...tiers[i], progress };
    }
  }
  const next = thresholds[thresholds.length - 1];
  return { ...tiers[tiers.length - 1], progress: Math.min(1, value / next) };
}

function renderTrophiesSvg(stats) {
  const years = Math.max(
    1,
    Math.floor((Date.now() - new Date(stats.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 365.25))
  );

  const trophies = [
    {
      title: "Stars",
      value: `${formatNumber(stats.stars)}`,
      subtitle: "Total Stars",
      ...getTrophyTier(stats.stars, [100, 30, 10, 1]),
    },
    {
      title: "Commits",
      value: `${formatNumber(stats.commits)}`,
      subtitle: "Yearly Commits",
      ...getTrophyTier(stats.commits, [1000, 300, 100, 20]),
    },
    {
      title: "Repositories",
      value: `${formatNumber(stats.repos)}`,
      subtitle: "Public Repos",
      ...getTrophyTier(stats.repos, [50, 25, 10, 3]),
    },
    {
      title: "Pull Requests",
      value: `${formatNumber(stats.prs)}`,
      subtitle: "Total PRs",
      ...getTrophyTier(stats.prs, [100, 30, 10, 2]),
    },
    {
      title: "Followers",
      value: `${formatNumber(stats.followers)}`,
      subtitle: "GitHub Followers",
      ...getTrophyTier(stats.followers, [100, 30, 10, 2]),
    },
    {
      title: "Experience",
      value: `${years} yr${years === 1 ? "" : "s"}`,
      subtitle: "On GitHub",
      ...getTrophyTier(years, [5, 3, 2, 1]),
    },
  ];

  const cardW = 122;
  const cardH = 112;
  const gap = 10;
  const totalW = trophies.length * cardW + (trophies.length - 1) * gap;

  const cardsMarkup = trophies
    .map((t, idx) => {
      const x = idx * (cardW + gap);
      const barW = Math.max(8, Math.round(t.progress * (cardW - 24)));
      return `
  <g transform="translate(${x}, 0)">
    <rect x="0.5" y="0.5" rx="6" width="${cardW - 1}" height="${cardH - 1}" stroke="#30363d" fill="#000000" fill-opacity="0"/>
    <text x="${cardW / 2}" y="20" text-anchor="middle" class="t-title">${escapeXml(t.title)}</text>
    <g transform="translate(${cardW / 2 - 14}, 27)">
      <path d="M5 2h18v7a9 9 0 01-18 0V2z" stroke="${t.color}" stroke-width="1.8" fill="${t.color}" fill-opacity="0.15"/>
      <path d="M5 4H2.5a1.5 1.5 0 00-1.5 1.5v1A4.5 4.5 0 005.5 11M23 4h2.5A1.5 1.5 0 0127 5.5v1A4.5 4.5 0 0122.5 11" stroke="${t.color}" stroke-width="1.6" fill="none"/>
      <path d="M14 18v5M9.5 23h9" stroke="${t.color}" stroke-width="1.8" stroke-linecap="round"/>
      <text x="14" y="12.5" text-anchor="middle" font-family="'Segoe UI', Ubuntu, Sans-Serif" font-size="10" font-weight="800" fill="${t.color}">${t.name}</text>
    </g>
    <text x="${cardW / 2}" y="71" text-anchor="middle" class="t-value">${escapeXml(t.value)}</text>
    <text x="${cardW / 2}" y="86" text-anchor="middle" class="t-sub">${escapeXml(t.subtitle)}</text>
    <rect x="12" y="96" width="${cardW - 24}" height="5" rx="2.5" fill="#30363d"/>
    <rect x="12" y="96" width="${barW}" height="5" rx="2.5" fill="${t.color}"/>
  </g>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${cardH}" viewBox="0 0 ${totalW} ${cardH}" fill="none" role="img" aria-label="GitHub Trophies">
  <title>GitHub Trophies</title>
  <style>
    .t-title { font: 700 12px 'Segoe UI', Ubuntu, Sans-Serif; fill: #3b82f6; }
    .t-value { font: 700 14px 'Segoe UI', Ubuntu, Sans-Serif; fill: #c9d1d9; }
    .t-sub { font: 400 10px 'Segoe UI', Ubuntu, Sans-Serif; fill: #8b949e; }
  </style>
  ${cardsMarkup}
</svg>
`;
}

async function main() {
  const user = await fetchGitHubData(USERNAME);

  const repos = user.repositories.nodes || [];
  const stars = repos.reduce((sum, repo) => sum + (repo.stargazerCount || 0), 0);

  const langMap = new Map();
  for (const repo of repos) {
    for (const edge of repo.languages?.edges || []) {
      const name = edge.node.name;
      const color = edge.node.color || "#3b82f6";
      const existing = langMap.get(name) || { name, color, size: 0 };
      existing.size += edge.size;
      langMap.set(name, existing);
    }
  }
  const languages = [...langMap.values()].sort((a, b) => b.size - a.size);

  const stats = {
    login: user.login,
    name: user.name || user.login,
    createdAt: user.createdAt,
    stars,
    commits:
      (user.contributionsCollection.totalCommitContributions || 0) +
      (user.contributionsCollection.restrictedContributionsCount || 0),
    prs: user.pullRequests.totalCount || 0,
    issues: user.issues.totalCount || 0,
    contributedTo: user.repositoriesContributedTo.totalCount || 0,
    repos: user.repositories.totalCount || 0,
    followers: user.followers.totalCount || 0,
  };

  mkdirSync(ASSETS_DIR, { recursive: true });
  writeFileSync(resolve(ASSETS_DIR, "github-stats.svg"), renderStatsSvg(stats), "utf8");
  writeFileSync(resolve(ASSETS_DIR, "top-langs.svg"), renderTopLangsSvg(languages), "utf8");
  writeFileSync(resolve(ASSETS_DIR, "trophies.svg"), renderTrophiesSvg(stats), "utf8");

  console.log("Generated GitHub profile SVGs in assets/", stats);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
