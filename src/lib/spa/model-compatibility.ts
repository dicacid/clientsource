export function supportsResearchChat(model: { id: string; outputModalities?: string[]; supportedEndpoints?: string[] }) {
  if (/:batch(?:$|:)/i.test(model.id)) return false;
  if (model.outputModalities?.length && !model.outputModalities.includes("text")) return false;
  if (model.supportedEndpoints?.length && !model.supportedEndpoints.some((endpoint) => /(?:^|\/)chat(?:\/completions)?$/.test(endpoint))) return false;
  return true;
}

export function assertResearchModel(model: string) {
  if (!supportsResearchChat({ id: model })) {
    throw new Error("This batch model cannot run interactive research. Select a chat model in AI & Models.");
  }
}
