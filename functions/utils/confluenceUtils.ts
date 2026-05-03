export async function getCustomContentFromConfluenceForForge(apiBaseUrl, contentId, forgeOAuthUserHeader) {
  const path = `/api/v2/custom-content/${contentId}`;
  const queryParams = { 'body-format': 'raw' };
  const queryString = new URLSearchParams(queryParams).toString();

  const fullUrl = `${apiBaseUrl}${path}${queryString ? '?' + queryString : ''}`;

  return await makeAuthenticatedRequestWithOAuth(fullUrl, 'GET', forgeOAuthUserHeader);
}

async function makeAuthenticatedRequestWithOAuth(url, method, forgeOAuthUserHeader) {
  try {
    console.log(`Fetching from URL with OAuth: ${url}`);
    const headers = {
      'Accept': 'application/json',
      'Authorization': `Bearer ${forgeOAuthUserHeader}`
    };

    const response = await fetch(url, {
      method: method,
      headers: headers
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}, Text: ${await response.text()}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error making authenticated request with OAuth:', error);
    throw error;
  }
}
