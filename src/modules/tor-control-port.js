// A module for TorBrowser that provides an asynchronous controller for
// Tor, through its ControlPort.
//
// This file is written in call stack order (later functions
// call earlier functions). The file can be processed
// with docco.js to produce pretty documentation.
//
// To import the module, use
//
//     let { controller } = Components.utils.import("path/to/controlPort.jsm");
//
// See the last function defined in this file, controller(host, port, password, onError)
// for usage of the controller function.

/* jshint esnext: true */
/* jshint -W097 */
/* global Components, console, Services */
"use strict";

// ### Mozilla Abbreviations
let {classes: Cc, interfaces: Ci, results: Cr, Constructor: CC, utils: Cu } = Components;

// ### Import Mozilla Services
Cu.import("resource://gre/modules/Services.jsm");

// ## torbutton logger
let logger = Cc["@torproject.org/torbutton-logger;1"]
               .getService(Components.interfaces.nsISupports).wrappedJSObject,
    log = x => logger.eclog(3, x);

// ### announce this file
log("Loading tor-control-port.js\n");

// ## io
// I/O utilities namespace
let io = io || {};

// __io.asyncSocketStreams(host, port)__.
// Creates a pair of asynchronous input and output streams for a socket at the
// given host and port.
io.asyncSocketStreams = function (host, port) {
  let socketTransportService = Cc["@mozilla.org/network/socket-transport-service;1"]
           .getService(Components.interfaces.nsISocketTransportService),
      UNBUFFERED = Ci.nsITransport.OPEN_UNBUFFERED,
      // Create an instance of a socket transport.
      socketTransport = socketTransportService.createTransport(null, 0, host, port, null),
      // Open unbuffered asynchronous outputStream.
      outputStream = socketTransport.openOutputStream(UNBUFFERED, 1, 1)
                      .QueryInterface(Ci.nsIAsyncOutputStream),
      // Open unbuffered asynchronous inputStream.
      inputStream = socketTransport.openInputStream(UNBUFFERED, 1, 1)
                      .QueryInterface(Ci.nsIAsyncInputStream);
  return [inputStream, outputStream];
};

// __io.pumpInputStream(scriptableInputStream, onInputData, onError)__.
// Run an "input stream pump" that takes an input stream and
// asynchronously pumps incoming data to the onInputData callback.
io.pumpInputStream = function (inputStream, onInputData, onError) {
  // Wrap raw inputStream with a "ScriptableInputStream" so we can read incoming data.
  let ScriptableInputStream = CC("@mozilla.org/scriptableinputstream;1",
           "nsIScriptableInputStream", "init"),
      scriptableInputStream = new ScriptableInputStream(inputStream),
      // A private method to read all data available on the input stream.
      readAll = function() {
        return scriptableInputStream.read(scriptableInputStream.available());
      },
      pump = Cc["@mozilla.org/network/input-stream-pump;1"]
               .createInstance(Components.interfaces.nsIInputStreamPump);
  // Start the pump.
  pump.init(inputStream, -1, -1, 0, 0, true);
  // Tell the pump to read all data whenever it is available, and pass the data
  // to the onInputData callback. The first argument to asyncRead implements
  // nsIStreamListener.
  pump.asyncRead({ onStartRequest: function (request, context) { },
                   onStopRequest: function (request, context, code) { },
                   onDataAvailable : function (request, context, stream, offset, count) {
                     try {
                       onInputData(readAll());
                     } catch (error) {
                       // readAll() or onInputData(...) has thrown an error.
                       // Notify calling code through onError.
                       onError(error);
                     }
                   } }, null);
};

// __io.asyncSocket(host, port, onInputData, onError)__.
// Creates an asynchronous, text-oriented TCP socket at host:port.
// The onInputData callback should accept a single argument, which will be called
// repeatedly, whenever incoming text arrives. Returns a socket object with two methods:
// socket.write(text) and socket.close(). onError will be passed the error object
// whenever a write fails.
io.asyncSocket = function (host, port, onInputData, onError) {
  let [inputStream, outputStream] = io.asyncSocketStreams(host, port),
      pendingWrites = [];
  // Run an input stream pump to send incoming data to the onInputData callback.
  io.pumpInputStream(inputStream, onInputData, onError);
  // Return the "socket object" as described.
  return {
           // Write a message to the socket.
           write : function(aString) {
             pendingWrites.push(aString);
             outputStream.asyncWait(
               // Implement an nsIOutputStreamCallback:
               { onOutputStreamReady : function () {
                 let totalString = pendingWrites.join("");
                   try {
                     outputStream.write(totalString, totalString.length);
                     log("controlPort << " + aString + "\n");
                   } catch (err) {
                     onError(err);
                   }
                   pendingWrites = [];
               } },
               0, 0, Services.tm.currentThread);
           },
           // Close the socket.
           close : function () {
             // Close stream objects.
             inputStream.close();
             outputStream.close();
           }
         };
};

// __io.onDataFromOnLine(onLine)__.
// Converts a callback that expects incoming individual lines of text to a callback that
// expects incoming raw socket string data.
io.onDataFromOnLine = function (onLine) {
  // A private variable that stores the last unfinished line.
  let pendingData = "";
  // Return a callback to be passed to io.asyncSocket. First, splits data into lines of
  // text. If the incoming data is not terminated by CRLF, then the last
  // unfinished line will be stored in pendingData, to be prepended to the data in the
  // next call to onData. The already complete lines of text are then passed in sequence
  // to onLine.
  return function (data) {
    let totalData = pendingData + data,
        lines = totalData.split("\r\n"),
        n = lines.length;
    pendingData = lines[n - 1];
    // Call onLine for all completed lines.
    lines.slice(0,-1).map(onLine);
  };
};

// __io.onLineFromOnMessage(onMessage)__.
// Converts a callback that expects incoming control port multiline message strings to a
// callback that expects individual lines.
io.onLineFromOnMessage = function (onMessage) {
  // A private variable that stores the last unfinished line.
  let pendingLines = [];
  // Return a callback that expects individual lines.
  return function (line) {
    // Add to the list of pending lines.
    pendingLines.push(line);
    // If line is the last in a message, then pass on the full multiline message.
    if (line.match(/^\d\d\d /) && (pendingLines.length == 1 ||
                                   pendingLines[0].startsWith(line.substring(0,3)))) {
      // Combine pending lines to form message.
      let message = pendingLines.join("\r\n");
      // Wipe pendingLines before we call onMessage, in case onMessage throws an error.
      pendingLines = [];
      // Pass multiline message to onMessage.
      onMessage(message);
      log("controlPort >> " + message);
    }
  };
};

// __io.callbackDispatcher()__.
// Returns [onString, dispatcher] where the latter is an object with two member functions:
// dispatcher.addCallback(regex, callback), and dispatcher.removeCallback(callback).
// Pass onString to another function that needs a callback with a single string argument.
// Whenever dispatcher.onString receives a string, the dispatcher will check for any
// regex matches and pass the string on to the corresponding callback(s).
io.callbackDispatcher = function () {
  let callbackPairs = [],
      removeCallback = function (aCallback) {
        callbackPairs = callbackPairs.filter(function ([regex, callback]) {
          return callback !== aCallback;
        });
      },
      addCallback = function (regex, callback) {
        if (callback) {
          callbackPairs.push([regex, callback]);
        }
        return function () { removeCallback(callback); };
      },
      onString = function (message) {
        for (let [regex, callback] of callbackPairs) {
          if (message.match(regex)) {
            callback(message);
          }
        }
      };
  return [onString, {addCallback : addCallback, removeCallback : removeCallback}];
};

// __io.matchRepliesToCommands(asyncSend)__.
// Takes asyncSend(message), an asynchronous send function, and returns two functions
// sendCommand(command, replyCallback) and onReply(response). If we call sendCommand,
// then when onReply is called, the corresponding replyCallback will be called.
io.matchRepliesToCommands = function (asyncSend) {
  let commandQueue = [],
      sendCommand = function (command, replyCallback) {
        commandQueue.push([command, replyCallback]);
        asyncSend(command);
      },
      onReply = function (reply) {
        let [command, replyCallback] = commandQueue.shift();
        if (replyCallback) { replyCallback(reply); }
      },
      onFailure = function () {
        commandQueue.shift();
      };
  return [sendCommand, onReply, onFailure];
};

// __io.controlSocket(host, port, password, onError)__.
// Instantiates and returns a socket to a tor ControlPort at host:port,
// authenticating with the given password. onError is called with an
// error object as its single argument whenever an error occurs. Example:
//
//     // Open the socket
//     let socket = controlSocket("127.0.0.1", 9151, "MyPassw0rd",
//                    function (error) { console.log(error.message || error); });
//     // Send command and receive "250" reply or error message
//     socket.sendCommand(commandText, replyCallback);
//     // Register or deregister for "650" notifications
//     // that match regex
//     socket.addNotificationCallback(regex, callback);
//     socket.removeNotificationCallback(callback);
//     // Close the socket permanently
//     socket.close();
io.controlSocket = function (host, port, password, onError) {
  // Produce a callback dispatcher for Tor messages.
  let [onMessage, mainDispatcher] = io.callbackDispatcher(),
      // Open the socket and convert format to Tor messages.
      socket = io.asyncSocket(host, port,
                              io.onDataFromOnLine(io.onLineFromOnMessage(onMessage)),
                              onError),
      // Tor expects any commands to be terminated by CRLF.
      writeLine = function (text) { socket.write(text + "\r\n"); },
      // Ensure we return the correct reply for each sendCommand.
      [sendCommand, onReply, onFailure] = io.matchRepliesToCommands(writeLine),
      // Create a secondary callback dispatcher for Tor notification messages.
      [onNotification, notificationDispatcher] = io.callbackDispatcher();
  // Pass successful reply back to sendCommand callback.
  mainDispatcher.addCallback(/^2\d\d/, onReply);
  // Pass error message to sendCommand callback.
  mainDispatcher.addCallback(/^[45]\d\d/, function (message) {
    onFailure();
    onError(new Error(message));
  });
  // Pass asynchronous notifications to notification dispatcher.
  mainDispatcher.addCallback(/^650/, onNotification);
  // Log in to control port.
  sendCommand("authenticate " + (password || ""));
  // Activate needed events.
  sendCommand("setevents stream");
  return { close : socket.close, sendCommand : sendCommand,
           addNotificationCallback : notificationDispatcher.addCallback,
           removeNotificationCallback : notificationDispatcher.removeCallback };
};

// ## utils
// A namespace for utility functions
let utils = utils || {};

// __utils.identity(x)__.
// Returns its argument unchanged.
utils.identity = function (x) { return x; };

// __utils.isString(x)__.
// Returns true iff x is a string.
utils.isString = function (x) {
  return typeof(x) === 'string' || x instanceof String;
};

// __utils.capture(string, regex)__.
// Takes a string and returns an array of capture items, where regex must have a single
// capturing group and use the suffix /.../g to specify a global search.
utils.capture = function (string, regex) {
  let matches = [];
  // Special trick to use string.replace for capturing multiple matches.
  string.replace(regex, function (a, captured) {
    matches.push(captured);
  });
  return matches;
};

// __utils.extractor(regex)__.
// Returns a function that takes a string and returns an array of regex matches. The
// regex must use the suffix /.../g to specify a global search.
utils.extractor = function (regex) {
  return function (text) {
    return utils.capture(text, regex);
  };
};

// __utils.splitLines(string)__.
// Splits a string into an array of strings, each corresponding to a line.
utils.splitLines = function (string) { return string.split(/\r?\n/); };

// __utils.splitAtSpaces(string)__.
// Splits a string into chunks between spaces. Does not split at spaces
// inside pairs of quotation marks.
utils.splitAtSpaces = utils.extractor(/((\S*?"(.*?)")+\S*|\S+)/g);

// __utils.splitAtEquals(string)__.
// Splits a string into chunks between equals. Does not split at equals
// inside pairs of quotation marks.
utils.splitAtEquals = utils.extractor(/(([^=]*?"(.*?)")+[^=]*|[^=]+)/g);

// __utils.mergeObjects(arrayOfObjects)__.
// Takes an array of objects like [{"a":"b"},{"c":"d"}] and merges to a single object.
// Pure function.
utils.mergeObjects = function (arrayOfObjects) {
  let result = {};
  for (let obj of arrayOfObjects) {
    for (var key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
};

// __utils.listMapData(parameterString, listNames)__.
// Takes a list of parameters separated by spaces, of which the first several are
// unnamed, and the remainder are named, in the form `NAME=VALUE`. Apply listNames
// to the unnamed parameters, and combine them in a map with the named parameters.
// Example: `40 FAILED 0 95.78.59.36:80 REASON=CANT_ATTACH`
//
//     utils.listMapData("40 FAILED 0 95.78.59.36:80 REASON=CANT_ATTACH",
//                       ["streamID", "event", "circuitID", "IP"])
//     // --> {"streamID" : "40", "event" : "FAILED", "circuitID" : "0",
//     //      "address" : "95.78.59.36:80", "REASON" : "CANT_ATTACH"}"
utils.listMapData = function (parameterString, listNames) {
  // Split out the space-delimited parameters.
  let parameters = utils.splitAtSpaces(parameterString),
      dataMap = {};
  // Assign listNames to the first n = listNames.length parameters.
  for (let i = 0; i < listNames.length; ++i) {
    dataMap[listNames[i]] = parameters[i];
  }
  // Read key-value pairs and copy these to the dataMap.
  for (let i = listNames.length; i < parameters.length; ++i) {
    let [key, value] = utils.splitAtEquals(parameters[i]);
    if (key && value) {
      dataMap[key] = value;
    }
  }
  return dataMap;
};

// ## info
// A namespace for functions related to tor's GETINFO command.
let info = info || {};

// __info.keyValueStringsFromMessage(messageText)__.
// Takes a message (text) response to GETINFO and provides a series of key-value
// strings, which are either multiline (with a `250+` prefix):
//
//     250+config/defaults=
//     AccountingMax "0 bytes"
//     AllowDotExit "0"
//     .
//
// or single-line (with a `250-` prefix):
//
//     250-version=0.2.6.0-alpha-dev (git-b408125288ad6943)
info.keyValueStringsFromMessage = utils.extractor(/^(250\+[\s\S]+?^\.|250-.+?)$/gmi);

// __info.applyPerLine(transformFunction)__.
// Returns a function that splits text into lines,
// and applies transformFunction to each line.
info.applyPerLine = function (transformFunction) {
  return function (text) {
    return utils.splitLines(text.trim()).map(transformFunction);
  };
};

// __info.routerStatusParser(valueString)__.
// Parses a router status entry as, described in
// https://gitweb.torproject.org/torspec.git/blob/HEAD:/dir-spec.txt
// (search for "router status entry")
info.routerStatusParser = function (valueString) {
  let lines = utils.splitLines(valueString),
      objects = [];
  for (let line of lines) {
    // Drop first character and grab data following it.
    let myData = line.substring(2),
    // Accumulate more maps with data, depending on the first character in the line.
        dataFun = {
          "r" : data => utils.listMapData(data, ["nickname", "identity", "digest",
                                                 "publicationDate", "publicationTime",
                                                 "IP", "ORPort", "DirPort"]) ,
          "a" : data => ({ "IPv6" :  data }) ,
          "s" : data => ({ "statusFlags" : utils.splitAtSpaces(data) }) ,
          "v" : data => ({ "version" : data }) ,
          "w" : data => utils.listMapData(data, []) ,
          "p" : data => ({ "portList" : data.split(",") }) ,
          "m" : data => utils.listMapData(data, [])
        }[line.charAt(0)];
    if (dataFun !== undefined) {
      objects.push(dataFun(myData));
    }
  }
  return utils.mergeObjects(objects);
};

// __info.circuitStatusParser(line)__.
// Parse the output of a circuit status line.
info.circuitStatusParser = function (line) {
  let data = utils.listMapData(line, ["id","status","circuit"]),
      circuit = data.circuit;
  // Parse out the individual circuit IDs and names.
  if (circuit) {
    data.circuit = circuit.split(",").map(function (x) {
      return x.split(/~|=/);
    });
  }
  return data;
};

// __info.streamStatusParser(line)__.
// Parse the output of a stream status line.
info.streamStatusParser = function (text) {
  return utils.listMapData(text, ["StreamID", "StreamStatus",
                                  "CircuitID", "Target"]);
};

// __info.parsers__.
// A map of GETINFO keys to parsing function, which convert result strings to JavaScript
// data.
info.parsers = {
  "version" : utils.identity,
  "config-file" : utils.identity,
  "config-defaults-file" : utils.identity,
  "config-text" : utils.identity,
  "ns/id/" : info.routerStatusParser,
  "ns/name/" : info.routerStatusParser,
  "ip-to-country/" : utils.identity,
  "circuit-status" : info.applyPerLine(info.circuitStatusParser),
  "stream-status" : info.applyPerLine(info.streamStatusParser)
};

// __info.getParser(key)__.
// Takes a key and determines the parser function that should be used to
// convert its corresponding valueString to JavaScript data.
info.getParser = function(key) {
  return info.parsers[key] ||
         info.parsers[key.substring(0, key.lastIndexOf("/") + 1)] ||
         "unknown";
};

// __info.stringToValue(string)__.
// Converts a key-value string as from GETINFO to a value.
info.stringToValue = function (string) {
  // key should look something like `250+circuit-status=` or `250-circuit-status=...`
  let key = string.match(/^250[\+-](.+?)=/mi)[1],
      // matchResult finds a single-line result for `250-` or a multi-line one for `250+`.
      matchResult = string.match(/250\-.+?=(.*?)$/mi) ||
                    string.match(/250\+.+?=([\s\S]*?)^\.$/mi),
      // Retrieve the captured group (the text of the value in the key-value pair)
      valueString = matchResult ? matchResult[1] : null;
  // Return value where the latter has been parsed according to the key requested.
  return info.getParser(key)(valueString);
};

// __info.getInfoMultiple(aControlSocket, keys, onData)__.
// Sends GETINFO for an array of keys. Passes onData an array of their respective results,
// in order.
info.getInfoMultiple = function (aControlSocket, keys, onData) {
  /*
  if (!(keys instanceof Array)) {
    throw new Error("keys argument should be an array");
  }
  if (!(onData instanceof Function)) {
    throw new Error("onData argument should be a function");
  }
  let parsers = keys.map(info.getParser);
  if (parsers.indexOf("unknown") !== -1) {
    throw new Error("unknown key");
  }
  if (parsers.indexOf("not supported") !== -1) {
    throw new Error("unsupported key");
  }
  */
  aControlSocket.sendCommand("getinfo " + keys.join(" "), function (message) {
    onData(info.keyValueStringsFromMessage(message).map(info.stringToValue));
  });
};

// __info.getInfo(controlSocket, key, onValue)__.
// Sends GETINFO for a single key. Passes onValue the value for that key.
info.getInfo = function (aControlSocket, key, onValue) {
  /*
  if (!utils.isString(key)) {
    throw new Error("key argument should be a string");
  }
  if (!(onValue instanceof Function)) {
    throw new Error("onValue argument should be a function");
  }
  */
  info.getInfoMultiple(aControlSocket, [key], function (data) {
    onValue(data[0]);
  });
};

// ## event
// Handlers for events

let event = event || {};

// __event.parsers__.
// A map of EVENT keys to parsing functions, which convert result strings to JavaScript
// data.
event.parsers = {
  "stream" : info.streamStatusParser,
  "circ" : info.circuitStatusParser
};

// __event.messageToData(type, message)__.
// Extract the data from an event.
event.messageToData = function (type, message) {
  let dataText = message.match(/^650 \S+?\s(.*?)$/mi)[1];
  return dataText ? event.parsers[type.toLowerCase()](dataText) : null;
};

// __event.watchEvent(controlSocket, type, filter, onData)__.
// Watches for a particular type of event. If filter(data) returns true, the event's
// data is pass to the onData callback.
event.watchEvent = function (controlSocket, type, filter, onData) {
  controlSocket.addNotificationCallback(new RegExp("^650." + type, "i"),
    function (message) {
      let data = event.messageToData(type, message);
      if (filter === null || filter(data)) {
        onData(data);
      }
    });
};

// ## tor
// Things related to the main controller.
let tor = tor || {};

// __tor.controller(host, port, password, onError)__.
// Creates a tor controller at the given host and port, with the given password.
// onError returns asynchronously whenever a connection error occurs.
tor.controller = function (host, port, password, onError) {
  let socket = io.controlSocket(host, port, password, onError);
  return { getInfo : function (key, log) { info.getInfo(socket, key, log); } ,
           getInfoMultiple : function (keys, log) {
             info.getInfoMultiple(socket, keys, log);
           },
           watchEvent : function (type, filter, onData) {
             event.watchEvent(socket, type, filter, onData);
           },
           close : socket.close };
};

// __tor.controllerCache__.
// A map from "host:port" to controller objects. Prevents redundant instantiation
// of control sockets.
tor.controllerCache = {};

// ## Export

// __controller(host, port, password, onError)__.
// Instantiates and returns a controller object connected to a tor ControlPort
// at host:port, authenticating with the given password, if the controller doesn't yet
// exist. Otherwise returns the existing controller to the given host:port.
// onError is called with an error object as its single argument whenever
// an error occurs. Example:
//
//     // Get the controller
//     let c = controller("127.0.0.1", 9151, "MyPassw0rd",
//                    function (error) { console.log(error.message || error); });
//     // Send command and receive `250` reply or error message
//     c.getInfo("ip-to-country/16.16.16.16", console.log);
//     // Close the controller permanently
//     c.close();
let controller = function (host, port, password, onError) {
  let dest = host + ":" + port;
  return (tor.controllerCache[dest] = tor.controllerCache[dest] ||
          tor.controller(host, port, password, onError));
};

// Export the controller function for external use.
var EXPORTED_SYMBOLS = ["controller"];
