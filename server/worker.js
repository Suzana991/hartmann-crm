import { createHandler } from "./src/handler.js";

export default {
  async fetch(request, env) {
    return createHandler(env)(request);
  }
};
