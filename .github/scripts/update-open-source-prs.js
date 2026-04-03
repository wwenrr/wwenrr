const fs = require('fs');
const path = require('path');

function formatDate(dateString) {
  return new Date(dateString).toISOString().slice(0, 10);
}

function formatStars(stars) {
  return new Intl.NumberFormat('en-US').format(stars);
}

function buildSection({ username, prs }) {
  const nowUtc = new Date().toISOString().replace('T', ' ').replace(/\..+$/, ' UTC');

  const totalOpen = prs.length;
  const draftCount = prs.filter((pr) => pr.isDraft).length;
  const uniqueRepos = new Set(prs.map((pr) => pr.repository.nameWithOwner)).size;

  const topRepos = Array.from(
    prs.reduce((acc, pr) => {
      const key = pr.repository.nameWithOwner;
      if (!acc.has(key)) {
        acc.set(key, {
          repo: key,
          stars: pr.repository.stargazerCount,
          openCount: 0,
          latestUpdatedAt: pr.updatedAt,
        });
      }
      const row = acc.get(key);
      row.openCount += 1;
      if (new Date(pr.updatedAt) > new Date(row.latestUpdatedAt)) {
        row.latestUpdatedAt = pr.updatedAt;
      }
      return acc;
    }, new Map()).values()
  )
    .sort((a, b) => {
      if (b.openCount !== a.openCount) return b.openCount - a.openCount;
      return new Date(b.latestUpdatedAt) - new Date(a.latestUpdatedAt);
    })
    .slice(0, 10);

  const recentOpen = prs
    .slice()
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, 12);

  const lines = [];
  lines.push('<p align="center">');
  lines.push(`  <img src="https://img.shields.io/badge/Open%20OSS%20PRs-${totalOpen}-16a34a?style=for-the-badge" alt="Open OSS PRs" />`);
  lines.push(`  <img src="https://img.shields.io/badge/Draft-${draftCount}-f59e0b?style=for-the-badge" alt="Draft PRs" />`);
  lines.push(`  <img src="https://img.shields.io/badge/Repos-${uniqueRepos}-0ea5e9?style=for-the-badge" alt="Repos" />`);
  lines.push('</p>');
  lines.push('');
  lines.push(`<p align="center"><code>Snapshot: ${nowUtc}</code></p>`);
  lines.push(`<p align="center"><code>Filter: is:open, public repos only, exclude ${username}/*, archived:false, stars > 3</code></p>`);
  lines.push('');

  if (topRepos.length > 0) {
    lines.push('### Active Repositories (Open PRs)');
    lines.push('');
    lines.push('| Repository | Stars | Open PRs | Last Updated |');
    lines.push('| --- | ---: | ---: | ---: |');
    for (const row of topRepos) {
      lines.push(
        `| [\`${row.repo}\`](https://github.com/${row.repo}) | ${formatStars(row.stars)} | ${row.openCount} | ${formatDate(row.latestUpdatedAt)} |`
      );
    }
    lines.push('');
  }

  lines.push('### Recent Open PRs');
  lines.push('');

  if (recentOpen.length === 0) {
    lines.push('- No open OSS PRs found for current filter.');
  } else {
    for (const pr of recentOpen) {
      const draftLabel = pr.isDraft ? ' [DRAFT]' : '';
      lines.push(
        `- [${pr.repository.nameWithOwner} #${pr.number}](${pr.url}) - ${pr.title}${draftLabel} - updated ${formatDate(pr.updatedAt)}`
      );
    }
  }

  return lines.join('\n');
}

module.exports = async ({ github, core, context }) => {
  const username = process.env.GH_USERNAME || context.repo.owner;

  const query = `type:pr author:${username} is:open archived:false`;
  const response = await github.graphql(
    `
      query($q: String!) {
        search(type: ISSUE, query: $q, first: 100) {
          nodes {
            ... on PullRequest {
              number
              title
              url
              isDraft
              createdAt
              updatedAt
              repository {
                nameWithOwner
                isPrivate
                isArchived
                stargazerCount
                owner {
                  login
                }
              }
            }
          }
        }
      }
    `,
    { q: query }
  );

  const prs = (response.search.nodes || [])
    .filter(Boolean)
    .filter((pr) => pr.repository && !pr.repository.isPrivate && !pr.repository.isArchived)
    .filter((pr) => pr.repository.owner.login.toLowerCase() !== username.toLowerCase())
    .filter((pr) => pr.repository.stargazerCount > 3)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  const readmePath = path.join(process.cwd(), 'README.md');
  const readme = fs.readFileSync(readmePath, 'utf8');

  const startMarker = '<!-- OPEN_SOURCE_OPEN_PRS:START -->';
  const endMarker = '<!-- OPEN_SOURCE_OPEN_PRS:END -->';

  if (!readme.includes(startMarker) || !readme.includes(endMarker)) {
    throw new Error('README.md is missing OPEN_SOURCE_OPEN_PRS markers.');
  }

  const section = buildSection({ username, prs });
  const nextReadme = readme.replace(
    new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`),
    `${startMarker}\n${section}\n${endMarker}`
  );

  fs.writeFileSync(readmePath, nextReadme);

  core.setOutput('open_pr_count', String(prs.length));
  core.info(`Updated README with ${prs.length} open OSS PR(s).`);
};
