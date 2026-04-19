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
    console.error('Missing #app container in sidepanel.html');
    return;
  }

  const stored = await chrome.storage.local.get(["onboardingComplete", "onboardingAnswers"]);

  if (stored.onboardingAnswers) {
    answers = stored.onboardingAnswers;
  }

  if (stored.onboardingComplete && stored.onboardingAnswers) {
    renderHome(stored.onboardingAnswers);
    return;
  }

  renderQuestion();
}

function renderQuestion() {
  const app = document.getElementById("app");
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
    onboardingAnswers: answers
  });

  if (currentStep < questions.length - 1) {
    currentStep += 1;
    renderQuestion();
    return;
  }

  await chrome.storage.local.set({
    onboardingComplete: true,
    onboardingAnswers: answers
  });

  renderHome(answers);
}

function handleBack() {
  if (currentStep === 0) return;
  currentStep -= 1;
  renderQuestion();
}

function renderHome(savedAnswers) {
  const app = document.getElementById("app");

  app.innerHTML = `
    <div class="panel">
      <h1 class="title">Learning Assistant</h1>
      <p class="subtitle">Your onboarding is complete.</p>

      <div class="summary-box">
        <p><strong>Study level:</strong> ${formatValue(savedAnswers.studyLevel)}</p>
        <p><strong>Weekly study time:</strong> ${formatValue(savedAnswers.weeklyStudyTime)}</p>
        <p><strong>Deadline management:</strong> ${formatValue(savedAnswers.deadlineManagement)}</p>
        <p><strong>Independent study confidence:</strong> ${formatValue(savedAnswers.independentConfidence)}</p>
        <p><strong>Main reason for falling behind:</strong> ${formatValue(savedAnswers.fallBehindCause)}</p>
        <p><strong>Reaction when behind:</strong> ${formatValue(savedAnswers.fallBehindReaction)}</p>
        <p><strong>Preferred mentor tone:</strong> ${formatValue(savedAnswers.mentorTone)}</p>
        <p><strong>Reminder style:</strong> ${formatValue(savedAnswers.reminderStyle)}</p>
        <p><strong>Check-in frequency:</strong> ${formatValue(savedAnswers.checkInFrequency)}</p>
      </div>

      <div class="home-actions">
        <button id="resetBtn" class="secondary-btn">Reset onboarding</button>
      </div>
    </div>
  `;

  document.getElementById("resetBtn").addEventListener("click", async () => {
    await chrome.storage.local.remove(["onboardingComplete", "onboardingAnswers"]);
    currentStep = 0;
    answers = {};
    renderQuestion();
  });
}

function formatValue(value) {
  if (!value) return "Not set";

  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}