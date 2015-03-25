// # domain-isolator.js
// A component for TorBrowser that puts requests from different
// first party domains on separate tor circuits.

// This file is written in call stack order (later functions
// call earlier functions). The code file can be processed
// with docco.js to provide clear documentation.

/* jshint moz: true */
/* global Components, console, XPCOMUtils */

// ### Abbreviations
const Cc = Components.classes, Ci = Components.interfaces, Cu = Components.utils;

// Make the logger available.
let logger = Cc["@torproject.org/torbutton-logger;1"]
               .getService(Components.interfaces.nsISupports).wrappedJSObject;

// ## mozilla namespace.
// Useful functionality for interacting with Mozilla services.
let mozilla = mozilla || {};

// __mozilla.protocolProxyService__.
// Mozilla's protocol proxy service, useful for managing proxy connections made
// by the browser.
mozilla.protocolProxyService = Cc["@mozilla.org/network/protocol-proxy-service;1"]
                                 .getService(Ci.nsIProtocolProxyService);

// __mozilla.thirdPartyUtil__.
// Mozilla's Thirdy Party Utilities, for figuring out first party domain.
mozilla.thirdPartyUtil = Cc["@mozilla.org/thirdpartyutil;1"]
                           .getService(Ci.mozIThirdPartyUtil);
                           
// __mozilla.registerProxyChannelFilter(filterFunction, positionIndex)__.
// Registers a proxy channel filter with the Mozilla Protocol Proxy Service,
// which will help to decide the proxy to be used for a given channel.
// The filterFunction should expect two arguments, (aChannel, aProxy),
// where aProxy is the proxy or list of proxies that would be used by default
// for the given channel, and should return a new Proxy or list of Proxies.
mozilla.registerProxyChannelFilter = function (filterFunction, positionIndex) {
  let proxyFilter = {
    applyFilter : function (aProxyService, aChannel, aProxy) {
      return filterFunction(aChannel, aProxy);
    }
  };
  mozilla.protocolProxyService.registerChannelFilter(proxyFilter, positionIndex);
};

// ## tor functionality.
let tor = tor || {};

// __tor.noncesForDomains__.
// A mutable map that records what nonce we are using for each domain.
tor.noncesForDomains = {};

// __tor.unknownDirtySince__.
// Specifies when the current catch-all circuit was first used
tor.unknownDirtySince = Date.now();

// __tor.socksProxyCredentials(originalProxy, domain)__.
// Takes a proxyInfo object (originalProxy) and returns a new proxyInfo
// object with the same properties, except the username is set to the 
// the domain, and the password is a nonce.
tor.socksProxyCredentials = function (originalProxy, domain) {
  // Check if we already have a nonce. If not, create
  // one for this domain.
  if (!tor.noncesForDomains.hasOwnProperty(domain)) {
    tor.noncesForDomains[domain] = 0;
  }
  let proxy = originalProxy.QueryInterface(Ci.nsIProxyInfo);
  return mozilla.protocolProxyService
           .newSOCKSProxyInfo(proxy.host,
                              proxy.port,
                              domain, // username
                              tor.noncesForDomains[domain].toString(), // password
                              proxy.flags,
                              proxy.failoverTimeout,
                              proxy.failoverProxy);
};

tor.newCircuitForDomain = function(domain) {
  // Check if we already have a nonce. If not, create
  // one for this domain.
  if (!tor.noncesForDomains.hasOwnProperty(domain)) {
    tor.noncesForDomains[domain] = 0;
  } else {
    tor.noncesForDomains[domain] += 1;
  }
  logger.eclog(3, "New domain isolation count " +tor.noncesForDomains[domain] + " for " + domain);
}

// __tor.isolateCircuitsByDomain()__.
// For every HTTPChannel, replaces the default SOCKS proxy with one that authenticates
// to the SOCKS server (the tor client process) with a username (the first party domain)
// and a nonce password. Tor provides a separate circuit for each username+password
// combination.
tor.isolateCircuitsByDomain = function () {
  mozilla.registerProxyChannelFilter(function (aChannel, aProxy) {
    try {
      let channel = aChannel.QueryInterface(Ci.nsIHttpChannel),
          firstPartyURI = mozilla.thirdPartyUtil.getFirstPartyURIFromChannel(channel, true)
                            .QueryInterface(Ci.nsIURI),
          firstPartyDomain = mozilla.thirdPartyUtil
                               .getFirstPartyHostForIsolation(firstPartyURI),
          proxy = aProxy.QueryInterface(Ci.nsIProxyInfo),
          replacementProxy = tor.socksProxyCredentials(aProxy, firstPartyDomain);
      logger.eclog(3, "tor SOCKS: " + channel.URI.spec + " via " +
                      replacementProxy.username + ":" + replacementProxy.password); 
      return replacementProxy;
    } catch (err) {
      if (Date.now() - tor.unknownDirtySince > 1000*10*60) {
        logger.eclog(3, "tor catchall circuit has been dirty for over 10 minutes. Rotating.");
        tor.newCircuitForDomain("--unknown--");
        tor.unknownDirtySince = Date.now();
      }
      let replacementProxy = tor.socksProxyCredentials(aProxy, "--unknown--");

      logger.eclog(3, "tor SOCKS isolation catchall: " + aChannel.URI.spec + " via " +
                      replacementProxy.username + ":" + replacementProxy.password);
      return replacementProxy;
    }
  }, 0);
};

// ## XPCOM component construction.
// Module specific constants
const kMODULE_NAME = "TorBrowser Domain Isolator";
const kMODULE_CONTRACTID = "@torproject.org/domain-isolator;1";
const kMODULE_CID = Components.ID("e33fd6d4-270f-475f-a96f-ff3140279f68");

// Import XPCOMUtils object.
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

// DomainIsolator object.
function DomainIsolator() {
    this.wrappedJSObject = this;
}
// Firefox component requirements
DomainIsolator.prototype = {
  QueryInterface: XPCOMUtils.generateQI([Ci.nsISupports, Ci.nsIObserver]),
  classDescription: kMODULE_NAME,
  classID: kMODULE_CID,
  contractID: kMODULE_CONTRACTID,
  observe: function (subject, topic, data) {
    if (topic === "profile-after-change") {
      logger.eclog(3, "domain isolator: set up isolating circuits by domain");
      tor.isolateCircuitsByDomain();
    }
  },
  newCircuitForDomain: function (domain) {
    tor.newCircuitForDomain(domain);
  },

  wrappedJSObject: null
};

// Assign factory to global object.
const NSGetFactory = XPCOMUtils.generateNSGetFactory([DomainIsolator]);
