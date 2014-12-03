// A script that automatically displays the Tor Circuit used for the
// current domain for the currently selected tab.
//
// This file is written in call stack order (later functions
// call earlier functions). The file can be processed
// with docco.js to produce pretty documentation.
//
// This script is to be embedded in torbutton.xul. It defines a single global function,
// runTorCircuitDisplay(host, port, password), which activates the automatic Tor
// circuit display for the current tab and any future tabs.
//
// See https://trac.torproject.org/8641

/* jshint esnext: true */
/* global document, gBrowser, Components */

// ### Main function
// __createTorCircuitDisplay(host, port, password, enablePrefName)__.
// The single function that prepares tor circuit display. Connects to a tor
// control port with the given host, port, and password, and binds to
// a named bool pref whose value determines whether the circuit display
// is enabled or disabled.
let createTorCircuitDisplay = (function () {

"use strict";

// Mozilla utilities
const Cu = Components.utils;
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/Task.jsm");

// Import the controller code.
let { controller } = Cu.import("resource://torbutton/modules/tor-control-port.js");

// Make the TorButton logger available.
let logger = Cc["@torproject.org/torbutton-logger;1"]
               .getService(Components.interfaces.nsISupports).wrappedJSObject;

// ## Circuit/stream domain and node monitoring

// A mutable map that stores the current nodes for each domain.
let domainToNodeDataMap = {},
    // A mutable map that reports `true` for IDs of "mature" circuits
    // (those that have conveyed a stream)..
    knownCircuitIDs = {},
    // A map from bridge fingerprint to its IP address.
    bridgeIDtoIPmap = new Map();

// __trimQuotes(s)__.
// Removes quotation marks around a quoted string.
let trimQuotes = s => s ? s.match(/^\"(.*)\"$/)[1] : undefined;

// __readBridgeIPs(controller)__.
// Gets a map from bridge ID to bridge IP, and stores it
// in `bridgeIDtoIPmap`.
let readBridgeIPs = function (controller) {
  Task.spawn(function* () {
    let configText = yield controller.getInfo("config-text"),
        bridgeEntries = configText.Bridge;
    if (bridgeEntries) {
      bridgeEntries.map(entry => {
        let IPplusPort, ID,
            tokens = entry.split(/\s+/);
          // First check if we have a "vanilla" bridge:
        if (tokens[0].match(/^\d+\.\d+\.\d+\.\d+/)) {
          [IPplusPort, ID] = tokens;
        // Several bridge types have a similar format:
        } else if (["fte", "obfs3", "obfs4", "scramblesuit"]
                     .indexOf(tokens[0]) >= 0) {
          [IPplusPort, ID] = tokens.slice(1);
        }
        // (For now, we aren't dealing with meek bridges and flashproxy.)
        if (IPplusPort && ID) {
          let IP = IPplusPort.split(":")[0];
          bridgeIDtoIPmap.set(ID.toUpperCase(), IP);
        }
      });
    }
  }).then(null, Cu.reportError);
};

// nodeDataForID(controller, id)__.
// Returns the type, IP and country code of a node with given ID.
// Example: `nodeDataForID(controller, "20BC91DC525C3DC9974B29FBEAB51230DE024C44")`
// => `{ type : "default", ip : "12.23.34.45", countryCode : "fr" }`
let nodeDataForID = function* (controller, id) {
  let result = {}; // type, ip, countryCode;
  if (bridgeIDtoIPmap.has(id.toUpperCase())) {
    result.ip = bridgeIDtoIPmap.get(id.toUpperCase());
    result.type = "bridge";
  } else {
    // Get the IP address for the given node ID.
    try {
      let statusMap = yield controller.getInfo("ns/id/" + id);
      result.ip = statusMap.IP;
    } catch (e) { }
    result.type = "default";
  }
  if (result.ip) {
    // Get the country code for the node's IP address.
    try {
      result.countryCode = yield controller.getInfo("ip-to-country/" + result.ip);
    } catch (e) { }
  }
  return result;
};

// __nodeDataForCircuit(controller, circuitEvent)__.
// Gets the information for a circuit.
let nodeDataForCircuit = function* (controller, circuitEvent) {
  let rawIDs = circuitEvent.circuit.map(circ => circ[0]),
      // Remove the leading '$' if present.
      ids = rawIDs.map(id => id[0] === "$" ? id.substring(1) : id);
  // Get the node data for all IDs in circuit.
  return [for (id of ids) yield nodeDataForID(controller, id)];
};

// __getCircuitStatusByID(aController, circuitID)__
// Returns the circuit status for the circuit with the given ID.
let getCircuitStatusByID = function* (aController, circuitID) {
  let circuitStatuses = yield aController.getInfo("circuit-status");
  for (let circuitStatus of circuitStatuses) {
    if (circuitStatus.id === circuitID) {
      return circuitStatus;
    }
  }
};

// __collectIsolationData(aController)__.
// Watches for STREAM SENTCONNECT events. When a SENTCONNECT event occurs, then
// we assume isolation settings (SOCKS username+password) are now fixed for the
// corresponding circuit. Whenever the first stream on a new circuit is seen,
// looks up u+p and records the node data in the domainToNodeDataMap.
let collectIsolationData = function (aController) {
  aController.watchEvent(
    "STREAM",
    streamEvent => streamEvent.StreamStatus === "SENTCONNECT",
    streamEvent => Task.spawn(function* () {
      if (!knownCircuitIDs[streamEvent.CircuitID]) {
        logger.eclog(3, "streamEvent.CircuitID: " + streamEvent.CircuitID);
        knownCircuitIDs[streamEvent.CircuitID] = true;
        let circuitStatus = yield getCircuitStatusByID(aController, streamEvent.CircuitID),
            domain = trimQuotes(circuitStatus.SOCKS_USERNAME);
        if (domain) {
          let nodeData = yield nodeDataForCircuit(aController, circuitStatus);
          domainToNodeDataMap[domain] = nodeData;
        }
      }
    }).then(null, Cu.reportError));
};

// ## User interface

// __regionBundle__.
// A list of localized region (country) names.
let regionBundle = Services.strings.createBundle(
                     "chrome://global/locale/regionNames.properties");

// __localizedCountryNameFromCode(countryCode)__.
// Convert a country code to a localized country name.
// Example: `'de'` -> `'Deutschland'` in German locale.
let localizedCountryNameFromCode = function (countryCode) {
  if (typeof(countryCode) === "undefined") return undefined;
  try {
    return regionBundle.GetStringFromName(countryCode.toLowerCase());
  } catch (e) {
    return countryCode.toUpperCase();
  }
};

// __showCircuitDisplay(show)__.
// If show === true, makes the circuit display visible.
let showCircuitDisplay = function (show) {
  document.querySelector("svg#tor-circuit").style.display = show ?
							    'block' : 'none';
};

// __nodeLines(nodeData)__.
// Takes a nodeData array of three items each like
// `{ ip : "12.34.56.78", country : "fr" }`
// and converts each node data to text, as
// `"France (12.34.56.78)"`.
let nodeLines = function (nodeData) {
  let result = ["This browser"];
  for (let {ip, countryCode, type} of nodeData) {
    let bridge = type === "bridge";
    result.push((countryCode ? localizedCountryNameFromCode(countryCode)
                             : "Unknown country") +
                " (" + (bridge ? "Bridge" : (ip || "IP unknown")) + ")");
  }
  result[4] = "Internet";
  return result;
};

// __updateCircuitDisplay()__.
// Updates the Tor circuit display SVG, showing the current domain
// and the relay nodes for that domain.
let updateCircuitDisplay = function () {
  let selectedBrowser = gBrowser.selectedBrowser;
  if (selectedBrowser) {
    let URI = selectedBrowser.currentURI,
	domain = null,
	nodeData = null;
    // Try to get a domain for this URI. Otherwise it remains null.
    try {
      domain = URI.host;
    } catch (e) { }
    if (domain) {
    // Check if we have anything to show for this domain.
      nodeData = domainToNodeDataMap[domain];
      if (nodeData) {
	// Update the displayed domain.
	document.querySelector("svg#tor-circuit text#domain").innerHTML = "(" + domain + "):";
	// Update the displayed information for the relay nodes.
	let diagramNodes = document.querySelectorAll("svg#tor-circuit text.node-text"),
            lines = nodeLines(nodeData);
	for (let i = 0; i < diagramNodes.length; ++i) {
          let line = lines[i];
          diagramNodes[i].innerHTML = line ? line : "";
	}
      }
    }
    // Only show the Tor circuit if we have a domain and node data.
    showCircuitDisplay(domain && nodeData);
  }
};

// __syncDisplayWithSelectedTab(syncOn)__.
// We may have multiple tabs, but there is only one instance of TorButton's popup
// panel for displaying the Tor circuit UI. Therefore we need to update the display
// to show the currently selected tab at its current location.
let syncDisplayWithSelectedTab = (function() {
  let listener1 = event => { updateCircuitDisplay(); },
      listener2 = { onLocationChange : function (aBrowser) {
                      if (aBrowser === gBrowser.selectedBrowser) {
                        updateCircuitDisplay();
                      }
                    } };
  return function (syncOn) {
    if (syncOn) {
      // Whenever a different tab is selected, change the circuit display
      // to show the circuit for that tab's domain.
      gBrowser.tabContainer.addEventListener("TabSelect", listener1);
      // If the currently selected tab has been sent to a new location,
      // update the circuit to reflect that.
      gBrowser.addTabsProgressListener(listener2);
      // Get started with a correct display.
      updateCircuitDisplay();
    } else {
      // Stop syncing.
      if (gBrowser.tabContainer) {
        gBrowser.tabContainer.removeEventListener("TabSelect", listener1);
      }
      gBrowser.removeTabsProgressListener(listener2);
      // Hide the display.
      showCircuitDisplay(false);
    }
  };
})();

// ## Pref utils

// __prefs__. A shortcut to Mozilla Services.prefs.
let prefs = Services.prefs;

// __getPrefValue(prefName)__
// Returns the current value of a preference, regardless of its type.
let getPrefValue = function (prefName) {
  switch(prefs.getPrefType(prefName)) {
    case prefs.PREF_BOOL: return prefs.getBoolPref(prefName);
    case prefs.PREF_INT: return prefs.getIntPref(prefName);
    case prefs.PREF_STRING: return prefs.getCharPref(prefName);
    default: return null;
  }
};

// __bindPrefAndInit(prefName, prefHandler)__
// Applies prefHandler to the current value of pref specified by prefName.
// Re-applies prefHandler whenever the value of the pref changes.
// Returns a zero-arg function that unbinds the pref.
let bindPrefAndInit = function (prefName, prefHandler) {
  let update = () => { prefHandler(getPrefValue(prefName)); },
      observer = { observe : function (subject, topic, data) {
                     if (data === prefName) {
                         update();
                     }
                   } };
  prefs.addObserver(prefName, observer, false);
  update();
  return () => { prefs.removeObserver(prefName, observer); };
};

// ## Main function

// setupDisplay(host, port, password, enablePrefName)__.
// Returns a function that lets you start/stop automatic display of the Tor circuit.
// A reference to this function (called createTorCircuitDisplay) is exported as a global.
let setupDisplay = function (host, port, password, enablePrefName) {
  let myController = null,
      stop = function() {
        if (myController) {
          syncDisplayWithSelectedTab(false);
          myController.close();
          myController = null;
        }
      },
      start = function () {
        if (!myController) {
          myController = controller(host, port || 9151, password, function (err) {
            // An error has occurred.
            logger.eclog(5, err);
            logger.eclog(5, "Disabling tor display circuit because of an error.");
            stop();
          });
          readBridgeIPs(myController);
          syncDisplayWithSelectedTab(true);
          collectIsolationData(myController);
       }
     };
  try {
    let unbindPref = bindPrefAndInit(enablePrefName, on => { if (on) start(); else stop(); });
    // When this chrome window is unloaded, we need to unbind the pref.
    window.addEventListener("unload", unbindPref);
  } catch (e) {
    logger.eclog(5, "Error: " + e.message + "\n" + e.stack);
  }
};

return setupDisplay;

// Finish createTorCircuitDisplay()
})();
