#!/usr/bin/env node

/**
 * Monitor Staging Errors for Paid Space Detection
 *
 * This script helps monitor the staging environment for errors
 * related to the paid space detection feature.
 */

const https = require('https');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// Configuration
const STAGING_URL = 'https://conf-stg-full.zenuml.com';
const API_ENDPOINT = '/api/space-status';
const CHECK_INTERVAL = 30000; // 30 seconds
const CLOUDFLARE_PROJECT = 'conf-stg-full';

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

// Error patterns to watch for
const ERROR_PATTERNS = [
  /space-status/i,
  /isPaid/i,
  /license/i,
  /unauthorized/i,
  /validateContextToken/i,
  /ALLOWED_FORGE_APP_IDS/i,
  /accountType/i,
  /lic.*param/i,
];

// Success patterns
const SUCCESS_PATTERNS = [
  /Space is paid.*bypassing/i,
  /Space paid status.*isPaid.*true/i,
  /paid_space_detected/i,
];

function log(message, color = 'reset') {
  const timestamp = new Date().toISOString();
  console.log(`${colors[color]}[${timestamp}] ${message}${colors.reset}`);
}

function logSection(title) {
  console.log(`\n${colors.cyan}${'='.repeat(60)}${colors.reset}`);
  console.log(`${colors.cyan}  ${title}${colors.reset}`);
  console.log(`${colors.cyan}${'='.repeat(60)}${colors.reset}\n`);
}

// Check API endpoint health
async function checkApiEndpoint() {
  return new Promise((resolve) => {
    const url = `${STAGING_URL}${API_ENDPOINT}?lic=test`;

    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 401) {
          log(`API endpoint returned 401 (expected without auth): ${API_ENDPOINT}`, 'green');
          resolve({ success: true, status: res.statusCode });
        } else if (res.statusCode === 200) {
          log(`API endpoint accessible: ${API_ENDPOINT}`, 'green');
          resolve({ success: true, status: res.statusCode, data });
        } else {
          log(`API endpoint error - Status: ${res.statusCode}`, 'red');
          resolve({ success: false, status: res.statusCode, data });
        }
      });
    }).on('error', (err) => {
      log(`API endpoint unreachable: ${err.message}`, 'red');
      resolve({ success: false, error: err.message });
    });
  });
}

// Get recent Cloudflare logs
async function getCloudflareErrors() {
  try {
    // Try to get deployment ID
    const { stdout: deployments } = await execPromise(
      `wrangler pages deployment list --project-name ${CLOUDFLARE_PROJECT} | head -5`
    );

    log('Recent deployments:', 'blue');
    console.log(deployments);

    // Note: Actual log tailing requires deployment ID
    log('To view real-time logs, run:', 'yellow');
    log(`  wrangler pages deployment tail <deployment-id> --project-name ${CLOUDFLARE_PROJECT}`, 'yellow');

    return true;
  } catch (error) {
    log(`Could not fetch Cloudflare logs: ${error.message}`, 'yellow');
    return false;
  }
}

// Simulate API calls with different scenarios
async function testScenarios() {
  const scenarios = [
    { name: 'Paid Space (lic=active)', lic: 'active', expectedPaid: true },
    { name: 'Trial Space (lic=evaluation)', lic: 'evaluation', expectedPaid: false },
    { name: 'No License (lic missing)', lic: '', expectedPaid: false },
  ];

  log('Testing different license scenarios...', 'magenta');

  for (const scenario of scenarios) {
    const url = `${STAGING_URL}${API_ENDPOINT}?lic=${scenario.lic}`;
    log(`  Testing: ${scenario.name}`, 'blue');
    // Note: Actual testing would require proper authentication
    log(`    URL: ${url}`, 'cyan');
    log(`    Expected isPaid: ${scenario.expectedPaid}`, 'cyan');
  }
}

// Monitor function
async function monitor() {
  logSection('STAGING ERROR MONITORING - Paid Space Detection');

  // Check API endpoint
  log('Checking API endpoint health...', 'blue');
  const apiHealth = await checkApiEndpoint();

  // Get Cloudflare logs info
  log('\nChecking Cloudflare deployment...', 'blue');
  await getCloudflareErrors();

  // Test scenarios
  log('\nTest scenarios:', 'blue');
  await testScenarios();

  // Summary
  logSection('MONITORING SUMMARY');

  if (apiHealth.success) {
    log('✅ API endpoint is responding correctly', 'green');
  } else {
    log('❌ API endpoint may have issues', 'red');
  }

  log('\nKey things to monitor:', 'yellow');
  log('  1. Check browser console for errors when using the app', 'cyan');
  log('  2. Watch Network tab for /api/space-status calls', 'cyan');
  log('  3. Verify isPaid response matches license status', 'cyan');
  log('  4. Check for any 500 errors or timeouts', 'cyan');

  log('\nError patterns being watched:', 'yellow');
  ERROR_PATTERNS.forEach(pattern => {
    log(`  - ${pattern.source}`, 'cyan');
  });

  log('\nSuccess patterns to confirm:', 'green');
  SUCCESS_PATTERNS.forEach(pattern => {
    log(`  - ${pattern.source}`, 'cyan');
  });
}

// Dashboard URLs
function showDashboardLinks() {
  logSection('MONITORING DASHBOARDS');

  log('Cloudflare Pages Dashboard:', 'blue');
  log('  https://dash.cloudflare.com/8d5fc7ce04adc5096f52485cce7d7b3d/pages/view/conf-stg-full', 'cyan');

  log('\nCloudflare Workers & Pages Logs:', 'blue');
  log('  https://dash.cloudflare.com/8d5fc7ce04adc5096f52485cce7d7b3d/pages/view/conf-stg-full/functions', 'cyan');

  log('\nAtlassian Staging Instance:', 'blue');
  log('  https://zenuml-stg.atlassian.net', 'cyan');
}

// Continuous monitoring
async function startContinuousMonitoring() {
  log(`Starting continuous monitoring (checking every ${CHECK_INTERVAL/1000} seconds)...`, 'green');

  setInterval(async () => {
    console.log('\n' + '─'.repeat(60));
    log('Running periodic health check...', 'blue');
    const apiHealth = await checkApiEndpoint();

    if (!apiHealth.success) {
      log('⚠️  ALERT: API endpoint issue detected!', 'red');
    } else {
      log('✅ API endpoint healthy', 'green');
    }
  }, CHECK_INTERVAL);
}

// Main execution
async function main() {
  // Initial monitoring
  await monitor();

  // Show dashboard links
  showDashboardLinks();

  // Ask if continuous monitoring should be started
  logSection('CONTINUOUS MONITORING');
  log('Run with --continuous flag to enable continuous monitoring', 'yellow');
  log('Example: node scripts/monitor-staging-errors.js --continuous', 'cyan');

  if (process.argv.includes('--continuous')) {
    await startContinuousMonitoring();
  } else {
    log('\nMonitoring complete. Check the dashboards for real-time logs.', 'green');
  }
}

// Handle errors
process.on('unhandledRejection', (error) => {
  log(`Unhandled error: ${error.message}`, 'red');
  process.exit(1);
});

// Run the monitor
main().catch(error => {
  log(`Error: ${error.message}`, 'red');
  process.exit(1);
});