console.log("CONTENT JS NEW VERSION LOADED");
console.log("content.js loaded fully");

let lastInteractionAt = Date.now();
let heartbeatInterval = null;
let lastInteractionMessageAt = 0;
const INTERACTION_MESSAGE_THROTTLE_MS = 15000;

init();

function init() {
  const pageInfo = getCourseraPageInfo();

  safeSendMessage({
    type: "COURSE_PAGE_INFO",
    pageInfo
  });

  setupInteractionTracking();
  startHeartbeat();
  createSupportButton();
}

function getCourseraPageInfo() {
  const url = window.location.href;
  const hostname = window.location.hostname;
  const title = document.title || "";
  const bodyText = document.body?.innerText?.slice(0, 1000) || "";
  const path = window.location.pathname;

  let pageType = "unknown";
  if (path.includes("/lecture/")) pageType = "lecture";
  else if (path.includes("/quiz/")) pageType = "quiz";
  else if (path.includes("/supplement/")) pageType = "reading";
  else if (path.includes("/learn/")) pageType = "course";

  let courseId = null;
  const learnMatch = path.match(/\/learn\/([^/]+)/);
  if (learnMatch) {
    courseId = learnMatch[1];
  }

  return {
    platform: "coursera",
    hostname,
    url,
    path,
    title,
    courseId,
    pageType,
    capturedAt: Date.now(),
    bodyPreview: bodyText
  };
}

function setupInteractionTracking() {
  const trackedEvents = ["mousemove", "click", "scroll", "keydown", "focus"];

  trackedEvents.forEach((eventName) => {
    window.addEventListener(
      eventName,
      () => {
        const now = Date.now();
        lastInteractionAt = now;

        const shouldSendInteractionMessage =
          now - lastInteractionMessageAt >= INTERACTION_MESSAGE_THROTTLE_MS;

        if (shouldSendInteractionMessage) {
          lastInteractionMessageAt = now;

          safeSendMessage({
            type: "USER_INTERACTION",
            interaction: {
              eventName,
              url: window.location.href,
              title: document.title || "",
              lastInteractionAt: now
            }
          });
        }
      },
      { passive: true }
    );
  });

  document.addEventListener("visibilitychange", () => {
    safeSendMessage({
      type: "VISIBILITY_CHANGE",
      visibility: {
        state: document.visibilityState,
        url: window.location.href,
        changedAt: Date.now()
      }
    });
  });
}

function sendHeartbeat() {
  safeSendMessage({
    type: "STUDY_HEARTBEAT",
    heartbeat: {
      pageInfo: getCourseraPageInfo(),
      visibilityState: document.visibilityState,
      lastInteractionAt,
      sentAt: Date.now()
    }
  });
}

function startHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }

  sendHeartbeat();

  heartbeatInterval = setInterval(() => {
    sendHeartbeat();
  }, 15000);
}

function safeSendMessage(message) {
  try {
    if (!chrome?.runtime?.id) {
      stopHeartbeat();
      return;
    }

    chrome.runtime.sendMessage(message, () => {
      if (chrome.runtime.lastError) {
        console.debug("sendMessage skipped:", chrome.runtime.lastError.message);
      }
    });
  } catch (error) {
    console.debug("sendMessage failed:", error);
    stopHeartbeat();
  }
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

function createSupportButton() {
  if (document.getElementById("ai-study-mentor-btn")) return;

  const button = document.createElement("button");
  button.id = "ai-study-mentor-btn";
  button.textContent = "Need support?";
  button.setAttribute("type", "button");

  button.style.position = "fixed";
  button.style.right = "20px";
  button.style.bottom = "20px";
  button.style.zIndex = "999999";
  button.style.padding = "12px 16px";
  button.style.border = "none";
  button.style.borderRadius = "999px";
  button.style.background = "#6366f1";
  button.style.color = "#ffffff";
  button.style.fontSize = "14px";
  button.style.fontWeight = "600";
  button.style.cursor = "pointer";
  button.style.boxShadow = "0 8px 24px rgba(0,0,0,0.18)";

  button.addEventListener("mouseenter", () => {
    button.style.transform = "translateY(-1px)";
  });

  button.addEventListener("mouseleave", () => {
    button.style.transform = "translateY(0)";
  });

  button.addEventListener("click", () => {
    safeSendMessage({
      type: "OPEN_SIDE_PANEL"
    });
  });

  document.body.appendChild(button);
}