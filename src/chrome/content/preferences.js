// Bug 1506 P1: Most of this code needs to go away. See also Bug 3100.

// PREFERences dialog functions
//   torbutton_prefs_set_field_attributes() -- initialize dialog fields
//   torbutton_prefs_init() -- on dialog load
//   torbutton_prefs_save() -- on dialog save

var tor_enabled = false;
const Cc = Components.classes, Ci = Components.interfaces;

function torbutton_prefs_set_field_attributes(doc)
{
    torbutton_log(2, "called prefs_set_field_attributes()");
    var o_torprefs = torbutton_get_prefbranch('extensions.torbutton.');
    var o_customprefs = torbutton_get_prefbranch('extensions.torbutton.custom.');

    // Privoxy is always recommended for Firefoxes not supporting socks_remote_dns
    if (doc.getElementById('torbutton_transparentTor').selected) {
        doc.getElementById('torbutton_settingsMethod').value = 'transparent';
    } else if (!torbutton_check_socks_remote_dns()) {
      doc.getElementById('torbutton_usePrivoxy').setAttribute("disabled", true);
    } else {
      doc.getElementById('torbutton_usePrivoxy').setAttribute("disabled", doc.getElementById('torbutton_settingsMethod').value != 'recommended');
    }

    if (doc.getElementById('torbutton_settingsMethod').value == 'recommended') {
        var proxy_port;
        var proxy_host;
        if (torbutton_has_good_socks()) {
          doc.getElementById('torbutton_usePrivoxy').checked = false;
          doc.getElementById('torbutton_usePrivoxy').setAttribute("disabled", true);
          proxy_host = '';
          proxy_port = 0;
        } else {
          if (doc.getElementById('torbutton_usePrivoxy').checked) {
            proxy_host = '127.0.0.1';
            proxy_port = 8118;
          } else {
            proxy_host = '';
            proxy_port = 0;
          }
        }

        torbutton_log(2, "using recommended settings");
        if (!torbutton_check_socks_remote_dns()) {
            doc.getElementById('torbutton_httpProxy').value = proxy_host;
            doc.getElementById('torbutton_httpPort').value = proxy_port;
            doc.getElementById('torbutton_httpsProxy').value = proxy_host;
            doc.getElementById('torbutton_httpsPort').value = proxy_port;
            doc.getElementById('torbutton_ftpProxy').value = proxy_host;
            doc.getElementById('torbutton_ftpPort').value = proxy_port;
            doc.getElementById('torbutton_gopherProxy').value = proxy_host;
            doc.getElementById('torbutton_gopherPort').value = proxy_port;
        } else {
            doc.getElementById('torbutton_httpProxy').value = proxy_host;
            doc.getElementById('torbutton_httpPort').value = proxy_port;
            doc.getElementById('torbutton_httpsProxy').value = proxy_host;
            doc.getElementById('torbutton_httpsPort').value = proxy_port;

            doc.getElementById('torbutton_ftpProxy').value = '';
            doc.getElementById('torbutton_ftpPort').value = 0;
            doc.getElementById('torbutton_gopherProxy').value = '';
            doc.getElementById('torbutton_gopherPort').value = 0;
        }

        var environ = Components.classes["@mozilla.org/process/environment;1"]
                   .getService(Components.interfaces.nsIEnvironment);

        if (environ.exists("TOR_SOCKS_PORT")) {
          doc.getElementById('torbutton_socksPort').value = parseInt(environ.get("TOR_SOCKS_PORT"));
        } else {
          doc.getElementById('torbutton_socksPort').value = 9150;
        }

        if (environ.exists("TOR_SOCKS_HOST")) {
          doc.getElementById('torbutton_socksHost').value = environ.get("TOR_SOCKS_HOST");
        } else {
          doc.getElementById('torbutton_socksHost').value = '127.0.0.1';
        }

        doc.getElementById('torbutton_httpProxy').disabled = true;
        doc.getElementById('torbutton_httpPort').disabled = true;
        doc.getElementById('torbutton_httpsProxy').disabled = true;
        doc.getElementById('torbutton_httpsPort').disabled = true;
        doc.getElementById('torbutton_ftpProxy').disabled = true;
        doc.getElementById('torbutton_ftpPort').disabled = true;
        doc.getElementById('torbutton_gopherProxy').disabled = true;
        doc.getElementById('torbutton_gopherPort').disabled = true;
        doc.getElementById('torbutton_socksHost').disabled = true;
        doc.getElementById('torbutton_socksPort').disabled = true;
        doc.getElementById('torbutton_socksGroup').disabled = true;
        doc.getElementById('torbutton_noProxiesOn').disabled = true;
    } else if (doc.getElementById('torbutton_settingsMethod').value == 'transparent') {
        // Mr. Larry was so lazy when he wrote the rest of this code
        torbutton_log(2, "not using recommended settings");
        torbutton_log(2, "using transparent settings");
        doc.getElementById('torbutton_usePrivoxy').setAttribute("disabled", true);
        doc.getElementById('torbutton_httpProxy').disabled = true;
        doc.getElementById('torbutton_httpPort').disabled = true;
        doc.getElementById('torbutton_httpsProxy').disabled = true;
        doc.getElementById('torbutton_httpsPort').disabled = true;
        doc.getElementById('torbutton_ftpProxy').disabled = true;
        doc.getElementById('torbutton_ftpPort').disabled = true;
        doc.getElementById('torbutton_gopherProxy').disabled = true;
        doc.getElementById('torbutton_gopherPort').disabled = true;
        doc.getElementById('torbutton_socksHost').disabled = true;
        doc.getElementById('torbutton_socksPort').disabled = true;
        doc.getElementById('torbutton_socksGroup').disabled = true;
        doc.getElementById('torbutton_noProxiesOn').disabled = true;
    } else {
        torbutton_log(2, "using transparent settings");
        doc.getElementById('torbutton_httpProxy').disabled = false;
        doc.getElementById('torbutton_httpPort').disabled = false;
        doc.getElementById('torbutton_httpsProxy').disabled = false;
        doc.getElementById('torbutton_httpsPort').disabled = false;
        doc.getElementById('torbutton_ftpProxy').disabled = false;
        doc.getElementById('torbutton_ftpPort').disabled = false;
        doc.getElementById('torbutton_gopherProxy').disabled = false;
        doc.getElementById('torbutton_gopherPort').disabled = false;
        doc.getElementById('torbutton_socksHost').disabled = false;
        doc.getElementById('torbutton_socksPort').disabled = false;
        doc.getElementById('torbutton_socksGroup').disabled = false;
        doc.getElementById('torbutton_noProxiesOn').disabled = false;
        /* Do not reset these on every document update..
        doc.getElementById('torbutton_httpProxy').value    = o_customprefs.getCharPref('http_proxy');
        doc.getElementById('torbutton_httpPort').value     = o_customprefs.getIntPref('http_port');
        doc.getElementById('torbutton_httpsProxy').value   = o_customprefs.getCharPref('https_proxy');
        doc.getElementById('torbutton_httpsPort').value    = o_customprefs.getIntPref('https_port');
        doc.getElementById('torbutton_ftpProxy').value     = o_customprefs.getCharPref('ftp_proxy');
        doc.getElementById('torbutton_ftpPort').value      = o_customprefs.getIntPref('ftp_port');
        doc.getElementById('torbutton_gopherProxy').value  = o_customprefs.getCharPref('gopher_proxy');
        doc.getElementById('torbutton_gopherPort').value   = o_customprefs.getIntPref('gopher_port');
        doc.getElementById('torbutton_socksHost').value    = o_customprefs.getCharPref('socks_host');
        doc.getElementById('torbutton_socksPort').value    = o_customprefs.getIntPref('socks_port');
        */
    }
}

function torbutton_prefs_init(doc) {
    var checkbox_displayStatusPanel = doc.getElementById('torbutton_displayStatusPanel');
// return; 

    torbutton_log(2, "called prefs_init()");
    sizeToContent();

    // remember if tor settings were enabled when the window was opened
    tor_enabled = torbutton_check_status();

    var o_torprefs = torbutton_get_prefbranch('extensions.torbutton.');

    // doc.getElementById('torbutton_panelStyle').value = o_torprefs.getCharPref('panel_style');
    var settings_method = doc.getElementById('torbutton_settingsMethod');
    var settings_method_pref = o_torprefs.getCharPref('settings_method');
    if (settings_method_pref == 'recommended')
        settings_method.selectedItem = doc.getElementById('torbutton_useRecommendedSettings');
    else if (settings_method_pref == 'custom')
        settings_method.selectedItem = doc.getElementById('torbutton_useCustomSettings');
    // doc.getElementById('torbutton_settingsMethod').value = o_torprefs.getCharPref('settings_method');
    doc.getElementById('torbutton_usePrivoxy').checked = o_torprefs.getBoolPref('use_privoxy');
    doc.getElementById('torbutton_httpProxy').value    = o_torprefs.getCharPref('http_proxy');
    doc.getElementById('torbutton_httpPort').value     = o_torprefs.getIntPref('http_port');
    doc.getElementById('torbutton_httpsProxy').value   = o_torprefs.getCharPref('https_proxy');
    doc.getElementById('torbutton_httpsPort').value    = o_torprefs.getIntPref('https_port');
    doc.getElementById('torbutton_ftpProxy').value     = o_torprefs.getCharPref('ftp_proxy');
    doc.getElementById('torbutton_ftpPort').value      = o_torprefs.getIntPref('ftp_port');
    doc.getElementById('torbutton_gopherProxy').value  = o_torprefs.getCharPref('gopher_proxy');
    doc.getElementById('torbutton_gopherPort').value   = o_torprefs.getIntPref('gopher_port');
    doc.getElementById('torbutton_socksHost').value    = o_torprefs.getCharPref('socks_host');
    doc.getElementById('torbutton_socksPort').value    = o_torprefs.getIntPref('socks_port');
    if(o_torprefs.getIntPref('socks_version') == 4) {
        doc.getElementById('torbutton_socksGroup').selectedItem =
            doc.getElementById('torbutton_socksv4');    
    } else {
        doc.getElementById('torbutton_socksGroup').selectedItem =
            doc.getElementById('torbutton_socksv5');    
    }
    doc.getElementById('torbutton_noProxiesOn').value = o_torprefs.getCharPref('no_proxies_on');

    // Transparent Torification magic
    if (o_torprefs.getBoolPref('saved.transparentTor')) {
        doc.getElementById('torbutton_settingsMethod').selectedItem = doc.getElementById('torbutton_transparentTor');
    }

    // Privacy and security settings
    doc.getElementById('torbutton_blockDisk').checked = o_torprefs.getBoolPref('block_disk');
    doc.getElementById('torbutton_resistFingerprinting').checked = o_torprefs.getBoolPref('resist_fingerprinting');
    doc.getElementById('torbutton_blockPlugins').checked = o_torprefs.getBoolPref('no_tor_plugins');
    doc.getElementById('torbutton_restrictThirdParty').checked = o_torprefs.getBoolPref('restrict_thirdparty');
    let sec_slider = doc.getElementById('torbutton_sec_slider');
    let sec_custom = doc.getElementById('torbutton_sec_custom');
    let custom_values = o_torprefs.getBoolPref('security_custom');
    sec_slider.value = o_torprefs.getIntPref('security_slider');
    sec_custom.checked = custom_values;
    sec_custom.disabled = !custom_values;
    torbutton_set_slider_text(doc, sec_custom.checked);
    // If the custom checkbox is checked and the user is done with dragging
    // uncheck the checkbox to allow setting the (newly) chosen security level.
    sec_slider.dragStateChanged = function(isDragging) {
        if (!isDragging && sec_custom.checked) {
           sec_custom.checked = false;
           sec_custom.disabled = true;
        }
    }
    sec_slider.valueChanged = function(which, newValue, userChanged) {
        torbutton_set_slider_text(doc, false);
    }

    torbutton_prefs_set_field_attributes(doc);
}

function torbutton_prefs_save(doc) {
    // Disable the Accept button once the user clicked on it as clicking on
    // our active Accept button more than once can lead to all sort of weird
    // behavior. See bug 11763 for an example.
    doc.documentElement.getButton("accept").disabled = true;
    torbutton_log(2, "called prefs_save()");
    var o_torprefs = torbutton_get_prefbranch('extensions.torbutton.');
    var o_customprefs = torbutton_get_prefbranch('extensions.torbutton.custom.');

    var wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
        .getService(Components.interfaces.nsIWindowMediator);
    var enumerator = wm.getEnumerator("navigator:browser");
    while(enumerator.hasMoreElements()) {
        var win = enumerator.getNext();
        if(win != window && win.m_tb_is_main_window) {
            torbutton_log(3, "Found main window for popup hack.");
            win.torbutton_unique_pref_observer.did_toggle_warning = false;
        }
    }

    o_torprefs.setCharPref('settings_method', doc.getElementById('torbutton_settingsMethod').value);
    o_torprefs.setBoolPref('use_privoxy',     doc.getElementById('torbutton_usePrivoxy').checked);
    o_torprefs.setCharPref('http_proxy',      doc.getElementById('torbutton_httpProxy').value);
    o_torprefs.setIntPref('http_port',        doc.getElementById('torbutton_httpPort').value);
    o_torprefs.setCharPref('https_proxy',     doc.getElementById('torbutton_httpsProxy').value);
    o_torprefs.setIntPref('https_port',       doc.getElementById('torbutton_httpsPort').value);
    o_torprefs.setCharPref('ftp_proxy',       doc.getElementById('torbutton_ftpProxy').value);
    o_torprefs.setIntPref('ftp_port',         doc.getElementById('torbutton_ftpPort').value);
    o_torprefs.setCharPref('gopher_proxy',    doc.getElementById('torbutton_gopherProxy').value);
    o_torprefs.setIntPref('gopher_port',      doc.getElementById('torbutton_gopherPort').value);
    o_torprefs.setCharPref('socks_host',      doc.getElementById('torbutton_socksHost').value);
    o_torprefs.setIntPref('socks_port',       doc.getElementById('torbutton_socksPort').value);

    if(doc.getElementById('torbutton_socksGroup').selectedItem ==
            doc.getElementById('torbutton_socksv4')) {
        o_torprefs.setIntPref('socks_version', 4); 
    } else if(doc.getElementById('torbutton_socksGroup').selectedItem ==
            doc.getElementById('torbutton_socksv5')) {
        o_torprefs.setIntPref('socks_version', 5); 
    }

    o_torprefs.setCharPref('no_proxies_on',      doc.getElementById('torbutton_noProxiesOn').value);

    o_torprefs.setBoolPref('saved.transparentTor', doc.getElementById('torbutton_transparentTor').selected);
    if (o_torprefs.getBoolPref('saved.transparentTor')) {
        var wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
            .getService(Components.interfaces.nsIWindowMediator);
        var chrome = wm.getMostRecentWindow("navigator:browser");
        var ret = chrome.torbutton_test_settings();
        if (ret != 4) {
            var warning = chrome.torbutton_get_property_string("torbutton.popup.test.failure");
            window.alert(warning);
        } else {
            o_torprefs.setBoolPref('tor_enabled', true);
            // In theory this is where we unlock some things that are now "safe"
            // Unleash Flash on Tor users
            // Ignore any proxy settings that the user has set
            // etc etc etc - pde will be very happy
        }
    }


    if (doc.getElementById('torbutton_settingsMethod').value == 'custom') {
        // XXX: Is this even needed anymore? We don't read the
        // custom prefs at all it seems..
        o_customprefs.setCharPref('http_proxy',      doc.getElementById('torbutton_httpProxy').value);
        o_customprefs.setIntPref('http_port',        doc.getElementById('torbutton_httpPort').value);
        o_customprefs.setCharPref('https_proxy',     doc.getElementById('torbutton_httpsProxy').value);
        o_customprefs.setIntPref('https_port',       doc.getElementById('torbutton_httpsPort').value);
        o_customprefs.setCharPref('ftp_proxy',       doc.getElementById('torbutton_ftpProxy').value);
        o_customprefs.setIntPref('ftp_port',         doc.getElementById('torbutton_ftpPort').value);
        o_customprefs.setCharPref('gopher_proxy',    doc.getElementById('torbutton_gopherProxy').value);
        o_customprefs.setIntPref('gopher_port',      doc.getElementById('torbutton_gopherPort').value);
        o_customprefs.setCharPref('socks_host',      doc.getElementById('torbutton_socksHost').value);
        o_customprefs.setIntPref('socks_port',       doc.getElementById('torbutton_socksPort').value);

        if(doc.getElementById('torbutton_socksGroup').selectedItem ==
                doc.getElementById('torbutton_socksv4')) {
            o_customprefs.setIntPref('socks_version', 4); 
        } else if(doc.getElementById('torbutton_socksGroup').selectedItem ==
                doc.getElementById('torbutton_socksv5')) {
            o_customprefs.setIntPref('socks_version', 5); 
        }
    }

    // Privacy and Security Settings
    o_torprefs.setBoolPref('block_disk', doc.getElementById('torbutton_blockDisk').checked);
    // If we have NoScript enabled we set `noscript.volatilePrivatePermissions`
    // to `true` if we are blocking disk records and to `false` if we are
    // enabling them.
    try {
      if ("@maone.net/noscript-service;1" in Components.classes) {
        let o_noscriptprefs = torbutton_get_prefbranch('noscript.');
        if (o_torprefs.getBoolPref('block_disk')) {
          o_noscriptprefs.setBoolPref('volatilePrivatePermissions', true);
        } else {
          o_noscriptprefs.setBoolPref('volatilePrivatePermissions', false);
        }
      }
    } catch (e) {}

    o_torprefs.setBoolPref('resist_fingerprinting', doc.getElementById('torbutton_resistFingerprinting').checked);
    o_torprefs.setBoolPref('no_tor_plugins', doc.getElementById('torbutton_blockPlugins').checked);
    o_torprefs.setBoolPref('restrict_thirdparty', doc.getElementById('torbutton_restrictThirdParty').checked);
    o_torprefs.setBoolPref('security_custom',
                           doc.getElementById('torbutton_sec_custom').checked);
    o_torprefs.setIntPref('security_slider',
                          doc.getElementById('torbutton_sec_slider').value);

    // if tor settings were initially active, update the active settings to reflect any changes
    if (tor_enabled) torbutton_activate_tor_settings();
    // If we have non-custom Security Slider settings update them now.
    if (!o_torprefs.getBoolPref('security_custom')) {
      win.torbutton_update_security_slider();
    }
}

function torbutton_prefs_test_settings() {

    // Reset Tor state to disabled.
    var wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
        .getService(Components.interfaces.nsIWindowMediator);
    var chrome = wm.getMostRecentWindow("navigator:browser");

    if(chrome.m_tb_ff3) {
        // FIXME: This is kind of ghetto.. can we make a progress 
        // bar or a window that updates itself?
        var warning = chrome.torbutton_get_property_string("torbutton.popup.test.ff3_notice");
        window.alert(warning);
    }
    var ret = chrome.torbutton_test_settings();
    // Strange errors are not worth translating. Our english users will
    // tell us they happen and we will (presumably) make them not happen.
    if(ret < 0) {
        ret = -ret;
        window.alert("Tor proxy test: HTTP error for check.torproject.org: "+ret);
        return;
    }

    switch(ret) {
        case 0:
            window.alert("Tor proxy test: Internal error");
            break;
        case 1:
            window.alert("Tor proxy test: Result not mimetype text/xml");
            break;
        case 3: // Can't seem to happen
            window.alert("Tor proxy test: Can't find result target!");
            break;
        case 2:
            window.alert("Tor proxy test: No TorCheckResult id found (response not valid XHTML)");
            break;
        case 4:
            var warning = chrome.torbutton_get_property_string("torbutton.popup.test.success");
            window.alert(warning);
            break;
        case 5:
            var warning = chrome.torbutton_get_property_string("torbutton.popup.test.failure");
            window.alert(warning);
            break;
        case 6:
            window.alert("Tor proxy test: TorDNSEL failure. Results unknown.");
            break;
        case 7:
            window.alert("Tor proxy test: check.torproject.org returned bad result");
            break;
        case 8:
            var warning = chrome.torbutton_get_property_string("torbutton.popup.test.no_http_proxy");
            window.alert(warning);
            break;
    }
}

function torbutton_prefs_reset_defaults() {
    var o_torprefs = torbutton_get_prefbranch('extensions.torbutton.');
    var o_proxyprefs = torbutton_get_prefbranch('network.proxy.');
    var tmpcnt = new Object();
    var children;
    var i;
    var was_enabled = false;
    var loglevel = o_torprefs.getIntPref("loglevel");
    var logmthd = o_torprefs.getIntPref("logmethod");
    
    torbutton_log(3, "Starting Pref reset");

    //  0. Disable tor
    //  1. Clear proxy settings
    //  2. Restore saved prefs
    //  3. Clear torbutton settings
    //  4. Enable tor if was previously enabled

    // Reset Tor state to disabled.
    var wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
        .getService(Components.interfaces.nsIWindowMediator);
    var chrome = wm.getMostRecentWindow("navigator:browser");

    // XXX Warning: The only reason this works is because of Firefox's 
    // threading model. As soon as a pref is changed, all observers
    // are notified by that same thread, immediately. Since torbutton's
    // security state is driven by proxy pref observers, this
    // causes everything to be reset in a linear order. If firefox 
    // ever makes pref observers asynchonous, this will all break.
    if(o_torprefs.getBoolPref("tor_enabled")) {
        chrome.torbutton_disable_tor();
        was_enabled = true;
    }
    
    torbutton_log(3, "Tor disabled for pref reset");

    children = o_torprefs.getChildList("" , tmpcnt);
    for(i = 0; i < children.length; i++) {
        if(o_torprefs.prefHasUserValue(children[i]))
            o_torprefs.clearUserPref(children[i]);
    }

    // Keep logging the same.
    o_torprefs.setIntPref("loglevel", loglevel);
    o_torprefs.setIntPref("logmethod", logmthd);

    children = o_proxyprefs.getChildList("" , tmpcnt);
    for(i = 0; i < children.length; i++) {
        if(o_proxyprefs.prefHasUserValue(children[i]))
            o_proxyprefs.clearUserPref(children[i]);
    }
    
    torbutton_log(3, "Resetting browser prefs");

    // Reset browser prefs that torbutton touches just in case
    // they get horked. Better everything gets set back to default
    // than some arcane pref gets wedged with no clear way to fix it.
    // Technical users who tuned these by themselves will be able to fix it.
    // It's the non-technical ones we should make it easy for
    torbutton_reset_browser_prefs();

    chrome.torbutton_init_prefs();
    torbutton_log(3, "Prefs reset");

    if(was_enabled) {
        // Hack for torbrowser/others where tor proxies are the same
        // as non-tor.
        if(chrome.torbutton_check_status()) {
            torbutton_log(4, "Tor still enabled after reset. Attempting to restore sanity");
            chrome.torbutton_set_status();
        } else {
            chrome.torbutton_enable_tor(true);
        }
    }

    // Resetting the Security Slider preferences
    o_torprefs.setBoolPref('security_custom', false);
    o_torprefs.setIntPref('security_slider', 4);
    chrome.torbutton_update_security_slider();

    torbutton_log(4, "Preferences reset to defaults");
    torbutton_prefs_init(window.document);

    // In all cases, force prefs to be synced to disk
    var prefService = Components.classes["@mozilla.org/preferences-service;1"]
        .getService(Components.interfaces.nsIPrefService);
    prefService.savePrefFile(null);
}

function torbutton_toggle_slider(doc, pos) {
    doc.getElementById("torbutton_sec_slider").value = pos;
    // Make sure the custom checkbox is unchecked as the user seems to want one
    // of the defined security levels.
    let sec_custom = doc.getElementById("torbutton_sec_custom");
    if (sec_custom.checked) {
        sec_custom.checked = false;
    }
    torbutton_set_slider_text(doc, false);
}

function torbutton_set_slider_text(doc, custom) {
  let level = doc.getElementById("torbutton_sec_slider").value;
  if (custom) {
    level = 5;
  }
  switch (level) {
    case (1):
      doc.getElementById("desc_low").collapsed = true;
      doc.getElementById("desc_medium_low").collapsed = true;
      doc.getElementById("desc_medium_high").collapsed = true;
      doc.getElementById("desc_high").collapsed = false;
      break;
    case (2):
      doc.getElementById("desc_low").collapsed = true;
      doc.getElementById("desc_medium_low").collapsed = true;
      doc.getElementById("desc_medium_high").collapsed = false;
      doc.getElementById("desc_high").collapsed = true;
      break;
   case (3):
      doc.getElementById("desc_low").collapsed = true;
      doc.getElementById("desc_medium_low").collapsed = false;
      doc.getElementById("desc_medium_high").collapsed = true;
      doc.getElementById("desc_high").collapsed = true;
      break;
    case (4):
      doc.getElementById("desc_low").collapsed = false;
      doc.getElementById("desc_medium_low").collapsed = true;
      doc.getElementById("desc_medium_high").collapsed = true;
      doc.getElementById("desc_high").collapsed = true;
      break;
    case (5):
      doc.getElementById("desc_low").collapsed = true;
      doc.getElementById("desc_medium_low").collapsed = true;
      doc.getElementById("desc_medium_high").collapsed = true;
      doc.getElementById("desc_high").collapsed = true;
      break;
  }
  // It can happen that the descriptions of the slider settings consume more
  // space than originally allocated. Adapt the dialog size accordingly.
  sizeToContent();
}

function torbutton_prefs_check_disk() {
    let o_torprefs = torbutton_get_prefbranch('extensions.torbutton.');
    let old_mode = o_torprefs.getBoolPref('block_disk');
    let mode = document.getElementById('torbutton_blockDisk').checked;

    if (mode === old_mode) {
        // Either revert, or uncheck.
        return;
    }

    let sb = Cc["@mozilla.org/intl/stringbundle;1"]
               .getService(Ci.nsIStringBundleService);
    let bundle = sb.createBundle("chrome://browser/locale/preferences/preferences.properties");
    let brandName = sb.createBundle("chrome://branding/locale/brand.properties").GetStringFromName("brandShortName");

    let msg = bundle.formatStringFromName(mode ?
                                        "featureEnableRequiresRestart" : "featureDisableRequiresRestart",
                                        [brandName], 1);
    let title = bundle.formatStringFromName("shouldRestartTitle", [brandName], 1);
    let prompts = Cc["@mozilla.org/embedcomp/prompt-service;1"].getService(Ci.nsIPromptService);
    let shouldProceed = prompts.confirm(window, title, msg)
    if (shouldProceed) {
      let cancelQuit = Cc["@mozilla.org/supports-PRBool;1"]
                         .createInstance(Ci.nsISupportsPRBool);
      let obsSvc = Cc["@mozilla.org/observer-service;1"]
                    .getService(Ci.nsIObserverService);
      obsSvc.notifyObservers(cancelQuit, "quit-application-requested",
                                   "restart");
      shouldProceed = !cancelQuit.data;

      if (shouldProceed) {
        document.documentElement.acceptDialog();
        let appStartup = Cc["@mozilla.org/toolkit/app-startup;1"]
                           .getService(Ci.nsIAppStartup);
        appStartup.quit(Ci.nsIAppStartup.eAttemptQuit |  Ci.nsIAppStartup.eRestart);
        return;
      }
    }

    document.getElementById('torbutton_blockDisk').checked = old_mode;
}
