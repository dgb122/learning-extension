/* global chrome */

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({
    openPanelOnActionClick: true
  });
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === "PAGE_CONTENT") {
    console.log("Page content preview:", message.content);
  }

  if (message.type === "PAGE_INFO") {
    console.log("Page title is:", message.title);
  }

  if (message.type === "OPEN_SIDE_PANEL") {
    const tabId = sender.tab?.id;
    const windowId = sender.tab?.windowId;

    if (typeof windowId === "number") {
      chrome.sidePanel.open({ windowId }).catch((error) => {
        console.error("Failed to open side panel:", error);
      });
    } else if (typeof tabId === "number") {
      chrome.sidePanel.open({ tabId }).catch((error) => {
        console.error("Failed to open side panel:", error);
      });
    }
  }
});