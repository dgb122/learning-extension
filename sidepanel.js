/* global chrome */

const questions = [
  {
    key: "studyLevel",
    question: "What level of study are you currently in?",
    options: [
      { label: "Undergraduate", value: "undergraduate" },
      { label: "Postgraduate", value: "postgraduate" },
      { label: "Other", value: "other" }
    ]
  },
  {
    key: "weeklyStudyTime",
    question: "How much time do you realistically have for studying each week?",
    options: [
      { label: "Less than 3 hours", value: "lt_3_hours" },
      { label: "3–5 hours", value: "3_5_hours" },
      { label: "6–10+ hours", value: "6_10_plus_hours" }
    ]
  },
  {
    key: "deadlineManagement",
    question: "How do you usually manage deadlines?",
    options: [
      { label: "Plan ahead", value: "plan_ahead" },
      { label: "Last-minute", value: "last_minute" },
      { label: "Often miss them", value: "often_miss" }
    ]
  },
  {
    key: "independentConfidence",
    question: "How confident are you with independent study?",
    options: [
      { label: "Very confident", value: "very_confident" },
      { label: "Somewhat confident", value: "somewhat_confident" },
      { label: "Not confident", value: "not_confident" }
    ]
  },
  {
    key: "fallBehindCause",
    question: "What usually causes you to fall behind academically?",
    options: [
      { label: "Poor time management or procrastination", value: "poor_time_management" },
      { label: "Unclear expectations or feedback", value: "unclear_expectations" },
      { label: "Heavy workload or competing commitments", value: "heavy_workload" },
      { label: "Stress, anxiety, or low motivation", value: "stress_anxiety_low_motivation" },
      { label: "I don't usually fall behind", value: "dont_usually_fall_behind" }
    ]
  },
  {
    key: "fallBehindReaction",
    question: "How do you usually react when you fall behind?",
    options: [
      { label: "I panic and avoid it", value: "panic_avoid" },
      { label: "I push harder", value: "push_harder" },
      { label: "I need external reminders", value: "need_external_reminders" },
      { label: "I ask for help", value: "ask_for_help" }
    ]
  },
  {
    key: "mentorTone",
    question: "What tone would you want from an AI mentor?",
    options: [
      { label: "Supportive", value: "supportive" },
      { label: "Direct", value: "direct" },
      { label: "Neutral", value: "neutral" },
      { label: "Motivational", value: "motivational" }
    ]
  },
  {
    key: "reminderStyle",
    question: "What kind of reminders work best for you?",
    options: [
      { label: "Gentle reminders", value: "gentle" },
      { label: "Firm reminders", value: "firm" },
      { label: "Minimal reminders", value: "minimal" }
    ]
  },
  {
    key: "checkInFrequency",
    question: "How often would you want the assistant to check in?",
    options: [
      { label: "Often", value: "often" },
      { label: "Sometimes", value: "sometimes" },
      { label: "Only when needed", value: "only_when_needed" }
    ]
  }
];

let currentStep = 0;
let answers = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  const app = document.getElementById("app");

  if (!app) {
    console.error("Missing #app container");
    return;
  }

  const stored = await chrome.storage.local.get([
    "onboardingStarted",
    "onboardingComplete",
    "onboardingAnswers",
    "mentorPreferences",
    "lastSessionEndedAt",
    "liveTracking",
    "currentSession",
    "sessions"
  ]);

  if (!stored.onboardingStarted) {
    renderIntro();
    return;
  }

  if (stored.onboardingAnswers) {
    answers = stored.onboardingAnswers;
  }

  const mentorPreferences = stored.mentorPreferences || {};
  const lastSessionEndedAt = stored.lastSessionEndedAt || null;
  const comebackStatus = buildComebackStatus(
    lastSessionEndedAt,
    mentorPreferences
  );

  if (stored.onboardingComplete && stored.onboardingAnswers) {
    renderHome(
      stored.onboardingAnswers,
      comebackStatus,
      stored.liveTracking || null,
      stored.currentSession || null,
      stored.sessions || []
    );
    return;
  }

  renderQuestion();
}

function renderIntro() {
  const app = document.getElementById("app");

  if (!app) return;

  app.innerHTML = `
    <div class="panel">
      <h1 class="title">Meet your AI Study Mentor</h1>
      <p class="subtitle">
        This isn’t just a tool. It’s a personalised mentor that learns how you study, keeps you on track, and adapts to you.
      </p>

      <div class="summary-box">
        <p>We’ll set it up in under 1 minute.</p>
        <p>Answer a few quick questions and your mentor will be ready.</p>
      </div>

      <div class="home-actions">
        <button id="startBtn" class="primary-btn">Set up my mentor</button>
      </div>
    </div>
  `;

  document.getElementById("startBtn").addEventListener("click", async () => {
    await chrome.storage.local.set({ onboardingStarted: true });
    renderQuestion();
  });
}

function renderQuestion() {
  const app = document.getElementById("app");

  if (!app) {
    console.error("Missing #app in sidepanel.html");
    return;
  }
  const currentQuestion = questions[currentStep];
  const savedAnswer = answers[currentQuestion.key];

  app.innerHTML = `
    <div class="panel">
      <div class="progress-wrap">
        <div class="progress-text">Question ${currentStep + 1} of ${questions.length}</div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${((currentStep + 1) / questions.length) * 100}%"></div>
        </div>
      </div>

      <h1 class="title">Personalise your learning assistant</h1>
      <p class="question">${currentQuestion.question}</p>

      <div class="options">
        ${currentQuestion.options
          .map(
            (option) => `
              <button class="option-btn ${savedAnswer === option.value ? "selected" : ""}" data-value="${option.value}">
                ${option.label}
              </button>
            `
          )
          .join("")}
      </div>

      <div class="footer-row">
        ${currentStep > 0 ? `<button id="backBtn" class="secondary-btn">Back</button>` : `<div></div>`}
      </div>
    </div>
  `;

  document.querySelectorAll(".option-btn").forEach((button) => {
    button.addEventListener("click", () => handleAnswer(button.dataset.value));
  });

  const backBtn = document.getElementById("backBtn");
  if (backBtn) {
    backBtn.addEventListener("click", handleBack);
  }
}

async function handleAnswer(value) {
  const currentQuestion = questions[currentStep];
  answers[currentQuestion.key] = value;

  await chrome.storage.local.set({
    onboardingAnswers: answers,
    mentorPreferences: buildMentorPreferences(answers)
  });

  if (currentStep < questions.length - 1) {
    currentStep += 1;
    renderQuestion();
    return;
  }

  const mentorPreferences = buildMentorPreferences(answers);

  await chrome.storage.local.set({
    onboardingComplete: true,
    onboardingAnswers: answers,
    mentorPreferences
  });

  const stored = await chrome.storage.local.get(["lastSessionEndedAt"]);
  const comebackStatus = buildComebackStatus(
    stored.lastSessionEndedAt || null,
    mentorPreferences
  );

  const trackingStored = await chrome.storage.local.get([
    "liveTracking",
    "currentSession",
    "sessions"
  ]);

  renderHome(
    answers,
    comebackStatus,
    trackingStored.liveTracking || null,
    trackingStored.currentSession || null,
    trackingStored.sessions || []
  );
}

function handleBack() {
  if (currentStep === 0) return;
  currentStep -= 1;
  renderQuestion();
}

function renderHome(savedAnswers, comebackStatus, liveTracking, currentSession, sessions) {
  const app = document.getElementById("app");

  if (!app) {
    console.error("Missing #app in sidepanel.html");
    return;
  }

  const totalActiveMs = liveTracking?.activeMs || 0;
  const sessionCount = sessions?.length || 0;
  const isStudyingNow = !!currentSession;

  app.innerHTML = `
    <div class="panel">
      <h1 class="title">Your AI Study Mentor is ready</h1>
      <p class="subtitle">
        I’ll adapt to how you learn, keep you consistent, and help you stay on track.
      </p>

      <div class="summary-box">
        <p><strong>Study activity</strong></p>
        <p><strong>Status:</strong> ${isStudyingNow ? "Studying now" : "Not currently studying"}</p>
        <p><strong>Last active:</strong> ${comebackStatus.label}</p>
        <p><strong>Check-in needed:</strong> ${comebackStatus.shouldNudge ? "Yes" : "No"}</p>
        <p><strong>Total active study time:</strong> ${formatDuration(totalActiveMs)}</p>
        <p><strong>Completed sessions:</strong> ${sessionCount}</p>
      </div>

      <div class="home-actions">
        <button id="resetBtn" class="secondary-btn">Reset onboarding</button>
      </div>
    </div>
  `;

  document.getElementById("resetBtn").addEventListener("click", async () => {
    await chrome.storage.local.remove([
      "onboardingComplete",
      "onboardingAnswers",
      "mentorPreferences"
    ]);
    currentStep = 0;
    answers = {};
    renderQuestion();
  });
}

function buildMentorPreferences(onboardingAnswers) {
  const deadlineManagement = onboardingAnswers.deadlineManagement || "";
  const independentConfidence = onboardingAnswers.independentConfidence || "";
  const fallBehindCause = onboardingAnswers.fallBehindCause || "";
  const fallBehindReaction = onboardingAnswers.fallBehindReaction || "";

  const needsMoreStructure =
    deadlineManagement === "last_minute" ||
    deadlineManagement === "often_miss" ||
    fallBehindReaction === "need_external_reminders" ||
    independentConfidence === "not_confident";

  const higherRiskOfFallingBehind =
    deadlineManagement === "often_miss" ||
    fallBehindCause === "poor_time_management" ||
    fallBehindCause === "heavy_workload" ||
    fallBehindCause === "stress_anxiety_low_motivation";

  return {
    mentorTone: onboardingAnswers.mentorTone || "supportive",
    reminderStyle: onboardingAnswers.reminderStyle || "gentle",
    checkInFrequency: onboardingAnswers.checkInFrequency || "sometimes",
    weeklyStudyTime: onboardingAnswers.weeklyStudyTime || null,
    studyLevel: onboardingAnswers.studyLevel || null,
    needsMoreStructure,
    higherRiskOfFallingBehind
  };
}

function buildComebackStatus(lastSessionEndedAt, mentorPreferences) {
  if (!lastSessionEndedAt) {
    return {
      label: "No study sessions yet",
      level: "new",
      shouldNudge: false,
      hoursSinceLastSession: null
    };
  }

  const now = Date.now();
  const hoursSinceLastSession = Math.floor(
    (now - lastSessionEndedAt) / (1000 * 60 * 60)
  );

  const checkInFrequency = mentorPreferences?.checkInFrequency || "sometimes";

  let nudgeThresholdHours = 48;

  if (checkInFrequency === "often") {
    nudgeThresholdHours = 24;
  } else if (checkInFrequency === "rarely") {
    nudgeThresholdHours = 72;
  }

  let label = "Last active recently";
  let level = "recent";

  if (hoursSinceLastSession < 24) {
    label = "Last active today";
    level = "recent";
  } else if (hoursSinceLastSession < 48) {
    label = "Last active 1 day ago";
    level = "cooling";
  } else {
    const days = Math.floor(hoursSinceLastSession / 24);
    label = `Last active ${days} days ago`;
    level = "away";
  }

  return {
    label,
    level,
    shouldNudge: hoursSinceLastSession >= nudgeThresholdHours,
    hoursSinceLastSession
  };
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