// Clear referer on cross-domain requests to/from Tor Hidden Services: #9623
// ("Smart referer" previously spoofed referer on all cross-domain requests.)

const kMODULE_CID = Components.ID("65be2be0-ceb4-44c2-91a5-9c75c53430bf");
const kMODULE_CONTRACTID = "@torproject.org/torRefSpoofer;1";

function RefSpoofer() {
  this.logger = Components.classes["@torproject.org/torbutton-logger;1"].
    getService(Components.interfaces.nsISupports).wrappedJSObject;
  this.logger.log(3, "RefSpoof component created");
  this.onionDomainRegex = new RegExp("\\.onion$", "i"); // THS hosts
  this.thirdPartyUtil = Components.classes["@mozilla.org/thirdpartyutil;1"].
    getService(Components.interfaces.mozIThirdPartyUtil);
  this.ios = Components.classes["@mozilla.org/network/io-service;1"].
    getService(Components.interfaces.nsIIOService);
}


RefSpoofer.prototype = {
  observe: function(subject, topic, data)
  {
    if (topic == "http-on-modify-request") {
      subject.QueryInterface(Components.interfaces.nsIHttpChannel);
      this.onModifyRequest(subject);
      return;
    }
    if (topic == "profile-after-change") {
      this.logger.log(3, "RefSpoof got profile-after-change");
      var os = Components.classes["@mozilla.org/observer-service;1"].
        getService(Components.interfaces.nsIObserverService);
      os.addObserver(this, "http-on-modify-request", false);
      return;
    }
  },
  onModifyRequest: function(oHttpChannel)
  {
    var referer;

    try {
      oHttpChannel.QueryInterface(Components.interfaces.nsIChannel);
      try {
        referer = oHttpChannel.getRequestHeader("Referer");
        referer = this.ios.newURI(referer, null, null); //make a nsIURI object for referer
      } catch (referr) {
        return; //no referer available or invalid uri
      }
      // Only spoof referer for cross-domain requests from .onions
      if (this.onionDomainRegex.test(referer.host) &&
          this.thirdPartyUtil.isThirdPartyURI(referer, oHttpChannel.URI)) {
        // Set the referer to the domain being requested. This makes it harder
        // to tell that we are referer-spoofing.
        this.adjustRef(oHttpChannel,
                       [oHttpChannel.URI.scheme, oHttpChannel.URI.host].join("://"));
      }
    } catch (ex) {
      this.logger.log(5, "RefSpoof onModifyRequest: " + ex);
    }
  },
  adjustRef: function(oChannel, sRef)
  {
    try {
      if (oChannel.referrer)
      {
        oChannel.referrer.spec = sRef;
        oChannel.setRequestHeader("Referer", sRef, false);
      }
      return true;
    }
    catch (ex) {
      this.logger.log(5, "RefSpoof adjustRef: " +ex);
    }
    return false;
  },
  QueryInterface: function(iid)
  {
    if (!iid.equals(Components.interfaces.nsISupports) &&
        !iid.equals(Components.interfaces.nsIObserver) &&
        !iid.equals(Components.interfaces.nsISupportsWeakReference)) {
      throw Components.results.NS_ERROR_NO_INTERFACE;
    }
    return this;
  },
  _xpcom_categories: [{category:"profile-after-change"}],
  classID: kMODULE_CID,
  contractID: kMODULE_CONTRACTID,
  classDescription: "Tor Ref Spoofer"
};

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
var NSGetFactory = XPCOMUtils.generateNSGetFactory([RefSpoofer]);
