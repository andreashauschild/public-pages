/**
 * CHMED16A1 E-Rezept Utility Functions
 *
 * Utility functions for decoding Swiss E-Rezept (electronic prescription) data
 * in the CHMED16A1 format used by HIN (Health Info Net).
 *
 * Requires: js-sha3 library for Keccak-256 hashing
 * CDN: https://cdnjs.cloudflare.com/ajax/libs/js-sha3/0.8.0/sha3.min.js
 *
 * Browser Requirements:
 * - DecompressionStream API (Chrome 80+, Firefox 113+, Safari 16.4+)
 */

/**
 * Parses a CHMED16A1 URL and extracts all components
 * @param {string} url - The full E-Rezept URL
 * @returns {object} - Extracted components: payload, identity, timestamp, signature
 * @throws {Error} - If URL is invalid or missing required parameters
 */
function parseERezeptURL(url) {
    if (!url || typeof url !== 'string') {
        throw new Error('Input must be a valid URL string');
    }
    if (!url.includes('#CHMED16A1')) {
        throw new Error('URL does not contain a valid #CHMED16A1 fragment');
    }

    const fragment = url.split('#')[1];
    const payload = fragment.split('&')[0];
    const paramString = fragment.substring(payload.length);
    const params = new URLSearchParams(paramString);

    const identity = params.get('i');
    const timestamp = params.get('t');
    const signature = params.get('s');

    if (!identity || !timestamp || !signature) {
        throw new Error('Missing required URL parameters (i, t, or s)');
    }

    return { payload, identity, timestamp, signature };
}

/**
 * Calculates the Keccak-256 hash of the payload
 * @param {string} payload - The CHMED16A1 payload string
 * @returns {string} - The hash with 0x prefix
 * @throws {Error} - If js-sha3 library is not loaded
 */
function calculateDataHash(payload) {
    if (typeof keccak256 === 'undefined') {
        throw new Error('Keccak library not loaded. Include js-sha3 library.');
    }
    return '0x' + keccak256(payload);
}

/**
 * Generates the verification API URL
 * @param {string} urlOrPayload - Full URL containing CHMED16A1 data
 * @param {string} [baseApiUrl] - Base API URL (default: HIN test environment)
 * @returns {object} - Object with apiUrl and all extracted components
 */
function generateVerifyApiUrl(urlOrPayload, baseApiUrl = 'https://eprescription-test.hin.ch/api/eprescription/verify') {
    const { payload, identity, timestamp, signature } = parseERezeptURL(urlOrPayload);
    const dataHash = calculateDataHash(payload);

    const apiUrl = `${baseApiUrl}?data_hash=${dataHash}&identity=${encodeURIComponent(identity)}&timestamp=${timestamp}&signature=${signature}`;

    return { apiUrl, dataHash, identity, timestamp, signature, payload };
}

/**
 * Decodes CHMED16A1 prescription data from various input formats
 *
 * Accepts three types of input:
 * 1. Full URL: "https://eprescription-test.hin.ch/#CHMED16A1...&i=...&t=...&s=..."
 * 2. Payload string: "CHMED16A1H4sIAAA..."
 * 3. Already parsed JSON object (pass-through)
 *
 * @param {string|object} input - URL, CHMED16A1 payload, or already parsed JSON object
 * @returns {Promise<object>} - The decoded prescription JSON object
 * @throws {Error} - If input is invalid or decoding fails
 */
async function decodeCHMED16A1(input) {
    // Case 1: Already a parsed JSON object - pass through
    if (typeof input === 'object' && input !== null) {
        return input;
    }

    if (typeof input !== 'string') {
        throw new Error('Input must be a string (URL or payload) or an object');
    }

    let payload = input.trim();

    // Case 2: Full URL - extract the fragment
    if (payload.includes('#CHMED16A1')) {
        const fragment = payload.split('#')[1];
        payload = fragment.split('&')[0];
    }

    // Case 3: Payload string (must have CHMED16A1 prefix)
    if (!payload.startsWith('CHMED16A1')) {
        throw new Error('Invalid input: must contain CHMED16A1 payload');
    }

    // Strip the CHMED16A1 prefix to get base64 content
    const base64Content = payload.replace('CHMED16A1', '');

    // Base64 decode to binary
    const binaryString = atob(base64Content);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }

    // Decompress gzip using DecompressionStream API
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();

    // Read decompressed data as text and parse JSON
    const response = new Response(ds.readable);
    const jsonText = await response.text();

    return JSON.parse(jsonText);
}

/**
 * Full decode and verify - combines all functions for complete E-Rezept processing
 *
 * @param {string} url - The full E-Rezept URL
 * @returns {Promise<object>} - Complete decoded result with all data:
 *   - apiUrl: The verification API URL
 *   - dataHash: Keccak-256 hash of payload
 *   - identity: Prescriber identity
 *   - timestamp: Signature timestamp
 *   - signature: Digital signature
 *   - payload: Raw CHMED16A1 payload
 *   - prescription: Decoded prescription JSON
 */
async function decodeERezept(url) {
    const { apiUrl, dataHash, identity, timestamp, signature, payload } = generateVerifyApiUrl(url);
    const prescriptionData = await decodeCHMED16A1(payload);

    return {
        apiUrl,
        dataHash,
        identity,
        timestamp,
        signature,
        payload,
        prescription: prescriptionData
    };
}
