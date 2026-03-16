import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../types.ts";

const CHAT_WS_URL = "ws://localhost:3001";

type Props = {
  gameId: number;
  channel?: string;
  label?: string;
};

export function ChatPanel({
  gameId,
  channel = "general",
  label = "Game Chat",
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const url = `${CHAT_WS_URL}/chat/${gameId}/${channel}`;
    const ws = new WebSocket(url);

    ws.onopen = () => {
      // Admin observer — use a fixed hash
      ws.send(
        JSON.stringify({
          type: "identify",
          publicKeyHex: `admin-observer-${channel}`,
        }),
      );
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === "identified") {
        setConnected(true);
        return;
      }

      if (msg.type === "message" || msg.type === "system") {
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now() + Math.random(),
            from: msg.type === "system" ? "System" : msg.from,
            text: msg.text ?? msg.message ?? "",
            isSystem: msg.type === "system",
          },
        ]);
      }

      if (msg.type === "error") {
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now() + Math.random(),
            from: "System",
            text: `[error] ${msg.message}`,
            isSystem: true,
          },
        ]);
      }
    };

    ws.onclose = () => setConnected(false);

    return () => ws.close();
  }, [gameId, channel]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="chat-panel">
      <div className="chat-header">
        {label}
        <span className={connected ? "status-on" : "status-off"}>
          {connected ? "connected" : "connecting..."}
        </span>
      </div>
      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="empty">No messages yet</div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`chat-msg ${msg.isSystem ? "system" : ""}`}
            >
              <strong>{msg.from}:</strong> {msg.text}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
