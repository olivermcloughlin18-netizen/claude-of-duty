// System stub (PLAN.md 3.4). Lane M fills this file in; the shape below is the
// contract index.html codes against, so every member must stay.
export const system = {
  name: 'net',
  debug: {},
  init(ctx) {},
  update(dt, frame) {},
  onKey(code) { return false; },
  onTouchAction(action) { return false; },
  reset() {},
  getState() { return {}; },
  async connect(config) { return false; },
  get online() { return false; },
  get roomMapId() { return null; },
  threats() { return []; },
};

export default system;
