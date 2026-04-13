const fs = require('fs');
const path = require('path');
const https = require('https');
const core = require('@actions/core');

function fetchMappingFromRepo(repo, filePath, ref, token) {
  return new Promise((resolve, reject) => {
    const apiPath = `/repos/${repo}/contents/${filePath}?ref=${ref}`;
    const headers = {
      'User-Agent': 'tf-scanner-action',
      'Accept': 'application/vnd.github.v3.raw',
    };
    if (token) {
      headers['Authorization'] = `token ${token}`;
    }

    const options = {
      hostname: 'api.github.com',
      path: apiPath,
      headers,
    };

    https
      .get(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(
              new Error(
                `Failed to fetch mapping from ${repo}/${filePath}@${ref} (status ${res.statusCode}): ${data}`
              )
            );
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse mapping JSON: ${e.message}`));
          }
        });
        res.on('error', reject);
      })
      .on('error', reject);
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
  return parts.slice(0, 2).map((s) => s.toLowerCase()).join('_');
}

function deriveModuleService(source) {
  const firstSegment = source.split('/')[0];
  const stripped = firstSegment.startsWith('terraform-')
    ? firstSegment.slice('terraform-'.length)
    : firstSegment;
  return stripped.toLowerCase().replace(/-/g, '_');
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
        modules.push({ name, source: deriveModuleService(source) });
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

  const modules_services = Array.from(
    new Set([
      ...modules.map((m) => m.source),
      ...resources.map((r) => r.service),
    ])
  );

  return { modules, resources, modules_services };
}

function mapServices(modulesServices, mapping) {
  const seen = new Set();
  const mapped = [];
  for (const key of modulesServices) {
    if (Object.prototype.hasOwnProperty.call(mapping, key)) {
      const value = mapping[key];
      if (!seen.has(value)) {
        seen.add(value);
        mapped.push(value);
      }
    }
  }
  return mapped;
}

async function run() {
  try {
    const terraformDir = core.getInput('terraform_dir') || 'tf';
    const mappingRepo =
      core.getInput('mapping_repo') ||
      'subhamay-bhattacharyya-gha/checkov-custom-policies';
    const mappingPath =
      core.getInput('mapping_path') || 'config/service-map.json';
    const mappingRef = core.getInput('mapping_ref') || 'main';
    const githubToken = core.getInput('github_token');

    core.info(`Input terraform_dir: ${terraformDir}`);
    core.info(`Input mapping_repo: ${mappingRepo}`);
    core.info(`Input mapping_path: ${mappingPath}`);
    core.info(`Input mapping_ref: ${mappingRef}`);
    core.info(`Input github_token: ${githubToken ? '***' : '(empty)'}`);

    const resolvedDir = path.resolve(process.cwd(), terraformDir);
    core.info(`Resolved terraform directory: ${resolvedDir}`);
    core.info(`Current working directory: ${process.cwd()}`);

    if (!fs.existsSync(resolvedDir)) {
      core.setFailed(`Directory not found: ${terraformDir}`);
      return;
    }

    const output = parseTfFiles(resolvedDir);

    core.info(
      `Fetching service mapping from ${mappingRepo}/${mappingPath}@${mappingRef}...`
    );
    const mapping = await fetchMappingFromRepo(
      mappingRepo,
      mappingPath,
      mappingRef,
      githubToken
    );
    output.mapped_services = mapServices(output.modules_services, mapping);

    const result = JSON.stringify(output);

    core.setOutput('result', result);
    core.setOutput('mapped_services', JSON.stringify(output.mapped_services));
    core.info('Terraform scan result:');
    core.info(result);
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();

module.exports = { walkDir, deriveServiceName, deriveModuleService, parseTfFiles, mapServices };
