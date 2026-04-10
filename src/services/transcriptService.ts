import type { TranscriptMessage } from "../domain/types";

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export class TranscriptService {
  public render(channelName: string, messages: TranscriptMessage[]): string {
    const rows = messages
      .map((message) => {
        const attachments =
          message.attachments.length === 0
            ? ""
            : `<div class="attachments">${message.attachments
                .map((attachment) => `<a href="${escapeHtml(attachment.url)}">${escapeHtml(attachment.name)}</a>`)
                .join("<br />")}</div>`;

        return `
          <article class="message">
            <img class="avatar" src="${escapeHtml(message.avatarUrl ?? "")}" alt="" />
            <div class="body">
              <header>
                <span class="author">${escapeHtml(message.authorTag)}</span>
                <time>${escapeHtml(message.createdAt.toISOString())}</time>
              </header>
              <p>${escapeHtml(message.content || "[empty]").replaceAll("\n", "<br />")}</p>
              ${attachments}
            </div>
          </article>
        `;
      })
      .join("\n");

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Transcript ${escapeHtml(channelName)}</title>
    <style>
      body {
        font-family: "Segoe UI", sans-serif;
        margin: 0;
        background: #0f172a;
        color: #e2e8f0;
      }
      main {
        max-width: 900px;
        margin: 0 auto;
        padding: 24px;
      }
      .message {
        display: grid;
        grid-template-columns: 48px 1fr;
        gap: 12px;
        padding: 16px 0;
        border-bottom: 1px solid rgba(148, 163, 184, 0.18);
      }
      .avatar {
        width: 48px;
        height: 48px;
        border-radius: 999px;
        background: rgba(148, 163, 184, 0.12);
      }
      header {
        display: flex;
        gap: 12px;
        align-items: baseline;
        margin-bottom: 6px;
      }
      .author {
        font-weight: 700;
      }
      time {
        font-size: 12px;
        color: #94a3b8;
      }
      p {
        margin: 0;
        white-space: pre-wrap;
      }
      .attachments {
        margin-top: 8px;
      }
      a {
        color: #7dd3fc;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Transcript: ${escapeHtml(channelName)}</h1>
      ${rows}
    </main>
  </body>
</html>`;
  }
}
