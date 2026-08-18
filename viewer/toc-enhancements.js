/* TOC polish: active-topic tracking + toc_source.md rules injection. */

let tocScrollFrame = null;

function markActiveTopic(index) {
  document.querySelectorAll("#tocList .topic-link").forEach((button, i) => {
    button.classList.toggle("active-topic", i === index);
  });
}

function updateActiveTopicFromScroll() {
  tocScrollFrame = null;

  if (navMode !== "toc" || !Array.isArray(currentTopics) || !currentTopics.length) {
    return;
  }

  const scroll = $("#chatScroll");
  const probeTop = scroll.getBoundingClientRect().top + 90;
  let activeIndex = 0;

  currentTopics.forEach((topic, index) => {
    if (!topic?.start_message_id) {
      if (index === 0) activeIndex = 0;
      return;
    }

    const message = document.getElementById("msg-" + topic.start_message_id);
    if (!message) return;

    if (message.getBoundingClientRect().top <= probeTop) {
      activeIndex = index;
    }
  });

  markActiveTopic(activeIndex);
}

function scheduleActiveTopicUpdate() {
  if (tocScrollFrame !== null) return;
  tocScrollFrame = requestAnimationFrame(updateActiveTopicFromScroll);
}

function decorateTopicLinks() {
  if (navMode !== "toc") return;

  const buttons = [...document.querySelectorAll("#tocList .topic-link")];

  buttons.forEach((button, index) => {
    if (button.dataset.activeTopicReady === "1") return;
    button.dataset.activeTopicReady = "1";

    const original = button.onclick;
    button.onclick = event => {
      markActiveTopic(index);
      if (typeof original === "function") original.call(button, event);
      window.setTimeout(scheduleActiveTopicUpdate, 450);
    };
  });

  scheduleActiveTopicUpdate();
}

const originalRenderMiddleNavigationForTocPolish = renderMiddleNavigation;
renderMiddleNavigation = function () {
  originalRenderMiddleNavigationForTocPolish();
  window.setTimeout(decorateTopicLinks, 0);
};

$("#chatScroll").addEventListener("scroll", scheduleActiveTopicUpdate, {passive: true});
window.addEventListener("resize", scheduleActiveTopicUpdate);

const originalOpenChatForTocPolish = openChat;
openChat = async function (item) {
  await originalOpenChatForTocPolish(item);
  window.setTimeout(() => {
    decorateTopicLinks();
    scheduleActiveTopicUpdate();
  }, 0);
};

async function prepareTocSourceWithRules() {
  if (!currentEntry) {
    setTocStatus("Спочатку оберіть чат.", "error");
    return;
  }

  setTocStatus("Готую toc_source.md…");

  try {
    const [sourceResponse, rulesResponse] = await Promise.all([
      fetch(`/api/toc-source?chat_id=${encodeURIComponent(currentEntry.id)}`, {cache: "no-store"}),
      fetch("toc-rules.md", {cache: "no-store"})
    ]);

    if (!sourceResponse.ok) {
      const error = await sourceResponse.json().catch(() => ({}));
      throw new Error(error.error || `${sourceResponse.status} ${sourceResponse.statusText}`);
    }

    if (!rulesResponse.ok) {
      throw new Error(`Не вдалося завантажити правила topics.json: ${rulesResponse.status}`);
    }

    let source = await sourceResponse.text();
    const rules = await rulesResponse.text();

    if (!source.includes("# Правила формування `topics.json`")) {
      source = source.trimEnd() + "\n\n---\n\n" + rules.trim() + "\n";
    }

    const blob = new Blob([source], {type: "text/markdown;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "toc_source.md";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    setTocStatus(
      "toc_source.md готовий разом із правилами формування topics.json.",
      "ok"
    );
  }
  catch (error) {
    setTocStatus(error.message || String(error), "error");
  }
}

/* Replace the original v5 button handler with the rules-aware generator. */
$("#prepareTocBtn").onclick = prepareTocSourceWithRules;

/* Initial state after all scripts are loaded. */
window.setTimeout(() => {
  decorateTopicLinks();
  scheduleActiveTopicUpdate();
}, 0);
