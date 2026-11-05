import type { Check } from "./types.js";

export const itemsPresentWhenServing: Check = (quote) => {
  const passed = !quote.can_serve || quote.items.length > 0;
  return {
    name: "itemsPresentWhenServing",
    passed,
    detail: passed
      ? quote.can_serve
        ? `${quote.items.length} item(s) listed`
        : "can_serve is false, so items may be empty"
      : "can_serve is true but items is empty",
  };
};
