import ReactGA from 'react-ga4';

// Initialize Google Analytics with your Measurement ID
export const initializeAnalytics = () => {
  ReactGA.initialize('G-EH3PXJLQ7R', {
    gaOptions: {
      debug_mode: process.env.NODE_ENV === 'development',
    },
  });
  console.log('✅ Google Analytics initialized');
};

// Track page views
export const trackPageView = (path) => {
  ReactGA.send({ hitType: 'pageview', page: path });
  console.log(`📊 GA: Page view tracked - ${path}`);   
};

// Track API calls
export const trackApiCall = (apiName, label = '') => {
  ReactGA.event({
    category: 'API',
    action: apiName,
    label: label,
  });
  console.log(`📊 GA: API call tracked - ${apiName}${label ? ` (${label})` : ''}`);
};

// Track custom events
export const trackEvent = (category, action, label = '', value = null) => {
  const eventParams = {
    category,
    action,
    label,
  };
  
  if (value !== null) {
    eventParams.value = value;
  }
  
  ReactGA.event(eventParams);
  console.log(`📊 GA: Event tracked - ${category}/${action}${label ? `/${label}` : ''}`);
};

// Track errors
export const trackError = (errorMessage, fatal = false) => {
  ReactGA.event({
    category: 'Error',
    action: errorMessage,
    label: fatal ? 'Fatal' : 'Non-Fatal',
  });
  console.log(`📊 GA: Error tracked - ${errorMessage}`);
};

export default {
  initializeAnalytics,
  trackPageView,
  trackApiCall,
  trackEvent,
  trackError,
};

