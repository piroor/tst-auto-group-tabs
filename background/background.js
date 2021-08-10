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


const mTabUniqueIdById = new Map();
const mTabIdByUniqueId = new Map();
const mTabIdsInWindow  = new Map();

const mToBeGroupedTabsInWindow = new Map();
const mGroupTabIdInWindow = new Map();

async function uniqueIdToId(uniqueId, windowId) {
  if (!uniqueId)
    return null;

  const id = mTabIdByUniqueId.get(uniqueId);
  if (id)
    return id;

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
  mTabUniqueIdById.set(tab.id, uniqueId);
  mTabIdByUniqueId.set(uniqueId, tab.id);

  const tabIds = mTabIdsInWindow.get(tab.windowId) || new Set();
  tabIds.add(tab.id);
  mTabIdsInWindow.set(tab.windowId, tabIds);
}

function untrackTab(tabId, windowId) {
  const tabIds = mTabIdsInWindow.get(windowId);
  if (tabIds)
    tabIds.delete(tabId);

  const uniqueId = mTabUniqueIdById.get(tabId);
  if (uniqueId)
    mTabIdByUniqueId.delete(uniqueId);
  mTabUniqueIdById.delete(tabId);

  const toBeGroupedTabs = mToBeGroupedTabsInWindow.get(windowId);
  if (toBeGroupedTabs) {
    for (const tabs of toBeGroupedTabs.values()) {
      tabs.delete(tabId);
    }
  }
}

browser.tabs.query({}).then(tabs => {
  for (const tab of tabs) {
    browser.sessions.getTabValue(tab.id, 'uniqueId').then(uniqueId => {
      if (uniqueId) {
        mTabUniqueIdById.set(tab.id, uniqueId);
        mTabIdByUniqueId.set(uniqueId, tab.id);
      }
      else {
        trackTab(tab);
      }
    });
  }
});


async function attachTabsToGroup(tabs, groupTab) {
  const lastDescendant = await browser.runtime.sendMessage(TST_ID, {
    type: 'get-tree',
    tab:  `lastDescendant-of-${groupTab.id}`,
  });
  let lastReferenceTab = lastDescendant || groupTab;
  for (const tab of tabs) {
    await browser.runtime.sendMessage(TST_ID, {
      type:        'attach',
      parent:      groupTab.id,
      child:       tab.id,
      insertAfter: lastReferenceTab.id, 
    });
    lastReferenceTab = await browser.runtime.sendMessage(TST_ID, {
      type: 'get-tree',
      tab:  `lastDescendant-of-${tab.id}`,
    }) || tab;
  }
}

async function getGroupTabForContext(context, windowId) {
  const groupTabIds = mGroupTabIdInWindow.get(windowId) || new Map();

  const groupTabId = groupTabIds.get(context) ||
    await uniqueIdToId(await browser.sessions.getWindowValue(windowId, `groupTabId_${context}`), windowId);

  let groupTab = groupTabId && await browser.tabs.get(groupTabId).catch(_error => null);
  if (groupTab && groupTab.windowId != windowId) {
    groupTabIds.delete(context);
    groupTab = null;
  }

  mGroupTabIdInWindow.set(groupTabIds);

  return groupTab;
}

async function prepareGroupTabForContext(context, windowId) {
  const groupTabIds = mGroupTabIdInWindow.get(windowId) || new Map();

  const title = configs[`groupTabTitle_${context}`] || browser.i18n.getMessage(`defaultGroupTabTitle_${context}`);
  const groupTab = await browser.tabs.create({
    url:    `ext+treestyletab:group?title=${encodeURIComponent(title)}&temporary=true`,
    active: false,
  });
  browser.sessions.setWindowValue(windowId, `groupTabId_${context}`, mTabUniqueIdById.get(groupTab.id));

  groupTabIds.set(context, groupTab.id);
  mGroupTabIdInWindow.set(windowId, groupTabIds);
  return groupTab;
}

async function handleNewTab(tab, context) {
  const toBeGroupedTabs = mToBeGroupedTabsInWindow.get(tab.windowId) || new Map();
  const toBeGroupedTabsForContext = toBeGroupedTabs.get(context) || new Map();
  toBeGroupedTabsForContext.set(tab.id, tab);
  toBeGroupedTabs.set(context, toBeGroupedTabsForContext);
  mToBeGroupedTabsInWindow.set(tab.windowId, toBeGroupedTabs);

  const groupTab = await getGroupTabForContext(context, tab.windowId);
  if (!groupTab && toBeGroupedTabsForContext.size < 2)
    return;

  const tabs = Array.from(toBeGroupedTabsForContext.values());
  toBeGroupedTabsForContext.clear();

  await attachTabsToGroup(
    tabs,
    groupTab || await prepareGroupTabForContext(context, tab.windowId)
  );
}


browser.tabs.onCreated.addListener(async tab => {
  try {
    trackTab(tab);
    if (mLastFocusedWindowId == browser.windows.WINDOW_ID_NONE)
      await handleNewTab(tab, 'byExternalApps');
  }
  catch(error) {
    console.log(error);
  }
});

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
  mToBeGroupedTabsInWindow.delete(windowId)
  const tabIds = mTabIdsInWindow.get(windowId);
  if (tabIds) {
    for (const id of tabIds) {
      untrackTab(id, windowId);
    }
    mTabIdsInWindow.delete(windowId);
  }
});
