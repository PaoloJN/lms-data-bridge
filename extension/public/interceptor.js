(function() {
  if (window.__lmsBridgeInterceptorInstalled) return;
  window.__lmsBridgeInterceptorInstalled = true;

  var CAPTURE_PATTERNS = [
    "/learn/api/public/v1/users/me",
    "/learn/api/public/v1/users/",
    "/learn/api/public/v1/courses",
    "/learn/api/public/v1/calendars",
    "/learn/api/"
  ];

  function shouldCapture(url) {
    return CAPTURE_PATTERNS.some(function(p) { return url.includes(p); });
  }

  // Intercept fetch
  var originalFetch = window.fetch;
  window.fetch = async function() {
    var args = arguments;
    var request = args[0];
    var url = typeof request === 'string' ? request : request.url;
    var response = await originalFetch.apply(this, args);

    if (shouldCapture(url)) {
      try {
        var clone = response.clone();
        var body = await clone.json();
        window.postMessage({
          type: '__LMS_BRIDGE_INTERCEPT__',
          payload: {
            url: url,
            method: (args[1] && args[1].method || 'GET').toUpperCase(),
            status: response.status,
            body: body,
            timestamp: new Date().toISOString()
          }
        }, '*');
      } catch(e) {
        // Response wasn't JSON, skip
      }
    }

    return response;
  };

  // Intercept XMLHttpRequest
  var originalXHROpen = XMLHttpRequest.prototype.open;
  var originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url) {
    this.__lmsBridgeUrl = url;
    this.__lmsBridgeMethod = method;
    return originalXHROpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function() {
    if (this.__lmsBridgeUrl && shouldCapture(this.__lmsBridgeUrl)) {
      this.addEventListener('load', function() {
        try {
          var body = JSON.parse(this.responseText);
          window.postMessage({
            type: '__LMS_BRIDGE_INTERCEPT__',
            payload: {
              url: this.__lmsBridgeUrl,
              method: (this.__lmsBridgeMethod || 'GET').toUpperCase(),
              status: this.status,
              body: body,
              timestamp: new Date().toISOString()
            }
          }, '*');
        } catch(e) {
          // Not JSON, skip
        }
      });
    }
    return originalXHRSend.apply(this, arguments);
  };

  console.log('[LMS Bridge] Interceptor installed');
})();
