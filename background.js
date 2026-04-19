/* global chrome */

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({
    openPanelOnActionClick: true
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "PAGE_CONTENT") {
    console.log("Page content preview:", message.content);
  }

  if (message.type === "PAGE_INFO") {
    console.log("Page title is:", message.title);
  }
});