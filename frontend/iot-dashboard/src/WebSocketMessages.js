// src/components/WebSocketMessages.js
import React, { useState, useEffect, useRef, useCallback } from "react";
import { useDevicePingStatus } from "./hooks/useDevicePingStatus";

export default function WebSocketMessages() {
  const [messages, setMessages] = useState([]);
  const [ws, setWs] = useState(null);
  const lastMessageRef = useRef(null);

  // ✅ función de conexión memorizada con useCallback
  const connect = useCallback(() => {
    const socket = new WebSocket(
      "wss://o3ppujthph.execute-api.eu-west-1.amazonaws.com/production"
    );

    socket.onopen = () => {
      console.log("✅ WebSocket conectado");
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.topic && data.payload !== undefined) {
          const msgString = JSON.stringify(data);

          // 🔎 Evitar duplicados
          if (msgString !== lastMessageRef.current) {
            lastMessageRef.current = msgString;
            setMessages((prev) => [...prev, data]);
          } else {
            console.log("⚪ Mensaje duplicado ignorado:", data);
          }
        } else {
          console.log("⚪ Mensaje ignorado (no es de IoT):", data);
        }
      } catch (e) {
        console.error("Error parsing WS message", e, event.data);
      }
    };

    socket.onclose = () => {
      console.log("❌ WebSocket cerrado, reintentando en 3s...");
      if (socket.pingInterval) clearInterval(socket.pingInterval);
      setTimeout(() => connect(), 3000);
    };

    socket.onerror = (err) => {
      console.error("⚠️ Error en WebSocket:", err);
      socket.close();
    };

    socket.pingInterval = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send("ping");
      }
    }, 60000);

    setWs(socket);
  }, []); // se define solo una vez

  useEffect(() => {
    connect();
    return () => {
      if (ws) ws.close();
    };
  }, [connect]); // ✅ ya no se queja eslint

  // ⬇️ Hook que pregunta al abrir la página
  const { status, refresh } = useDevicePingStatus({
    ws,
    apiUrl: "https://kl7d93xve4.execute-api.eu-west-1.amazonaws.com/dev/",
    deviceId: "d_000",
  });

  return (
    <div style={{ marginTop: "20px", textAlign: "left" }}>
      <h4>
        Estado del dispositivo:{" "}
        {status === "online" && (
          <span style={{ color: "green", fontWeight: "bold" }}>ONLINE</span>
        )}
        {status === "offline" && (
          <span style={{ color: "red", fontWeight: "bold" }}>OFFLINE</span>
        )}
        {status === "checking" && (
          <span style={{ color: "orange" }}>Comprobando...</span>
        )}
      </h4>
      <button onClick={refresh}>Rechequear</button>

      <h4>Mensajes recibidos IoT:</h4>
      <div
        style={{
          background: "#f4f4f4",
          padding: "10px",
          borderRadius: "8px",
          maxHeight: "200px",
          overflowY: "auto",
          fontSize: "14px",
        }}
      >
        {messages.map((msg, idx) => (
          <div
            key={idx}
            style={{
              marginBottom: "8px",
              padding: "6px",
              borderBottom: "1px solid #ccc",
            }}
          >
            <strong>topic:</strong> {msg.topic || "unknown"} <br />
            <strong>payload:</strong>{" "}
            {typeof msg.payload === "object"
              ? JSON.stringify(msg.payload)
              : msg.payload}
          </div>
        ))}
      </div>
    </div>
  );
}
