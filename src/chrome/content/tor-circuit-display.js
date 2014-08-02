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
// __runTorCircuitDisplay(host, port, password)__.
// The single function we run to activate automatic display of the Tor circuit..
let runTorCircuitDisplay = (function () {

"use strict";

// Mozilla utilities
const Cu = Components.utils;
Cu.import("resource://gre/modules/Services.jsm");

// Import the controller code.
let { controller } = Cu.import("resource://torbutton/modules/tor-control-port.js");

// Make the TorButton logger available.
let logger = Cc["@torproject.org/torbutton-logger;1"]
               .getService(Components.interfaces.nsISupports).wrappedJSObject;

// __regionBundle__.
// A list of localized region (country) names.
let regionBundle = Services.strings.createBundle(
                     "chrome://global/locale/regionNames.properties");

// __localizedCountryNameFromCode(countryCode)__.
// Convert a country code to a localized country name.
// Example: `'de'` -> `'Deutschland'` in German locale.
let localizedCountryNameFromCode = function (countryCode) {
  try {
    return regionBundle.GetStringFromName(countryCode.toLowerCase());
  } catch (e) {
    return countryCode.toUpperCase();
  }
};

// __domainToNodeDataMap__.
// A mutable map that stores the current nodes for each domain.
let domainToNodeDataMap = {};

// __trimQuotes(s)__.
// Removes quotation marks around a quoted string.
let trimQuotes = s => s.match(/^\"(.*)\"$/)[1];

// nodeDataForID(controller, id, onResult)__.
// Requests the IP, country code, and name of a node with given ID.
// Returns result via onResult.
// Example: nodeData(["20BC91DC525C3DC9974B29FBEAB51230DE024C44"], show);
let nodeDataForID = function (controller, ids, onResult) {
  let idRequests = ids.map(id => "ns/id/" + id);
  controller.getInfoMultiple(idRequests, function (statusMaps) {
    let IPs = statusMaps.map(statusMap => statusMap.IP),
        countryRequests = IPs.map(ip => "ip-to-country/" + ip);
    controller.getInfoMultiple(countryRequests, function (countries) {
      let results = [];
      for (let i = 0; i < ids.length; ++i) {
        results.push({ name : statusMaps[i].nickname, id : ids[i] ,
                       ip : statusMaps[i].IP , country : countries[i] });
      }
      onResult(results);
    });
  });
};

// __nodeDataForCircuit(controller, circuitEvent, onResult)__.
// Gets the information for a circuit.
let nodeDataForCircuit = function (controller, circuitEvent, onResult) {
  let ids = circuitEvent.circuit.map(circ => circ[0]);
  nodeDataForID(controller, ids, onResult);
};

// __nodeLines(nodeData)__.
// Takes a nodeData array of three items each like
// `{ ip : "12.34.56.78", country : "fr" }`
// and converts each node data to text, as
// `"France (12.34.56.78)"`.
let nodeLines = function (nodeData) {
  let result = ["This browser"];
  for (let {ip, country} of nodeData) {
    result.push(localizedCountryNameFromCode(country) + " (" + ip + ")");
  }
  result.push("Internet");
  return result;
};

// __updateCircuitDisplay()__.
// Updates the Tor circuit display SVG, showing the current domain
// and the relay nodes for that domain.
let updateCircuitDisplay = function () {
  let URI = gBrowser.selectedBrowser.currentURI,
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
        diagramNodes[i].innerHTML = lines[i];
      }
    }
  }
  // Only show the Tor circuit if we have a domain and node data.
  document.querySelector("svg#tor-circuit").style.display = (domain && nodeData) ?
                                                            'block' : 'none';
};

// __collectBuiltCircuitData(aController)__.
// Watches for CIRC BUILT events and records their data in the domainToNodeDataMap.
let collectBuiltCircuitData = function (aController) {
  aController.watchEvent(
    "CIRC",
    circuitEvent => circuitEvent.status === "EXTENDED" ||
                    circuitEvent.status === "BUILT",
    function (circuitEvent) {
      let domain = trimQuotes(circuitEvent.SOCKS_USERNAME);
      if (domain) {
        nodeDataForCircuit(aController, circuitEvent, function (nodeData) {
          domainToNodeDataMap[domain] = nodeData;
          updateCircuitDisplay();
        });
      } else {
        updateCircuitDisplay();
      }
    });
};

// __syncDisplayWithSelectedTab()__.
// We may have multiple tabs, but there is only one instance of TorButton's popup
// panel for displaying the Tor circuit UI. Therefore we need to update the display
// to show the currently selected tab at its current location.
let syncDisplayWithSelectedTab = function () {
  // Whenever a different tab is selected, change the circuit display
  // to show the circuit for that tab's domain.
  gBrowser.tabContainer.addEventListener("TabSelect", function (event) {
    updateCircuitDisplay();
  });
  // If the currently selected tab has been sent to a new location,
  // update the circuit to reflect that.
  gBrowser.addTabsProgressListener({ onLocationChange : function (aBrowser) {
    if (aBrowser == gBrowser.selectedBrowser) {
      updateCircuitDisplay();
    }
  } });

  // Get started with a correct display.
  updateCircuitDisplay();
};

// __display(host, port, password)__.
// The main function for activating automatic display of the Tor circuit.
// A reference to this function (called runTorCircuitDisplay) is exported as a global.
let display = function (host, port, password) {
  let myController = controller(host, port || 9151, password, function (x) { logger.eclog(5, x); });
  syncDisplayWithSelectedTab();
  collectBuiltCircuitData(myController);
};

return display;

// Finish runTorCircuitDisplay()
})();

