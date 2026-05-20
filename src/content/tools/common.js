/**
 * Shared UI builders for tool cards and download cards.
 */


/**
 * Create a tool card shell with header and body.
 */
export function createToolCardShell(title, subtitle) {
  const element = document.createElement("article");
  element.className = "bap-tool-card";

  const header = document.createElement("header");
  header.className = "bap-tool-card-header";

  const titleNode = document.createElement("h4");
  titleNode.textContent = title;

  const subtitleNode = document.createElement("p");
  subtitleNode.textContent = subtitle;

  header.appendChild(titleNode);
  header.appendChild(subtitleNode);

  const body = document.createElement("div");
  body.className = "bap-tool-card-body";

  element.appendChild(header);
  element.appendChild(body);

  return { element, body };
}


