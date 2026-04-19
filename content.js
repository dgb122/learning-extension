console.log("Extension is running on this page");

// grab visible text (basic version)
const text = document.body.innerText.slice(0, 1000);

chrome.runtime.sendMessage({
  type: "PAGE_CONTENT",
  content: text
});