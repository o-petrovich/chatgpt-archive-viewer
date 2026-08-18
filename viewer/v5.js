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


waitForCatalogAndSort();
