/**
 * This file is part of Adguard Browser Extension (https://github.com/AdguardTeam/AdguardBrowserExtension).
 *
 * Adguard Browser Extension is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Adguard Browser Extension is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Adguard Browser Extension.  If not, see <http://www.gnu.org/licenses/>.
 */

/* global chrome, Log */

/**
 * Chromium windows implementation
 * @type {{onCreated, onRemoved, onUpdated, create, getLastFocused, forEachNative}}
 */
adguard.windowsImpl = (function (adguard) {

    'use strict';

    var browser = browser || chrome;

    function toWindowFromChromeWindow(chromeWin) {
        return {
            windowId: chromeWin.id,
            type: chromeWin.type === 'normal' || chromeWin.type === 'popup' ? chromeWin.type : 'other'
        };
    }

    var onCreatedChannel = adguard.utils.channels.newChannel();
    var onRemovedChannel = adguard.utils.channels.newChannel();
    var onUpdatedChannel = adguard.utils.channels.newChannel();

    // https://developer.chrome.com/extensions/windows#event-onCreated
    browser.windows.onCreated.addListener(function (chromeWin) {
        onCreatedChannel.notify(toWindowFromChromeWindow(chromeWin), chromeWin);
    });

    // https://developer.chrome.com/extensions/windows#event-onRemoved
    browser.windows.onRemoved.addListener(function (windowId) {
        onRemovedChannel.notify(windowId);
    });

    var create = function (createData, callback) {
        // https://developer.chrome.com/extensions/windows#method-create
        browser.windows.create(createData, function (chromeWin) {
            callback(toWindowFromChromeWindow(chromeWin), chromeWin);
        });
    };

    var forEachNative = function (callback) {
        // https://developer.chrome.com/extensions/windows#method-getAll
        browser.windows.getAll(function (chromeWins) {
            for (var i = 0; i < chromeWins.length; i++) {
                var chromeWin = chromeWins[i];
                callback(chromeWin, toWindowFromChromeWindow(chromeWin));
            }
        });
    };

    var getLastFocused = function (callback) {
        // https://developer.chrome.com/extensions/windows#method-getLastFocused
        browser.windows.getLastFocused(function (chromeWin) {
            callback(chromeWin.id);
        });
    };

    return {

        onCreated: onCreatedChannel, // callback (adguardWin, nativeWin)
        onRemoved: onRemovedChannel, // callback (windowId)
        onUpdated: onUpdatedChannel, // empty

        create: create,
        getLastFocused: getLastFocused,

        forEachNative: forEachNative
    };

})(adguard);

/**
 * Chromium tabs implementation
 * @type {{onCreated, onRemoved, onUpdated, onActivated, create, remove, activate, reload, sendMessage, getAll, getActive, fromChromeTab}}
 */
adguard.tabsImpl = (function (adguard) {

    'use strict';

    var browser = browser || chrome;

    /**
     * tabId parameter must be integer
     * @param tabId
     */
    function tabIdToInt(tabId) {
        return parseInt(tabId);
    }

    function checkLastError() {
        var ex = browser.runtime.lastError;
        if (ex) {
            Log.error("Error while executing operation: {0}", ex);
        }
        return ex;
    }

    // https://developer.chrome.com/extensions/tabs#type-Tab
    function toTabFromChromeTab(chromeTab) {
        return {
            tabId: chromeTab.id,
            url: chromeTab.url,
            title: chromeTab.title,
            incognito: chromeTab.incognito,
            status: chromeTab.status
        };
    }

    // https://developer.chrome.com/extensions/tabs#event-onCreated
    var onCreatedChannel = adguard.utils.channels.newChannel();
    browser.tabs.onCreated.addListener(function (chromeTab) {
        onCreatedChannel.notify(toTabFromChromeTab(chromeTab));
    });

    // https://developer.chrome.com/extensions/tabs#event-onCreated
    var onRemovedChannel = adguard.utils.channels.newChannel();
    browser.tabs.onRemoved.addListener(function (tabId) {
        onRemovedChannel.notify(tabId);
    });

    var onUpdatedChannel = adguard.utils.channels.newChannel();
    // https://developer.chrome.com/extensions/tabs#event-onUpdated
    browser.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
        onUpdatedChannel.notify(toTabFromChromeTab(tab));
    });

    // https://developer.chrome.com/extensions/tabs#event-onActivated
    var onActivatedChannel = adguard.utils.channels.newChannel();
    browser.tabs.onActivated.addListener(function (activeInfo) {
        onActivatedChannel.notify(activeInfo.tabId);
    });

    // https://developer.chrome.com/extensions/windows#event-onFocusChanged
    browser.windows.onFocusChanged.addListener(function (windowId) {
        if (windowId === browser.windows.WINDOW_ID_NONE) {
            return;
        }
        getActive(onActivatedChannel.notify);
    });

    var create = function (createData, callback) {

        var url = createData.url;
        var active = createData.active === true;

        if (createData.type === 'popup') {
            // https://developer.chrome.com/extensions/windows#method-create
            browser.windows.create({
                url: url,
                type: 'popup',
                focused: active,
                width: 1230,
                height: 630
            }, callback);
            return;
        }

        var isHttp = url.indexOf('http') === 0;

        function onWindowFound(win) {
            // https://developer.chrome.com/extensions/tabs#method-create
            browser.tabs.create({
                windowId: win.id,
                url: url,
                active: active
            }, function (chromeTab) {
                callback(toTabFromChromeTab(chromeTab));
            });
        }

        function isAppropriateWindow(win) {
            // We can't open not-http (e.g. 'chrome-extension://') urls in incognito mode
            return win.type === 'normal' && (isHttp || !win.incognito);
        }

        // https://developer.chrome.com/extensions/windows#method-create
        // https://developer.chrome.com/extensions/windows#method-getLastFocused

        browser.windows.getLastFocused(function (win) {

            if (isAppropriateWindow(win)) {
                onWindowFound(win);
                return;
            }

            browser.windows.getAll(function (wins) {

                for (var i = 0; i < wins.length; i++) {
                    var win = wins[i];
                    if (isAppropriateWindow(win)) {
                        onWindowFound(win);
                        return;
                    }
                }

                // Create new window
                browser.windows.create({}, onWindowFound);
            });
        });
    };

    var remove = function (tabId, callback) {
        // https://developer.chrome.com/extensions/tabs#method-remove
        browser.tabs.remove(tabIdToInt(tabId), function () {
            if (checkLastError()) {
                return;
            }
            callback(tabId);
        });
    };

    var activate = function (tabId, callback) {
        browser.tabs.update(tabIdToInt(tabId), {active: true}, function (tab) {
            if (checkLastError()) {
                return;
            }
            // Focus window
            browser.windows.update(tab.windowId, {focused: true}, function () {
                if (checkLastError()) {
                    return;
                }
                callback(tabId);
            });
        });
    };

    var reload = function (tabId, url) {
        if (url) {
            if (adguard.utils.browser.isEdgeBrowser()) {
                /**
                 * For security reasons, in Firefox and Edge, this may not be a privileged URL.
                 * So passing any of the following URLs will fail, with runtime.lastError being set to an error message:
                 * chrome: URLs
                 * javascript: URLs
                 * data: URLs
                 * privileged about: URLs (for example, about:config, about:addons, about:debugging).
                 *
                 * Non-privileged URLs (about:home, about:newtab, about:blank) are allowed.
                 *
                 * So we use a content script instead.
                 */
                sendMessage(tabId, {type: 'update-tab-url', url: url});
            } else {
                browser.tabs.update(tabIdToInt(tabId), {url: url}, checkLastError);
            }
        } else {
            // https://developer.chrome.com/extensions/tabs#method-reload
            if (browser.tabs.reload) {
                browser.tabs.reload(tabIdToInt(tabId), {bypassCache: true}, checkLastError);
            } else {
                // Reload page without cache via content script
                sendMessage(tabId, {type: 'no-cache-reload'});
            }
        }
    };

    var sendMessage = function (tabId, message, responseCallback) {
        // https://developer.chrome.com/extensions/tabs#method-sendMessage
        (browser.tabs.sendMessage || browser.tabs.sendRequest)(tabIdToInt(tabId), message, responseCallback);
    };

    var getAll = function (callback) {
        // https://developer.chrome.com/extensions/tabs#method-query
        browser.tabs.query({}, function (chromeTabs) {
            var result = [];
            for (var i = 0; i < chromeTabs.length; i++) {
                var chromeTab = chromeTabs[i];
                result.push(toTabFromChromeTab(chromeTab));
            }
            callback(result);
        });
    };

    var getActive = function (callback) {
        browser.tabs.query({lastFocusedWindow: true, active: true}, function (tabs) {
            if (tabs && tabs.length > 0) {
                callback(tabs[0].id);
            }
        });
    };

    return {

        onCreated: onCreatedChannel,
        onRemoved: onRemovedChannel,
        onUpdated: onUpdatedChannel,
        onActivated: onActivatedChannel,

        create: create,
        remove: remove,
        activate: activate,
        reload: reload,
        sendMessage: sendMessage,
        getAll: getAll,
        getActive: getActive,

        fromChromeTab: toTabFromChromeTab
    };

})(adguard);