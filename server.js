require("dotenv").config();

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.use(cors());
app.use(express.json());

app.post("/api/mentor", async (req, res) => {
  try {
    const {
      action,
      pageTitle,
      pageUrl,
      onboardingAnswers,
      studentAnswer,
      questionNumber,
      conversation,
      score,
      totalQuestions,
      incorrectAnswers
    } = req.body;

    if (action === "Quiz summary") {
      const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
    You are an AI learning mentor.

    The student has completed a quiz.

    Your job:
    - Summarise what they did well.
    - Explain what concepts they struggled with based on incorrect answers.
    - Suggest what they should review next.
    - End with one short actionable next step.

    Keep it concise, encouraging, intelligent, and personalised.
    Do not sound robotic or overly motivational.
    `
          },
          {
            role: "user",
            content: `
    Page title:
    ${pageTitle}

    Onboarding answers:
    ${JSON.stringify(onboardingAnswers, null, 2)}

    Score:
    ${score}/${totalQuestions}

    Incorrect answers:
    ${JSON.stringify(incorrectAnswers, null, 2)}
    `
          }
        ]
      });

      const text =
        response.choices?.[0]?.message?.content ||
        "Good progress overall. Review the questions you missed and revisit the main concepts once more.";

      return res.json({
        message: text,
      });
    }

    if (action === "Give me an example") {
      const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
    You are an AI study mentor inside a Coursera extension.

    The student wants a real-world example of the topic currently on screen.

    Rules:
    - Explain the concept using a relatable real-world example or scenario.
    - Adapt tone and explanation style to onboarding answers.
    - Make the example practical and specific.
    - Avoid generic textbook explanations.
    - Keep it concise but intelligent.
    - End with one reflective question to help the student think deeper.
    `
          },
          {
            role: "user",
            content: `
    Current page title:
    ${pageTitle}

    Current page URL:
    ${pageUrl}

    Student onboarding answers:
    ${JSON.stringify(onboardingAnswers, null, 2)}
    `
          }
        ]
      });

      const text =
        response.choices?.[0]?.message?.content ||
        "Here’s a simple example related to this topic.";

      return res.json({
        message: text,
      });
    }

    if (action === "Practice quiz") {
      const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `
    You are an AI study mentor inside a Coursera extension.

    Create a short multiple-choice practice quiz based on the student's current Coursera page.

    Use the student's onboarding answers to adapt difficulty and tone.

    Return ONLY valid JSON in this exact format:
    {
      "questions": [
        {
          "question": "Question text here",
          "options": ["Option A", "Option B", "Option C", "Option D"],
          "correctIndex": 0,
          "explanation": "Short explanation here"
        }
      ]
    }

    Rules:
    - Create exactly 5 questions.
    - Each question must have exactly 4 options.
    - correctIndex must be 0, 1, 2, or 3.
    - Questions should test actual understanding, not random memory.
    - Explanations should be clear and specific.
    - Keep the tone aligned with the onboarding answers.
    `
          },
          {
            role: "user",
            content: `
    Action: ${action}

    Current page title:
    ${pageTitle}

    Current page URL:
    ${pageUrl}

    Student onboarding answers:
    ${JSON.stringify(onboardingAnswers, null, 2)}
    `
          }
        ]
      });

      const text = response.choices?.[0]?.message?.content || "{}";
      const parsed = JSON.parse(text);

      return res.json({
        questions: parsed.questions || [],
      });
    }

const response = await client.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [
    {
      role: "system",
      content: `
You are an AI study mentor inside a Coursera extension.

Use the student's onboarding answers to adapt your tone.
If mentorTone is Direct, be clear and straight to the point.
If mentorTone is Supportive or Encouraging, be warm but not fluffy.
If mentorTone is Neutral, be calm and simple.
If mentorTone is Detailed, give slightly more explanation.

Do not say "act like you're texting me".
Do not be fluffy.
Do not over-praise.
Do not give the full answer away immediately.

For "Test my understanding":
- Give brief feedback on the student's answer.
- If they are partly right, say what is right and what is missing.
- Ask the next question.
- Do this for questions 1 to 3.
- After question 3, give a short final summary: what they understand, what to review, and one next action.
- Keep it concise.
`
    },
    {
      role: "user",
      content: `
Action: ${action}

Current page title:
${pageTitle}

Current page URL:
${pageUrl}

Student onboarding answers:
${JSON.stringify(onboardingAnswers, null, 2)}

Question number:
${questionNumber || "N/A"}

Student answer:
${studentAnswer || "N/A"}

Conversation so far:
${JSON.stringify(conversation || [], null, 2)}

Respond appropriately for this action.
`
    }
  ]
});

const text = response.choices?.[0]?.message?.content || "No response generated";

res.json({
  message: text,
});

  } catch (error) {
    console.error("Mentor API error:", error);
    res.status(500).json({
      error: "Something went wrong with the mentor API.",
    });
  }
});

app.listen(3000, () => {
  console.log("Mentor backend running on http://localhost:3000");
});