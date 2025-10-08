import { makeAuthenticatedRequest } from "../lib/confluence-auth.cjs";
const fetch = require('node-fetch');

export async function getCustomContentFromConfluence(installationData, contentId, forgeOAuthUser) {
  const path = `/api/v2/custom-content/${contentId}`;
  const queryParams = { 'body-format': 'raw' };
  const queryString = new URLSearchParams(queryParams).toString();
  const fullUrl = `${installationData.baseUrl}${path}${queryString ? '?' + queryString : ''}`;

  // Use OAuth function if OAuth header is present, otherwise use regular JWT authentication
  if (forgeOAuthUser) {
    return await makeAuthenticatedRequestWithOAuth(fullUrl, 'GET', path, queryParams, forgeOAuthUser);
  }

  return await makeAuthenticatedRequest(fullUrl, 'GET', path, queryParams, installationData);
}

/**
 * Make an authenticated request to Confluence with OAuth user header
 * @param {string} url - Full URL to fetch
 * @param {string} method - HTTP method
 * @param {string} path - Request path
 * @param {object} queryParams - Query parameters
 * @param {string} forgeOAuthUser - OAuth user header for Forge authentication
 * @returns {Promise<object>} Response data
 */
async function makeAuthenticatedRequestWithOAuth(url, method, path, queryParams = {}, forgeOAuthUser) {
  try {
    // Make request with Bearer token (OAuth)
    console.log(`Fetching from URL with OAuth: ${url}`);
    const headers = {
      'Accept': 'application/json',
      'Authorization': `Bearer ${forgeOAuthUser}`
    };
    
    const response = await fetch(url, {
      method: method,
      headers: headers
    });
    
    // Check if request was successful
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}, Text: ${await response.text()}`);
    }
    
    // Parse and return response
    return await response.json();
  } catch (error) {
    console.error('Error making authenticated request with OAuth:', error);
    throw error;
  }
}