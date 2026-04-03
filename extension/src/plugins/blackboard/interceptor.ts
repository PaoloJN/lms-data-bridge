// XHR/Fetch interceptor for Blackboard Ultra
// Captures API responses that Blackboard's own UI fetches, avoiding CORS issues
// This runs as a page script (injected into the page context, not the extension context)

export interface InterceptedResponse {
  url: string;
  method: string;
  status: number;
  body: unknown;
  timestamp: string;
}

// Patterns we care about capturing
const CAPTURE_PATTERNS = [
  "/learn/api/public/v1/users/me",
  "/learn/api/public/v1/users/",
  "/learn/api/public/v1/courses",
  "/learn/api/public/v1/calendars",
  "/learn/api/",
];

function shouldCapture(url: string): boolean {
  return CAPTURE_PATTERNS.some((pattern) => url.includes(pattern));
}

// This code gets injected into the page as a <script> tag
// so it runs in the page's JS context and can intercept fetch/XHR
export function getInterceptorScript(): string {
  return `
(function() {
  if (window.__lmsBridgeInterceptorInstalled) return;
  window.__lmsBridgeInterceptorInstalled = true;

  const CAPTURE_PATTERNS = ${JSON.stringify(CAPTURE_PATTERNS)};

  function shouldCapture(url) {
    return CAPTURE_PATTERNS.some(p => url.includes(p));
  }

  // Intercept fetch
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const request = args[0];
    const url = typeof request === 'string' ? request : request.url;
    const response = await originalFetch.apply(this, args);

    if (shouldCapture(url)) {
      try {
        const clone = response.clone();
        const body = await clone.json();
        window.postMessage({
          type: '__LMS_BRIDGE_INTERCEPT__',
          payload: {
            url: url,
            method: (args[1]?.method || 'GET').toUpperCase(),
            status: response.status,
            body: body,
            timestamp: new Date().toISOString(),
          }
        }, '*');
      } catch(e) {
        // Response wasn't JSON, skip
      }
    }

    return response;
  };

  // Intercept XMLHttpRequest
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__lmsBridgeUrl = url;
    this.__lmsBridgeMethod = method;
    return originalXHROpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function(...args) {
    if (this.__lmsBridgeUrl && shouldCapture(this.__lmsBridgeUrl)) {
      this.addEventListener('load', function() {
        try {
          const body = JSON.parse(this.responseText);
          window.postMessage({
            type: '__LMS_BRIDGE_INTERCEPT__',
            payload: {
              url: this.__lmsBridgeUrl,
              method: (this.__lmsBridgeMethod || 'GET').toUpperCase(),
              status: this.status,
              body: body,
              timestamp: new Date().toISOString(),
            }
          }, '*');
        } catch(e) {
          // Not JSON, skip
        }
      });
    }
    return originalXHRSend.apply(this, args);
  };

  console.log('[LMS Bridge] Interceptor installed');
})();
`;
}
