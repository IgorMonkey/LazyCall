// On-demand repository metrics. Does not run inside LazyCall or collect app data.
const { execFileSync } = require('node:child_process');
const repository = 'IgorMonkey/LazyCall';
const args = new Set(process.argv.slice(2));
if ([...args].some(arg => !['--traffic', '--json'].includes(arg))) {
  console.error('Usage: node scripts/release-stats.cjs [--traffic] [--json]');
  process.exit(1);
}
function api(endpoint, paginate = false) {
  return JSON.parse(execFileSync('gh', ['api', endpoint, ...(paginate ? ['--paginate', '--slurp'] : [])], { encoding: 'utf8', windowsHide: true, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }));
}
try {
  const releases = api(`repos/${repository}/releases?per_page=100`, true).flat().filter(release => !release.draft);
  const rows = [];
  for (const release of releases) {
    const assets = api(`repos/${repository}/releases/${release.id}/assets?per_page=100`, true).flat();
    for (const asset of assets) {
      let kind;
      if (/^LazyCall-Web-Setup-.+\.exe$/i.test(asset.name)) kind = 'web bootstrap';
      else if (/^LazyCall-Setup-.+\.exe$/i.test(asset.name)) kind = 'full installer';
      else if (/\.nsis\.7z$/i.test(asset.name)) kind = 'web payload';
      else continue;
      rows.push({ version: release.tag_name, kind, file: asset.name, downloads: asset.download_count, bytes: asset.size });
    }
  }
  const report = { repository, capturedAt: new Date().toISOString(), metrics: 'GitHub asset download counters; not unique users, completed installs, or active users', releases: rows };
  if (args.has('--traffic')) {
    report.traffic = {};
    for (const kind of ['views', 'clones']) {
      try {
        const value = api(`repos/${repository}/traffic/${kind}`);
        report.traffic[kind] = { count: value.count, uniques: value.uniques, period: 'past 14 days; unique counts are scoped to this period' };
      } catch { report.traffic[kind] = { unavailable: true, reason: 'Requires repository push access; verify gh authentication and network' }; }
    }
  }
  if (args.has('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`${repository} — ${report.capturedAt}\n`);
    if (rows.length) console.table(rows.map(({ version, kind, file, downloads }) => ({ version, kind, file, downloads })));
    else console.log('No published installer assets yet.');
    console.log('\nDownload counters are not unique users or successful installs. Do not add the bootstrap and payload counts together.');
    if (report.traffic) console.log('\nTraffic (past 14 days):\n' + JSON.stringify(report.traffic, null, 2));
  }
} catch (error) {
  console.error('Cannot read GitHub metrics. Check gh authentication and network. ' + (error.code || error.message));
  process.exitCode = 1;
}
