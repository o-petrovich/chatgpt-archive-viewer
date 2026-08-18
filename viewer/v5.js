/* v5 compatibility/fix layer.
 * Loaded after app.js so it can refine behavior without replacing the main viewer.
 */

function messageHasImage(message) {
  const content = message?.content || {};

  if (content.content_type !== "multimodal_text") {
    return false;
  }

  return (content.parts || []).some(
    part =>
      part &&
      typeof part === "object" &&
      part.content_type === "image_asset_pointer" &&
      typeof part.asset_pointer === "string"
  );
}


isServiceMessage = function (message) {
  const role = message?.author?.role || "";
  const content = message?.content || {};
  const type = content.content_type || "";
  const metadata = message?.metadata || {};
  const recipient = message?.recipient || "all";

  if (role === "user") {
    return false;
  }

  if (role === "tool") {
    return !messageHasImage(message);
  }

  if (role === "system" || role === "developer") {
    return true;
  }

  if (role !== "assistant") {
    return true;
  }

  if (recipient !== "all") {
    return true;
  }

  if (
    metadata.reasoning_status === "is_reasoning" ||
    metadata.reasoning_status === "reasoning_ended" ||
    metadata.can_save === false && type === "code"
  ) {
    return true;
  }

  if (
    type === "thoughts" ||
    type === "reasoning_recap" ||
    type === "execution_output" ||
    type === "tool_result" ||
    type === "computer_initialize_state" ||
    type === "computer_output" ||
    type === "code_execution_output"
  ) {
    return true;
  }

  return false;
};


function firstMessageTimestamp(conversation) {
  const mapping = conversation?.mapping || {};
  let first = Infinity;

  for (const node of Object.values(mapping)) {
    const message = node?.message;
    const timestamp = message?.create_time;

    if (
      typeof timestamp === "number" &&
      Number.isFinite(timestamp) &&
      timestamp > 0 &&
      timestamp < first
    ) {
      first = timestamp;
    }
  }

  if (Number.isFinite(first)) {
    return first;
  }

  const fallback = conversation?.create_time;

  return typeof fallback === "number" && Number.isFinite(fallback)
    ? fallback
    : 0;
}


function formatCatalogDate(timestamp) {
  if (!timestamp) {
    return "";
  }

  const date = new Date(timestamp * 1000);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day} ${hour}:${minute}`;
}


async function enrichAndSortCatalog() {
  await Promise.all(
    catalog.map(async item => {
      try {
        const conversation = await loadJSON(
          `../${item.path}/conversation.json?ts=${Date.now()}`
        );

        const timestamp = firstMessageTimestamp(conversation);

        item.first_message_time = timestamp;
        item.date = formatCatalogDate(timestamp);
      }
      catch (error) {
        console.warn(
          "Не вдалося визначити час першого повідомлення:",
          item.title,
          error
        );
      }
    })
  );

  catalog.sort(
    (a, b) =>
      (b.first_message_time || 0) -
      (a.first_message_time || 0)
  );

  renderCatalog();
}


function waitForCatalogAndSort(attempt = 0) {
  if (Array.isArray(catalog) && catalog.length) {
    enrichAndSortCatalog();
    return;
  }

  if (attempt >= 40) {
    return;
  }

  window.setTimeout(
    () => waitForCatalogAndSort(attempt + 1),
    50
  );
}


function setTocStatus(text = "", kind = "") {
  const el = $("#tocActionStatus");

  el.textContent = text;
  el.className = "toc-action-status" + (kind ? ` ${kind}` : "");
}


function updateTocActionsVisibility() {
  const actions = $("#tocActions");

  if (!actions) {
    return;
  }

  actions.style.display = navMode === "toc" ? "block" : "none";

  const disabled = !currentEntry;
  $("#prepareTocBtn").disabled = disabled;
  $("#importTopicsBtn").disabled = disabled;
}


/*
 * v5 topics renderer: same navigation principle as "Питання", but supports
 * title/start/end/summary/level from topics.json v1.
 */
renderMiddleNavigation = function () {
  const list = $("#tocList");

  list.innerHTML = "";

  $("#tocTab").classList.toggle("active", navMode === "toc");
  $("#questionsTab").classList.toggle("active", navMode === "questions");

  updateTocActionsVisibility();

  if (!currentConversation) {
    list.innerHTML = '<div class="toc-empty">Оберіть чат.</div>';
    return;
  }

  if (navMode === "toc") {
    const topics =
      Array.isArray(currentTopics) && currentTopics.length
        ? currentTopics
        : [{
            title: "Огляд чату",
            start_message_id: null,
            end_message_id: null,
            summary: "",
            level: 1
          }];

    for (const topic of topics) {
      const button = document.createElement("button");
      const level = Math.max(1, Math.min(6, Number(topic.level) || 1));

      button.className = "toc-link topic-link";
      button.textContent = topic.title || "Без назви";
      button.style.paddingLeft = `${10 + (level - 1) * 16}px`;

      if (topic.summary) {
        button.title = topic.summary;
      }

      button.onclick = () => {
        scrollToMessage(topic.start_message_id || null);
      };

      list.appendChild(button);
    }

    return;
  }

  if (!currentUserMessages.length) {
    list.innerHTML = '<div class="toc-empty">У цьому чаті немає user-повідомлень.</div>';
    return;
  }

  currentUserMessages.forEach((item, index) => {
    const button = document.createElement("button");

    button.className = "toc-link question-link";

    const shortText = shortenAtWordBoundary(
      item.text || "[порожнє повідомлення]"
    );

    button.innerHTML =
      `<span class="question-index">${index + 1}.</span>${esc(shortText)}`;

    button.title = item.text || "";
    button.onclick = () => scrollToMessage(item.messageId);

    list.appendChild(button);
  });
};


async function prepareTocSource() {
  if (!currentEntry) {
    setTocStatus("Спочатку оберіть чат.", "error");
    return;
  }

  setTocStatus("Готую toc_source.md…");

  try {
    const response = await fetch(
      `/api/toc-source?chat_id=${encodeURIComponent(currentEntry.id)}`,
      {cache: "no-store"}
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "toc_source.md";
    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);

    setTocStatus(
      "toc_source.md готовий. Передайте його ChatGPT для аналізу змісту.",
      "ok"
    );
  }
  catch (error) {
    setTocStatus(error.message || String(error), "error");
  }
}


async function importTopicsFile(file) {
  if (!currentEntry || !file) {
    return;
  }

  setTocStatus("Перевіряю topics.json…");

  try {
    const text = await file.text();
    const topics = JSON.parse(text);

    if (!Array.isArray(topics)) {
      throw new Error("topics.json повинен містити JSON-масив.");
    }

    const response = await fetch("/api/import-topics", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        chat_id: currentEntry.id,
        topics
      })
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok || !result.ok) {
      throw new Error(result.error || `${response.status} ${response.statusText}`);
    }

    currentTopics = result.topics || topics;
    navMode = "toc";
    renderMiddleNavigation();

    setTocStatus(result.message || "Зміст імпортовано.", "ok");
  }
  catch (error) {
    setTocStatus(error.message || String(error), "error");
  }
  finally {
    $("#topicsFileInput").value = "";
  }
}


$("#prepareTocBtn").onclick = prepareTocSource;

$("#importTopicsBtn").onclick = () => {
  if (!currentEntry) {
    setTocStatus("Спочатку оберіть чат.", "error");
    return;
  }

  $("#topicsFileInput").click();
};

$("#topicsFileInput").addEventListener("change", event => {
  const file = event.target.files?.[0];
  importTopicsFile(file);
});

/* app.js already switches navMode; these listeners only refresh action state. */
$("#tocTab").addEventListener("click", () => {
  window.setTimeout(() => {
    renderMiddleNavigation();
    setTocStatus();
  }, 0);
});

$("#questionsTab").addEventListener("click", () => {
  window.setTimeout(() => {
    renderMiddleNavigation();
    setTocStatus();
  }, 0);
});


waitForCatalogAndSort();
updateTocActionsVisibility();
