import { useEffect, useRef, useState } from "react";

const CHAT_SERVER_URL = (import.meta.env.VITE_CHAT_SERVER_URL as string | undefined)
  ?? "ws://localhost:3001";

type ChatMessage = {
  id: number;
  from: string;
  text: string;
  isSystem: boolean;
};

type Props = {
  gameId: bigint;
  midnightAddressHash: string;
  /** Chat channel to connect to. Defaults to "general". */
  channel?: string;
  /** Header label. Defaults to "Game Chat". */
  label?: string;
};

export function GameChat({ gameId, midnightAddressHash, channel = "general", label = "Game Chat" }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const url = `${CHAT_SERVER_URL}/chat/${gameId}/${channel}`;
    const ws = new WebSocket(url);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "identify", midnightAddressHash }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === "identified") {
        setConnected(true);
        return;
      }

      if (msg.type === "message") {
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now() + Math.random(),
            from: msg.from,
            text: msg.text,
            isSystem: false,
          },
        ]);
        return;
      }

      if (msg.type === "system") {
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now() + Math.random(),
            from: "System",
            text: msg.text,
            isSystem: true,
          },
        ]);
        return;
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

    ws.onclose = () => {
      setConnected(false);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          from: "System",
          text: "Disconnected from chat.",
          isSystem: true,
        },
      ]);
    };

    return () => {
      ws.close();
    };
  }, [gameId, midnightAddressHash, channel]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className={`chat-panel${channel === "werewolf" ? " werewolf-chat-panel" : ""}`}>
      <div className="chat-header">
        {label}
        <span className={`chat-status ${connected ? "chat-status-connected" : "chat-status-disconnected"}`}>
          {connected ? "connected" : "connecting…"}
        </span>
      </div>
      <div className="chat-messages">
        {messages.length === 0
          ? <div className="chat-empty">No messages yet</div>
          : messages.map((msg) => (
            <div
              key={msg.id}
              className={`chat-message ${msg.isSystem ? "chat-message-system" : ""}`}
            >
              <span className="chat-message-from">{msg.from}</span>
              {": "}
              {msg.text}
            </div>
          ))}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
