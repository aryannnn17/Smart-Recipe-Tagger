const axios = require('axios');

// Google Analytics 4 Measurement Protocol configuration
const GA4_MEASUREMENT_ID = 'G-EH3PXJLQ7R';
const GA4_API_SECRET = '6WXBZMC0Sk-TFj9YUGKGPQ';
const GA4_ENDPOINT = `https://www.google-analytics.com/mp/collect?measurement_id=${GA4_MEASUREMENT_ID}&api_secret=${GA4_API_SECRET}`;

// Generate a consistent client_id for server-side events
const CLIENT_ID = 'server-1234';

/**
 * Track a server-side event to Google Analytics 4
 * @param {string} eventName - The name of the event (e.g., 'photos_api_call')
 * @param {object} params - Additional parameters for the event
 * @returns {Promise<void>}
 */
async function trackServerEvent(eventName, params = {}) {
  try {
    const payload = {
      client_id: CLIENT_ID,
      events: [
        {
          name: eventName,
          params: {
            ...params,
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV || 'development',
          },
        },
      ],
    };

    console.log(`📊 GA4 Server Event: ${eventName}`, params);

    const response = await axios.post(GA4_ENDPOINT, payload, {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 5000, // 5 second timeout
    });

    if (response.status === 204 || response.status === 200) {
      console.log(`✅ GA4 event tracked successfully: ${eventName}`);
    } else {
      console.warn(`⚠️ GA4 unexpected response status: ${response.status}`);
    }
  } catch (error) {
    // Don't let analytics errors break the application
    console.error(`❌ GA4 tracking error for event "${eventName}":`, error.message);
  }
}

/**
 * Track API call events
 * @param {string} apiName - Name of the API (e.g., 'google_photos', 'vision', 'gemini')
 * @param {object} metadata - Additional metadata about the call
 */
async function trackApiCall(apiName, metadata = {}) {
  return trackServerEvent(`${apiName}_api_call`, metadata);
}

/**
 * Track API errors
 * @param {string} apiName - Name of the API that failed
 * @param {Error|string} error - The error object or message
 * @param {object} metadata - Additional metadata
 */
async function trackApiError(apiName, error, metadata = {}) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return trackServerEvent('api_error', {
    api_name: apiName,
    error: errorMessage,
    ...metadata,
  });
}

module.exports = {
  trackServerEvent,
  trackApiCall,
  trackApiError,
};

