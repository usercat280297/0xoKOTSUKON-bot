export function slugifyTicketName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function shortenId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toLowerCase();
}

export function formatPanelSummary(name: string, active: boolean, optionCount: number, channelId: string, panelId: string): string {
  return [
    `Panel: ${name}`,
    `ID: ${panelId}`,
    `Status: ${active ? "active" : "disabled"}`,
    `Channel: <#${channelId}>`,
    `Options: ${optionCount}`
  ].join("\n");
}
