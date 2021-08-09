/*
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
*/
'use strict';

import {
  configs
} from '/common/common.js';

const TST_ID = 'treestyletab@piro.sakura.ne.jp';

const stylesForWindow = new Map();

async function registerToTST() {
  try {
    await browser.runtime.sendMessage(TST_ID, {
      type: 'register-self' ,
      name: browser.i18n.getMessage('extensionName'),
      //icons: browser.runtime.getManifest().icons,
    });
  }
  catch(_error) {
    // TST is not available
  }
}
configs.$loaded.then(registerToTST);

browser.runtime.onMessageExternal.addListener((message, sender) => {
  switch (sender.id) {
    case TST_ID:
      switch (message.type) {
        case 'ready':
          registerToTST();
          break;
      }
      break;
  }
});

browser.tabs.onCreated.addListener(tab => {
  reserveToUpdateActiveTabMarker(tab.windowId);
});

browser.tabs.onRemoved.addListener((_tabId, removeInfo) => {
  reserveToUpdateActiveTabMarker(removeInfo.windowId);
});

browser.tabs.onDetached.addListener((_tabId, detachInfo) => {
  reserveToUpdateActiveTabMarker(detachInfo.oldWindowId);
});

browser.windows.onRemoved.addListener(windowId => {
  stylesForWindow.delete(windowId);
});
