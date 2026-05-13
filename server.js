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
      pageContext,
      learningContext,
      onboardingAnswers,
      studentAnswer,
      questionNumber,
      conversation,
      score,
      totalQuestions,
      incorrectAnswers
    } = req.body;

    if (action === "Analyse nudge") {
      const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `
You are an AI study mentor deciding whether to gently nudge a Coursera student.

Return ONLY valid JSON in this exact format:
{
  "shouldNudge": true,
  "title": "Short title",
  "message": "One short helpful sentence",
  "action": "Explain this topic"
}

Allowed actions:
- "Explain this topic"
- "Test my understanding"
- "Practice quiz"
- "Give me an example"

Rules:
- Only nudge if there is a genuinely useful reason.
- Do not nudge just because the student is on any page.
- Good reasons include: quiz/test page, repeated quiz-like questions, possible struggle, inactivity, near end of video, dense reading page, same topic seen repeatedly, or useful timing for recall.
- If the student is on a quiz/test, do NOT offer to answer the question. Offer practice or explanation without revealing answers.
- Keep title under 5 words.
- Keep message under 18 words.
- If no useful nudge is needed, return:
{
  "shouldNudge": false,
  "title": "",
  "message": "",
  "action": ""
}
`
          },
          {
            role: "user",
            content: `
Current page context:
${JSON.stringify(pageContext || {}, null, 2)}

Stored learning context:
${JSON.stringify(learningContext || {}, null, 2)}

Student onboarding answers:
${JSON.stringify(onboardingAnswers || {}, null, 2)}
`
          }
        ]
      });

      const text = response.choices?.[0]?.message?.content || "{}";
      const parsed = JSON.parse(text);

      return res.json(parsed);
    }

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

    if (action === "Explain this topic") {
      const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
    You are an AI study mentor inside a Coursera extension.

    The student wants a direct explanation of the topic or current page.

    IMPORTANT:
    - This response appears in a one-way explanation card.
    - Do NOT ask the student to reply.
    - Do NOT ask the student to summarise.
    - Do NOT ask follow-up questions.
    - Do NOT say "tell me more" or "share your answer".
    - Do NOT summarise the onboarding answers in your answer, just use it to match your tone.
    - Never say "you prefer a neutral tone", "based on your onboarding", or anything that reveals personalisation settings.
    - If the request is general, choose the clearest main topic from the current page and explain it directly.
    - Structure the answer as: simple explanation, why it matters, quick example, key takeaway.

    Your job:
    - Explain the topic clearly.
    - Use the current Coursera page context.
    - If the requested topic is specific, focus on that topic.
    - If the request is general, explain the main concept on the current page.
    - Use simple, student-friendly language.
    - Include one short example if useful.
    - End with one clear takeaway, not a question.
    - If the page is a knowledge check, explain the module/topic area generally. Do not treat it like the student has submitted an answer.
    - Never say the student has not provided an answer.
    - Never ask the student to summarise what they learned.
    - Never ask for feedback.
    - Never mention onboarding answers, tone preferences, or learning preferences.
    - If the page title says "Module 1 Knowledge Check", infer the topic from the course/page context and give a useful overview.

    Keep it concise but genuinely helpful.
    `
          },
          {
            role: "user",
            content: `
    Requested topic:
    ${req.body.requestedTopic || "Explain the current Coursera page"}

    Current page title:
    ${pageTitle}

    Current page URL:
    ${pageUrl}

    Current page context:
    ${JSON.stringify(pageContext || {}, null, 2)}

    Stored learning context:
    ${JSON.stringify(learningContext || {}, null, 2)}

    Student onboarding answers:
    ${JSON.stringify(onboardingAnswers || {}, null, 2)}
    `
          }
        ]
      });

      const text =
        response.choices?.[0]?.message?.content ||
        "Here is a simple explanation of the current topic.";

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

    if (action === "Review missed questions") {
      const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `
    You are an AI revision assistant inside a Coursera Chrome extension.

    The student has missed some practice quiz questions.

    Return ONLY valid JSON in this exact format:
    {
      "reviewItems": [
        {
          "question": "Original question",
          "selectedAnswer": "What the student chose",
          "correctAnswer": "Correct answer",
          "whyWrong": "Clear explanation of why their answer was wrong",
          "correctConcept": "The concept they need to understand",
          "revisionExplanation": "Revision-focused explanation in simple language",
          "followUpQuestion": "One simpler practice question"
        }
      ]
    }

    Rules:
    - Do not be generic.
    - Do not just repeat the original explanation.
    - Explain the misunderstanding.
    - Make it feel like a smart revision assistant.
    - Keep each field concise.
    - Use the course/page context where useful.
    - Do not ask the student for more information.
    `
          },
          {
            role: "user",
            content: `
    Current page title:
    ${pageTitle}

    Current page URL:
    ${pageUrl}

    Current page context:
    ${JSON.stringify(pageContext || {}, null, 2)}

    Stored learning context:
    ${JSON.stringify(learningContext || {}, null, 2)}

    Student onboarding answers:
    ${JSON.stringify(onboardingAnswers || {}, null, 2)}

    Incorrect answers:
    ${JSON.stringify(incorrectAnswers || [], null, 2)}
    `
          }
        ]
      });

      const text = response.choices?.[0]?.message?.content || "{}";
      const parsed = JSON.parse(text);

      return res.json({
        reviewItems: parsed.reviewItems || [],
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
      - Base questions on the Coursera page context, headings, body preview, recent pages, and recent questions.
      - If the student is on a quiz/test/assignment page, do NOT copy, paraphrase, solve, or reveal the visible assessment questions.
      - In quiz/test mode, create similar practice questions that test the underlying concept only.
      - Questions should test actual understanding, not random memory.
      - Explanations should teach the concept, not reveal Coursera quiz answers.
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

    Current page context:
    ${JSON.stringify(pageContext || {}, null, 2)}

    Stored learning context:
    ${JSON.stringify(learningContext || {}, null, 2)}
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

You must base your support on the specific Coursera course content provided by the extension.
Use the current page context, visible headings, page preview, recent pages, and recent questions to understand the direction of the course.
Do not give generic internet-style explanations unless the course context is too limited.
If the student is on a quiz or test page, do not repeat the exact visible questions. Ask similar questions that test the same concept without giving away the answer.

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

Current page context:
${JSON.stringify(pageContext || {}, null, 2)}

Stored learning context:
${JSON.stringify(learningContext || {}, null, 2)}

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