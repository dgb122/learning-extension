console.log("Extension is running on this page");

init();

function init() {
  const pageInfo = getCourseraPageInfo();

  chrome.runtime.sendMessage({
    type: "COURSE_PAGE_INFO",
    pageInfo
  });

  createSupportButton();
}

function getCourseraPageInfo() {
  const url = window.location.href;
  const hostname = window.location.hostname;
  const title = document.title || "";
  const bodyText = document.body?.innerText?.slice(0, 1000) || "";

  const path = window.location.pathname;

  let pageType = "unknown";
  if (path.includes("/learn/")) pageType = "course";
  if (path.includes("/lecture/")) pageType = "lecture";
  if (path.includes("/quiz/")) pageType = "quiz";
  if (path.includes("/supplement/")) pageType = "reading";

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
    chrome.runtime.sendMessage({
      type: "OPEN_SIDE_PANEL"
    });
  });

  document.body.appendChild(button);
}