console.log("CONTENT JS NEW VERSION LOADED");
console.log("content.js loaded fully");

let lastInteractionAt = Date.now();
let heartbeatInterval = null;
let lastInteractionMessageAt = 0;
const INTERACTION_MESSAGE_THROTTLE_MS = 15000;

let mentorNudgeInterval = null;
let lastLargeNudgeAt = 0;
let lastSmallNudgeAt = 0;
let activeMentorSuggestion = null;

const LARGE_INACTIVITY_NUDGE_MS = 30 * 1000;
const SMALL_NUDGE_COOLDOWN_MS = 4 * 60 * 1000;

init();

function init() {
  const pageInfo = getCourseraPageInfo();

  safeSendMessage({
    type: "COURSE_PAGE_INFO",
    pageInfo
  });

  savePageContext(pageInfo);

  setupInteractionTracking();
  startHeartbeat();
  watchCourseraPageChanges();
  createMentorUI();
  startMentorNudges();
}

function getCourseraPageInfo() {
  const url = window.location.href;
  const hostname = window.location.hostname;
  const title = document.title || "";
  const path = window.location.pathname;

  const bodyText = document.body?.innerText || "";
  const cleanedBodyText = bodyText
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 3000);

  let pageType = "unknown";

  if (path.includes("/lecture/")) pageType = "lecture";
  else if (path.includes("/quiz/")) pageType = "quiz";
  else if (path.includes("/exam/")) pageType = "test";
  else if (path.includes("/assignment/")) pageType = "assignment";
  else if (path.includes("/supplement/")) pageType = "reading";
  else if (path.includes("/learn/")) pageType = "course";

  let courseId = null;
  const learnMatch = path.match(/\/learn\/([^/]+)/);

  if (learnMatch) {
    courseId = learnMatch[1];
  }

  const visibleHeadings = Array.from(
    document.querySelectorAll("h1, h2, h3")
  )
    .map((heading) => heading.innerText?.trim())
    .filter(Boolean)
    .slice(0, 8);

  const quizLikeQuestions = Array.from(
    document.querySelectorAll("h1, h2, h3, p, div")
  )
    .map((el) => el.innerText?.trim())
    .filter((text) => text && text.includes("?") && text.length < 300)
    .slice(0, 10);

  const video = document.querySelector("video");

  const videoInfo = video
    ? {
        currentTime: Math.round(video.currentTime || 0),
        duration: Math.round(video.duration || 0),
        paused: video.paused,
        ended: video.ended,
        progressPercent:
          video.duration > 0
            ? Math.round((video.currentTime / video.duration) * 100)
            : 0
      }
    : null;

  return {
    platform: "coursera",
    hostname,
    url,
    path,
    title,
    courseId,
    pageType,
    capturedAt: Date.now(),
    headings: visibleHeadings,
    bodyPreview: cleanedBodyText,
    quizLikeQuestions,
    videoInfo,
    courseProgressPercent: getCourseraCourseProgress()
  };
}

function isAssessmentPage(pageInfo = getCourseraPageInfo()) {
  return (
    pageInfo.pageType === "quiz" ||
    pageInfo.pageType === "test" ||
    pageInfo.pageType === "assignment"
  );
}

function getCourseraCourseProgress() {
  const bodyText = document.body?.innerText || "";

  const progressPatterns = [
    /(\d{1,3})%\s*(complete|completed|finished)/i,
    /(complete|completed|finished)\s*(\d{1,3})%/i,
    /progress\s*(\d{1,3})%/i
  ];

  for (const pattern of progressPatterns) {
    const match = bodyText.match(pattern);

    if (match) {
      const number = match[1] || match[2];
      const progress = Number(number);

      if (!Number.isNaN(progress) && progress >= 0 && progress <= 100) {
        return progress;
      }
    }
  }

  const completedMatches = bodyText.match(/completed|complete|done|finished/gi) || [];
  const lessonMatches = bodyText.match(/lecture|video|reading|quiz|assignment/gi) || [];

  if (lessonMatches.length > 0) {
    const estimatedProgress = Math.round(
      Math.min((completedMatches.length / lessonMatches.length) * 100, 100)
    );

    if (estimatedProgress > 0) {
      return estimatedProgress;
    }
  }

  return null;
}

async function savePageContext(pageInfo) {
  const existingData = await chrome.storage.local.get([
    "learningContext"
  ]);

  const learningContext = existingData.learningContext || {
    recentPages: [],
    recentQuestions: [],
    lastKnownTopic: "",
    lastCourseId: "",
    lastUpdated: null
  };

  learningContext.lastKnownTopic = pageInfo.title;
  learningContext.lastCourseId = pageInfo.courseId;
  learningContext.courseProgressPercent = pageInfo.courseProgressPercent;
  learningContext.lastUpdated = Date.now();

  learningContext.recentPages.unshift({
    title: pageInfo.title,
    pageType: pageInfo.pageType,
    url: pageInfo.url,
    headings: pageInfo.headings,
    capturedAt: pageInfo.capturedAt
  });

  learningContext.recentPages =
    learningContext.recentPages.slice(0, 15);

  if (pageInfo.quizLikeQuestions?.length) {
    learningContext.recentQuestions.unshift(
      ...pageInfo.quizLikeQuestions
    );

    learningContext.recentQuestions =
      [...new Set(learningContext.recentQuestions)]
        .slice(0, 30);
  }

  await chrome.storage.local.set({
    learningContext
  });

  console.log("Saved learning context", learningContext);
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
      learningContextUpdatedAt: Date.now(),
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

function watchCourseraPageChanges() {
  let lastUrl = window.location.href;
  let lastTitle = document.title;

  setInterval(() => {
    const currentUrl = window.location.href;
    const currentTitle = document.title;

    if (currentUrl !== lastUrl || currentTitle !== lastTitle) {
      lastUrl = currentUrl;
      lastTitle = currentTitle;

      const pageInfo = getCourseraPageInfo();

      safeSendMessage({
        type: "COURSE_PAGE_INFO",
        pageInfo
      });

      savePageContext(pageInfo);

      console.log("Coursera page context updated", pageInfo);
    }
  }, 3000);
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

function startMentorNudges() {
  if (mentorNudgeInterval) {
    clearInterval(mentorNudgeInterval);
  }

  mentorNudgeInterval = setInterval(() => {
    checkForMentorNudges();
  }, 15000);
}

async function analyseNudgeWithAI() {
  try {
    const pageInfo = getCourseraPageInfo();

    const data = await chrome.storage.local.get([
      "onboardingAnswers",
      "learningContext"
    ]);

    const response = await fetch("https://learning-extension.onrender.com/api/mentor", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "Analyse nudge",
        pageTitle: pageInfo.title || "",
        pageUrl: window.location.href,
        pageContext: pageInfo,
        learningContext: data.learningContext || {},
        onboardingAnswers: data.onboardingAnswers || {}
      })
    });

    return await response.json();
  } catch (error) {
    console.error("AI nudge analysis failed:", error);
    return null;
  }
}

async function checkForMentorNudges() {
  const now = Date.now();
  const pageInfo = getCourseraPageInfo();

  const drawer = document.getElementById("ai-study-mentor-drawer");
  const drawerIsOpen = drawer?.classList.contains("open");

  if (drawerIsOpen) return;

  const inactiveForMs = now - lastInteractionAt;

  if (
    inactiveForMs >= LARGE_INACTIVITY_NUDGE_MS &&
    now - lastLargeNudgeAt > LARGE_INACTIVITY_NUDGE_MS
  ) {
    lastLargeNudgeAt = now;

    showMentorNudge({
      size: "large",
      title: "Still with me?",
      message:
        "You’ve already opened the course, so don’t let this turn into a half-study session. Do one tiny action to keep the momentum.",
      actionText: "Help me restart",
      action: "Explain this topic"
    });

    return;
  }

  if (now - lastSmallNudgeAt < SMALL_NUDGE_COOLDOWN_MS) return;

  const aiNudge = await analyseNudgeWithAI();

    if (aiNudge?.shouldNudge) {
    lastSmallNudgeAt = now;

    showMentorNudge({
      size: "small",
      title: aiNudge.title || "Need support?",
      message: aiNudge.message || "I noticed a useful moment to help.",
      actionText: "Open mentor",
      action: aiNudge.action || "Explain this topic"
    });
  }
}

function showMentorNudge({ size, title, message, actionText, action }) {
  if (size === "small") {
    showMentorBadgeNudge({
      title,
      message,
      action
    });

    return;
  }

  const existingNudge = document.getElementById("ai-mentor-nudge");
  if (existingNudge) existingNudge.remove();

  const nudge = document.createElement("div");
  nudge.id = "ai-mentor-nudge";
  nudge.className = `ai-mentor-nudge ${size === "large" ? "large" : "small"}`;

  nudge.innerHTML = `
    <button class="ai-mentor-nudge-close" type="button">×</button>
    <p class="ai-mentor-nudge-title">${title}</p>
    <p class="ai-mentor-nudge-message">${message}</p>
    <button class="ai-mentor-nudge-action" type="button">${actionText}</button>
  `;

  document.body.appendChild(nudge);

  nudge.querySelector(".ai-mentor-nudge-close")?.addEventListener("click", () => {
    nudge.remove();
  });

  nudge.querySelector(".ai-mentor-nudge-action")?.addEventListener("click", async () => {
    nudge.remove();
    openMentorDrawer();
    await renderMentorContent();

    setTimeout(() => {
      handleAction(action);
    }, 100);
  });

    if (size !== "large") {
    setTimeout(() => {
      nudge.remove();
    }, 9000);
  }

  if (size === "large" && navigator.vibrate) {
    navigator.vibrate([200, 100, 200]);
  }
}

function showMentorBadgeNudge({ title, message, action }) {
  const button = document.getElementById("ai-study-mentor-btn");
  const badge = document.getElementById("ai-mentor-badge");

  if (!button || !badge) return;

  activeMentorSuggestion = {
    title,
    message,
    action,
    createdAt: Date.now()
  };

  button.classList.add("has-ai-suggestion");
  button.setAttribute("title", `${title}: ${message}`);
}

function clearMentorBadge() {
  const button = document.getElementById("ai-study-mentor-btn");

  activeMentorSuggestion = null;

  if (button) {
    button.classList.remove("has-ai-suggestion");
    button.removeAttribute("title");
  }
}

function createMentorUI() {
  if (document.getElementById("ai-study-mentor-btn")) return;

  const button = document.createElement("button");
  button.id = "ai-study-mentor-btn";
  button.innerHTML = `
    Need support?
    <span id="ai-mentor-badge"></span>
  `;
  button.setAttribute("type", "button");

  const overlay = document.createElement("div");
  overlay.id = "ai-study-mentor-overlay";

  const drawer = document.createElement("aside");
  drawer.id = "ai-study-mentor-drawer";
  drawer.setAttribute("aria-hidden", "true");

  drawer.innerHTML = `
    <div class="ai-mentor-header">
      <div>
        <p class="ai-mentor-eyebrow">Learning Assistant</p>
        <h2 class="ai-mentor-title">Your AI Study Mentor</h2>
      </div>

      <div class="ai-header-actions">
        <button id="ai-profile-avatar" class="ai-profile-avatar" type="button">
          S
        </button>

        <div id="ai-profile-menu" class="ai-profile-menu hidden">
          <button id="ai-reset-onboarding" type="button">Reset onboarding</button>
          <button id="logout-account-btn" type="button">Log out</button>
        </div>

        <button id="ai-study-mentor-close" class="ai-mentor-close" type="button">×</button>
      </div>
    </div>

    <div id="ai-mentor-dynamic-content" class="ai-mentor-body"></div>
  `;

  button.addEventListener("click", async () => {
    const suggestion = activeMentorSuggestion;

    clearMentorBadge();
    openMentorDrawer();
    await renderMentorContent();

    if (suggestion?.action) {
      setTimeout(() => {
        handleAction(suggestion.action);
      }, 150);
    }
  });

  overlay.addEventListener("click", closeMentorDrawer);

  document.body.appendChild(button);
  document.body.appendChild(overlay);
  document.body.appendChild(drawer);

  const closeButton = document.getElementById("ai-study-mentor-close");
  if (closeButton) {
    closeButton.addEventListener("click", closeMentorDrawer);
  }

  document.getElementById("ai-profile-avatar")?.addEventListener("click", (event) => {
    event.stopPropagation();
    document.getElementById("ai-profile-menu")?.classList.toggle("hidden");
  });

  document.getElementById("ai-reset-onboarding")?.addEventListener("click", async () => {
    await chrome.storage.local.remove([
      "onboardingComplete",
      "onboardingAnswers",
      "mentorPreferences"
    ]);

    document.getElementById("ai-profile-menu")?.classList.add("hidden");

    await renderMentorContent();
  });

  document.getElementById("logout-account-btn")?.addEventListener("click", async () => {
    await chrome.storage.local.remove(["currentUser"]);

    document.getElementById("ai-profile-menu")?.classList.add("hidden");

    await renderMentorContent();
  });

  document.addEventListener("click", () => {
    document.getElementById("ai-profile-menu")?.classList.add("hidden");
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMentorDrawer();
    }
  });
}

function openMentorDrawer() {
  const drawer = document.getElementById("ai-study-mentor-drawer");
  const overlay = document.getElementById("ai-study-mentor-overlay");

  if (!drawer || !overlay) return;

  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  overlay.classList.add("open");
  document.getElementById("ai-study-mentor-btn")?.classList.add("hidden");
  document.getElementById("ai-profile-menu")?.classList.add("hidden");
}

function closeMentorDrawer() {
  const drawer = document.getElementById("ai-study-mentor-drawer");
  const overlay = document.getElementById("ai-study-mentor-overlay");

  if (!drawer || !overlay) return;

  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  overlay.classList.remove("open");
  document.getElementById("ai-study-mentor-btn")?.classList.remove("hidden");
}

async function renderMentorContent() {
  const stored = await chrome.storage.local.get([
    "currentUser",
    "users",
    "onboardingComplete",
    "onboardingAnswers",
    "mentorPreferences",
    "liveTracking",
    "currentSession",
    "sessions",
    "lastSessionEndedAt",
    "simulatedEmailReminder"
  ]);

  if (!stored.currentUser) {
    renderAccountScreen();
    return;
  }

  if (!stored.onboardingComplete || !stored.onboardingAnswers) {
    renderOnboardingPlaceholder();
    return;
  }

  renderMentorHome(
    stored.onboardingAnswers,
    stored.liveTracking || null,
    stored.currentSession || null,
    stored.sessions || [],
    stored.lastSessionEndedAt || null,
    stored.simulatedEmailReminder || null
  );
}

function renderAccountScreen() {
  const container = document.getElementById("ai-mentor-dynamic-content");
  if (!container) return;

  container.innerHTML = `
    <div class="ai-mentor-card">
      <p class="ai-mentor-card-title">Create your study account</p>
      <p class="ai-mentor-card-text">
        This lets your mentor remember your progress, mistakes, and study history across sessions.
      </p>

      <input id="account-name-input" class="ai-chat-input" placeholder="Your name" />
      <input id="account-email-input" class="ai-chat-input" placeholder="Your email" />

      <button id="create-account-btn" class="primary-btn" type="button">
        Create account
      </button>

      <p class="ai-mentor-card-text muted" style="margin-top: 12px;">
        Prototype note: this account is stored locally on this device.
      </p>
    </div>
  `;

  const createBtn = document.getElementById("create-account-btn");

  createBtn.addEventListener("click", async () => {
    const name = document.getElementById("account-name-input").value.trim();
    const email = document.getElementById("account-email-input").value.trim();

    if (!name || !email) {
      alert("Please enter your name and email.");
      return;
    }

    const stored = await chrome.storage.local.get(["users"]);
    const users = stored.users || {};

    const userId = email.toLowerCase();

    users[userId] = {
      id: userId,
      name,
      email,
      createdAt: Date.now(),
      lastLoginAt: Date.now()
    };

    await chrome.storage.local.set({
      users,
      currentUser: users[userId]
    });

    await renderMentorContent();
  });
}

function renderOnboardingPlaceholder() {
  const container = document.getElementById("ai-mentor-dynamic-content");
  if (!container) return;

  container.innerHTML = `
    <div class="ai-mentor-card">
      <p class="ai-mentor-card-title">Set up your mentor</p>
      <p class="ai-mentor-card-text">
        Answer a few quick questions so I can personalise your support.
      </p>

      <button id="start-onboarding-btn" class="primary-btn">
        Start setup
      </button>
    </div>
  `;

  const startBtn = document.getElementById("start-onboarding-btn");

  if (startBtn) {
    startBtn.addEventListener("click", () => {
      startOnboardingFlow();
    });
  }
}

const onboardingQuestions = [
  {
    key: "studyLevel",
    question: "What is your study level?",
    options: ["Undergraduate", "Postgraduate", "Other"]
  },
  {
    key: "weeklyStudyTime",
    question: "How many hours do you usually study per week?",
    options: ["0-2 Hours", "3-5 Hours", "6-10 Hours", "10+ Hours"]
  },
  {
    key: "deadlineManagement",
    question: "How do you usually manage deadlines?",
    options: ["Usually On Track", "Sometimes Miss", "Often Miss"]
  },
  {
    key: "independentConfidence",
    question: "How confident are you with independent study?",
    options: ["Confident", "Somewhat Confident", "Not Confident"]
  },
  {
    key: "fallBehindCause",
    question: "What is the main reason you fall behind?",
    options: ["Heavy Workload", "Low Motivation", "Unclear Content", "Forget To Study"]
  },
  {
    key: "fallBehindReaction",
    question: "What helps most when you fall behind?",
    options: ["External Reminders", "Encouragement", "Clear Plan", "Accountability"]
  },
  {
    key: "mentorTone",
    question: "What mentor tone would you prefer?",
    options: ["Neutral", "Encouraging", "Direct", "Detailed"]
  },
  {
    key: "reminderStyle",
    question: "What reminder style would help you most?",
    options: ["Minimal", "Supportive", "Frequent", "Direct"]
  },
  {
    key: "checkInFrequency",
    question: "How often should your mentor check in?",
    options: ["Only When Needed", "Daily", "Every Few Days", "Weekly"]
  }
];

let onboardingStep = 0;
let onboardingAnswersDraft = {};

function startOnboardingFlow() {
  onboardingStep = 0;
  onboardingAnswersDraft = {};
  renderOnboardingQuestion();
}

function renderOnboardingQuestion() {
  const container = document.getElementById("ai-mentor-dynamic-content");
  if (!container) return;

  const currentQuestion = onboardingQuestions[onboardingStep];
  const progressPercent = Math.round(
    ((onboardingStep + 1) / onboardingQuestions.length) * 100
  );

  container.innerHTML = `
    <div class="ai-mentor-card">
      <p class="ai-mentor-card-title">Set up your mentor</p>

      <div class="progress-wrap">
        <div class="progress-text">Question ${onboardingStep + 1} of ${onboardingQuestions.length}</div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${progressPercent}%"></div>
        </div>
      </div>

      <p class="ai-mentor-card-text"><strong>${currentQuestion.question}</strong></p>

      <div class="ai-mentor-actions">
        ${currentQuestion.options
          .map(
            (option) => `
              <button class="ai-mentor-action-btn" type="button" data-value="${option}">
                ${option}
              </button>
            `
          )
          .join("")}
      </div>
    </div>
  `;

  const buttons = container.querySelectorAll(".ai-mentor-action-btn");

  buttons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const value = btn.getAttribute("data-value");
      onboardingAnswersDraft[currentQuestion.key] = value;

      if (onboardingStep < onboardingQuestions.length - 1) {
        onboardingStep += 1;
        renderOnboardingQuestion();
        return;
      }

      await chrome.storage.local.set({
        onboardingComplete: true,
        onboardingAnswers: onboardingAnswersDraft,
        mentorPreferences: {
          mentorTone: onboardingAnswersDraft.mentorTone,
          reminderStyle: onboardingAnswersDraft.reminderStyle,
          checkInFrequency: onboardingAnswersDraft.checkInFrequency
        }
      });

      await renderMentorContent();
    });
  });
}

function getPersonalisedDailyGoalMinutes(onboardingAnswers = {}) {
  const studyTime =
    onboardingAnswers.studyTime ||
    onboardingAnswers.availableTime ||
    onboardingAnswers.weeklyStudyTime ||
    "";

  const confidence =
    onboardingAnswers.independentConfidence ||
    onboardingAnswers.confidence ||
    "";

  const deadlineManagement =
    onboardingAnswers.deadlineManagement ||
    onboardingAnswers.deadlines ||
    "";

  let goal = 30;

  if (
    studyTime.includes("Less than 30") ||
    studyTime.includes("limited") ||
    studyTime.includes("1-2")
  ) {
    goal = 15;
  }

  if (
    studyTime.includes("30-60") ||
    studyTime.includes("3-5")
  ) {
    goal = 25;
  }

  if (
    studyTime.includes("1 hour") ||
    studyTime.includes("5+")
  ) {
    goal = 40;
  }

  if (
    confidence === "Not Confident" ||
    confidence.includes("Not") ||
    deadlineManagement.includes("Struggle")
  ) {
    goal = Math.max(15, goal - 10);
  }

  return goal;
}

async function renderMentorHome(savedAnswers, liveTracking, currentSession, sessions, lastSessionEndedAt, simulatedEmailReminder) {
  const container = document.getElementById("ai-mentor-dynamic-content");
  if (!container) return;

  const storedUserData = await chrome.storage.local.get(["currentUser"]);
  const currentUser = storedUserData.currentUser;

  const pageInfo = getCourseraPageInfo();

  savePageContext(pageInfo);

  const totalActiveMs = liveTracking?.activeMs || 0;

  const todayActiveMinutes = Math.floor(totalActiveMs / 60000);

  const learningData = await chrome.storage.local.get([
    "learningContext",
    "learningMemory"
  ]);

  const learningContext = learningData.learningContext || {};
  const learningMemory = learningData.learningMemory || {};

  const courseProgressPercent =
    learningContext.courseProgressPercent;

  const hasCourseProgress =
    typeof courseProgressPercent === "number" &&
    courseProgressPercent >= 0 &&
    courseProgressPercent <= 100;

  const dailyGoalMinutes = getPersonalisedDailyGoalMinutes(savedAnswers);

  const progressPercent = Math.min(
    Math.round((todayActiveMinutes / dailyGoalMinutes) * 100),
    100
  );

  let progressMessage = "You’ve started. That counts.";

  if (progressPercent >= 100) {
    progressMessage =
      "You’ve hit today’s study goal. That’s proper momentum.";
  } else if (progressPercent >= 70) {
    progressMessage =
      "You’re nearly there. One small push and today is done.";
  } else if (progressPercent >= 40) {
    progressMessage =
      "You’re building momentum. Keep it easy and consistent.";
  } else if (progressPercent >= 15) {
    progressMessage =
      "You’ve already made progress today. Don’t reset the day.";
  }

  const streakDays = getStudyStreakDays(sessions, currentSession);

  const nextStepPrompt = getNextStepPrompt(
    savedAnswers,
    liveTracking,
    currentSession,
    sessions,
    lastSessionEndedAt
  );

  container.innerHTML = `
    <div class="ai-study-snapshot">
      <div class="ai-study-snapshot-top">
        <div>
          <p class="ai-study-eyebrow">Coursera study companion</p>
          <h3 class="ai-study-title">Today’s study momentum</h3>
        </div>

        <button id="open-activity-page" class="ai-study-streak-pill" type="button">
          ${streakDays} day streak ›
        </button>
      </div>

      <p class="ai-study-message">
        ${
          hasCourseProgress
            ? courseProgressPercent >= 80
              ? "You’re close to finishing this course. Keep the final stretch focused."
              : courseProgressPercent >= 40
              ? "You’re making strong progress through this course."
              : "You’ve started building momentum through this course."
            : progressMessage
        }
      </p>

      <div class="ai-study-progress-row">
        <span>
          ${
            hasCourseProgress
              ? `${courseProgressPercent}% course completed`
              : `${todayActiveMinutes}/${dailyGoalMinutes} mins personalised goal`
          }
        </span>
        <span>${streakDays} day streak</span>
      </div>

      <div class="progress-bar">
        <div
          class="progress-fill"
          style="width: ${
            hasCourseProgress ? courseProgressPercent : progressPercent
          }%;"
        ></div>
      </div>
    </div>
 

    <div class="ai-mentor-card">
      <p class="ai-mentor-card-title">Recommended next step</p>
      <p class="ai-mentor-card-text">${nextStepPrompt.message}</p>


      <div class="ai-mentor-actions">
        <button class="ai-mentor-action-btn" type="button" data-action="Explain this topic">Explain this topic</button>
        <button class="ai-mentor-action-btn" type="button" data-action="Give me an example">Give me an example</button>
        <button class="ai-mentor-action-btn" type="button" data-action="Test my understanding">Test my understanding</button>
        <button class="ai-mentor-action-btn" type="button" data-action="Practice quiz">Practice quiz</button>
      </div>

    </div>

        <div class="ai-mentor-card">
      <p class="ai-mentor-card-title">Learning memory</p>
      <p class="ai-mentor-card-text">
        ${
          learningMemory.lastSummary
            ? learningMemory.lastSummary
            : "Once you complete a quiz or understanding check, I’ll remember what to help you with next."
        }
      </p>
      ${
        learningMemory.lastRecommendedAction
          ? `<p class="ai-mentor-card-text muted">Next: ${learningMemory.lastRecommendedAction}</p>`
          : ""
      }

      ${
        learningMemory.quizMistakes && learningMemory.quizMistakes.length > 0
          ? `<button id="review-memory-mistakes" class="primary-btn" type="button">
              Review incorrect answers
            </button>`
          : ""
      }
    </div>

    <div class="ai-mentor-card">
      <p class="ai-mentor-card-title">Re-engagement email</p>

      <p class="ai-mentor-card-text">
        ${
          simulatedEmailReminder
            ? "A reminder email has been drafted based on today’s engagement pattern."
            : "If today’s meaningful engagement stays low, I’ll draft a reminder based on active study time, page visits, mentor use, and quiz practice."
        }
      </p>

      ${
        simulatedEmailReminder
          ? `<p class="ai-mentor-card-text muted">Subject: ${simulatedEmailReminder.subject}</p>`
          : ""
      }

      <button id="simulate-email-reminder-btn" class="ai-mentor-action-btn" type="button">
        Check reminder logic
      </button>
    </div>
  `;

  document.getElementById("open-activity-page")?.addEventListener("click", () => {
    renderActivityPage({
      pageInfo,
      currentSession,
      sessions,
      lastSessionEndedAt,
      totalActiveMs
    });
  });

  document.getElementById("simulate-email-reminder-btn")?.addEventListener("click", async () => {
    await checkSimulatedEmailReminder();
    await renderMentorContent();
  });

  document.getElementById("review-memory-mistakes")
  ?.addEventListener("click", () => {
    practiceQuizIncorrectAnswers = learningMemory.quizMistakes || [];
    renderMissedQuestionsReview();
   });

  attachActionHandlers();
}

function getStudyStreakDays(sessions = [], currentSession = null) {
  const safeSessions = Array.isArray(sessions) ? sessions : [];

  const studyDates = safeSessions
    .map((session) => session.startedAt || session.startTime || session.createdAt)
    .filter(Boolean)
    .map((time) => new Date(time).toDateString());

  if (currentSession) {
    studyDates.push(new Date().toDateString());
  }

  const uniqueDates = [...new Set(studyDates)];
  let streak = 0;
  const checkDate = new Date();

  while (uniqueDates.includes(checkDate.toDateString())) {
    streak += 1;
    checkDate.setDate(checkDate.getDate() - 1);
  }

  return streak;
}

function getStudyStreakMessage(streakDays, currentSession) {
  if (currentSession) {
    return "You’re studying right now. I’ll keep tracking this session while you work.";
  }

  if (streakDays >= 3) {
    return "You’re building a real routine. One focused session today keeps the streak alive.";
  }

  if (streakDays === 1) {
    return "You’ve started the streak. Come back today to keep the momentum going.";
  }

  return "Start with one focused session today and I’ll track the streak from there.";
}

async function checkSimulatedEmailReminder() {
  const stored = await chrome.storage.local.get([
    "currentUser",
    "sessions",
    "currentSession",
    "learningContext",
    "onboardingAnswers",
    "mentorInteractionLog",
    "quizInteractionLog"
  ]);

  const reminder = buildSimulatedEmailReminder(stored);

  if (!reminder) {
    await chrome.storage.local.remove(["simulatedEmailReminder"]);

    alert("No reminder needed. Meaningful study engagement already detected today.");

    return;
  }

  await chrome.storage.local.set({
    simulatedEmailReminder: reminder
  });

  alert(`
Simulated re-engagement email drafted.

Reason:
Low meaningful engagement detected today.

Engagement summary:
• Active study time: ${reminder.engagementDetails.activeMinutes} mins
• Course pages visited: ${reminder.engagementDetails.pageVisits}
• Mentor interactions: ${reminder.engagementDetails.mentorInteractions}
• Quiz interactions: ${reminder.engagementDetails.quizInteractions}

Behavioural engagement score:
${reminder.engagementScore}/7
`);
}

function buildSimulatedEmailReminder(stored) {
  const currentUser = stored.currentUser || {};
  const sessions = Array.isArray(stored.sessions) ? stored.sessions : [];
  const currentSession = stored.currentSession || null;
  const learningContext = stored.learningContext || {};
  const onboardingAnswers = stored.onboardingAnswers || {};

  const engagement = calculateTodaysMeaningfulEngagement({
    sessions,
    currentSession,
    learningContext,
    mentorInteractionLog: stored.mentorInteractionLog || [],
    quizInteractionLog: stored.quizInteractionLog || []
  });

  if (engagement.meaningfullyEngaged) {
    return null;
  }

  const courseTitle =
    learningContext?.pageContext?.title ||
    learningContext?.lastKnownTopic ||
    "your Coursera course";

  const confidence = onboardingAnswers.independentConfidence || "";

  const supportLine =
    confidence === "Not Confident"
      ? "You don’t need to catch up on everything at once. Start with one small focused step."
      : "A short focused session is enough to turn today into real progress.";

  return {
    subject: "Still time for one focused study session today",

    body: `
Hi ${currentUser.name || "there"},

You’ve opened Coursera today, but I haven’t detected enough meaningful engagement yet.

Today’s engagement so far:
- Active study time: ${engagement.activeMinutes} minutes
- Course pages visited: ${engagement.pageVisits}
- Mentor interactions: ${engagement.mentorInteractions}
- Quiz interactions: ${engagement.quizInteractions}

${supportLine}

Try one focused 20-minute session, visit the next course page, or use the mentor to check your understanding.

This is a simulated prototype email reminder.
    `.trim(),

    reason: "low_engagement",
    engagementScore: engagement.score,
    engagementDetails: engagement,
    createdAt: Date.now()
  };
}

function calculateTodaysMeaningfulEngagement({
  sessions = [],
  currentSession = null,
  learningContext = {},
  mentorInteractionLog = [],
  quizInteractionLog = []
}) {
  const today = new Date().toDateString();

  const todaysSessions = sessions.filter((session) => {
    const sessionTime = session.startedAt || session.startTime || session.createdAt;
    return sessionTime && new Date(sessionTime).toDateString() === today;
  });

  if (
    currentSession &&
    currentSession.startedAt &&
    new Date(currentSession.startedAt).toDateString() === today
  ) {
    todaysSessions.push(currentSession);
  }

  const activeMs = todaysSessions.reduce((total, session) => {
    return total + (session.activeMs || 0);
  }, 0);

  const activeMinutes = Math.floor(activeMs / 60000);

  const recentPages = Array.isArray(learningContext.recentPages)
    ? learningContext.recentPages
    : [];

  const pageVisits = recentPages.filter((page) => {
    return page.capturedAt && new Date(page.capturedAt).toDateString() === today;
  }).length;

  const mentorInteractions = mentorInteractionLog.filter((item) => {
    return item.createdAt && new Date(item.createdAt).toDateString() === today;
  }).length;

  const quizInteractions = quizInteractionLog.filter((item) => {
    return item.createdAt && new Date(item.createdAt).toDateString() === today;
  }).length;

  let score = 0;

  if (activeMinutes >= 20) score += 3;
  else if (activeMinutes >= 10) score += 2;
  else if (activeMinutes >= 5) score += 1;

  if (pageVisits >= 3) score += 2;
  else if (pageVisits >= 1) score += 1;

  if (mentorInteractions >= 1) score += 2;

  if (quizInteractions >= 1) score += 2;

  return {
    activeMinutes,
    pageVisits,
    mentorInteractions,
    quizInteractions,
    score,
    meaningfullyEngaged: score >= 3
  };
}

function renderActivityPage({ pageInfo, currentSession, sessions, lastSessionEndedAt, totalActiveMs }) {
  const container = document.getElementById("ai-mentor-dynamic-content");
  if (!container) return;

  const streakDays = getStudyStreakDays(sessions, currentSession);

  container.innerHTML = `
    <button id="back-to-mentor-home" class="ai-back-btn" type="button">← Back</button>

    <div class="ai-mentor-card">
      <p class="ai-mentor-card-title">Your study activity</p>
      <p class="ai-mentor-card-text">${getStudyStreakMessage(streakDays, currentSession)}</p>
    </div>

    <div class="activity-grid">
      <div class="activity-stat-card">
        <p class="activity-stat-number">${streakDays}</p>
        <p class="activity-stat-label">day streak</p>
      </div>

      <div class="activity-stat-card">
        <p class="activity-stat-number">${formatDuration(totalActiveMs)}</p>
        <p class="activity-stat-label">total active study time</p>
      </div>

      <div class="activity-stat-card">
        <p class="activity-stat-number">${sessions.length}</p>
        <p class="activity-stat-label">completed sessions</p>
      </div>
    </div>

    <div class="ai-mentor-card">
      <p class="ai-mentor-card-title">Current page</p>
      <p class="ai-mentor-card-text">${pageInfo.title || "Untitled page"}</p>
      <p class="ai-mentor-card-text muted">Page type: ${formatLabel(pageInfo.pageType || "unknown")}</p>
      <p class="ai-mentor-card-text muted">Status: ${currentSession ? "Studying now" : "Not currently studying"}</p>
      <p class="ai-mentor-card-text muted">Last active: ${formatLastActive(lastSessionEndedAt)}</p>
    </div>
  `;

  document.getElementById("back-to-mentor-home")?.addEventListener("click", () => {
    renderMentorContent();
  });
}

async function renderMentorDrawerData() {
  const pageInfo = getCourseraPageInfo();

  const stored = await chrome.storage.local.get([
    "liveTracking",
    "currentSession",
    "sessions",
    "lastSessionEndedAt"
  ]);

  const liveTracking = stored.liveTracking || null;
  const currentSession = stored.currentSession || null;
  const sessions = stored.sessions || [];
  const lastSessionEndedAt = stored.lastSessionEndedAt || null;

  const pageTitleEl = document.getElementById("ai-mentor-page-title");
  const pageTypeEl = document.getElementById("ai-mentor-page-type");
  const statusEl = document.getElementById("ai-mentor-status");
  const lastActiveEl = document.getElementById("ai-mentor-last-active");
  const totalTimeEl = document.getElementById("ai-mentor-total-time");
  const sessionCountEl = document.getElementById("ai-mentor-session-count");

  if (pageTitleEl) {
    pageTitleEl.textContent = pageInfo.title || "Untitled page";
  }

  if (pageTypeEl) {
    pageTypeEl.textContent = `Page type: ${formatLabel(pageInfo.pageType || "unknown")}`;
  }

  if (statusEl) {
    statusEl.textContent = currentSession ? "Status: Studying now" : "Status: Not currently studying";
  }

  if (lastActiveEl) {
    lastActiveEl.textContent = `Last active: ${formatLastActive(lastSessionEndedAt)}`;
  }

  if (totalTimeEl) {
    totalTimeEl.textContent = `Total active study time: ${formatDuration(liveTracking?.activeMs || 0)}`;
  }

  if (sessionCountEl) {
    sessionCountEl.textContent = `Completed sessions: ${sessions.length}`;
  }
}

function getNextStepPrompt(answers, liveTracking, currentSession, sessions, lastSessionEndedAt) {
  const now = Date.now();

  const lastActiveAt =
    liveTracking?.lastActiveAt ||
    currentSession?.lastActiveAt ||
    lastSessionEndedAt ||
    null;

  const hoursSinceActive = lastActiveAt
    ? (now - lastActiveAt) / (1000 * 60 * 60)
    : null;

  const currentActiveMinutes = currentSession?.activeMs
    ? Math.floor(currentSession.activeMs / 60000)
    : 0;

  const lastCompletedSession = sessions?.[sessions.length - 1] || null;
  const lastSessionMinutes = lastCompletedSession?.activeMs
    ? Math.floor(lastCompletedSession.activeMs / 60000)
    : 0;

  if (hoursSinceActive !== null && hoursSinceActive >= 48) {
    return {
      message: "You haven’t studied for a couple of days, so your best next step is to restart small instead of trying to catch up on everything at once.",
      actions: ["Start a 5 minute study session", "Review my last topic"]
    };
  }

  if (currentSession && currentActiveMinutes >= 45) {
    return {
      message: "You’ve been studying for a while. Your next step should be either a short break or a quick check that you actually understood the topic.",
      actions: ["Take a short break", "Test my understanding"]
    };
  }

  if (lastCompletedSession && lastSessionMinutes > 0 && lastSessionMinutes < 10) {
    return {
      message: "Your last session was quite short. Your next step is to make it easier to continue, not force a huge study block.",
      actions: ["Do a quick recap", "Continue the lesson"]
    };
  }

  if (answers.fallBehindCause === "Unclear Content") {
    return {
      message: "Because unclear content is what usually makes you fall behind, your next step is to make sure this topic actually makes sense before moving on.",
      actions: ["Explain this topic", "Give me an example"]
    };
  }

  if (answers.fallBehindCause === "Low Motivation") {
    return {
      message: "Because motivation is usually your biggest barrier, your next step is to make studying feel easy to restart.",
      actions: ["Start a 10 minute focus session", "Give me a simple plan"]
    };
  }

  return {
    message: "Your next step is to keep momentum while you’re already here.",
    actions: ["Continue learning", "Test my understanding"]
  };
}

function getPersonalisedSupportMessage(answers) {
  const confidence = answers.independentConfidence;
  const fallBehindCause = answers.fallBehindCause;
  const reminderStyle = answers.reminderStyle;
  const checkInFrequency = answers.checkInFrequency;

  let message = "I’ll adapt your support based on how you study.";

  if (confidence === "Not Confident") {
    message = "Because you’re not feeling confident with independent study, I’ll keep support more guided and break things into smaller steps.";
  } else if (confidence === "Somewhat Confident") {
    message = "Because you’re somewhat confident, I’ll give you light support without over-explaining everything.";
  } else if (confidence === "Confident") {
    message = "Because you’re confident with independent study, I’ll keep support concise and focus on quick prompts when you need them.";
  }

  if (fallBehindCause === "Heavy Workload") {
    message += " Since heavy workload is your main barrier, I’ll suggest shorter catch-up actions instead of overwhelming you.";
  }

  if (fallBehindCause === "Low Motivation") {
    message += " Since motivation is the main challenge, I’ll use more encouraging check-ins to help you restart.";
  }

  if (fallBehindCause === "Unclear Content") {
    message += " Since unclear content is the main issue, I’ll prioritise explanations and examples.";
  }

  if (fallBehindCause === "Forget To Study") {
    message += " Since forgetting to study is the main issue, I’ll prioritise reminders and gentle prompts.";
  }

  if (reminderStyle === "Minimal" || checkInFrequency === "Only When Needed") {
    message += " I’ll keep reminders minimal and only step in when it looks useful.";
  }

  return message;
}

function formatValue(value) {
  if (!value) return "Not set";

  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return "0m";

  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;

  return `${hours}h ${minutes}m`;
}

function formatLastActive(lastSessionEndedAt) {
  if (!lastSessionEndedAt) return "No study sessions yet";

  const diffMs = Date.now() - lastSessionEndedAt;
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

  if (diffHours < 1) return "Today";
  if (diffHours < 24) return "Today";
  if (diffHours < 48) return "1 day ago";

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} days ago`;
}

function formatLabel(value) {
  return String(value)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function attachActionHandlers() {
  const buttons = document.querySelectorAll(".ai-mentor-action-btn");

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.getAttribute("data-action");

      handleAction(action);
    });
  });
}

async function recordMentorInteraction(action) {
  const stored = await chrome.storage.local.get(["mentorInteractionLog"]);
  const mentorInteractionLog = stored.mentorInteractionLog || [];

  mentorInteractionLog.unshift({
    action,
    pageTitle: document.title || "",
    url: window.location.href,
    createdAt: Date.now()
  });

  await chrome.storage.local.set({
    mentorInteractionLog: mentorInteractionLog.slice(0, 50)
  });
}

async function recordQuizInteraction(type) {
  const stored = await chrome.storage.local.get(["quizInteractionLog"]);
  const quizInteractionLog = stored.quizInteractionLog || [];

  quizInteractionLog.unshift({
    type,
    pageTitle: document.title || "",
    url: window.location.href,
    createdAt: Date.now()
  });

  await chrome.storage.local.set({
    quizInteractionLog: quizInteractionLog.slice(0, 50)
  });
}

function handleAction(action) {
  console.log("User selected action:", action);

  if (!action) return;

  recordMentorInteraction(action);

  if (action === "Practice quiz") {
    recordQuizInteraction("started_practice_quiz");
    renderPracticeQuiz();
  }

  if (action === "Test my understanding") {
    renderUnderstandingChat();
    return;
  }

  if (action === "Give me an example") {
    renderExampleChat();
    return;
  }

  if (action === "Explain this topic") {
    renderExplainTopicChat();
    return;
  }

  callMentorAPI(action);
}

let understandingQuestionNumber = 1;
let understandingConversation = [];

function renderUnderstandingChat() {
  const container = document.querySelector(".ai-mentor-body");
  if (!container) return;

  understandingQuestionNumber = 1;
  const pageInfo = getCourseraPageInfo();
  const onAssessmentPage = isAssessmentPage(pageInfo);

  understandingConversation = [
    {
      role: "mentor",
      text: onAssessmentPage
        ? "I can help you practise this topic without giving away the quiz answer. First, what concept do you think this question is testing?"
        : "Let’s check this properly. First question: what do you think the main idea of this topic is?"
    }
  ];

  container.innerHTML = `
    <div class="ai-chat-screen">
      <button id="back-to-mentor-home" class="secondary-btn" type="button">
        Back
      </button>

      <div class="ai-chat-header-card">
        <p class="ai-mentor-card-title">Test my understanding</p>
        <p class="ai-mentor-card-text muted">
          ${
            onAssessmentPage
              ? "Quiz-safe mode: I’ll help you practise the concept without revealing the answer."
              : "I’ll ask a few questions, give feedback after each one, then tell you what to review."
          }
        </p>
      </div>

      <div id="understanding-chat-messages" class="ai-chat-messages"></div>

      <div class="ai-chat-input-wrap">
        <textarea 
          id="understanding-chat-input"
          placeholder="Type your answer..."
          class="ai-chat-input"
        ></textarea>

        <button id="send-understanding-chat" class="primary-btn" type="button">
          Send
        </button>
      </div>
    </div>
  `;

  renderUnderstandingMessages();

  document
    .getElementById("back-to-mentor-home")
    ?.addEventListener("click", renderMentorContent);

  document
    .getElementById("send-understanding-chat")
    ?.addEventListener("click", sendUnderstandingChatMessage);
}

function renderUnderstandingMessages() {
  const messages = document.getElementById("understanding-chat-messages");
  if (!messages) return;

  messages.innerHTML = understandingConversation
    .map((message) => {
      const bubbleClass =
        message.role === "student" ? "ai-chat-bubble student" : "ai-chat-bubble mentor";

      const label = message.role === "student" ? "You" : "AI Mentor";

      return `
        <div class="${bubbleClass}">
          <span class="ai-chat-label">${label}</span>
          <p>${message.text}</p>
        </div>
      `;
    })
    .join("");

  messages.scrollTop = messages.scrollHeight;
}

function renderUnderstandingCheck() {
  const body = document.querySelector(".ai-mentor-body");
  if (!body) return;

  body.innerHTML = `
    <div class="ai-mentor-card">
      <p class="ai-mentor-card-title">Test my understanding</p>
      <p class="ai-mentor-card-text">
        I’ll ask you questions one at a time based on this topic. Answer in your own words and I’ll give feedback before moving on.
      </p>
    </div>

    <div class="ai-mentor-card">
      <p class="ai-mentor-card-title">Question 1</p>
      <p class="ai-mentor-card-text">
        What do you think the main idea of this topic is?
      </p>
    </div>

    <div class="ai-mentor-card">
      <textarea 
        id="understanding-answer"
        placeholder="Type your answer here..."
        style="width: 100%; min-height: 90px; border-radius: 12px; border: 1px solid #e5e7eb; padding: 12px; font-family: inherit;"
      ></textarea>

      <button id="send-understanding-answer" class="primary-btn" type="button" style="margin-top: 12px;">
        Send answer
      </button>

      <button id="back-to-mentor-home" class="secondary-btn" type="button" style="margin-top: 10px;">
        Back
      </button>
    </div>
  `;

  document
    .getElementById("back-to-mentor-home")
    ?.addEventListener("click", renderMentorContent);

  document
    .getElementById("send-understanding-answer")
    ?.addEventListener("click", () => {
      const answer = document.getElementById("understanding-answer")?.value;

      if (!answer || !answer.trim()) {
        alert("Type your answer first.");
        return;
      }

      alert("Answer received. Next we’ll connect this to AI feedback.");
    });
}

async function sendUnderstandingChatMessage() {
  const input = document.getElementById("understanding-chat-input");

  if (!input) return;

  const answer = input.value.trim();

  if (!answer) {
    alert("Type your answer first.");
    return;
  }

  understandingConversation.push({
    role: "student",
    text: answer
  });

  input.value = "";
  renderUnderstandingMessages();

  understandingConversation.push({
    role: "mentor",
    text: "Checking your answer..."
  });

  renderUnderstandingMessages();

  const feedback = await callMentorAPIForChat(
    answer,
    understandingQuestionNumber,
    understandingConversation
  );

  understandingConversation.pop();

  understandingConversation.push({
    role: "mentor",
    text: feedback
  });

  understandingQuestionNumber += 1;

  renderUnderstandingMessages();
  await saveLearningMemory({
    completedChecks: 1,
    topicsUnderstood: [getCourseraPageInfo().title || "Current topic"],
    lastSummary: feedback,
    lastRecommendedAction: "Review this topic or try a practice quiz"
  });

  if (understandingQuestionNumber > 3) {
    const inputWrap = document.querySelector(".ai-chat-input-wrap");

    if (inputWrap) {
      inputWrap.innerHTML = `
        <button id="finish-understanding-chat" class="primary-btn" type="button">
          Back to main menu
        </button>
      `;
    }

    document
      .getElementById("finish-understanding-chat")
      ?.addEventListener("click", renderMentorContent);
  }
}

async function getStoredLearningContext() {
  const data = await chrome.storage.local.get([
    "learningContext"
  ]);

  return data.learningContext || {
    recentPages: [],
    recentQuestions: [],
    lastKnownTopic: "",
    lastCourseId: "",
    lastUpdated: null
  };
}

async function saveLearningMemory(update) {
  const data = await chrome.storage.local.get(["learningMemory"]);

  const currentMemory = data.learningMemory || {
    topicsStruggledWith: [],
    topicsUnderstood: [],
    quizMistakes: [],
    completedChecks: 0,
    lastSummary: "",
    lastRecommendedAction: "",
    lastUpdated: null
  };

  const updatedMemory = {
    ...currentMemory,
    topicsStruggledWith: [
      ...new Set([
        ...currentMemory.topicsStruggledWith,
        ...(update.topicsStruggledWith || [])
      ])
    ].slice(-8),
    topicsUnderstood: [
      ...new Set([
        ...currentMemory.topicsUnderstood,
        ...(update.topicsUnderstood || [])
      ])
    ].slice(-8),
    quizMistakes: [
      ...(currentMemory.quizMistakes || []),
      ...(update.quizMistakes || [])
    ].slice(-10),
    completedChecks:
      currentMemory.completedChecks + (update.completedChecks || 0),
    lastSummary: update.lastSummary || currentMemory.lastSummary,
    lastRecommendedAction:
      update.lastRecommendedAction || currentMemory.lastRecommendedAction,
    lastUpdated: Date.now()
  };

  await chrome.storage.local.set({
    learningMemory: updatedMemory
  });

  return updatedMemory;
}

async function callMentorAPIForChat(studentAnswer, questionNumber, conversation) {
  try {
    const pageInfo = getCourseraPageInfo();

    const data = await chrome.storage.local.get(["onboardingAnswers"]);
    const learningContext = await getStoredLearningContext();

    const response = await fetch("https://learning-extension.onrender.com/api/mentor", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "Test my understanding",
        pageTitle: pageInfo?.title || "",
        pageUrl: window.location.href,
        onboardingAnswers: data.onboardingAnswers || {},
        studentAnswer,
        questionNumber,
        conversation,
        pageContext: pageInfo,
        learningContext
      }),
    });

    const result = await response.json();

    return result.message || "Good start. Add one more specific detail, then we’ll move to the next question.";
  } catch (error) {
    console.error("Chat API error:", error);
    return "I couldn’t check that properly, but try explaining it again in one clearer sentence.";
  }
}

let practiceQuizQuestions = [];
let practiceQuizCurrentIndex = 0;
let practiceQuizScore = 0;
let practiceQuizIncorrectAnswers = [];

async function renderPracticeQuiz() {
  const container = document.querySelector(".ai-mentor-body");
  if (!container) return;

  practiceQuizQuestions = [];
  practiceQuizCurrentIndex = 0;
  practiceQuizScore = 0;
  practiceQuizIncorrectAnswers = [];

  container.innerHTML = `
    <div class="ai-chat-screen">
      <button id="back-to-mentor-home" class="secondary-btn" type="button">
        Back
      </button>

      <div class="ai-chat-header-card">
        <p class="ai-mentor-card-title">Practice quiz</p>
        <p class="ai-mentor-card-text muted">
          I’ll make a short quiz based on this Coursera page and your study preferences.
        </p>
      </div>

      <div class="ai-mentor-card">
        <p class="ai-mentor-card-text">Generating your quiz...</p>
      </div>
    </div>
  `;

  document
    .getElementById("back-to-mentor-home")
    ?.addEventListener("click", renderMentorContent);

  practiceQuizQuestions = await callMentorAPIForQuiz();

  if (!practiceQuizQuestions.length) {
    container.innerHTML = `
      <div class="ai-chat-screen">
        <button id="back-to-mentor-home" class="secondary-btn" type="button">
          Back
        </button>

        <div class="ai-mentor-card">
          <p class="ai-mentor-card-title">Practice quiz</p>
          <p class="ai-mentor-card-text">
            I couldn’t generate a quiz right now. Try again in a moment.
          </p>
        </div>
      </div>
    `;

    document
      .getElementById("back-to-mentor-home")
      ?.addEventListener("click", renderMentorContent);

    return;
  }

  renderPracticeQuizQuestion();
}

function renderPracticeQuizQuestion() {
  const container = document.querySelector(".ai-mentor-body");
  if (!container) return;

  const question = practiceQuizQuestions[practiceQuizCurrentIndex];

  container.innerHTML = `
    <div class="ai-chat-screen">
      <button id="back-to-mentor-home" class="secondary-btn" type="button">
        Back
      </button>

      <div class="ai-chat-header-card">
        <p class="ai-mentor-card-title">Practice quiz</p>
        <p class="ai-mentor-card-text muted">
          Question ${practiceQuizCurrentIndex + 1} of ${practiceQuizQuestions.length}
        </p>
      </div>

      <div class="ai-mentor-card">
        <p class="ai-mentor-card-title">${question.question}</p>

        <div class="ai-mentor-actions">
          ${question.options
            .map(
              (option, index) => `
                <button class="ai-mentor-action-btn quiz-option-btn" type="button" data-index="${index}">
                  ${option}
                </button>
              `
            )
            .join("")}
        </div>
      </div>
    </div>
  `;

  document
    .getElementById("back-to-mentor-home")
    ?.addEventListener("click", renderMentorContent);

  document.querySelectorAll(".quiz-option-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const selectedIndex = Number(btn.getAttribute("data-index"));
      showPracticeQuizFeedback(selectedIndex);
    });
  });
}

function showPracticeQuizFeedback(selectedIndex) {
  const container = document.querySelector(".ai-mentor-body");
  if (!container) return;

  const question = practiceQuizQuestions[practiceQuizCurrentIndex];
  const isCorrect = selectedIndex === question.correctIndex;
  recordQuizInteraction(isCorrect ? "answered_correctly" : "answered_incorrectly");

  if (isCorrect) {
    practiceQuizScore += 1;
  } else {
    practiceQuizIncorrectAnswers.push({
      question: question.question,
      selectedAnswer: question.options[selectedIndex],
      correctAnswer: question.options[question.correctIndex],
      explanation: question.explanation,
      pageTitle: getCourseraPageInfo().title || "Current topic",
      createdAt: Date.now()
    });
  }

  container.innerHTML = `
    <div class="ai-chat-screen">
      <button id="back-to-mentor-home" class="secondary-btn" type="button">
        Back
      </button>

      <div class="ai-mentor-card">
        <p class="ai-mentor-card-title">
          ${isCorrect ? "Correct" : "Not quite"}
        </p>

        <p class="ai-mentor-card-text">
          ${question.explanation}
        </p>

        <button id="next-quiz-question" class="primary-btn" type="button">
          ${
            practiceQuizCurrentIndex < practiceQuizQuestions.length - 1
              ? "Next question"
              : "See results"
          }
        </button>
      </div>
    </div>
  `;

  document
    .getElementById("back-to-mentor-home")
    ?.addEventListener("click", renderMentorContent);

  document
    .getElementById("next-quiz-question")
    ?.addEventListener("click", () => {
      practiceQuizCurrentIndex += 1;

      if (practiceQuizCurrentIndex < practiceQuizQuestions.length) {
        renderPracticeQuizQuestion();
      } else {
        renderPracticeQuizResults();
      }
    });
}

async function renderPracticeQuizResults() {
  const container = document.querySelector(".ai-mentor-body");
  if (!container) return;

  container.innerHTML = `
    <div class="ai-chat-screen">
      <div class="ai-mentor-card">
        <p class="ai-mentor-card-title">Quiz complete</p>

        <p class="ai-mentor-card-text">
          You scored ${practiceQuizScore} out of ${practiceQuizQuestions.length}.
        </p>

        <p class="ai-mentor-card-text muted">
          Generating your learning summary...
        </p>
      </div>
    </div>
  `;

  const summary = await callQuizSummaryAPI();
  await saveLearningMemory({
    completedChecks: 1,
    topicsStruggledWith: practiceQuizIncorrectAnswers.map(
      (item) => item.question
    ),
    quizMistakes: practiceQuizIncorrectAnswers,
    lastSummary: summary,
    lastRecommendedAction:
      practiceQuizIncorrectAnswers.length > 0
        ? "Review the questions you missed"
        : "Move on to the next course section"
  });

  container.innerHTML = `
    <div class="ai-chat-screen">
      <div class="ai-mentor-card">
        <p class="ai-mentor-card-title">Quiz complete</p>

        <p class="ai-mentor-card-text">
          You scored ${practiceQuizScore} out of ${practiceQuizQuestions.length}.
        </p>
      </div>

      <div class="ai-mentor-card">
        <p class="ai-mentor-card-title">Your learning summary</p>

        <p class="ai-mentor-card-text">
          ${summary}
        </p>

        ${
          practiceQuizIncorrectAnswers.length > 0
            ? `<button id="review-missed-questions" class="primary-btn" type="button">
                Review missed questions
              </button>`
            : ""
        }

        <button id="finish-practice-quiz" class="secondary-btn" type="button" style="margin-top: 10px;">
          Back to main menu
        </button>
      </div>
    </div>
  `;

  document
    .getElementById("finish-practice-quiz")
    ?.addEventListener("click", renderMentorContent);

  document
    .getElementById("review-missed-questions")
    ?.addEventListener("click", renderMissedQuestionsReview);
}

function renderMissedQuestionsReview() {
  const container = document.querySelector(".ai-mentor-body");
  if (!container) return;

  const missedQuestionsHtml = practiceQuizIncorrectAnswers
    .map((item, index) => {
      return `
        <div class="ai-mentor-card">
          <p class="ai-mentor-card-title">Mistake ${index + 1}</p>

          <p class="ai-mentor-card-text">
            <strong>Question:</strong> ${item.question}
          </p>

          <p class="ai-mentor-card-text">
            <strong>Why this matters:</strong> ${item.explanation || "This question points to a concept worth revising before moving on."}
          </p>

          <p class="ai-mentor-card-text muted">
            Revision focus: make sure you can explain this idea in your own words, then try another question on the same concept.
          </p>
        </div>
      `;
    })
    .join("");

  container.innerHTML = `
    <div class="ai-chat-screen">
      <button id="back-to-quiz-results" class="secondary-btn" type="button">
        Back
      </button>

      <div class="ai-chat-header-card">
        <p class="ai-mentor-card-title">Review missed questions</p>
        <p class="ai-mentor-card-text muted">
          These are the areas I’ll prioritise in your future revision and explanations.
        </p>
      </div>

      ${missedQuestionsHtml}

      <button id="practice-weak-areas" class="primary-btn" type="button">
        Practise these weak areas
      </button>

      <button id="finish-missed-review" class="secondary-btn" type="button" style="margin-top: 10px;">
        Back to main menu
      </button>
    </div>
  `;

  document
    .getElementById("back-to-quiz-results")
    ?.addEventListener("click", renderPracticeQuizResults);

  document
    .getElementById("finish-missed-review")
    ?.addEventListener("click", renderMentorContent);

  document
    .getElementById("practice-weak-areas")
    ?.addEventListener("click", renderUnderstandingChat);
}

async function callMissedQuestionsReviewAPI() {
  try {
    const pageInfo = getCourseraPageInfo();
    const data = await chrome.storage.local.get(["onboardingAnswers"]);
    const learningContext = await getStoredLearningContext();

    const response = await fetch("https://learning-extension.onrender.com/api/mentor", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "Review missed questions",
        pageTitle: pageInfo?.title || "",
        pageUrl: window.location.href,
        onboardingAnswers: data.onboardingAnswers || {},
        pageContext: pageInfo,
        learningContext,
        incorrectAnswers: practiceQuizIncorrectAnswers
      }),
    });

    const result = await response.json();

    return result.reviewItems || practiceQuizIncorrectAnswers.map((item) => ({
      question: item.question,
      selectedAnswer: item.selectedAnswer || "Not saved",
      correctAnswer: item.correctAnswer || "Review the explanation",
      whyWrong: "Your answer missed the main concept being tested.",
      correctConcept: item.explanation || "Review this concept again.",
      revisionExplanation: item.explanation || "Go back over this topic, then try a simpler version.",
      followUpQuestion: ""
    }));
  } catch (error) {
    console.error("Missed questions review error:", error);

    return practiceQuizIncorrectAnswers.map((item) => ({
      question: item.question,
      selectedAnswer: item.selectedAnswer || "Not saved",
      correctAnswer: item.correctAnswer || "Review the explanation",
      whyWrong: "Your answer missed the main concept being tested.",
      correctConcept: item.explanation || "Review this concept again.",
      revisionExplanation: item.explanation || "Go back over this topic, then try a simpler version.",
      followUpQuestion: ""
    }));
  }
}

async function callQuizSummaryAPI() {
  try {
    const pageInfo = getCourseraPageInfo();
    const data = await chrome.storage.local.get(["onboardingAnswers"]);

    const response = await fetch("https://learning-extension.onrender.com/api/mentor", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "Quiz summary",
        pageTitle: pageInfo?.title || "",
        pageUrl: window.location.href,
        onboardingAnswers: data.onboardingAnswers || {},
        score: practiceQuizScore,
        totalQuestions: practiceQuizQuestions.length,
        incorrectAnswers: practiceQuizIncorrectAnswers
      }),
    });

    const result = await response.json();

    return result.message || "You’re making good progress. Review the questions you missed and try testing your understanding again.";
  } catch (error) {
    console.error("Quiz summary error:", error);

    return "You’re making progress. Review the areas you struggled with, then revisit this topic once more.";
  }
}

async function callMentorAPIForQuiz() {
  try {
    const pageInfo = getCourseraPageInfo();
    const data = await chrome.storage.local.get(["onboardingAnswers"]);
    const learningContext = await getStoredLearningContext();

    const response = await fetch("https://learning-extension.onrender.com/api/mentor", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "Practice quiz",
        pageTitle: pageInfo?.title || "",
        pageUrl: window.location.href,
        onboardingAnswers: data.onboardingAnswers || {},
        pageContext: pageInfo,
        learningContext
      }),
    });

    const result = await response.json();

    return result.questions || [];
  } catch (error) {
    console.error("Quiz API error:", error);
    return [];
  }
}

async function renderExplainTopicChat() {
  const container = document.querySelector(".ai-mentor-body");
  if (!container) return;

  container.innerHTML = `
    <div class="ai-chat-screen">
      <button id="back-to-mentor-home" class="secondary-btn" type="button">
        Back
      </button>

      <div class="ai-chat-header-card">
        <p class="ai-mentor-card-title">Explain this topic</p>
        <p class="ai-mentor-card-text muted">
          Ask about a specific concept, or use the button below for an explanation based on this Coursera page.
        </p>
      </div>

      <div class="ai-mentor-card">
        <textarea 
          id="explain-topic-input"
          class="ai-chat-input"
          placeholder="Example: Explain SEO metrics in simple terms..."
        ></textarea>

        <button id="send-explain-topic" class="primary-btn" type="button">
          Explain my topic
        </button>

        <button id="explain-current-page" class="secondary-btn" type="button" style="margin-top: 10px;">
          Explain the current page
        </button>
      </div>

      <div id="explain-topic-result"></div>
    </div>
  `;

  document
    .getElementById("back-to-mentor-home")
    ?.addEventListener("click", renderMentorContent);

  document
    .getElementById("send-explain-topic")
    ?.addEventListener("click", async () => {
      const input = document.getElementById("explain-topic-input");
      const topic = input?.value?.trim();

      if (!topic) {
        alert("Type the topic you want explained first.");
        return;
      }

      await showExplainTopicResult(topic);
    });

  document
    .getElementById("explain-current-page")
    ?.addEventListener("click", async () => {
      await showExplainTopicResult("Give a general overview of the current module or knowledge check topic. Do not ask me anything back.");
    });
}

async function showExplainTopicResult(topic) {
  const resultContainer = document.getElementById("explain-topic-result");
  if (!resultContainer) return;

  resultContainer.innerHTML = `
    <div class="ai-mentor-card">
      <p class="ai-mentor-card-text muted">Generating explanation...</p>
    </div>
  `;

  const explanation = await callExplainTopicAPI(topic);

  resultContainer.innerHTML = `
    <div class="ai-mentor-card">
      <p class="ai-mentor-card-title">Explanation</p>
      <p class="ai-mentor-card-text">${explanation}</p>
    </div>
  `;
}

async function callExplainTopicAPI(topic) {
  try {
    const pageInfo = getCourseraPageInfo();
    const data = await chrome.storage.local.get(["onboardingAnswers"]);
    const learningContext = await getStoredLearningContext();

    const response = await fetch("https://learning-extension.onrender.com/api/mentor", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "Explain this topic",
        requestedTopic: topic,
        pageTitle: pageInfo?.title || "",
        pageUrl: window.location.href,
        onboardingAnswers: data.onboardingAnswers || {},
        pageContext: pageInfo,
        learningContext
      }),
    });

    const result = await response.json();

    return result.message || "I couldn’t generate a specific explanation yet.";
  } catch (error) {
    console.error("Explain topic error:", error);
    return "I couldn’t generate the explanation right now.";
  }
}

async function renderExampleChat() {
  const container = document.querySelector(".ai-mentor-body");

  if (!container) return;

  container.innerHTML = `
    <div class="ai-chat-screen">
      <button id="back-to-mentor-home" class="secondary-btn" type="button">
        Back
      </button>

      <div class="ai-chat-header-card">
        <p class="ai-mentor-card-title">Give me an example</p>

        <p class="ai-mentor-card-text muted">
          I’ll explain this topic using a real-world example.
        </p>
      </div>

      <div class="ai-mentor-card">
        <p class="ai-mentor-card-text">
          Generating example...
        </p>
      </div>
    </div>
  `;

  document
    .getElementById("back-to-mentor-home")
    ?.addEventListener("click", renderMentorContent);

  const example = await callExampleAPI();

  container.innerHTML = `
    <div class="ai-chat-screen">
      <button id="back-to-mentor-home" class="secondary-btn" type="button">
        Back
      </button>

      <div class="ai-mentor-card">
        <p class="ai-mentor-card-title">Real-world example</p>

        <p class="ai-mentor-card-text">
          ${example}
        </p>
      </div>

      <button id="finish-example-chat" class="primary-btn" type="button">
        Back to main menu
      </button>
    </div>
  `;

  document
    .getElementById("back-to-mentor-home")
    ?.addEventListener("click", renderMentorContent);

  document
    .getElementById("finish-example-chat")
    ?.addEventListener("click", renderMentorContent);
}

async function callExampleAPI() {
  try {
    const pageInfo = getCourseraPageInfo();

    const data = await chrome.storage.local.get(["onboardingAnswers"]);

    const response = await fetch("https://learning-extension.onrender.com/api/mentor", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "Give me an example",
        pageTitle: pageInfo?.title || "",
        pageUrl: window.location.href,
        onboardingAnswers: data.onboardingAnswers || {},
      }),
    });

    const result = await response.json();

    return (
      result.message ||
      "Imagine applying this concept in a real-world situation related to the course topic."
    );
  } catch (error) {
    console.error("Example API error:", error);

    return "I couldn’t generate an example right now.";
  }
}

async function callMentorAPI(action) {
  try {
    const pageInfo = getCourseraPageInfo();

    const data = await chrome.storage.local.get([
      "onboardingAnswers"
    ]);

    const response = await fetch("https://learning-extension.onrender.com/api/mentor", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action,
        pageTitle: pageInfo?.title || "",
        pageUrl: window.location.href,
        onboardingAnswers: data.onboardingAnswers || {},
        conversation: []
      }),
    });

    const result = await response.json();

    showMentorResponse(result.message);
  } catch (error) {
    console.error("API error:", error);
  }
}

function showMentorResponse(message) {
  const container = document.querySelector(".ai-mentor-body");

  if (!container) return;

  const card = document.createElement("div");
  card.className = "ai-mentor-card";

  card.innerHTML = `
    <p class="ai-mentor-card-title">Your AI Mentor</p>
    <p class="ai-mentor-card-text">${message}</p>
  `;

  const existing = container.querySelector(".ai-mentor-response");
  if (existing) existing.remove();

  card.classList.add("ai-mentor-response");
  container.prepend(card);
}