import { startChatServer } from "./server.ts";

const port = Number(process.env["CHAT_SERVER_PORT"] ?? "3001");
startChatServer(port);
