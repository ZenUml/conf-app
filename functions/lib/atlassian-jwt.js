"use strict";

import * as crypto_1 from 'node:crypto';
import * as url from 'node:url';

/*
 * Based off jwt-simple:
 * https://github.com/hokaccha/node-jwt-simple
 *
 * Add Atlassian query string hash verification:
 * https://developer.atlassian.com/cloud/jira/platform/understanding-jwt/
 *
 * JSON Web Token encode and decode module for node.js
 *
 * Copyright(c) 2011 Kazuhito Hokamura
 * MIT Licensed
 */
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createQueryStringHash = exports.createCanonicalRequest = exports.encodeAsymmetric = exports.encodeSymmetric = exports.decodeSymmetric = exports.getAlgorithm = exports.getKeyId = exports.decodeAsymmetric = exports.version = exports.fromMethodAndPathAndBody = exports.fromMethodAndUrl = exports.fromExpressRequest = exports.SymmetricAlgorithm = exports.AsymmetricAlgorithm = void 0;
var lodash_1 = __importDefault(require("lodash"));
var jsuri_1 = __importDefault(require("./jsuri"));

// https://auth0.com/blog/critical-vulnerabilities-in-json-web-token-libraries/
var AsymmetricAlgorithm;
(function (AsymmetricAlgorithm) {
    AsymmetricAlgorithm["RS256"] = "RS256";
})(AsymmetricAlgorithm || (exports.AsymmetricAlgorithm = AsymmetricAlgorithm = {}));
var SymmetricAlgorithm;
(function (SymmetricAlgorithm) {
    SymmetricAlgorithm["HS256"] = "HS256";
    SymmetricAlgorithm["HS384"] = "HS384";
    SymmetricAlgorithm["HS512"] = "HS512";
})(SymmetricAlgorithm || (exports.SymmetricAlgorithm = SymmetricAlgorithm = {}));
function getAlgorithmFromString(rawAlgorithm) {
    switch (rawAlgorithm) {
        case 'HS256':
            return SymmetricAlgorithm.HS256;
        case 'HS384':
            return SymmetricAlgorithm.HS384;
        case 'HS512':
            return SymmetricAlgorithm.HS512;
        case 'RS256':
            return AsymmetricAlgorithm.RS256;
        default:
            return undefined;
    }
}
/**
 * Supported algorithm mapping.
 */
var algorithmMap = {
    HS256: 'sha256',
    HS384: 'sha384',
    HS512: 'sha512',
    RS256: 'RSA-SHA256'
};
function fromExpressRequest(eReq) {
    // req.originalUrl represents the full URL and req.path represents the URL from the last router
    // (https://expressjs.com/en/4x/api.html#req.originalUrl)
    // However, since some people depend on this lib without using real req object but rather mock them, we need this
    // fallback for it to not break.
    var pathname = eReq.originalUrl ? url.parse(eReq.originalUrl).pathname : eReq.path;
    return {
        method: eReq.method,
        pathname: pathname,
        query: eReq.query,
        body: eReq.body
    };
}
exports.fromExpressRequest = fromExpressRequest;
function fromMethodAndUrl(method, rawUrl) {
    var parsedUrl = url.parse(rawUrl, true);
    return {
        method: method,
        pathname: parsedUrl.pathname,
        query: parsedUrl.query
    };
}
exports.fromMethodAndUrl = fromMethodAndUrl;
function fromMethodAndPathAndBody(method, rawUrl, body) {
    var parsedUrl = url.parse(rawUrl, false);
    return {
        method: method,
        pathname: parsedUrl.pathname,
        body: body
    };
}
exports.fromMethodAndPathAndBody = fromMethodAndPathAndBody;
/**
 * The separator between sections of a canonical query.
 */
var CANONICAL_QUERY_SEPARATOR = '&';
exports.version = '2.0.3';
/**
 * Decodes JWT string to object.
 * The encoding algorithm must be RS256.
 *
 * @param token JWT to decode
 * @param key Key used to decode
 * @param signedAlgorithm should match the header.alg
 * @param noVerify optional, set to true to skip the result verification
 *
 * @return Decoded JWT object
 *
 * @api public
 */
var decodeAsymmetric = function jwt_decode_asymmetric(token, key, signedAlgorithm, noVerify) {
    // All segment should be base64
    var _a = getTokenSegments(token), headerSeg = _a[0], payloadSeg = _a[1], signatureSeg = _a[2];
    // Base64 decode and parse JSON
    var _b = getHeaderAndPayload(headerSeg, payloadSeg), header = _b[0], payload = _b[1];
    validateAsymmetricAlgorithm(header.alg, signedAlgorithm);
    if (!noVerify) {
        verifySignature(headerSeg, payloadSeg, signatureSeg, key, header.alg);
    }
    return payload;
};
exports.decodeAsymmetric = decodeAsymmetric;
function getKeyId(token) {
    var _a = getTokenSegments(token), headerSeg = _a[0], payloadSeg = _a[1];
    // Base64 decode and parse JSON
    var header = getHeaderAndPayload(headerSeg, payloadSeg)[0];
    return header && header.kid;
}
exports.getKeyId = getKeyId;
function getAlgorithm(token) {
    var _a = getTokenSegments(token), headerSeg = _a[0], payloadSeg = _a[1];
    // Base64 decode and parse JSON
    var header = getHeaderAndPayload(headerSeg, payloadSeg)[0];
    return header && header.alg;
}
exports.getAlgorithm = getAlgorithm;
/**
 * Decodes JWT string to object.
 * The encoding algorithm must be symmetric (HS256, HS384, or HS512).
 *
 * @param token JWT to decode
 * @param key Key used to decode
 * @param signedAlgorithm should match the header.alg
 * @param noVerify optional, set to true to skip the result verification
 *
 * @return Decoded JWT object
 *
 * @api public
 */
var decodeSymmetric = function jwt_decode_symmetric(token, key, signedAlgorithm, noVerify) {
    // All segment should be base64
    var _a = getTokenSegments(token), headerSeg = _a[0], payloadSeg = _a[1], signatureSeg = _a[2];
    // Base64 decode and parse JSON
    var _b = getHeaderAndPayload(headerSeg, payloadSeg), header = _b[0], payload = _b[1];
    // Normalize 'aud' claim, the spec allows both String and Array
    if (payload.aud && !lodash_1.default.isArray(payload.aud)) {
        payload.aud = [payload.aud];
    }
    validateSymmetricAlgorithm(header.alg, signedAlgorithm);
    if (!noVerify) {
        verifySignature(headerSeg, payloadSeg, signatureSeg, key, header.alg);
    }
    return payload;
};
exports.decodeSymmetric = decodeSymmetric;
/**
 * Encodes JWT object to string.
 * The encoding algorithm must be symmetric (HS256, HS384, or HS512).
 *
 * @param payload Payload object to encode
 * @param key Key used to encode
 * @param algorithm Optional, must be HS256, HS384, or HS512; default is HS256
 *
 * @return Encoded JWT string
 *
 * @api public
 */
var encodeSymmetric = function jwt_encode_symmetric(payload, key, algorithm) {
    var _a = validateSupportedAlgorithm(key, algorithm), signingAlgorithm = _a[0], signingMethod = _a[1];
    if (!SymmetricAlgorithm[signingAlgorithm]) {
        throw new Error('Algorithm "' + algorithm + '" is not symmetric');
    }
    // typ is fixed value
    var header = { typ: 'JWT', alg: signingAlgorithm };
    // Create segments, all segment should be base64 string
    var segments = [];
    segments.push(base64urlEncode(JSON.stringify(header)));
    segments.push(base64urlEncode(JSON.stringify(payload)));
    segments.push(sign(segments.join('.'), key, signingMethod));
    return segments.join('.');
};
exports.encodeSymmetric = encodeSymmetric;
/**
 * Encodes JWT object to string.
 * The encoding algorithm must be RS256
 *
 * @param payload  Payload object to encode
 * @param key Key used to encode
 * @param algorithm supports only RS256
 * @returns
 */
var encodeAsymmetric = function jwt_encode_asymmetric(payload, key, algorithm, header) {
    var _a = validateSupportedAlgorithm(key, algorithm), signingAlgorithm = _a[0], signingMethod = _a[1];
    if (!AsymmetricAlgorithm[signingAlgorithm]) {
        throw new Error('Algorithm "' + algorithm + '" is not asymmetric');
    }
    // typ is fixed value
    var defaultHeader = { typ: 'JWT', alg: signingAlgorithm };
    // Create segments, all segment should be base64 string
    var segments = [];
    segments.push(base64urlEncode(JSON.stringify(header ? __assign(__assign({}, defaultHeader), { kid: header.kid }) : defaultHeader)));
    segments.push(base64urlEncode(JSON.stringify(payload)));
    segments.push(sign(segments.join('.'), key, signingMethod));
    return segments.join('.');
};
exports.encodeAsymmetric = encodeAsymmetric;
function createCanonicalRequest(req, checkBodyForParams, baseUrl) {
    return canonicalizeMethod(req) +
        CANONICAL_QUERY_SEPARATOR +
        canonicalizeUri(req, baseUrl) +
        CANONICAL_QUERY_SEPARATOR +
        canonicalizeQueryString(req, checkBodyForParams);
}
exports.createCanonicalRequest = createCanonicalRequest;
function createQueryStringHash(req, checkBodyForParams, baseUrl) {
    return (0, crypto_1.createHash)(algorithmMap.HS256)
        .update(createCanonicalRequest(req, checkBodyForParams, baseUrl))
        .digest('hex');
}
exports.createQueryStringHash = createQueryStringHash;
/**
 * Private util functions.
 */
function validateSupportedAlgorithm(key, algorithm) {
    // Check key
    if (!key) {
        throw new Error('Require key');
    }
    // Check algorithm, default is HS256
    var signingAlgorithm = algorithm || 'HS256';
    var alg = getAlgorithmFromString(signingAlgorithm);
    if (!alg) {
        throw new Error('Algorithm "' + algorithm + '" is not supported');
    }
    var signingMethod = algorithmMap[alg];
    if (!signingMethod) {
        throw new Error('Algorithm "' + algorithm + '" is not supported');
    }
    return [signingAlgorithm, signingMethod];
}
function validateAsymmetricAlgorithm(algorithm, expectedAlgorithm) {
    // Asymmetric algorithm: Check if expected algorithm is defined and it matches the header
    if (algorithm !== expectedAlgorithm) {
        throw new Error('Algorithm from the header "' + algorithm + '" does not match');
    }
    if (!AsymmetricAlgorithm[expectedAlgorithm] ||
        !AsymmetricAlgorithm[algorithm]) {
        throw new Error('Algorithm from the header "' + algorithm + '" is not asymmetric');
    }
}
function validateSymmetricAlgorithm(algorithm, expectedAlgorithm) {
    // Symmetric algorithm: Check if expected algorithm is defined and it matches the header
    if (algorithm !== expectedAlgorithm) {
        throw new Error('Algorithm from the header "' + algorithm + '" does not match');
    }
    if (!SymmetricAlgorithm[expectedAlgorithm] ||
        !SymmetricAlgorithm[algorithm]) {
        throw new Error('Algorithm from the header "' + algorithm + '" is not symmetric');
    }
}
function verifySignature(headerSeg, payloadSeg, signatureSeg, key, algorithm) {
    var _a = validateSupportedAlgorithm(key, algorithm), signingMethod = _a[1];
    // Verify signature
    var signingInput = [headerSeg, payloadSeg].join('.');
    var verified = false;
    if (AsymmetricAlgorithm[algorithm]) {
        verified = (0, crypto_1.createVerify)(signingMethod).update(signingInput).verify(key, base64urlUnescape(signatureSeg), 'base64');
    }
    else {
        var signingOutput = sign(signingInput, key, signingMethod);
        var signingOutputBuf = Buffer.from(signingOutput, 'ascii');
        var signatureSegBuf = Buffer.from(signatureSeg, 'ascii');
        verified = signingOutputBuf.length === signatureSegBuf.length
            && (0, crypto_1.timingSafeEqual)(signingOutputBuf, signatureSegBuf);
    }
    if (!verified) {
        throw new Error('Signature verification failed for input: ' + signingInput + ' with method ' + signingMethod);
    }
}
function sign(input, key, method) {
    var base64str;
    if (method !== 'RSA-SHA256') {
        base64str = (0, crypto_1.createHmac)(method, key).update(input).digest('base64');
    }
    else {
        base64str = (0, crypto_1.createSign)(method).update(input).sign(key, 'base64');
    }
    return base64urlEscape(base64str);
}
function getTokenSegments(token) {
    var segments = token.split('.');
    if (segments.length !== 3) {
        throw new Error('Not enough or too many JWT token segments; should be 3');
    }
    var headerSeg = segments[0];
    var payloadSeg = segments[1];
    var signatureSeg = segments[2];
    return [headerSeg, payloadSeg, signatureSeg];
}
function getHeaderAndPayload(headerSeg, payloadSeg) {
    var header = JSON.parse(base64urlDecode(headerSeg));
    var payload = JSON.parse(base64urlDecode(payloadSeg));
    // Normalize 'aud' claim, the spec allows both String and Array
    if (payload.aud && !lodash_1.default.isArray(payload.aud)) {
        payload.aud = [payload.aud];
    }
    return [header, payload];
}
function base64urlDecode(str) {
    return Buffer.from(base64urlUnescape(str), 'base64').toString();
}
function base64urlUnescape(str) {
    str += Array(5 - str.length % 4).join('=');
    return str.replace(/\-/g, '+').replace(/_/g, '/');
}
function base64urlEncode(str) {
    return base64urlEscape(Buffer.from(str).toString('base64'));
}
function base64urlEscape(str) {
    return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function canonicalizeMethod(req) {
    return req.method.toUpperCase();
}
function canonicalizeUri(req, baseUrlString) {
    var path = req.pathname;
    var baseUrl = new jsuri_1.default(baseUrlString);
    var baseUrlPath = baseUrl.path();
    if (path && path.indexOf(baseUrlPath) === 0) {
        path = path.slice(baseUrlPath.length);
    }
    if (!path || path.length === 0) {
        return '/';
    }
    // If the separator is not URL encoded then the following URLs have the same query-string-hash:
    //   https://djtest9.jira-dev.com/rest/api/2/project&a=b?x=y
    //   https://djtest9.jira-dev.com/rest/api/2/project?a=b&x=y
    path = path.replace(new RegExp(CANONICAL_QUERY_SEPARATOR, 'g'), encodeRfc3986(CANONICAL_QUERY_SEPARATOR));
    // Prefix with /
    if (path[0] !== '/') {
        path = '/' + path;
    }
    // Remove trailing /
    if (path.length > 1 && path[path.length - 1] === '/') {
        path = path.substring(0, path.length - 1);
    }
    return path;
}
function canonicalizeQueryString(req, checkBodyForParams) {
    var queryParams = req.query;
    var method = req.method.toUpperCase();
    // Apache HTTP client (or something) sometimes likes to take the query string and put it into the request body
    // if the method is PUT or POST
    if (checkBodyForParams && lodash_1.default.isEmpty(queryParams) && (method === 'POST' || method === 'PUT')) {
        queryParams = req.body;
    }
    var sortedQueryString = new Array(), query = lodash_1.default.extend({}, queryParams);
    if (!lodash_1.default.isEmpty(query)) {
        // Remove the 'jwt' query string param
        delete query.jwt;
        lodash_1.default.each(lodash_1.default.keys(query).sort(), function (key) {
            // The __proto__ field can sometimes sneak in depending on what node version is being used.
            // Get rid of it or the qsh calculation will be wrong.
            if (key === '__proto__') {
                return;
            }
            var param = query[key];
            var paramValue = '';
            if (Array.isArray(param)) {
                paramValue = lodash_1.default.map(param.sort(), encodeRfc3986).join(',');
            }
            else {
                paramValue = encodeRfc3986(param);
            }
            sortedQueryString.push(encodeRfc3986(key) + '=' + paramValue);
        });
    }
    return sortedQueryString.join('&');
}
/**
 * We follow the same rules as specified in OAuth1:
 * Percent-encode everything but the unreserved characters according to RFC-3986:
 * unreserved  = ALPHA / DIGIT / "-" / "." / "_" / "~"
 * See http://tools.ietf.org/html/rfc3986
 */
function encodeRfc3986(value) {
    return encodeURIComponent(value)
        .replace(/[!'()]/g, escape)
        .replace(/\*/g, '%2A');
}
