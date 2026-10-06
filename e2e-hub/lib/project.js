// Read-only access to the Cypress project: stages, specs and the step catalog. Everything is
// read fresh on each call so new specs or catalog entries show up without a restart.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const ENV_FILE = path.join(ROOT, 'cypress.env.json');
const E2E_DIR = path.join(ROOT, 'cypress', 'e2e');
const CATALOG_FILE = path.join(ROOT, 'cypress', 'step-catalog.js');
const SPEC_PATTERN = /\.cy\.(js|ts)$/;

function readEnv() {
  if (!fs.existsSync(ENV_FILE)) {
    throw new Error('cypress.env.json not found — copy cypress.env.example.json and adjust it');
  }
  return JSON.parse(fs.readFileSync(ENV_FILE, 'utf8'));
}

function listStages() {
  const env = readEnv();
  const stages = Object.entries(env.stages || {}).map(([name, stage]) => ({
    name,
    description: stage.description || name,
    baseUrl: stage.baseUrl || null,
    protected: stage.protected === true,
  }));
  return { stages, defaultStage: env.systemUnderTest || (stages[0] && stages[0].name) || null };
}

function getStage(name) {
  return listStages().stages.find((s) => s.name === name) || null;
}

function prettifySpecName(fileName) {
  return fileName.replace(SPEC_PATTERN, '');
}

/** All specs below cypress/e2e, grouped by their first folder ("category"). */
function listSpecs() {
  const specs = [];
  const walk = (dir, rel) => {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) return;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) return walk(path.join(dir, entry.name), relPath);
      if (!entry.isFile() || !SPEC_PATTERN.test(entry.name)) return;
      const parts = relPath.split('/');
      const category = parts.length > 1 ? parts[0] : 'general';
      const labelParts = (parts.length > 1 ? parts.slice(1) : parts).filter((p) => p !== 'specs');
      labelParts[labelParts.length - 1] = prettifySpecName(labelParts[labelParts.length - 1]);
      specs.push({ label: labelParts.join(' / '), value: `cypress/e2e/${relPath}`, category, wildcard: false });
    });
  };
  if (fs.existsSync(E2E_DIR)) walk(E2E_DIR, '');

  const categories = [...new Set(specs.map((s) => s.category))].filter((c) => c !== 'general');
  categories.forEach((category) => {
    specs.push({ label: `All specs in ${category}`, value: `cypress/e2e/${category}/**/*.cy.*`, category, wildcard: true });
  });

  specs.sort((a, b) =>
    a.category.localeCompare(b.category) || Number(b.wildcard) - Number(a.wildcard) || a.label.localeCompare(b.label));
  return specs;
}

/** A spec pattern is runnable if it stays inside cypress/e2e. */
function isValidSpecPattern(spec) {
  const value = String(spec || '').trim();
  return value.startsWith('cypress/e2e/') && !value.includes('..') && !/[\s,;'"`$\\]/.test(value);
}

function loadStepCatalog() {
  if (!fs.existsSync(CATALOG_FILE)) return {};
  delete require.cache[require.resolve(CATALOG_FILE)];
  return require(CATALOG_FILE);
}

/** Catalog suites in the shape the UI needs: only labelled steps are selectable. */
function listStepSuites() {
  return Object.entries(loadStepCatalog()).map(([suite, entry]) => ({
    suite,
    spec: entry.spec || null,
    label: entry.label || suite,
    envKey: `${suite}LastStep`,
    steps: (entry.steps || []).filter((s) => s.label).map((s) => ({ key: s.key, label: s.label })),
  }));
}

module.exports = {
  ROOT,
  listStages,
  getStage,
  listSpecs,
  isValidSpecPattern,
  listStepSuites,
};
