/**
 * Proxy support for blocked regions.
 * Set TELEGRAM_PROXY env var, e.g.:
 *   http://user:pass@proxy-host:8080
 *   socks5://user:pass@proxy-host:1080
 */
const TELEGRAM_PROXY = process.env.TELEGRAM_PROXY || '';

let _dispatcher = null;

function getDispatcher() {
  if (!TELEGRAM_PROXY) return undefined;
  if (_dispatcher) return _dispatcher;

  var { ProxyAgent } = require('undici');
  _dispatcher = new ProxyAgent(TELEGRAM_PROXY);
  console.log('[proxy] Using proxy:', TELEGRAM_PROXY);
  return _dispatcher;
}

/** Grammy bot options with proxy */
function getBotOptions() {
  var dispatcher = getDispatcher();
  if (!dispatcher) return {};
  return { client: { baseFetchConfig: { dispatcher } } };
}

/** Download URL through proxy, returns Buffer */
function downloadThroughProxy(url) {
  return new Promise(function (resolve, reject) {
    var dispatcher = getDispatcher();
    var mod = dispatcher ? require('undici') : require('https');
    var options = dispatcher ? { dispatcher } : {};

    mod.request(url, options, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () { resolve(Buffer.concat(chunks)); });
    }).on('error', reject);
  });
}

module.exports = { getBotOptions, downloadThroughProxy, hasProxy: !!TELEGRAM_PROXY };
