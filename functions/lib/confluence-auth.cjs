/**
 * Confluence Authentication Test Script
 * ====================================
 * 
 * This script tests authentication with Confluence using JWT tokens.
 * It validates that the installation secrets are correct and that
 * the JWT generation is working properly for the Confluence V2 API.
 * 
 * Prerequisites:
 * - Node.js installed
 * - node-fetch package available globally or in the parent project
 * 
 * Usage:
 * ```
 * node scripts/test-confluence-auth.js
 * ```
 * 
 * Configuration:
 * Update the CONFIG object with your actual values:
 * - addonKey: Your Atlassian Connect app key
 * - clientKey: The client key from installation data
 * - sharedSecret: The shared secret from installation data
 * - baseUrl: The base URL of the Confluence instance
 * - contentId: The ID of the content to fetch
 */

const fetch = require('node-fetch');
const jwtAdapter = require('./jwt-adapter.cjs');

// Configuration - replace these with your actual values
const CONFIG = {
  // Installation data
  addonKey: 'com.zenuml.confluence-addon-lite',
  clientKey: 'aa4a743a-201f-38c4-b7fd-d7f8f68ec685',
  sharedSecret: 'ATCOBgAzn5l-f66kgC5-7EgfgFYzB0H6i3kyRcjrUMn4yXnUHZYfG9QLFj_uCu-JlvP7alyL19aP9eGaeOkoB5U93QED09A0B8',
  baseUrl: 'https://whimet4.atlassian.net',

  // Test parameters
  contentId: '561578058'
};

/**
 * Make an authenticated request to Confluence
 * @param {string} url - Full URL to fetch
 * @param {string} method - HTTP method
 * @param {string} path - Request path for QSH
 * @param {object} queryParams - Query parameters for QSH
 * @param {object} installationData - Client installation data
 * @returns {Promise<object>} Response data
 */
async function makeAuthenticatedRequest(url, method, path, queryParams = {}, installationData) {
  try {
    // Generate JWT token using the path without /wiki prefix
    const jwt = await jwtAdapter.generateJWT(
      installationData.key, 
      installationData.clientKey, 
      installationData.sharedSecret, 
      method, 
      path, 
      queryParams
    );
    
    // Make request with JWT
    console.log(`Fetching from URL: ${url}`);
    const response = await fetch(url, {
      method: method,
      headers: {
        'Authorization': `JWT ${jwt}`,
        'Accept': 'application/json'
      }
    });
    
    // Check if request was successful
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}, Text: ${await response.text()}`);
    }
    
    // Parse and return response
    return await response.json();
  } catch (error) {
    console.error('Error making authenticated request:', error);
    throw error;
  }
}

/**
 * Test fetching custom content using V2 API
 */
async function testFetchCustomContentV2() {
  try {
    // Define path and query parameters - Note the path format for V2 API
    const path = '/api/v2/custom-content/' + CONFIG.contentId;
    const queryParams = {
      'body-format': 'raw'
    };

    // Build the query string
    const queryString = new URLSearchParams(queryParams).toString();

    // Build the full URL - Note: for V2 API, we need to append /wiki to the base URL
    const url = `${CONFIG.baseUrl}/wiki${path}${queryString ? '?' + queryString : ''}`;

    // Make authenticated request
    const data = await makeAuthenticatedRequest(url, 'GET', path, queryParams, {
      key: CONFIG.addonKey,
      clientKey: CONFIG.clientKey,
      sharedSecret: CONFIG.sharedSecret
    });
    
    // Display results
    console.log('Successfully fetched content with V2 API:');
    console.log(`- ID: ${data.id}`);
    console.log(`- Title: ${data.title}`);
    console.log(`- Type: ${data.type}`);
    console.log(`- Space: ${data.space?.name || 'N/A'}`);
    console.log(`- Version: ${data.version.number}`);
    console.log(`- Body: ${data.body.raw.value.substring(0, 100)}...`);
    
    return true;
  } catch (error) {
    console.error('Error testing V2 API:', error);
    return false;
  }
}

/**
 * Run all tests
 */
async function runTest() {
  console.log('Starting Confluence authentication test...');
  
  // Print configuration (hide sensitive data)
  const configDisplay = { ...CONFIG };
  if (configDisplay.sharedSecret) {
    configDisplay.sharedSecret = configDisplay.sharedSecret.substring(0, 5) + '...';
  }
  console.log('Configuration:', configDisplay);
  
  // Test V2 API
  console.log('\n=== Testing V2 API ===');
  const v2Success = await testFetchCustomContentV2();
  
  // Print summary
  if (v2Success) {
    console.log('\n✅ All tests passed successfully!');
  } else {
    console.log('\n❌ Tests failed. See errors above.');
    process.exit(1);
  }
}

exports.makeAuthenticatedRequest = makeAuthenticatedRequest;

// runTest()