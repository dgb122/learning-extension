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
  createMentorUI();
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

function createMentorUI() {
  if (document.getElementById("ai-study-mentor-btn")) return;

  const button = document.createElement("button");
  button.id = "ai-study-mentor-btn";
  button.textContent = "Need support?";
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
      <button id="ai-study-mentor-close" class="ai-mentor-close" type="button" aria-label="Close mentor">×</button>
    </div>

    <div id="ai-mentor-dynamic-content" class="ai-mentor-body"></div>
  `;

  button.addEventListener("click", async () => {
    openMentorDrawer();
    await renderMentorContent();
  });

  overlay.addEventListener("click", closeMentorDrawer);

  document.body.appendChild(button);
  document.body.appendChild(overlay);
  document.body.appendChild(drawer);

  const closeButton = document.getElementById("ai-study-mentor-close");
  if (closeButton) {
    closeButton.addEventListener("click", closeMentorDrawer);
  }

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
}

function closeMentorDrawer() {
  const drawer = document.getElementById("ai-study-mentor-drawer");
  const overlay = document.getElementById("ai-study-mentor-overlay");

  if (!drawer || !overlay) return;

  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  overlay.classList.remove("open");
}

async function renderMentorContent() {
  const stored = await chrome.storage.local.get([
    "onboardingComplete",
    "onboardingAnswers",
    "mentorPreferences",
    "liveTracking",
    "currentSession",
    "sessions",
    "lastSessionEndedAt"
  ]);

  if (!stored.onboardingComplete || !stored.onboardingAnswers) {
    renderOnboardingPlaceholder();
    return;
  }

  renderMentorHome(
    stored.onboardingAnswers,
    stored.liveTracking || null,
    stored.currentSession || null,
    stored.sessions || [],
    stored.lastSessionEndedAt || null
  );
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

function renderMentorHome(savedAnswers, liveTracking, currentSession, sessions, lastSessionEndedAt) {
  const container = document.getElementById("ai-mentor-dynamic-content");
  if (!container) return;

  const pageInfo = getCourseraPageInfo();
  const totalActiveMs = liveTracking?.activeMs || 0;

  const nextStepPrompt = getNextStepPrompt(
    savedAnswers,
    liveTracking,
    currentSession,
    sessions,
    lastSessionEndedAt
  );

  container.innerHTML = `

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
      <p class="ai-mentor-card-title">Current page</p>
      <p class="ai-mentor-card-text">${pageInfo.title || "Untitled page"}</p>
      <p class="ai-mentor-card-text muted">Page type: ${formatLabel(pageInfo.pageType || "unknown")}</p>
    </div>

    <div class="ai-mentor-card">
      <p class="ai-mentor-card-title">Study activity</p>
      <p class="ai-mentor-card-text">Status: ${currentSession ? "Studying now" : "Not currently studying"}</p>
      <p class="ai-mentor-card-text muted">Last active: ${formatLastActive(lastSessionEndedAt)}</p>
      <p class="ai-mentor-card-text muted">Total active study time: ${formatDuration(totalActiveMs)}</p>
      <p class="ai-mentor-card-text muted">Completed sessions: ${sessions.length}</p>
    </div>

    <div class="ai-mentor-card">
      <button id="ai-reset-onboarding" class="secondary-btn" type="button">Reset onboarding</button>
    </div>
  `;

  const resetBtn = document.getElementById("ai-reset-onboarding");
  if (resetBtn) {
    resetBtn.addEventListener("click", async () => {
      await chrome.storage.local.remove([
        "onboardingComplete",
        "onboardingAnswers",
        "mentorPreferences"
      ]);
      await renderMentorContent();
    });
  }

  attachActionHandlers();
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

function handleAction(action) {
  console.log("User selected action:", action);

  if (!action) return;

  if (action === "Test my understanding") {
    renderUnderstandingChat();
    return;
  }

  if (action === "Practice quiz") {
    renderPracticeQuiz();
    return;
  }

  if (action === "Give me an example") {
    renderExampleChat();
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
  understandingConversation = [
    {
      role: "mentor",
      text: "Let’s check this properly. First question: what do you think the main idea of this topic is?"
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
          I’ll ask a few questions, give feedback after each one, then tell you what to review.
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

async function callMentorAPIForChat(studentAnswer, questionNumber, conversation) {
  try {
    const pageInfo = getCourseraPageInfo();

    const data = await chrome.storage.local.get(["onboardingAnswers"]);

    const response = await fetch("http://localhost:3000/api/mentor", {
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
        conversation
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

  if (isCorrect) {
    practiceQuizScore += 1;
  } else {
    practiceQuizIncorrectAnswers.push({
      question: question.question,
      explanation: question.explanation
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

        <button id="finish-practice-quiz" class="primary-btn" type="button">
          Back to main menu
        </button>
      </div>
    </div>
  `;

  document
    .getElementById("finish-practice-quiz")
    ?.addEventListener("click", renderMentorContent);
}

async function callQuizSummaryAPI() {
  try {
    const pageInfo = getCourseraPageInfo();
    const data = await chrome.storage.local.get(["onboardingAnswers"]);

    const response = await fetch("http://localhost:3000/api/mentor", {
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

    const response = await fetch("http://localhost:3000/api/mentor", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "Practice quiz",
        pageTitle: pageInfo?.title || "",
        pageUrl: window.location.href,
        onboardingAnswers: data.onboardingAnswers || {},
      }),
    });

    const result = await response.json();

    return result.questions || [];
  } catch (error) {
    console.error("Quiz API error:", error);
    return [];
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

    const response = await fetch("http://localhost:3000/api/mentor", {
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

    const response = await fetch("http://localhost:3000/api/mentor", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action,
        pageTitle: pageInfo?.title || "",
        pageUrl: window.location.href,
        onboardingAnswers: data.onboardingAnswers || {},
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