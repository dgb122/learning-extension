/* global chrome */

const HEARTBEAT_MS = 15000;
const ACTIVE_WINDOW_MS = 60000;
const SESSION_END_THRESHOLD_MS = 5 * 60 * 1000;

chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed");

  chrome.sidePanel.setPanelBehavior({
    openPanelOnActionClick: true
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

  if (message.type === "COURSE_PAGE_INFO") {
    handlePageInfo(message.pageInfo);
  }

  if (message.type === "USER_INTERACTION") {
    handleUserInteraction(message.interaction);
  }

  if (message.type === "VISIBILITY_CHANGE") {
    handleVisibilityChange(message.visibility);
  }

  if (message.type === "STUDY_HEARTBEAT") {
    handleStudyHeartbeat(message.heartbeat, sender);
  }
});

function handlePageInfo(pageInfo) {
  chrome.storage.local.set({
    lastPageInfo: pageInfo,
    lastSeenAt: Date.now()
  });

  console.log("Saved page info:", pageInfo);
}

function handleUserInteraction(interaction) {
  chrome.storage.local.set({
    lastInteraction: interaction,
    lastInteractionAt: interaction.lastInteractionAt
  });

  console.log("User interaction:", interaction);
}

function handleVisibilityChange(visibility) {
  chrome.storage.local.set({
    lastVisibility: visibility
  });

  console.log("Visibility changed:", visibility);
}

async function handleStudyHeartbeat(heartbeat, sender) {
  const now = heartbeat.sentAt;
  const msSinceInteraction = now - heartbeat.lastInteractionAt;
  const isVisible = heartbeat.visibilityState === "visible";
  const isActive = isVisible && msSinceInteraction <= ACTIVE_WINDOW_MS;

  const result = await chrome.storage.local.get([
    "liveTracking",
    "currentSession",
    "sessions",
    "lastSessionEndedAt"
  ]);

  const tabId = sender.tab?.id ?? null;

  const liveTracking = result.liveTracking || createEmptyLiveTracking();
  let currentSession = result.currentSession || null;
  const sessions = result.sessions || [];

  const cleanupResult = cleanupStaleSession(currentSession, sessions, now);
  currentSession = cleanupResult.currentSession;

  if (cleanupResult.didCleanup) {
    await chrome.storage.local.set({
      sessions: cleanupResult.sessions,
      currentSession: cleanupResult.currentSession,
      lastSessionEndedAt: cleanupResult.lastSessionEndedAt
    });

    console.log("Cleaned up stale session:", cleanupResult.endedSession);
  }

  liveTracking.currentCourseId = heartbeat.pageInfo.courseId;
  liveTracking.currentCourseName = heartbeat.pageInfo.courseId || "";
  liveTracking.currentPageTitle = heartbeat.pageInfo.title;
  liveTracking.currentPageType = heartbeat.pageInfo.pageType;
  liveTracking.currentUrl = heartbeat.pageInfo.url;
  liveTracking.lastHeartbeatAt = now;
  liveTracking.lastInteractionAt = heartbeat.lastInteractionAt;
  liveTracking.visibilityState = heartbeat.visibilityState;
  liveTracking.isActive = isActive;
  liveTracking.currentTabId = tabId;

  if (isActive) {
    liveTracking.activeMs += HEARTBEAT_MS;
    liveTracking.lastActiveAt = now;
  } else {
    liveTracking.inactiveMs += HEARTBEAT_MS;
  }

  const shouldStartSession = isActive && !currentSession;

  if (shouldStartSession) {
    currentSession = createNewSession(heartbeat, now, tabId);
    console.log("Started new session:", currentSession);
  }

  if (currentSession) {
    updateCurrentSession(currentSession, heartbeat, now, isActive, tabId);

    const msSinceLastActive = currentSession.lastActiveAt
      ? now - currentSession.lastActiveAt
      : 0;

    const shouldEndSession =
      !isActive && msSinceLastActive >= SESSION_END_THRESHOLD_MS;

    if (shouldEndSession) {
      endCurrentSession(currentSession, now);
      sessions.push(currentSession);

      await chrome.storage.local.set({
        sessions,
        currentSession: null,
        lastSessionEndedAt: now
      });

      console.log("Ended session:", currentSession);
      currentSession = null;
    }
  }

  await chrome.storage.local.set({
    liveTracking,
    currentSession
  });

  console.log("Study heartbeat:", {
    isActive,
    activeMs: liveTracking.activeMs,
    inactiveMs: liveTracking.inactiveMs,
    lastActiveAt: liveTracking.lastActiveAt,
    currentSessionId: currentSession?.sessionId || null,
    pageTitle: liveTracking.currentPageTitle
  });
}

function cleanupStaleSession(currentSession, sessions, now) {
  if (!currentSession || !currentSession.lastActiveAt) {
    return {
      didCleanup: false,
      currentSession,
      sessions
    };
  }

  const msSinceLastActive = now - currentSession.lastActiveAt;
  const isStale = msSinceLastActive >= SESSION_END_THRESHOLD_MS;

  if (!isStale) {
    return {
      didCleanup: false,
      currentSession,
      sessions
    };
  }

  const endedSession = {
    ...currentSession,
    endedAt: currentSession.lastActiveAt,
    durationMs: currentSession.lastActiveAt - currentSession.startedAt
  };

  return {
    didCleanup: true,
    currentSession: null,
    sessions: [...sessions, endedSession],
    endedSession,
    lastSessionEndedAt: endedSession.endedAt
  };
}

function createEmptyLiveTracking() {
  return {
    currentCourseId: null,
    currentCourseName: "",
    currentPageTitle: "",
    currentPageType: "unknown",
    currentUrl: "",
    lastHeartbeatAt: null,
    lastInteractionAt: null,
    lastActiveAt: null,
    visibilityState: "hidden",
    isActive: false,
    activeMs: 0,
    inactiveMs: 0,
    currentTabId: null
  };
}

function createNewSession(heartbeat, now, tabId) {
  return {
    sessionId: `session_${now}`,
    startedAt: now,
    endedAt: null,
    lastActiveAt: now,
    durationMs: 0,
    activeMs: 0,
    inactiveMs: 0,
    courseId: heartbeat.pageInfo.courseId,
    courseName: heartbeat.pageInfo.courseId || "",
    pageTitle: heartbeat.pageInfo.title,
    pageType: heartbeat.pageInfo.pageType,
    url: heartbeat.pageInfo.url,
    tabId
  };
}

function updateCurrentSession(session, heartbeat, now, isActive, tabId) {
  session.courseId = heartbeat.pageInfo.courseId;
  session.courseName = heartbeat.pageInfo.courseId || "";
  session.pageTitle = heartbeat.pageInfo.title;
  session.pageType = heartbeat.pageInfo.pageType;
  session.url = heartbeat.pageInfo.url;
  session.durationMs = now - session.startedAt;
  session.tabId = session.tabId ?? null;
  session.tabId = tabId;

  if (isActive) {
    session.activeMs += HEARTBEAT_MS;
    session.lastActiveAt = now;
  } else {
    session.inactiveMs += HEARTBEAT_MS;
  }
}

function endCurrentSession(session, now) {
  session.endedAt = now;
  session.durationMs = now - session.startedAt;
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const result = await chrome.storage.local.get([
    "currentSession",
    "sessions",
    "lastSessionEndedAt",
    "liveTracking"
  ]);

  const currentSession = result.currentSession || null;
  const sessions = result.sessions || [];
  const liveTracking = result.liveTracking || createEmptyLiveTracking();

  if (!currentSession || currentSession.tabId !== tabId) {
    return;
  }

  const endedAt = Date.now();
  endCurrentSession(currentSession, endedAt);
  sessions.push(currentSession);

  if (liveTracking.currentTabId === tabId) {
    liveTracking.currentTabId = null;
    liveTracking.isActive = false;
    liveTracking.visibilityState = "hidden";
    liveTracking.currentUrl = "";
    liveTracking.currentPageTitle = "";
    liveTracking.currentPageType = "unknown";
  }

  await chrome.storage.local.set({
    currentSession: null,
    sessions,
    lastSessionEndedAt: endedAt,
    liveTracking
  });

  console.log("Ended session because tab was closed:", currentSession);
});