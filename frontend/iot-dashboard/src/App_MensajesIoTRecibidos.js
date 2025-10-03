import React, { useEffect, useState } from "react";

export default function WebSocketViewer() {
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    // 1. Abrir conexión WebSocket
    const ws = new WebSocket("wss://o3ppujthph.execute-api.eu-west-1.amazonaws.com/production/");

    ws.onopen = () => {
      console.log("✅ WebSocket conectado");
    };

    // 2. Escuchar mensajes de Lambda
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("📩 Mensaje recibido:", data);

        // Guardar en el estado (agregando al historial)
        setMessages((prev) => [...prev, data]);
      } catch (err) {
        console.error("Error parseando mensaje:", err);
      }
    };

    ws.onclose = () => {
      console.log("❌ WebSocket cerrado");
    };

    // 3. Limpiar al desmontar
    return () => ws.close();
  }, []);

  return (
    <div>
      <h2>Mensajes IoT recibidos</h2>
      <ul>
        {messages.map((msg, index) => (
          <li key={index}>
            <strong>{msg.topic}:</strong> {JSON.stringify(msg.payload)}
          </li>
        ))}
      </ul>
    </div>
  );
}
