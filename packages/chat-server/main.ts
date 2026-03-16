import { startChatServer } from "./server.ts";

const port = Number(Deno.env.get("CHAT_SERVER_PORT") ?? "3001");
startChatServer(port);
