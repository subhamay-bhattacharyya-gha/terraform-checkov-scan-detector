const fs = require('fs');
const path = require('path');
const https = require('https');
const core = require('@actions/core');

function fetchGist(gistId, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/gists/${gistId}`,
      headers: {
        'User-Agent': 'tf-scanner-action',
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    };

    https.get(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Gist fetch failed with status ${res.statusCode}: ${data}`));
          return;
        }
        try {
          const gist = JSON.parse(data);
          const file = gist.files['checkov-scan-mapping.json'];
          if (!file) {
            reject(new Error('checkov-scan-mapping.json not found in gist'));
            return;
          }
          resolve(JSON.parse(file.content));
        } catch (e) {
          reject(new Error(`Failed to parse gist content: ${e.message}`));
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

function walkDir(dir) {
  let files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(walkDir(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.tf')) {
      files.push(fullPath);
    }
  }
  return files;
}

function deriveServiceName(resourceType) {
  const parts = resourceType.split('_');
  parts.shift();
  return parts
    .map((s) => s.toUpperCase())
    .join('_');
}

function parseTfFiles(terraformDir) {
  const tfFiles = walkDir(terraformDir);
  const moduleSet = new Set();
  const resourceSet = new Set();
  const modules = [];
  const resources = [];

  const moduleRegex = /module\s+"([^"]+)"\s*\{[^}]*?source\s*=\s*"([^"]+)"/gs;
  const resourceRegex = /resource\s+"([^"]+)"\s+"([^"]+)"\s*\{/g;

  for (const filePath of tfFiles) {
    const content = fs.readFileSync(filePath, 'utf8');

    let match;
    while ((match = moduleRegex.exec(content)) !== null) {
      const name = match[1];
      const source = match[2];
      const key = `${name}|${source}`;
      if (!moduleSet.has(key)) {
        moduleSet.add(key);
        modules.push({ name, source });
      }
    }

    while ((match = resourceRegex.exec(content)) !== null) {
      const type = match[1];
      const key = type;
      if (!resourceSet.has(key)) {
        resourceSet.add(key);
        resources.push({ type, service: deriveServiceName(type) });
      }
    }
  }

  return { modules, resources };
}

async function run() {
  try {
    const terraformDir = core.getInput('terraform_dir') || 'tf';
    const gistId = core.getInput('gist_id');
    const githubToken = core.getInput('github_token');
    const resolvedDir = path.resolve(process.cwd(), terraformDir);

    if (!fs.existsSync(resolvedDir)) {
      core.setFailed(`Directory not found: ${terraformDir}`);
      return;
    }

    const output = parseTfFiles(resolvedDir);
    const result = JSON.stringify(output);

    core.setOutput('result', result);
    core.info('Terraform scan result:');
    core.info(result);

    if (gistId && githubToken) {
      core.info('Fetching checkov-scan-mapping.json from private gist...');
      const gistContent = await fetchGist(gistId, githubToken);
      core.info('Gist content (checkov-scan-mapping.json):');
      core.info(JSON.stringify(gistContent, null, 2));
      core.setOutput('gist_mapping', JSON.stringify(gistContent));
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();

module.exports = { walkDir, deriveServiceName, parseTfFiles };
