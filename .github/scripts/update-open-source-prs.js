const fs = require('fs');
const path = require('path');

function formatDate(dateString) {
  return new Date(dateString).toISOString().slice(0, 10);
}

function sanitizeTableCell(value, fallback = '-') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
  return text.length > 0 ? text : fallback;
}

function buildSection({ username, prs }) {
  const totalMerged = prs.length;
  const uniqueRepos = new Set(prs.map((pr) => pr.repository.nameWithOwner)).size;
  const recentMerged = prs.slice().sort((a, b) => new Date(b.mergedAt) - new Date(a.mergedAt)).slice(0, 20);

  const lines = [];
  lines.push('<div align="center">');
  lines.push(`  <img src="https://img.shields.io/badge/Merged%20OSS%20PRs-${totalMerged}-16a34a?style=flat-square" />`);
  lines.push(`  <img src="https://img.shields.io/badge/Repos-${uniqueRepos}-0ea5e9?style=flat-square" />`);
  lines.push('</div>');
  lines.push('');
  lines.push('<br />');
  lines.push('');

  lines.push('<div align="center">');
  lines.push('<details>');
  lines.push('<summary><b>Recent Merged PRs</b></summary>');
  lines.push('');
  lines.push('<br />');
  lines.push('');

  if (recentMerged.length === 0) {
    lines.push('No merged OSS PRs found.');
  } else {
    lines.push('| Repo | PR | Title | Merged Date |');
    lines.push('|---|---|---|---|');
    for (const pr of recentMerged) {
      const repo = sanitizeTableCell(pr.repository.nameWithOwner);
      const title = sanitizeTableCell(pr.title, '—');
      lines.push(
        `| ${repo} | [#${pr.number}](${pr.url}) | ${title} | ${formatDate(pr.mergedAt)} |`
      );
    }
  }

  lines.push('');
  lines.push('</details>');
  lines.push('</div>');

  return lines.join('\n');
}

module.exports = async ({ github, core, context }) => {
  const username = process.env.GH_USERNAME || context.repo.owner;

  const query = `type:pr author:${username} is:merged archived:false`;
  const response = await github.graphql(
    `
      query($q: String!) {
        search(type: ISSUE, query: $q, first: 100) {
          nodes {
            ... on PullRequest {
              number
              title
              url
              createdAt
              updatedAt
              mergedAt
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
    .filter((pr) => Boolean(pr.mergedAt))
    .filter((pr) => pr.repository.stargazerCount > 3)
    .sort((a, b) => new Date(b.mergedAt) - new Date(a.mergedAt));

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

  core.setOutput('merged_pr_count', String(prs.length));
  core.info(`Updated README with ${prs.length} merged OSS PR(s).`);
};
