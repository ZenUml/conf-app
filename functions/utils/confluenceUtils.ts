import { makeAuthenticatedRequest } from "../lib/confluence-auth.cjs";

export async function getCustomContentFromConfluence(installationData, contentId) {
  const path = `/api/v2/custom-content/${contentId}`;
  const queryParams = { 'body-format': 'raw' };
  const queryString = new URLSearchParams(queryParams).toString();
  const fullUrl = `${installationData.baseUrl}${path}${queryString ? '?' + queryString : ''}`;

  return await makeAuthenticatedRequest(fullUrl, 'GET', path, queryParams, installationData);
}