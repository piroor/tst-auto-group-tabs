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

let mLastFocusedWindowId = browser.windows.WINDOW_ID_NONE;

browser.windows.getAll().then(windows => {
  for (const window of windows) {
    if (!window.focused)
      continue;

    mLastFocusedWindowId = window.id;
    break;
  }
});

/*
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
*/


const mTabUniqyeIdById = new Map();
const mTabIdByUniqueId = new Map();
const mTabIdsInWindow  = new Map();

const mTabsOpenedByExternalApplicationsInWindow = new Map();
const mGroupTabIdInWindow = new Map();

async function uniqueIdToId(uniqueId, windowId) {
  if (!uniqueId)
    return null;

  const tabs = await browser.tabs.query({ windowId });
  const uniqueIds = await Promise.all(tabs.map(tab => browser.sessions.getTabValue(tab.id, 'uniqueId')));
  const index = uniqueIds.indexOf(uniqueId);
  if (index < 0)
    return null;

  return tabs[index].id;
}

function trackTab(tab) {
  const uniqueId = `${Date.now()}-${parseInt(Math.random() * 65000)}`
  browser.sessions.setTabValue(tab.id, 'uniqueId', uniqueId);
  mTabUniqyeIdById.set(tab.id, uniqueId);
  mTabIdByUniqueId.set(uniqueId, tab.id);

  const tabIds = mTabIdsInWindow.get(tab.windowId) || new Set();
  tabIds.add(tab.id);
  mTabIdsInWindow.set(tab.windowId, tabIds);
}

function untrackTab(tabId, windowId) {
  const tabIds = mTabIdsInWindow.get(windowId);
  if (tabIds)
    tabIds.delete(tabId);

  const uniqueId = mTabUniqyeIdById.get(tabId);
  if (uniqueId)
    mTabIdByUniqueId.delete(uniqueId);
  mTabUniqyeIdById.delete(tabId);

  const tabsOpenedByExternalApps = mTabsOpenedByExternalApplicationsInWindow.get(windowId);
  if (tabsOpenedByExternalApps)
    tabsOpenedByExternalApps.delete(tabId);
}


browser.tabs.onCreated.addListener(async tab => { try {
  trackTab(tab);

  const tabs = mTabsOpenedByExternalApplicationsInWindow.get(tab.windowId) || new Map();
  if (mLastFocusedWindowId == browser.windows.WINDOW_ID_NONE) {
    tabs.set(tab.id, tab);
    mTabsOpenedByExternalApplicationsInWindow.set(tab.windowId, tabs);
  }

  const groupTabId = mGroupTabIdInWindow.get(tab.windowId) ||
    await uniqueIdToId(await browser.sessions.getWindowValue(tab.windowId, 'groupTabId_byExternalApps'), tab.windowId);
  if (tab.id == groupTabId)
    return;

  let groupTab = groupTabId && await browser.tabs.get(groupTabId).catch(_error => null);
  if (groupTab && groupTab.windowId != tab.windowId) {
    mGroupTabIdInWindow.delete(tab.windowId);
    groupTab = null;
  }

  if (!groupTab && tabs.size < 2)
    return;

  const tabsToBeGrouped = Array.from(tabs.values());
  tabs.clear();

  if (!groupTab) {
    const title = configs.groupTabTitle_byExternalApps || browser.i18n.getMessage('defaultGroupTabTitle_byExternalApps');
    groupTab = await browser.tabs.create({
      url:    `ext+treestyletab:group?title=${encodeURIComponent(title)}&temporary=true`,
      active: false,
    });
    mGroupTabIdInWindow.set(tab.windowId, groupTab.id);
    browser.sessions.setWindowValue(tab.windowId, 'groupTabId_byExternalApps', mTabUniqyeIdById.get(groupTab.id));
    tabs.delete(groupTab.id);
  }

  const lastDescendant = await browser.runtime.sendMessage(TST_ID, {
    type: 'get-tree',
    tab:  `lastDescendant-of-${groupTab.id}`,
  });
  let lastReferenceTab = lastDescendant || groupTab;
  for (const tab of tabsToBeGrouped) {
    await browser.runtime.sendMessage(TST_ID, {
      type:        'attach',
      parent:      groupTab.id,
      child:       tab.id,
      insertAfter: lastReferenceTab.id, 
    });
    lastReferenceTab = tab;
  }
} catch(error) { console.log(error); }});

browser.tabs.onRemoved.addListener((tabId, removeInfo) => {
  untrackTab(tabId, removeInfo.windowId);
});

browser.tabs.onAttached.addListener((tabId, attachInfo) => {
  const tabIds = mTabIdsInWindow.get(attachInfo.newWindowId);
  if (tabIds)
    tabIds.add(tabId);
});

browser.tabs.onDetached.addListener((tabId, detachInfo) => {
  const tabIds = mTabIdsInWindow.get(detachInfo.oldWindowId);
  if (tabIds)
    tabIds.delete(tabId);
});

browser.windows.onFocusChanged.addListener(windowId => {
  mLastFocusedWindowId = windowId;
});

browser.windows.onRemoved.addListener(windowId => {
  mTabsOpenedByExternalApplicationsInWindow.delete(windowId)
  const tabIds = mTabIdsInWindow.get(windowId);
  if (tabIds) {
    for (const id of tabIds) {
      untrackTab(id, windowId);
    }
    mTabIdsInWindow.delete(windowId);
  }
});
