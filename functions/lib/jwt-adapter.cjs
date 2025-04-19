/**
 * JWT Adapter Module
 * 
 * This module provides a CommonJS wrapper around the ES module atlassian-jwt.js
 * It dynamically imports the ES module and exposes its functionality through CommonJS exports.
 */

const crypto = require('node:crypto');

// Function to generate a canonical request string for QSH
function getCanonicalRequest(method, path, queryParams = {}) {
  // Sort query parameters alphabetically
  const sortedParams = Object.entries(queryParams)
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');

  // Construct canonical request
  return `${method.toUpperCase()}&${path}&${sortedParams}`;
}

// Function to generate a query string hash (QSH) for JWT
function generateQsh(method, path, queryParams = {}) {
  const canonicalRequest = getCanonicalRequest(method, path, queryParams);
  console.log('Canonical request:', canonicalRequest);
  
  // Create SHA-256 hash
  const hash = crypto.createHash('sha256')
    .update(canonicalRequest)
    .digest('hex')
    .toLowerCase();
  
  console.log('QSH:', hash);
  return hash;
}

/**
 * Generate a JWT token for Confluence authentication
 * 
 * @param {string} addonKey - The addon key
 * @param {string} clientKey - The client key
 * @param {string} sharedSecret - The shared secret
 * @param {string} method - HTTP method
 * @param {string} path - Request path
 * @param {object} queryParams - Query parameters
 * @returns {Promise<string>} JWT token
 */
async function generateJWT(addonKey, clientKey, sharedSecret, method, path, queryParams = {}) {
  const now = Math.floor(Date.now() / 1000);
  
  // For Confluence Cloud, the QSH is calculated on the path WITHOUT the /wiki prefix
  const qsh = generateQsh(method, path, queryParams);
  
  // Create JWT payload
  const payload = {
    iss: addonKey,
    iat: now,
    exp: now + 60 * 5,
    qsh: qsh,
    sub: clientKey
  };
  
  console.log('JWT payload:', payload);
  
  // Create JWT header
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };
  
  // Encode header and payload
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  
  // Create signature
  const signatureInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.createHmac('sha256', sharedSecret)
    .update(signatureInput)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  
  // Combine all parts
  const jwt = `${encodedHeader}.${encodedPayload}.${signature}`;
  console.log('Standard JWT:', jwt);
  
  return jwt;
}

// Use dynamic import to load the ES module
async function loadJwtModule() {
  try {
    // Import the ES module dynamically
    const jwtModule = await import('./atlassian-jwt.js');
    
    // Return the imported module
    return {
      AsymmetricAlgorithm: jwtModule.AsymmetricAlgorithm,
      SymmetricAlgorithm: jwtModule.SymmetricAlgorithm,
      fromExpressRequest: jwtModule.fromExpressRequest,
      fromMethodAndUrl: jwtModule.fromMethodAndUrl,
      fromMethodAndPathAndBody: jwtModule.fromMethodAndPathAndBody,
      version: jwtModule.version,
      decodeAsymmetric: jwtModule.decodeAsymmetric,
      getKeyId: jwtModule.getKeyId,
      getAlgorithm: jwtModule.getAlgorithm,
      decodeSymmetric: jwtModule.decodeSymmetric,
      encodeSymmetric: jwtModule.encodeSymmetric,
      encodeAsymmetric: jwtModule.encodeAsymmetric,
      createCanonicalRequest: jwtModule.createCanonicalRequest,
      createQueryStringHash: jwtModule.createQueryStringHash
    };
  } catch (error) {
    console.error('Error loading JWT module:', error);
    throw error;
  }
}

// Export the functions
module.exports = { 
  generateJWT,
  generateQsh,
  getCanonicalRequest,
  loadJwtModule
};